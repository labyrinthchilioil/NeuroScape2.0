import time

from app.calibration.service import CalibrationService
from app.osc.receiver import MuseOSCReceiver
from app.signal_processing.core import FEATURE_VERSION


def test_live_epoch_starts_after_calibration_and_emits_new_tbr(make_samples):
    receiver = MuseOSCReceiver()
    receiver.samples.extend(make_samples(seconds=10, start=0))
    receiver.total_eeg_samples = len(receiver.samples)
    receiver.last_message_timestamp = time.monotonic()
    service = CalibrationService(receiver=receiver)
    service.result = {
        "feature_version": FEATURE_VERSION,
        "ready_to_continue": True,
    }

    start = service.start_live_session()
    assert start["after_sample_index"] == 2559

    waiting = service.live_epoch(start["after_sample_index"])
    assert waiting == {
        "ready": False,
        "available_samples": 0,
        "required_samples": 2560,
    }

    receiver.samples.extend(make_samples(seconds=10, start=2560))
    epoch = service.live_epoch(start["after_sample_index"])
    assert epoch["ready"] is True
    assert epoch["start_sample_index"] == 2560
    assert epoch["end_sample_index"] == 5119
    assert epoch["valid"] is True
    assert epoch["log_tbr"] is not None
    assert epoch["quality_score"] > 0.9


def test_raw_recording_uses_a_new_sample_boundary(make_samples):
    receiver = MuseOSCReceiver()
    receiver.samples.extend(make_samples(seconds=1, start=0))
    receiver.total_eeg_samples = len(receiver.samples)
    receiver.last_message_timestamp = time.monotonic()
    service = CalibrationService(receiver=receiver)

    start = service.start_raw_live_recording()
    assert start["after_sample_index"] == 255
    receiver.samples.extend(make_samples(seconds=1, start=256))
    recorded = service.live_raw_samples(start["after_sample_index"])
    assert recorded[0].sample_index == 256
    assert recorded[-1].sample_index == 511
