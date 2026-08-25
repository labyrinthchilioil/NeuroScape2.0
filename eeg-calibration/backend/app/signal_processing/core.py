from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

import numpy as np
from scipy.signal import butter, filtfilt, iirnotch, sosfiltfilt, welch

from app import config
from app.models.schemas import EEGSample

FEATURE_VERSION = "raw_welch_frontal_log_tbr_median_block_protocol_v4"
INCOMPATIBLE_PROFILE_MESSAGE = "Incompatible calibration profile. Please recalibrate."


class IncompatibleCalibrationProfile(ValueError):
    pass


@dataclass
class EpochResult:
    epoch_index: int
    tbr: float | None
    valid_channels: list[str]
    invalid_reasons: dict[str, list[str]]
    channel_tbr: dict[str, float]
    packet_completeness: float
    peak_to_peak_uv: dict[str, float | None]
    quality_flags: list[str] = field(default_factory=list)

    @property
    def usable(self) -> bool:
        return self.tbr is not None

    def as_quality_record(self) -> dict:
        return {
            "epoch_index": self.epoch_index,
            "valid": self.usable,
            "invalid_reasons": self.invalid_reasons,
            "quality_flags": self.quality_flags,
            "valid_channels": self.valid_channels,
            "packet_completeness": self.packet_completeness,
            "peak_to_peak_uv": self.peak_to_peak_uv,
            "epoch_tbr": self.tbr,
            "channel_tbr": self.channel_tbr,
        }


def preprocess(values: np.ndarray, fs: int = config.SAMPLING_RATE_HZ) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    if values.ndim != 1 or len(values) < 32 or not np.all(np.isfinite(values)):
        raise ValueError("Signal must be a finite one-dimensional array with at least 32 samples")
    centered = values - np.mean(values)
    notch_b, notch_a = iirnotch(config.NOTCH_HZ, config.NOTCH_Q, fs)
    notched = filtfilt(notch_b, notch_a, centered)
    sos = butter(
        config.FILTER_ORDER,
        [config.BANDPASS_LOW_HZ, config.BANDPASS_HIGH_HZ],
        btype="bandpass",
        fs=fs,
        output="sos",
    )
    return sosfiltfilt(sos, notched)


def band_power(
    values: np.ndarray,
    low: float,
    high: float,
    fs: int = config.SAMPLING_RATE_HZ,
    *,
    include_high: bool = True,
) -> float:
    frequencies, psd = welch(
        values,
        fs=fs,
        window="hamming",
        nperseg=config.WELCH_NPERSEG,
        noverlap=config.WELCH_NOVERLAP,
        average="median",
    )
    high_mask = frequencies <= high if include_high else frequencies < high
    mask = (frequencies >= low) & high_mask
    if len(frequencies) < 2 or not np.any(mask):
        return 0.0
    frequency_resolution = float(frequencies[1] - frequencies[0])
    return float(np.sum(psd[mask]) * frequency_resolution)


def channel_log_tbr(values: np.ndarray, fs: int = config.SAMPLING_RATE_HZ) -> float:
    theta_power = band_power(values, 4.0, 8.0, fs, include_high=False)
    beta_power = band_power(values, 13.0, 30.0, fs, include_high=True)
    return float(np.log((theta_power + config.EPSILON) / (beta_power + config.EPSILON)))


def create_epochs(samples: list[EEGSample], seconds: int = config.EPOCH_SECONDS) -> list[list[EEGSample]]:
    size = config.SAMPLING_RATE_HZ * seconds
    return [samples[index:index + size] for index in range(0, len(samples) - size + 1, size)]


def packet_completeness(epoch: list[EEGSample], seconds: int = config.EPOCH_SECONDS) -> float:
    if not epoch:
        return 0.0
    nominal = config.SAMPLING_RATE_HZ * seconds
    if len(epoch) < 2:
        return len(epoch) / nominal
    elapsed = max(0.0, epoch[-1].monotonic_timestamp - epoch[0].monotonic_timestamp)
    expected = max(
        nominal,
        round(elapsed * config.SAMPLING_RATE_HZ) + 1,
        epoch[-1].sample_index - epoch[0].sample_index + 1,
    )
    return min(1.0, len({sample.sample_index for sample in epoch}) / expected)


def analyze_segment(samples: list[EEGSample]) -> list[EpochResult]:
    if not samples:
        return []
    filtered: dict[str, np.ndarray | None] = {}
    for channel in ("af7", "af8"):
        try:
            filtered[channel] = preprocess(np.array([getattr(sample, channel) for sample in samples]))
        except ValueError:
            filtered[channel] = None

    results: list[EpochResult] = []
    epoch_size = config.SAMPLING_RATE_HZ * config.EPOCH_SECONDS
    for epoch_index, epoch in enumerate(create_epochs(samples)):
        start, stop = epoch_index * epoch_size, (epoch_index + 1) * epoch_size
        completeness = packet_completeness(epoch)
        invalid: dict[str, list[str]] = {}
        channel_tbrs: dict[str, float] = {}
        peak_to_peak: dict[str, float | None] = {}
        quality_flags = ["blink_overlap"] if any(sample.blink for sample in epoch) else []
        for channel in ("af7", "af8"):
            label = channel.upper()
            reasons: list[str] = []
            values = None if filtered[channel] is None else filtered[channel][start:stop]
            peak_to_peak[label] = None if values is None or not np.all(np.isfinite(values)) else float(np.ptp(values))
            if any(sample.headband_on is False for sample in epoch):
                reasons.append("headband_off")
            hsi_values = [getattr(sample, f"hsi_{channel}") for sample in epoch]
            known_hsi = [value for value in hsi_values if value is not None]
            if known_hsi and sum(value == 4 for value in known_hsi) / len(known_hsi) >= config.MAX_BAD_HSI_FRACTION:
                reasons.append("poor_hsi")
            if completeness < config.MIN_PACKET_COMPLETENESS:
                reasons.append("packet_completeness")
            if values is None or not np.all(np.isfinite(values)):
                reasons.append("non_finite_or_unfilterable")
            elif peak_to_peak[label] is not None and peak_to_peak[label] > config.MAX_PEAK_TO_PEAK_UV:
                reasons.append("peak_to_peak")
            if any(sample.jaw_clench for sample in epoch):
                reasons.append("jaw_clench_overlap")
            if reasons:
                invalid[label] = reasons
            else:
                try:
                    channel_tbrs[label] = channel_log_tbr(values)
                except (ValueError, FloatingPointError):
                    invalid[label] = ["spectral_calculation"]
        epoch_tbr = float(np.median(list(channel_tbrs.values()))) if channel_tbrs else None
        results.append(
            EpochResult(
                epoch_index,
                epoch_tbr,
                list(channel_tbrs),
                invalid,
                channel_tbrs,
                completeness,
                peak_to_peak,
                quality_flags,
            )
        )
    return results


def condition_median(results: Iterable[EpochResult]) -> float | None:
    values = [result.tbr for result in results if result.tbr is not None]
    return float(np.median(values)) if values else None


def median_value(values: Iterable[float | None]) -> float | None:
    finite = [float(value) for value in values if value is not None and np.isfinite(value)]
    return float(np.median(finite)) if finite else None


def pooled_mad(values: Iterable[float | None]) -> float | None:
    finite = np.asarray(
        [float(value) for value in values if value is not None and np.isfinite(value)],
        dtype=float,
    )
    if finite.size == 0:
        return None
    center = np.median(finite)
    return float(np.median(np.abs(finite - center)))


def anchor_summary(focused_values: list[float], free_thought_values: list[float]) -> dict:
    focused_anchor = median_value(focused_values)
    free_thought_anchor = median_value(free_thought_values)
    difference = (
        None
        if focused_anchor is None or free_thought_anchor is None
        else float(free_thought_anchor - focused_anchor)
    )
    variability = pooled_mad([*focused_values, *free_thought_values])
    separation_score = (
        None
        if difference is None or variability is None
        else float(abs(difference) / (variability + config.EPSILON))
    )
    if difference is None:
        direction = None
    elif difference > 0:
        direction = "free_thought_higher"
    elif difference < 0:
        direction = "focused_higher"
    else:
        direction = "no_difference"
    return {
        "focused_meditation_anchor": focused_anchor,
        "free_thought_anchor": free_thought_anchor,
        "difference": difference,
        "direction": direction,
        "pooled_mad": variability,
        "separation_score": separation_score,
        "separation_assessment": {
            "status": "pilot_threshold_not_configured",
            "minimum_absolute_difference": config.MIN_ABSOLUTE_ANCHOR_DIFFERENCE,
            "minimum_separation_score": config.MIN_SEPARATION_SCORE,
            "require_free_thought_higher": config.REQUIRE_FREE_THOUGHT_HIGHER,
        },
    }


def validate_calibration_profile(profile: dict) -> dict:
    if profile.get("feature_version") != FEATURE_VERSION:
        raise IncompatibleCalibrationProfile(INCOMPATIBLE_PROFILE_MESSAGE)
    return profile
