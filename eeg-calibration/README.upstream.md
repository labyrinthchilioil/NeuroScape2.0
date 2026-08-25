# NeuroScape EEG Calibration

[中文版 README](README.zh-CN.md) · [中文操作指南](docs/OPERATION_GUIDE_ZH.md)

A local, hardware-first Muse 2 calibration application. It receives real Mind Monitor OSC packets and guides an investigator through acclimation, four counterbalanced task-elicited blocks, block-level self-report, deterministic quality review, and participant-specific median EEG anchors.

The two anchors are:

- **Focused Meditation**: attention is mainly maintained on breathing, bodily sensations, or the present sensory environment.
- **Off-meditation Free Thought**: thoughts mainly concern content unrelated to the current meditation experience.

These are instructed reference conditions. They are not objective ground truth for spontaneous mind wandering. The application does not generate synthetic EEG and does not run post-calibration personalization.

## Requirements

- Windows, macOS, or Linux with Python 3.11+
- Node.js 20+ and npm
- Muse 2 headset
- Mind Monitor on a phone connected to the same network as the computer

## Install and run

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
cd frontend
npm.cmd ci
npm.cmd run build
cd ..
.\scripts\start.ps1
```

Open `http://127.0.0.1:8000`. The production build is served by FastAPI. For separate hot-reload frontend and backend processes, run `scripts/dev.ps1`.

## Mind Monitor setup

1. Put the phone and computer on the same Wi-Fi network.
2. Open the Connection page and note the displayed computer IPv4 address.
3. In Mind Monitor, set OSC destination IP to that address and UDP port to `5000`.
4. Enable raw EEG and start streaming.
5. Wear Muse 2 and confirm `HeadBandOn`, AF7/AF8 HSI, sample rate, and live waveform.
6. Create a session using `P` plus a positive integer, such as `P1` or `P2`.
7. Pass the 10-second real-data connection test.

Odd participant numbers receive Order A; even participant numbers receive Order B. The assignment is stored when the session is created.

Recognized OSC addresses remain unchanged:

- `/muse/eeg`
- `/muse/elements/horseshoe`
- `/muse/elements/touching_forehead`
- `/muse/acc`
- `/muse/gyro`
- `/muse/elements/blink`
- `/muse/elements/jaw_clench`

The application listens for OSC on `0.0.0.0:5000`; the web server binds to `127.0.0.1:8000` by default. The waveform is only shown while real packets are recent and `HeadBandOn` is true.

Step 2 also shows live Mind Monitor blink-event counts for the current or most recent recording, the full session count, and the age of the latest event. These are event counters, not an eyes-closed detector. Final blink quality continues to use the number of 10-second epochs containing one or more blink events.

## Investigator protocol

### Acclimation

The investigator reads the bilingual guidance and starts a backend-timed 60-second acclimation. Acclimation EEG is retained in the session but never enters either anchor. A full attempt can be accepted or repeated after equipment adjustment. An early-ended attempt must be repeated.

### Calibration order

Order A:

1. Focused Meditation 1
2. Free Thought 1
3. Focused Meditation 2
4. Free Thought 2

Order B:

1. Free Thought 1
2. Focused Meditation 1
3. Free Thought 2
4. Focused Meditation 2

Each block lasts 75 seconds and stops automatically. `End Early` is an emergency control; an early-ended block is retained but cannot enter an anchor. The investigator provides no further prompt during recording.

### Block-level self-report

After every block, the investigator enters two participant ratings with 1–7 buttons and may add notes:

- Mind wandering
- Drowsiness

An explicit `unable to judge` option stores null ratings and makes the block invalid. Self-report gates block inclusion but is never numerically added to EEG and does not label individual epochs.

Subjective validity is deterministic:

- Focused Meditation passes when mind wandering ≤ 3 and drowsiness ≤ 3.
- Free Thought passes when mind wandering ≥ 5 and drowsiness ≤ 3.
- Mind wandering = 4 or drowsiness = 4 is borderline and excluded from the main anchor.
- Drowsiness ≥ 5, unable-to-judge, or a failed condition manipulation is invalid.

### EEG and redo decision

The first 15 seconds of each 75-second block are excluded. The remaining 60 seconds yield six non-overlapping 10-second epochs.

- A block needs at least 5/6 valid epochs for EEG quality pass.
- Each condition needs two eligible blocks and at least 9 selected valid epochs.
- Blink is a soft epoch flag and a record-only quality descriptor. Raw blink-event counts and blink-flagged epoch counts are saved per block. They never determine block eligibility, condition status, or redo; they are used only to rank otherwise eligible blocks when a condition has three candidates.
- Borderline, subjectively invalid, early-ended, or EEG-invalid blocks are excluded.

After the original four blocks, the system evaluates both conditions. A failing condition receives exactly one additional block with the same instructions. Both conditions may receive one redo, so a session has at most six calibration blocks. After the allowed redo, the collection is either `ready_to_continue` or `insufficient_after_redo`.

When three eligible blocks exist for a condition, the system deterministically selects two in this priority order:

1. More valid epochs.
2. Fewer blink-flagged epochs.
3. Fewer raw blink events.
4. Smaller condition-specific self-report ideal distance.
5. Later acquisition if every preceding value is tied.

The Focused Meditation ideal is MW = 1 and drowsiness = 1. The Free Thought ideal is MW = 7 and drowsiness = 1. Ideal distance is the Manhattan distance from the relevant target: `abs(MW - target_MW) + abs(drowsiness - 1)`. Self-report is used only for eligibility and block selection; it is never added to an EEG feature or anchor.

## Signal processing

The shared implementation is `backend/app/signal_processing/core.py`:

1. Mean-center each AF7 and AF8 block signal.
2. Apply the existing 60 Hz notch filter.
3. Apply the existing zero-phase fourth-order 1–35 Hz Butterworth band-pass filter.
4. Split retained data into non-overlapping 10-second epochs.
5. Hard-reject individual channel epochs for headband-off, poor HSI, packet completeness below 90%, non-finite/unfilterable data, filtered peak-to-peak above 150 µV, jaw-clench overlap, or failed spectral calculation.
6. Preserve single-channel fallback when only AF7 or AF8 passes.
7. Calculate Welch PSD with a Hamming window, `nperseg=512`, `noverlap=256`, and `average="median"`.
8. Sum PSD bins times 0.5 Hz over theta `4 ≤ f < 8 Hz` and beta `13 ≤ f ≤ 30 Hz`.
9. Calculate channel log-TBR:

   ```text
   ln((theta_power + 1e-12) / (beta_power + 1e-12))
   ```

10. Use the median of valid AF7/AF8 channel values for each epoch.
11. Pool the valid epoch log-TBR values from the two selected blocks and use their median for the condition anchor. Because each eligible block currently requires at least 5/6 valid epochs, an anchor normally uses 10–12 epoch values; it is not an average or median of two block-level summaries.
12. Calculate:

   ```text
   difference = free_thought_anchor - focused_meditation_anchor
   separation_score = abs(difference) / (pooled_mad + 1e-12)
   ```

`pooled_mad` is the unscaled median absolute deviation of selected epoch TBR values from both conditions.

## Pilot-safe mapping status

The application calculates difference, direction, pooled MAD, and separation score. It does not invent pilot thresholds:

- `minimum_absolute_difference = null`
- `minimum_separation_score = null`
- `require_free_thought_higher = null`

A quality-valid collection is therefore `mapping_status = provisional` and `mapping_available = false` until those protocol values are fixed. This is separate from `ready_to_continue`, which answers whether the confirmed collection and redo rules were satisfied.

Profiles use feature version `raw_welch_frontal_log_tbr_median_block_protocol_v4`. Earlier profiles require recalibration.

## Local data

All participant and EEG records remain under `data/sessions/<session_id>/`:

- `session_metadata.json`
- `raw_eeg.csv`
- `raw_osc.jsonl`
- `markers.jsonl`
- `calibration_record.json`
- `calibration_profile.json`
- `quality_report.json`

`calibration_record.json` preserves order, acclimation attempts, every original/redo block, condition and block numbers, start/end timestamps and sample indices, self-report, subjective status, EEG quality, inclusion decision, and redo reason. Participant IDs must remain pseudonymous.

## Verification

```powershell
pytest
cd frontend
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Automated coverage includes protocol ordering, timers, early termination, self-report thresholds, redo selection, median Welch and anchor calculations, theta/beta boundaries, block segmentation, artifact handling, OSC parsing, storage, WebSocket status, frontend types, linting, and production build.

## Safety and interpretation

This is a research calibration tool, not a medical device. The anchors are participant-specific operational references derived from instructed conditions and retrospective self-report. They are not diagnostic, clinical, psychological, or objective attention measurements.
