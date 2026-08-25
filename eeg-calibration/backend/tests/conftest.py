from __future__ import annotations

import numpy as np
import pytest

from app.models.schemas import EEGSample


@pytest.fixture
def make_samples():
    def factory(seconds: int = 10, theta_amp: float = 10.0, beta_amp: float = 2.0, start: int = 0, headband: bool = True, hsi: int = 1):
        fs = 256
        t = np.arange(seconds * fs) / fs
        signal = theta_amp * np.sin(2 * np.pi * 6 * t) + beta_amp * np.sin(2 * np.pi * 20 * t)
        return [EEGSample(sample_index=start+i, monotonic_timestamp=i/fs, session_elapsed_seconds=i/fs, tp9=0, af7=float(v), af8=float(v*.95), tp10=0, headband_on=headband, hsi_tp9=hsi, hsi_af7=hsi, hsi_af8=hsi, hsi_tp10=hsi) for i,v in enumerate(signal)]
    return factory
