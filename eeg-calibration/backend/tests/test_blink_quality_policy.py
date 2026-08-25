from __future__ import annotations

import numpy as np

from app import config
from app.calibration.service import CalibrationService, FOCUSED, FREE_THOUGHT
from app.models.schemas import SelfReportSubmit
from app.signal_processing.core import analyze_segment
from app.storage.session_store import SessionStore


def test_blink_is_a_soft_epoch_flag(make_samples):
    samples = make_samples()
    samples[len(samples) // 2].blink = True
    result = analyze_segment(samples)[0]
    assert result.usable
    assert result.quality_flags == ["blink_overlap"]
    assert all("blink_overlap" not in reasons for reasons in result.invalid_reasons.values())


def test_peak_to_peak_rejects_only_the_affected_channel(make_samples):
    samples = make_samples()
    time_axis = np.arange(len(samples)) / config.SAMPLING_RATE_HZ
    high_amplitude = 220 * np.sin(2 * np.pi * 6 * time_axis)
    for index, sample in enumerate(samples):
        sample.af8 = float(high_amplitude[index])
    result = analyze_segment(samples)[0]
    assert result.usable
    assert result.valid_channels == ["AF7"]
    assert result.peak_to_peak_uv["AF8"] > config.MAX_PEAK_TO_PEAK_UV
    assert "peak_to_peak" in result.invalid_reasons["AF8"]


def block(
    block_id: str,
    condition: str,
    sequence: int,
    blink_epochs: int,
    valid_epochs: int = 5,
    blink_events: int = 0,
    ideal_distance: int = 0,
):
    values = [float(sequence)] * valid_epochs
    return {
        "block_id": block_id,
        "condition": condition,
        "actual_sequence_number": sequence,
        "eligible_for_anchor": True,
        "included_in_anchor": False,
        "blink_event_count": blink_events,
        "subjective_ideal_distance": ideal_distance,
        "eeg_quality": {
            "blink_epochs": blink_epochs,
            "valid_epochs": valid_epochs,
            "invalid_epochs": 6 - valid_epochs,
            "total_epochs": 6,
            "epoch_tbrs": values,
            "rejection_counts": {},
            "channel_contributions": {"AF7": valid_epochs, "AF8": valid_epochs},
        },
    }


def test_blink_burden_is_recorded_but_never_gates_condition_quality(tmp_path):
    service = CalibrationService(store=SessionStore(tmp_path))
    service.blocks = [
        block("f1", FOCUSED, 1, 6), block("f2", FOCUSED, 2, 6),
        block("t1", FREE_THOUGHT, 3, 0), block("t2", FREE_THOUGHT, 4, 0),
    ]
    evaluation = service._condition_evaluation()[FOCUSED]
    assert config.MAX_BLINK_EPOCHS_PER_CONDITION is None
    assert evaluation["status"] == "pass"
    assert evaluation["blink_epochs"] == 12
    assert all("blink" not in issue for issue in evaluation["issues"])
    service.store.close()


def test_subjective_ideal_distance_uses_condition_specific_targets():
    assert CalibrationService._subjective_ideal_distance(
        FOCUSED, SelfReportSubmit(mind_wandering=1, drowsiness=1)
    ) == 0
    assert CalibrationService._subjective_ideal_distance(
        FOCUSED, SelfReportSubmit(mind_wandering=3, drowsiness=2)
    ) == 3
    assert CalibrationService._subjective_ideal_distance(
        FREE_THOUGHT, SelfReportSubmit(mind_wandering=7, drowsiness=1)
    ) == 0
    assert CalibrationService._subjective_ideal_distance(
        FREE_THOUGHT, SelfReportSubmit(mind_wandering=5, drowsiness=3)
    ) == 4


def test_confirmed_selection_key_applies_each_priority_in_order():
    cases = [
        (block("valid", FOCUSED, 1, 6, 6, 99, 10), block("other", FOCUSED, 2, 0, 5, 0, 0)),
        (block("blink_epoch", FOCUSED, 1, 1, 5, 99, 10), block("other", FOCUSED, 2, 2, 5, 0, 0)),
        (block("blink_event", FOCUSED, 1, 1, 5, 1, 10), block("other", FOCUSED, 2, 1, 5, 2, 0)),
        (block("subjective", FOCUSED, 1, 1, 5, 1, 1), block("other", FOCUSED, 2, 1, 5, 1, 2)),
        (block("later", FOCUSED, 5, 1, 5, 1, 1), block("other", FOCUSED, 1, 1, 5, 1, 1)),
    ]
    for preferred, other in cases:
        ranked = sorted([other, preferred], key=CalibrationService._block_selection_key)
        assert ranked[0]["block_id"] == preferred["block_id"]


def test_condition_selection_uses_later_block_only_after_all_other_ties(tmp_path):
    service = CalibrationService(store=SessionStore(tmp_path))
    service.blocks = [
        block("f1", FOCUSED, 1, 1, 5, 3, 1),
        block("f2", FOCUSED, 2, 6, 6, 10, 10),
        block("f3", FOCUSED, 5, 1, 5, 3, 1),
        block("t1", FREE_THOUGHT, 3, 0), block("t2", FREE_THOUGHT, 4, 0),
    ]
    evaluation = service._condition_evaluation()[FOCUSED]
    assert evaluation["selected_block_ids"] == ["f2", "f3"]
    assert evaluation["status"] == "pass"
    service.store.close()


def test_condition_passes_with_one_eligible_four_epoch_block(tmp_path):
    service = CalibrationService(store=SessionStore(tmp_path))
    service.blocks = [block("f1", FOCUSED, 1, 0, valid_epochs=4)]
    evaluation = service._condition_evaluation()[FOCUSED]
    assert evaluation["status"] == "pass"
    assert evaluation["selected_block_ids"] == ["f1"]
    assert evaluation["valid_epochs"] == 4
    service.store.close()
