from __future__ import annotations

import csv
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.calibration.machine import CalibrationStateMachine, InvalidTransition
from app.main import app
from app.models.schemas import CalibrationState, EEGSample, SessionCreate
from app.storage.session_store import SessionStore


def test_valid_protocol_state_machine_progression():
    machine = CalibrationStateMachine()
    for state in (
        CalibrationState.CONNECTION_CHECK,
        CalibrationState.READY,
        CalibrationState.ACCLIMATION,
        CalibrationState.ACCLIMATION_COMPLETE,
        CalibrationState.BLOCK_READY,
        CalibrationState.BLOCK_RECORDING,
        CalibrationState.SELF_REPORT,
        CalibrationState.PROCESSING,
        CalibrationState.COMPLETE,
    ):
        machine.transition(state)
    assert machine.state == CalibrationState.COMPLETE


def test_illegal_state_transition():
    with pytest.raises(InvalidTransition):
        CalibrationStateMachine().transition(CalibrationState.BLOCK_RECORDING)


@pytest.mark.parametrize(
    ("participant", "normalized"),
    [("P1", "P1"), ("p22", "P22"), ("P001", "P001")],
)
def test_participant_id_format(participant, normalized):
    assert SessionCreate(participant_id=participant).participant_id == normalized


@pytest.mark.parametrize("participant", ["P0", "P000", "001", "participant1", "P-1"])
def test_invalid_participant_ids_are_rejected(participant):
    with pytest.raises(ValueError):
        SessionCreate(participant_id=participant)


def test_api_health_and_truthful_status():
    client = TestClient(app)
    assert client.get('/api/health').json()["data_local"] is True
    assert client.get('/api/status').json()["connection"]["connected"] is False


def test_session_file_creation(tmp_path: Path):
    store = SessionStore(tmp_path)
    metadata = store.create("P1", "192.168.1.2")
    saved = json.loads((tmp_path / metadata["session_id"] / "session_metadata.json").read_text())
    assert saved["participant_id"] == "P1"
    store.close()


def test_buffered_writer_shutdown_flush(tmp_path: Path):
    store = SessionStore(tmp_path)
    metadata = store.create("P2", "127.0.0.1")
    sample = EEGSample(sample_index=0, monotonic_timestamp=1, session_elapsed_seconds=0, tp9=1, af7=2, af8=3, tp10=4)
    store.writer.put_eeg(sample)
    store.close()
    with (tmp_path / metadata["session_id"] / "raw_eeg.csv").open(newline='') as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 1
    assert rows[0]["af7"] == "2.0"
