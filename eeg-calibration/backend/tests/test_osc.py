from __future__ import annotations

import time

import pytest

from app.osc.receiver import MuseOSCReceiver, parse_eeg_arguments


def test_parse_four_value_eeg():
    assert parse_eeg_arguments((1, 2, 3, 4)) == (1.0, 2.0, 3.0, 4.0, None)


def test_parse_five_value_eeg():
    assert parse_eeg_arguments((1, 2, 3, 4, 5))[-1] == 5.0


@pytest.mark.parametrize("values", [(1, 2, 3), (1, 2, "bad", 4), (1, 2, 3, 4, 5, 6)])
def test_malformed_eeg(values):
    with pytest.raises(ValueError): parse_eeg_arguments(values)


def test_receiver_records_malformed_messages():
    receiver = MuseOSCReceiver(); receiver.handle("/muse/eeg", 1, 2)
    assert receiver.malformed_messages == 1 and receiver.total_eeg_samples == 0


def test_receiver_channel_order_and_sample_index():
    receiver = MuseOSCReceiver(); receiver.handle("/muse/eeg", 10, 20, 30, 40)
    sample = receiver.samples[0]
    assert (sample.tp9, sample.af7, sample.af8, sample.tp10, sample.sample_index) == (10, 20, 30, 40, 0)


def test_marker_alignment_uses_nearest_sample(make_samples):
    receiver = MuseOSCReceiver(); receiver.samples.extend(make_samples(seconds=1))
    assert receiver.nearest_sample_index(.499) == 128


def test_connection_status_uses_real_timestamp():
    receiver = MuseOSCReceiver(); assert receiver.status()["connected"] is False
    receiver.handle("/muse/eeg", 1, 2, 3, 4); assert receiver.status()["connected"] is True
    receiver.last_message_timestamp = time.monotonic() - 3
    assert receiver.status()["connected"] is False

def test_blink_event_counters_reset_for_each_session():
    receiver = MuseOSCReceiver()
    receiver.handle("/muse/elements/blink", 1)
    assert receiver.status()["blink_events_total"] == 1
    assert receiver.status()["blink_events_session"] == 0
    receiver.set_session_start(time.monotonic())
    receiver.handle("/muse/elements/blink", 0)
    receiver.handle("/muse/elements/blink", 1)
    status = receiver.status()
    assert status["blink_events_total"] == 2
    assert status["blink_events_session"] == 1
    assert status["last_blink_age_seconds"] is not None
    assert status["last_blink_age_seconds"] < 1.0
    receiver.set_session_start(None)
    assert receiver.status()["blink_events_session"] == 0
