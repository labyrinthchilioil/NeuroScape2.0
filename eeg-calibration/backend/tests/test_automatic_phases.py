from __future__ import annotations

import time
from pathlib import Path

import pytest

from app import config
from app.calibration.service import CalibrationService, FOCUSED, FREE_THOUGHT
from app.models.schemas import CalibrationState, SelfReportSubmit
from app.storage.session_store import SessionStore


class ManualTimer:
    instances: list["ManualTimer"] = []

    def __init__(self, interval: float, callback) -> None:
        self.interval = interval
        self.callback = callback
        self.daemon = False
        self.started = False
        self.cancelled = False
        self.instances.append(self)

    def start(self) -> None:
        self.started = True

    def cancel(self) -> None:
        self.cancelled = True

    def fire(self) -> None:
        if not self.cancelled:
            self.callback()


class ReadyReceiver:
    def __init__(self) -> None:
        self.osc_callback = None
        self.eeg_callback = None
        self.total_eeg_samples = 3000
        self._session_start: float | None = None
        self._marker_index = 0
        self.session_blink_events = 0

    def set_session_start(self, timestamp: float | None) -> None:
        self._session_start = timestamp

    def elapsed(self, now: float | None = None) -> float | None:
        if self._session_start is None:
            return None
        return (now or time.monotonic()) - self._session_start

    def nearest_sample_index(self, _timestamp: float) -> int:
        value = self._marker_index
        self._marker_index += 1
        return value

    def snapshot_samples(self, _start=None, _end=None):
        return []

    def status(self):
        return {
            "connected": True,
            "total_eeg_samples": self.total_eeg_samples,
            "estimated_sample_rate_hz": 256.0,
            "last_packet_age_seconds": 0.01,
            "headband_on": True,
            "hsi": {"TP9": 1, "AF7": 1, "AF8": 1, "TP10": 1},
            "accelerometer": [None, None, None],
            "gyroscope": [None, None, None],
            "malformed_messages": 0,
            "packet_completeness": 1.0,
            "low_rate_warning": False,
            "real_data_seconds": 20.0,
            "blink_events_total": self.session_blink_events,
            "blink_events_session": self.session_blink_events,
            "last_blink_age_seconds": None,
            "waveform": [],
        }

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass


def ready_service(tmp_path: Path, participant: str = "P1") -> CalibrationService:
    ManualTimer.instances.clear()
    service = CalibrationService(store=SessionStore(tmp_path), receiver=ReadyReceiver(), timer_factory=ManualTimer)
    service.create_session(participant)
    service.machine.transition(CalibrationState.READY)
    return service


def test_participant_parity_assigns_order_and_schedule(tmp_path):
    odd = ready_service(tmp_path / "odd", "P1")
    assert odd.calibration_order == "A"
    assert [task["condition"] for task in odd.original_schedule] == [FOCUSED, FREE_THOUGHT, FOCUSED, FREE_THOUGHT]
    odd.shutdown()
    even = ready_service(tmp_path / "even", "P2")
    assert even.calibration_order == "B"
    assert [task["condition"] for task in even.original_schedule] == [FREE_THOUGHT, FOCUSED, FREE_THOUGHT, FOCUSED]
    even.shutdown()


def test_acclimation_and_block_have_automatic_timers_and_self_report_gate(tmp_path):
    service = ready_service(tmp_path)
    start = service.start_acclimation()
    acclimation_timer = ManualTimer.instances[0]
    assert start.event == "ACCLIMATION_START"
    assert acclimation_timer.interval == config.ACCLIMATION_SECONDS == 60
    assert service.machine.state == CalibrationState.ACCLIMATION
    acclimation_timer.fire()
    assert service.machine.state == CalibrationState.ACCLIMATION_COMPLETE
    service.accept_acclimation()
    assert service.machine.state == CalibrationState.BLOCK_READY
    block_start = service.start_block()
    block_timer = ManualTimer.instances[1]
    assert block_start.condition == FOCUSED
    assert block_timer.interval == config.BLOCK_SECONDS == 75
    block_timer.fire()
    assert service.machine.state == CalibrationState.SELF_REPORT
    response = service.submit_self_report(SelfReportSubmit(mind_wandering=2, drowsiness=2))
    assert response["subjective_validity"]["status"] == "pass"
    assert response["subjective_ideal_distance"] == 2
    assert service.machine.state == CalibrationState.BLOCK_READY
    service.shutdown()


def test_step_two_status_reports_live_and_completed_recording_blink_events(tmp_path):
    service = ready_service(tmp_path)
    service.start_acclimation()
    service.receiver.session_blink_events = 2
    live = service.status(include_waveform=False)["connection"]
    assert live["blink_events_current_or_last_recording"] == 2
    assert live["blink_events_current_or_last_label"] == "Acclimation 1"
    ManualTimer.instances[0].fire()
    completed = service.status(include_waveform=False)["connection"]
    assert completed["blink_events_current_or_last_recording"] == 2
    service.accept_acclimation()
    service.start_block()
    service.receiver.session_blink_events = 5
    block_live = service.status(include_waveform=False)["connection"]
    assert block_live["blink_events_current_or_last_recording"] == 3
    assert block_live["blink_events_current_or_last_label"] == "Focused Meditation"
    service.shutdown()


def test_early_end_is_recorded_and_cannot_be_accepted_for_acclimation(tmp_path):
    service = ready_service(tmp_path)
    service.start_acclimation()
    marker = service.end_acclimation_early()
    assert marker.completed_automatically is False
    with pytest.raises(ValueError, match="cannot be accepted"):
        service.accept_acclimation()
    service.shutdown()


@pytest.mark.parametrize(
    ("condition", "mw", "drowsiness", "expected"),
    [
        (FOCUSED, 3, 3, "pass"),
        (FOCUSED, 4, 2, "borderline"),
        (FOCUSED, 5, 2, "invalid"),
        (FREE_THOUGHT, 5, 3, "pass"),
        (FREE_THOUGHT, 4, 2, "borderline"),
        (FREE_THOUGHT, 3, 2, "invalid"),
        (FREE_THOUGHT, 6, 4, "borderline"),
        (FREE_THOUGHT, 6, 5, "invalid"),
    ],
)
def test_subjective_validity_rules(condition, mw, drowsiness, expected):
    report = SelfReportSubmit(mind_wandering=mw, drowsiness=drowsiness)
    assert CalibrationService._subjective_validity(condition, report)["status"] == expected


def eeg_quality(values: list[float], blink_epochs: int = 0) -> dict:
    epoch_details = [
        {"packet_completeness": 1.0, "valid_channels": ["AF7", "AF8"]}
        for _ in values
    ]
    return {
        "status": "pass",
        "reasons": [],
        "expected_epochs": 6,
        "total_epochs": 6,
        "valid_epochs": len(values),
        "invalid_epochs": 6 - len(values),
        "blink_epochs": blink_epochs,
        "packet_completeness": 1.0,
        "rejection_counts": {},
        "channel_contributions": {"AF7": len(values), "AF8": len(values)},
        "epoch_tbrs": values,
        "epoch_details": epoch_details,
    }


def protocol_block(block_id: str, condition: str, sequence: int, values: list[float]) -> dict:
    return {
        "task_id": block_id,
        "block_id": block_id,
        "condition": condition,
        "condition_label": condition,
        "condition_block_number": 1 if sequence < 3 else 2,
        "sequence_number": sequence,
        "actual_sequence_number": sequence,
        "is_redo": False,
        "redo_of_block_id": None,
        "redo_reason": None,
        "duration_seconds": 75.0,
        "completed_automatically": True,
        "self_report": {"mind_wandering": 2 if condition == FOCUSED else 6, "drowsiness": 2, "investigator_notes": "", "unable_to_judge": False},
        "subjective_validity": {"status": "pass", "reasons": []},
        "eeg_quality": eeg_quality(values),
        "eligible_for_anchor": True,
        "included_in_anchor": False,
    }


def test_valid_collection_generates_provisional_median_profile(tmp_path):
    service = ready_service(tmp_path)
    service.blocks = [
        protocol_block("f1", FOCUSED, 1, [1, 2, 3, 4, 100]),
        protocol_block("t1", FREE_THOUGHT, 2, [10, 11, 12, 13, 14]),
        protocol_block("f2", FOCUSED, 3, [5, 6, 7, 8, 9]),
        protocol_block("t2", FREE_THOUGHT, 4, [15, 16, 17, 18, 19]),
    ]
    profile = service._process()
    assert profile["focused_meditation_anchor"] == pytest.approx(5.5)
    assert profile["free_thought_anchor"] == pytest.approx(14.5)
    assert profile["difference"] == pytest.approx(9.0)
    assert profile["ready_to_continue"] is True
    assert profile["mapping_status"] == "provisional"
    assert profile["mapping_available"] is False
    assert (service.store.session_dir / "calibration_record.json").exists()
    service.shutdown()


def test_one_eligible_block_per_condition_is_enough_for_profile(tmp_path):
    service = ready_service(tmp_path)
    service.blocks = [
        protocol_block("f1", FOCUSED, 1, [1, 2, 3, 4]),
        protocol_block("t1", FREE_THOUGHT, 2, [10, 11, 12, 13]),
    ]
    profile = service._process()
    assert profile["focused_meditation_anchor"] == pytest.approx(2.5)
    assert profile["free_thought_anchor"] == pytest.approx(11.5)
    assert profile["ready_to_continue"] is True
    assert profile["selected_block_ids"] == ["f1", "t1"]
    service.shutdown()


def test_reset_cancels_active_phase_timer(tmp_path):
    service = ready_service(tmp_path)
    service.start_acclimation()
    active_timer = ManualTimer.instances[0]
    service.reset()
    assert active_timer.cancelled
    assert service.machine.state == CalibrationState.IDLE
