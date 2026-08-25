from __future__ import annotations

import socket
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable

from pythonosc import dispatcher
from pythonosc.osc_server import ThreadingOSCUDPServer

from app import config
from app.models.schemas import EEGSample


def parse_eeg_arguments(arguments: tuple | list) -> tuple[float, float, float, float, float | None]:
    if len(arguments) not in (4, 5):
        raise ValueError("/muse/eeg requires four or five numeric arguments")
    try:
        values = tuple(float(value) for value in arguments)
    except (TypeError, ValueError) as exc:
        raise ValueError("/muse/eeg arguments must be numeric") from exc
    return values[0], values[1], values[2], values[3], values[4] if len(values) == 5 else None


@dataclass
class SensorState:
    hsi: list[int | None] = field(default_factory=lambda: [None] * 4)
    headband_on: bool | None = None
    acc: list[float | None] = field(default_factory=lambda: [None] * 3)
    gyro: list[float | None] = field(default_factory=lambda: [None] * 3)
    blink_until: float = 0.0
    jaw_until: float = 0.0


class MuseOSCReceiver:
    def __init__(self, osc_callback: Callable[[dict], None] | None = None, eeg_callback: Callable[[EEGSample], None] | None = None) -> None:
        self.osc_callback = osc_callback
        self.eeg_callback = eeg_callback
        self.lock = threading.RLock()
        self.samples: deque[EEGSample] = deque(maxlen=config.SAMPLING_RATE_HZ * config.BUFFER_SECONDS)
        self.waveform: deque[dict] = deque(maxlen=config.WAVEFORM_RATE_HZ * 20)
        self.sensor = SensorState()
        self.total_events = 0
        self.total_eeg_samples = 0
        self.total_blink_events = 0
        self.session_blink_events = 0
        self.last_blink_timestamp: float | None = None
        self.malformed_messages = 0
        self.first_eeg_timestamp: float | None = None
        self.last_message_timestamp: float | None = None
        self._server: ThreadingOSCUDPServer | None = None
        self._thread: threading.Thread | None = None
        self._session_start: float | None = None
        self._waveform_stride = max(1, config.SAMPLING_RATE_HZ // config.WAVEFORM_RATE_HZ)

    def set_session_start(self, timestamp: float | None) -> None:
        with self.lock:
            self._session_start = timestamp
            self.session_blink_events = 0
            self.last_blink_timestamp = None

    def handle(self, address: str, *args) -> None:
        now = time.monotonic()
        with self.lock:
            self.total_events += 1
            self.last_message_timestamp = now
        record = {"monotonic_timestamp": now, "session_elapsed_seconds": self.elapsed(now), "osc_address": address, "arguments": list(args), "eeg_sample_index": None}
        try:
            if address == "/muse/eeg":
                values = parse_eeg_arguments(args)
                with self.lock:
                    index = self.total_eeg_samples
                    self.total_eeg_samples += 1
                    if self.first_eeg_timestamp is None:
                        self.first_eeg_timestamp = now
                    sensor = self.sensor
                    sample = EEGSample(
                        sample_index=index, monotonic_timestamp=now, session_elapsed_seconds=self.elapsed(now),
                        tp9=values[0], af7=values[1], af8=values[2], tp10=values[3], aux_right=values[4],
                        headband_on=sensor.headband_on, hsi_tp9=sensor.hsi[0], hsi_af7=sensor.hsi[1],
                        hsi_af8=sensor.hsi[2], hsi_tp10=sensor.hsi[3], acc_x=sensor.acc[0], acc_y=sensor.acc[1],
                        acc_z=sensor.acc[2], gyro_x=sensor.gyro[0], gyro_y=sensor.gyro[1], gyro_z=sensor.gyro[2],
                        blink=now <= sensor.blink_until, jaw_clench=now <= sensor.jaw_until,
                    )
                    self.samples.append(sample)
                    if index % self._waveform_stride == 0:
                        self.waveform.append({"sample_index": index, "af7": sample.af7, "af8": sample.af8})
                record["eeg_sample_index"] = index
                if self.eeg_callback:
                    self.eeg_callback(sample)
            elif address == "/muse/elements/horseshoe":
                if len(args) < 4: raise ValueError("horseshoe requires four values")
                with self.lock: self.sensor.hsi = [int(v) for v in args[:4]]
            elif address == "/muse/elements/touching_forehead":
                if not args: raise ValueError("touching_forehead requires a value")
                with self.lock: self.sensor.headband_on = bool(int(args[0]))
            elif address == "/muse/acc":
                if len(args) < 3: raise ValueError("acc requires three values")
                with self.lock: self.sensor.acc = [float(v) for v in args[:3]]
            elif address == "/muse/gyro":
                if len(args) < 3: raise ValueError("gyro requires three values")
                with self.lock: self.sensor.gyro = [float(v) for v in args[:3]]
            elif address == "/muse/elements/blink":
                if args and bool(args[0]):
                    with self.lock:
                        self.sensor.blink_until = now + config.BLINK_EXCLUSION_SECONDS
                        self.total_blink_events += 1
                        if self._session_start is not None:
                            self.session_blink_events += 1
                        self.last_blink_timestamp = now
            elif address == "/muse/elements/jaw_clench":
                if args and bool(args[0]):
                    with self.lock: self.sensor.jaw_until = now + config.JAW_EXCLUSION_SECONDS
        except (ValueError, TypeError, OverflowError):
            with self.lock: self.malformed_messages += 1
            record["malformed"] = True
        if self.osc_callback:
            self.osc_callback(record)

    def elapsed(self, now: float | None = None) -> float | None:
        if self._session_start is None: return None
        return (now or time.monotonic()) - self._session_start

    def snapshot_samples(self, start_index: int | None = None, end_index: int | None = None) -> list[EEGSample]:
        with self.lock:
            return [s for s in self.samples if (start_index is None or s.sample_index >= start_index) and (end_index is None or s.sample_index < end_index)]

    def nearest_sample_index(self, timestamp: float) -> int | None:
        with self.lock:
            if not self.samples: return None
            return min(self.samples, key=lambda sample: abs(sample.monotonic_timestamp - timestamp)).sample_index

    def estimated_rate(self, seconds: float = 10.0) -> float:
        cutoff = time.monotonic() - seconds
        with self.lock:
            recent = [s for s in self.samples if s.monotonic_timestamp >= cutoff]
        if len(recent) < 2: return 0.0
        span = recent[-1].monotonic_timestamp - recent[0].monotonic_timestamp
        return (len(recent) - 1) / span if span > 0 else 0.0

    def status(self) -> dict:
        now = time.monotonic()
        with self.lock:
            age = None if self.last_message_timestamp is None else now - self.last_message_timestamp
            rate = self.estimated_rate()
            connected = bool(self.total_eeg_samples and age is not None and age < config.CONNECTION_RECENT_SECONDS)
            waveform_visible = connected and self.sensor.headband_on is True
            if not waveform_visible:
                self.waveform.clear()
            return {
                "connected": connected, "total_eeg_samples": self.total_eeg_samples,
                "estimated_sample_rate_hz": round(rate, 2), "last_packet_age_seconds": age,
                "headband_on": self.sensor.headband_on,
                "hsi": dict(zip(("TP9", "AF7", "AF8", "TP10"), self.sensor.hsi)),
                "accelerometer": self.sensor.acc, "gyroscope": self.sensor.gyro,
                "malformed_messages": self.malformed_messages,
                "blink_events_total": self.total_blink_events,
                "blink_events_session": self.session_blink_events,
                "last_blink_age_seconds": (
                    None if self.last_blink_timestamp is None else now - self.last_blink_timestamp
                ),
                "packet_completeness": min(1.0, rate / config.SAMPLING_RATE_HZ) if rate else 0.0,
                "low_rate_warning": connected and rate < config.SAMPLING_RATE_HZ * config.MIN_PACKET_COMPLETENESS,
                "real_data_seconds": 0.0 if self.first_eeg_timestamp is None else now - self.first_eeg_timestamp,
                "waveform": list(self.waveform) if waveform_visible else [],
            }

    def start(self) -> None:
        if self._server: return
        route = dispatcher.Dispatcher()
        for address in ("/muse/eeg", "/muse/elements/horseshoe", "/muse/elements/touching_forehead", "/muse/acc", "/muse/gyro", "/muse/elements/blink", "/muse/elements/jaw_clench"):
            route.map(address, self.handle)
        self._server = ThreadingOSCUDPServer((config.OSC_HOST, config.OSC_PORT), route)
        self._thread = threading.Thread(target=self._server.serve_forever, name="muse-osc", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server:
            self._server.shutdown(); self._server.server_close(); self._server = None
        if self._thread:
            self._thread.join(timeout=3); self._thread = None


def local_ipv4() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        try: return socket.gethostbyname(socket.gethostname())
        except OSError: return "Unavailable"
    finally:
        sock.close()
