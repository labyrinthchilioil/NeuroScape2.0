# NeuroScape

Module 01/02 Phase 1 development and test instructions: [docs/MODULE_01_02_PHASE1.md](docs/MODULE_01_02_PHASE1.md).

Audio-library items intentionally deferred for later asset curation are tracked in [docs/TBD_AUDIO_LIBRARY_GAPS.md](docs/TBD_AUDIO_LIBRARY_GAPS.md).

NeuroScape is a neuroadaptive spatial-audio meditation runtime. Modules 03 and 04 are implemented: semantic plans become authoritative numerical world snapshots in Module 03, then Module 04 validates, visualizes, spatializes, records, and replays those snapshots in the browser.

```text
Module 01 → NeuroState ┐
Module 02 → SceneJourneyPlan → Module 03 → RuntimeWorldState
                              └───────────────┬───────────────┘
                                              ↓
                               Module 04 Runtime Store
                         React + Three.js + Web Audio/HRTF
```

`RuntimeWorldState` is the only spatial source of truth. The browser never interprets EEG, executes planner reasoning, or simulates source movement.

## Quick start

```bash
npm install
npm run calibration:setup
npm run dev
```

Python 3.11+ is required for Muse calibration and live EEG. See
[Muse calibration and live adaptive integration](docs/EEG_CALIBRATION_LIVE_INTEGRATION.md)
for Mind Monitor setup, profile handoff, and the live 10-second epoch pipeline.
The existing mock modes remain available without EEG hardware.

Put `OPENAI_API_KEY` in a repository-root `.env` file (see `.env.example`). `npm run dev` loads it only in the localhost backend; the key is never bundled into Vite or sent to the browser.

Open the displayed Vite URL, enter a participant ID and duration, then select
**Start Muse calibration**. Development-only mock and diagnostic entry points
remain under the collapsed **Developer tools** section. Adaptive sessions
automatically save study artifacts under `study-results/` and also expose a ZIP
download on the Summary page.

## Set up on another computer

Install Git, Node.js 20.19+ (Node 22 LTS recommended), npm, and Python 3.11+.
Then run:

```bash
git clone -b feature/module-01-02-rebuild https://github.com/yujianing0210/NeuroScape2.0.git
cd NeuroScape2.0
npm install
npm run calibration:setup
cp .env.example .env
```

Edit `.env` and replace `your_openai_api_key_here` with a valid API key. Start
all three local services with:

```bash
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`).
For real EEG, connect the Mind Monitor phone and computer to a private Wi-Fi
that permits device-to-device UDP. In Mind Monitor, enable RAW EEG and OSC
streaming, then use the IPv4 address shown on the calibration page and UDP port
`5000`. macOS/Windows may ask for permission for Python to accept incoming
network traffic; allow it. Do not copy another researcher's `.env`, `.venv`,
`study-results`, or `eeg-calibration/data/sessions` directories.

## Validation

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

See [End-to-End Development Guide](docs/END_TO_END_DEVELOPMENT.md) for architecture, protocol, audio assets, demo operation, diagnostics, and upstream integration.

The source-of-truth specifications in `SystemDesign/` and legacy visual references in `UIreference/` are preserved unchanged.
