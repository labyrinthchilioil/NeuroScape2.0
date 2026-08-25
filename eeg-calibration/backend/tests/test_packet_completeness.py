from app.signal_processing.core import analyze_segment, packet_completeness


def test_epoch_packet_completeness_uses_arrival_span_only_for_loss_diagnostics(make_samples):
    samples = make_samples()
    for index, sample in enumerate(samples):
        sample.monotonic_timestamp = index / 230.0
    assert packet_completeness(samples) < 0.90
    result = analyze_segment(samples)[0]
    assert not result.usable
    assert "packet_completeness" in result.invalid_reasons["AF7"]
