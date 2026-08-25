from __future__ import annotations

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("NEUROSCAPE_DATA_DIR", ROOT_DIR / "data" / "sessions"))
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"

# UDP accepts packets from Mind Monitor; HTTP remains loopback-only by default.
OSC_HOST = os.getenv("NEUROSCAPE_OSC_HOST", "0.0.0.0")
OSC_PORT = int(os.getenv("NEUROSCAPE_OSC_PORT", "5000"))
HTTP_HOST = os.getenv("NEUROSCAPE_HTTP_HOST", "127.0.0.1")
HTTP_PORT = int(os.getenv("NEUROSCAPE_HTTP_PORT", "8000"))

# Muse 2 raw EEG and calibration parameters.
SAMPLING_RATE_HZ = 256
NOTCH_HZ = 60.0
NOTCH_Q = 30.0
BANDPASS_LOW_HZ = 1.0
BANDPASS_HIGH_HZ = 35.0
FILTER_ORDER = 4
EPOCH_SECONDS = 10
BLOCK_DISCARD_SECONDS = 15
ACCLIMATION_SECONDS = 60
BLOCK_SECONDS = 75
EXPECTED_EPOCHS_PER_BLOCK = 6
MIN_VALID_EPOCHS_PER_BLOCK = 4
MIN_VALID_EPOCHS_PER_CONDITION = 4
WELCH_NPERSEG = 512
WELCH_NOVERLAP = 256
EPSILON = 1e-12

# Channel/epoch quality limits. Motion rejection remains disabled by default.
MIN_PACKET_COMPLETENESS = 0.90
MAX_PEAK_TO_PEAK_UV = 150.0
MAX_BAD_HSI_FRACTION = 0.20
MAX_BLINK_EPOCHS_PER_CONDITION: int | None = None
MAX_REDOS_PER_CONDITION = 1
BLINK_EXCLUSION_SECONDS = 0.5
JAW_EXCLUSION_SECONDS = 1.0
MOTION_REJECTION_ENABLED = False
WAVEFORM_RATE_HZ = 16
BUFFER_SECONDS = 900
CONNECTION_RECENT_SECONDS = 2.0

# Pilot-safe separation gate. Values stay unset until fixed from pilot data.
MIN_ABSOLUTE_ANCHOR_DIFFERENCE: float | None = None
MIN_SEPARATION_SCORE: float | None = None
REQUIRE_FREE_THOUGHT_HIGHER: bool | None = None
