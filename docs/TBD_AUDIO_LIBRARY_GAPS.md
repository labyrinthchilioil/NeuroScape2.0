# Audio Library Gaps — TBD

This list is intentionally non-blocking for the runnable prototype. The authored source of truth is `packages/contracts/src/audio_library.json`; the items below should be reconciled before the production study library is frozen.

## Local-file coverage

All audio files currently under `frontend/public/audio` have authored records in `audio_library.json` and are eligible for scene-compatible Decision 2 retrieval.

## Forest-water transition gap

The authored library now includes `forest_stream_ambient_bed_01` for the `stream_bank` portion of the forest journey. A dedicated forest waterfall recording is still missing. Existing legacy demo aliases temporarily resolve to ocean shoreline/wave clips so older Module 03/04 scenarios continue to run; new Decision 2 retrieval uses only scene-compatible authored candidates.

## Metadata refinements for later review

- Confirm whether an explicit authored `family_id`/`variant_id` should replace the current deterministic family derivation that removes the trailing numeric suffix.
- Confirm functional roles for footsteps (`locomotion`, `embodied-anchor`, `rhythmic-regulation`, or `transition-cue`).
- Preserve the distinction between `default_motion.duration`, `auto_delete_after_sec`, and looping lifecycle when reviewing measured clip lengths.
