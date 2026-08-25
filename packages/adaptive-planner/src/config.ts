export interface AdaptivePlannerConfig {
  sessionDurationMs: number;
  openingDurationMs: number;
  closingStartMs: number;
  epochDurationMs: number;
  analysisWindowMs: number;
  checkpointIntervalMs: number;
  minimumValidEpochs: number;
  trendWindowCount: number;
  focusLeaningThreshold: number;
  mindWanderingLeaningThreshold: number;
  trendDeltaThreshold: number;
  highVariabilityMad: number;
  sustainedWindowCount: number;
  minimumConfidence: number;
  adaptationCooldownMs: number;
  sceneTransitionCooldownMs: number;
  maxSceneTransitions: number;
  exactAssetCooldownMs: number;
  assetFamilyCooldownMs: number;
  bodyAnchorCooldownMs: number;
  referenceTolerance: number;
  separationRatioMedium: number;
  separationRatioHigh: number;
  maxMeaningfulStasisMs: number;
  patchHorizonMs: number;
  executionFreezeBufferMs: number;
  outcomeObservationWindowMs: number;
  llmDecision1TimeoutMs: number;
  llmDecision2TimeoutMs: number;
  maxPatchOperations: number;
  maxConcurrentSources: number;
  maxAmbientLayers: number;
  maxEventsPerMinute: number;
  maxBodyAnchorsPerMinute: number;
  maxSalienceLoad: number;
  reservedAdaptationHeadroom: number;
  maxCumulativePatches: number;
  basePlanMatchTolerance: number;
}

/**
 * Runnable Phase-1 defaults. Every numeric policy value below is TBD_PILOT:
 * it is an explicit starting hypothesis, not a validated scientific threshold.
 */
export const phase1Config: AdaptivePlannerConfig = Object.freeze({
  sessionDurationMs: 600_000,
  openingDurationMs: 60_000,
  closingStartMs: 540_000,
  epochDurationMs: 10_000,
  analysisWindowMs: 60_000,
  checkpointIntervalMs: 40_000,
  minimumValidEpochs: 5,
  trendWindowCount: 3,
  focusLeaningThreshold: 0.34,
  mindWanderingLeaningThreshold: 0.67,
  trendDeltaThreshold: 0.05,
  highVariabilityMad: 0.12,
  sustainedWindowCount: 2,
  minimumConfidence: 0.6,
  adaptationCooldownMs: 60_000,
  sceneTransitionCooldownMs: 180_000,
  maxSceneTransitions: 5,
  exactAssetCooldownMs: 90_000,
  assetFamilyCooldownMs: 45_000,
  bodyAnchorCooldownMs: 80_000,
  // TBD_PILOT: descriptive reference and confidence thresholds.
  referenceTolerance: 0.05,
  separationRatioMedium: 1,
  separationRatioHigh: 2.5,
  maxMeaningfulStasisMs: 160_000,
  // TBD_PILOT: receding-horizon, latency, and restrained-complexity policy.
  patchHorizonMs: 120_000,
  executionFreezeBufferMs: 15_000,
  outcomeObservationWindowMs: 60_000,
  llmDecision1TimeoutMs: 15_000,
  llmDecision2TimeoutMs: 30_000,
  maxPatchOperations: 3,
  maxConcurrentSources: 3,
  maxAmbientLayers: 2,
  maxEventsPerMinute: 1,
  maxBodyAnchorsPerMinute: 1,
  maxSalienceLoad: 1,
  reservedAdaptationHeadroom: 0.25,
  maxCumulativePatches: 6,
  basePlanMatchTolerance: 0.15,
});
