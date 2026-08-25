# Module 01/02 Phase 1: OpenAI-Enabled Integration

This branch rebuilds Modules 01 and 02 without relying on the earlier placeholders. It provides a deterministic, testable seam from calibration-shaped mock data to the existing Module 03 scene controller and Module 04 spatial-audio frontend.

## Run

```bash
nvm use
npm ci
npm run dev
```

Use Node 22 LTS. Odd-numbered Node releases such as Node 23 are not supported by the current ESLint/Vite dependency set.

Open the Vite URL, enter a participant ID, and choose one of the two Phase 1 modes:

- **Fast mock test** advances the 10-minute logical session at 10× speed (about one minute of wall time). Audio clips keep their natural playback rate, so the captured mix is about one wall-clock minute.
- **Real-time study** advances at 1× speed and captures the complete approximately 10-minute spatial-audio mix.

Then choose a planner provider:

- **OpenAI · GPT-5.6** uses the real two-stage Responses API planner. Decision 1 uses low reasoning effort and Decision 2 uses medium reasoning effort.
- **Offline mock** preserves the deterministic provider for development, regression tests, and sessions where API usage is not desired.

The repository-root `.env` must contain `OPENAI_API_KEY` for OpenAI mode. The local backend loads the key; it is never exposed through Vite. Requests use `store: false`. The participant folder still stores the complete inspectable prompt, JSON Schema, structured output, model/response ID, token usage, and concise rationale for later analysis.

Starting either mode enables browser audio and starts master-output capture from the same post-HRTF mix sent to the headphones. If the browser does not support `MediaRecorder`, the session continues and all non-audio study data is still saved.

At session end, the existing Summary page retains the complete recording in application state. **Export Recording** downloads a versioned JSON bundle containing:

- calibration-relative attention states;
- eligibility outcomes and gate reasons;
- Decision 1 inputs/outputs and structured rationale;
- Decision 2 output, selected assets, and structured rationale;
- every accepted `SceneJourneyPlan`;
- Module 03 runtime snapshots and session/planner events.

The recording contains inspectable rationale summaries, not hidden model chain-of-thought.

## Study result storage

`npm run dev` starts both Vite and a minimal local study-recorder service. When an adaptive session ends, the browser uploads the finalized artifacts to:

```text
study-results/<participant-id>/<session-id>/
```

The folder contains the calibration profile, EEG epochs, attention timeline, eligibility results, Decision 1 and Decision 2 records, plans, runtime events, complete JSON session bundle, manifest, error log, completion marker, and—when capture is supported—the final spatial-audio mix (`.webm` or the browser-supported equivalent).

The Summary page also offers **Download Study ZIP**. This is an independent fallback: a failed local-backend save does not prevent the ZIP download. The backend output root can be overridden with `NEUROSCAPE_RESULTS_DIR`.

## Phase 1 pipeline

1. Study mode consumes non-overlapping live Muse windows from the calibration service; mock mode uses `createMockTbrReplay()`. Both produce one quality-annotated log-TBR epoch every 10 session seconds.
2. `AttentionInterpreter` applies the individual calibration anchors and computes current state, trend, variability, duration, confidence, and phase.
3. `evaluateEligibility()` checks only hard prerequisites: calibration usability, phase, valid-window count, confidence, and cooldown.
4. `OpenAIDecisionProvider` calls the local backend for Decision 1 (`Should adapt?`) using GPT-5.6 with low reasoning effort.
5. Only when Decision 1 returns adapt, `OpenAIPlanningProvider` calls Decision 2 (`How to adapt?`) using GPT-5.6 with medium reasoning effort and the retrieved Audio Library candidates.
6. `mergePlanPatch()` merges a soundscape patch into a complete `SceneJourneyPlan`.
7. Module 03 validates and applies the plan without resetting the runtime.
8. Module 04 renders the resulting world state using the existing audio catalog and HRTF chain.

Decision 2 is never called when Decision 1 returns maintain.

## Canonical audio library

`packages/contracts/src/audio_library.json` is the shared authored source of truth. Module 04 derives canonical `asset_id → /audio/<asset_ref>` loading entries from it, while Decision 2 receives deterministically retrieved, scene-compatible candidates containing the authored descriptions, tags, intensity, suddenness, recommended volume/distance, use/avoid conditions, spatial behavior, default position, `default_motion.duration`, event lifecycle, fades, loop status, and priority.

The Decision 2 prompt forbids invented assets and numbers. The engine rejects any selected asset ID that was not in the retrieved candidate set. For a restrained but perceptibly layered response, a within-scene reorientation may combine ambient and event candidates, grounding may combine ambient and action candidates, and a scene transition may combine ambient and event candidates. Each patch remains limited to at most one salient event or one body-anchored action. Authored event motion duration and recommended gain are enforced by the output schema and validated again locally. Existing dotted asset IDs remain temporary aliases only for older Module 03/04 demonstrations.

The `MockDecisionProvider` and `MockPlanningProvider` remain available behind the **Offline mock** option. Decision 2 is never called when Decision 1 returns maintain. An API failure is logged as `llm-error`; the runtime maintains the current soundscape rather than silently switching to mock reasoning.

## Replacement seams for later phases

| Phase 1 component        | Later replacement                    | Stable interface       |
| ------------------------ | ------------------------------------ | ---------------------- |
| `mockCalibrationProfile` | imported calibration profile adapter | `CalibrationProfile`   |
| `createMockTbrReplay()`  | imported Muse OSC live epoch stream  | `TbrEpoch`             |
| `OpenAIDecisionProvider` | production endpoint/deployment       | `DecisionProvider`     |
| `OpenAIPlanningProvider` | production endpoint/deployment       | `PlanningProvider`     |
| `phase1SoundKnowledge`   | production audio database            | asset metadata records |

## Eligibility design rationale

Eligibility is deliberately not an attention classifier. It answers only whether the evidence and system state are safe enough to ask Decision 1. The adaptation decision therefore remains separately observable and testable. Gate failures always produce a maintain result with explicit reason codes.

## TBD pilot parameters

All values below are runnable hypotheses centralized in `packages/adaptive-planner/src/config.ts`; none should be described as validated thresholds.

| Parameter                   |   Phase 1 value | Adjustment target        |
| --------------------------- | --------------: | ------------------------ |
| Session duration            |           600 s | study protocol           |
| Opening phase               |            60 s | onboarding experience    |
| Closing phase start         |           540 s | closing experience       |
| EEG epoch                   |            10 s | signal stability/latency |
| Analysis window             |            60 s | state stability          |
| Planning checkpoint         |            30 s | responsiveness/cost      |
| Minimum valid epochs        |               5 | quality tolerance        |
| Trend history               |   3 checkpoints | trend reliability        |
| Focus/intermediate boundary |            0.34 | pilot distribution       |
| Intermediate/MW boundary    |            0.67 | pilot distribution       |
| Trend delta                 | 0.05/checkpoint | pilot false positives    |
| High variability MAD        |            0.12 | pilot distribution       |
| Sustained duration          |   2 checkpoints | intervention sensitivity |
| Minimum confidence          |            0.60 | quality policy           |
| General adaptation cooldown |            60 s | perceptual density       |
| Scene transition cooldown   |           180 s | narrative continuity     |
| Maximum scene transitions   |       5/session | study design             |
| Exact asset cooldown        |            90 s | repetition tolerance     |
| Asset-family cooldown       |            45 s | library diversity        |
| Body-anchor cooldown        |            80 s | repetition tolerance     |

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The adaptive end-to-end test is `frontend/tests/AdaptiveIntegrationHarness.test.ts`.
