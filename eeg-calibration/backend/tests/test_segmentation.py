from app import config
from app.signal_processing.core import create_epochs


def test_75_second_block_discards_15_seconds_and_retains_six_epochs(make_samples):
    recorded = make_samples(seconds=config.BLOCK_SECONDS)
    retained = recorded[config.BLOCK_DISCARD_SECONDS * config.SAMPLING_RATE_HZ:]
    epochs = create_epochs(retained)
    assert len(epochs) == config.EXPECTED_EPOCHS_PER_BLOCK == 6
    assert epochs[0][0].sample_index == 15 * config.SAMPLING_RATE_HZ


def test_short_block_only_uses_complete_epochs(make_samples):
    recorded = make_samples(seconds=35)
    retained = recorded[15 * config.SAMPLING_RATE_HZ:]
    assert len(create_epochs(retained)) == 2
