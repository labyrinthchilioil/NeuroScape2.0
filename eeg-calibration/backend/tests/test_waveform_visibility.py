from __future__ import annotations

import time

from app.osc.receiver import MuseOSCReceiver


def test_waveform_is_hidden_and_cleared_until_headband_is_worn():
    receiver = MuseOSCReceiver()
    receiver.handle("/muse/eeg", 10, 20, 30, 40)
    assert receiver.status()["connected"] is True
    assert receiver.status()["waveform"] == []
    assert list(receiver.waveform) == []

    receiver.handle("/muse/elements/touching_forehead", 1)
    for _ in range(16):
        receiver.handle("/muse/eeg", 10, 20, 30, 40)
    assert receiver.status()["waveform"]

    receiver.handle("/muse/elements/touching_forehead", 0)
    assert receiver.status()["waveform"] == []
    assert list(receiver.waveform) == []


def test_disconnection_clears_cached_waveform():
    receiver = MuseOSCReceiver()
    receiver.handle("/muse/elements/touching_forehead", 1)
    for _ in range(16):
        receiver.handle("/muse/eeg", 10, 20, 30, 40)
    assert receiver.status()["waveform"]

    receiver.last_message_timestamp = time.monotonic() - 3
    assert receiver.status()["connected"] is False
    assert receiver.status()["waveform"] == []
    assert list(receiver.waveform) == []
