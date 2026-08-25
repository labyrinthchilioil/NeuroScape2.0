# Muse calibration and live adaptive integration

NeuroScape includes the hardware-first calibration implementation from
`teresa-xinyanli/neuroscape-eeg-calibration`. The upstream Python modules are
vendored under `eeg-calibration/`; the existing NeuroScape React application
owns the combined navigation and adaptive runtime.

## One-time setup

Python 3.11 or newer is required. The setup command selects an available modern
Python executable and creates an ignored project-local virtual environment:

```bash
npm run calibration:setup
```

If Python uses a different executable name, set `NEUROSCAPE_PYTHON` before
running setup. Continue to use the normal development command afterward:

```bash
npm run dev
```

This starts three local processes:

- the Muse OSC/calibration service on `127.0.0.1:8000` and UDP `0.0.0.0:5000`;
- the study-recorder/OpenAI proxy on `127.0.0.1:8787`;
- the Vite frontend, which proxies calibration HTTP and WebSocket traffic.

## Investigator flow

1. Enter the participant ID and meditation duration, then choose **Start Muse
   calibration** on the home page.
2. Configure Mind Monitor to send raw EEG OSC packets to the displayed computer
   IPv4 address and UDP port 5000.
3. Create the pseudonymous participant, pass the connection test, and complete
   acclimation.
4. Complete all four counterbalanced Focused Meditation / Free Thought blocks,
   their self-reports, and any deterministic redo requested by the protocol.
5. Review the generated profile and select **Continue to Adaptive Session**.
6. The configured meditation duration uses only Muse samples received after
   adaptive startup.
   Each non-overlapping 2560-sample window produces one 10-second log-TBR epoch
   using the same preprocessing, Welch PSD, artifact rejection, and AF7/AF8
   aggregation as calibration.

Calibration and adaptive playback remain separate frontend pages but share the
same participant/profile state and local EEG service.

## Profile acceptance policy

The imported protocol deliberately leaves pilot separation thresholds unset, so
a quality-valid upstream profile reports `mapping_status: provisional` and
`mapping_available: false`. The NeuroScape adapter enables planner mapping only
when `ready_to_continue` is true and both anchors plus pooled MAD are present.
The required feature version is
`raw_welch_frontal_log_tbr_median_block_protocol_v4`.

This is an explicit provisional research policy, not a claim that the anchors
objectively detect mind wandering. Profiles with insufficient collection quality
remain blocked.

## Data boundaries

Calibration raw EEG, raw OSC, markers, protocol records, quality reports, and the
original profile remain under `eeg-calibration/data/sessions/<calibration-id>/`.
The adaptive folder under `study-results/` contains the planner-normalized real
profile, processed live epochs, attention states, Decisions 1/2, applied plans,
runtime events, and captured spatial-audio mix.

The mock profile and deterministic replay remain available through the existing
fast-test/offline development path.
