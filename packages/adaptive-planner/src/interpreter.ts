import type { AdaptivePlannerConfig } from './config.js';
import type {
  AttentionState,
  AttentionTrend,
  CalibrationProfile,
  ConfidenceLevel,
  ReferenceCoverage,
  SessionPhase,
  StateTrajectory,
  TbrEpoch,
} from './types.js';

const NUMERICAL_EPSILON = 1e-6;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const mad = (values: number[]) =>
  values.length
    ? median(values.map((value) => Math.abs(value - median(values))))
    : null;

export function sessionPhase(
  timestampMs: number,
  config: AdaptivePlannerConfig,
): SessionPhase {
  if (timestampMs < config.openingDurationMs) return 'opening';
  if (timestampMs >= config.closingStartMs) return 'closing';
  return 'adaptive';
}

function calibrationLevel(
  ratio: number | null,
  config: AdaptivePlannerConfig,
): ConfidenceLevel | 'unusable' {
  if (ratio === null) return 'unusable';
  if (ratio >= config.separationRatioHigh) return 'high';
  if (ratio >= config.separationRatioMedium) return 'medium';
  return 'low';
}

export class AttentionInterpreter {
  readonly #epochs: TbrEpoch[] = [];
  readonly #states: AttentionState[] = [];
  readonly #profile: CalibrationProfile;
  readonly #config: AdaptivePlannerConfig;
  constructor(profile: CalibrationProfile, config: AdaptivePlannerConfig) {
    this.#profile = profile;
    this.#config = config;
  }

  ingest(epoch: TbrEpoch): AttentionState {
    this.#epochs.push(structuredClone(epoch));
    const recent = this.#epochs.filter(
      (item) =>
        item.timestampMs > epoch.timestampMs - this.#config.analysisWindowMs &&
        item.timestampMs <= epoch.timestampMs,
    );
    const valid = recent.filter(
      (item): item is TbrEpoch & { logTbr: number } =>
        item.valid && item.logTbr !== null && Number.isFinite(item.logTbr),
    );
    const currentLogTbr = valid.length
      ? median(valid.map((item) => item.logTbr))
      : null;
    const focusReferenceLogTbr = this.#profile.focusedAnchorLogTbr;
    const mindWanderingReferenceLogTbr =
      this.#profile.mindWanderingAnchorLogTbr;
    const referenceGap = focusReferenceLogTbr - mindWanderingReferenceLogTbr;
    const referenceGapAbs = Math.abs(referenceGap);
    const calibrationNoise = 1.4826 * Math.max(0, this.#profile.pooledMad);
    const separationRatio =
      referenceGapAbs < NUMERICAL_EPSILON
        ? null
        : referenceGapAbs / Math.max(calibrationNoise, NUMERICAL_EPSILON);
    const calibrationQuality = calibrationLevel(separationRatio, this.#config);
    const relativePosition =
      currentLogTbr === null || referenceGapAbs < NUMERICAL_EPSILON
        ? null
        : (currentLogTbr - mindWanderingReferenceLogTbr) / referenceGap;
    const deltaFromFocus =
      currentLogTbr === null ? null : currentLogTbr - focusReferenceLogTbr;
    const deltaFromMindWandering =
      currentLogTbr === null
        ? null
        : currentLogTbr - mindWanderingReferenceLogTbr;
    const tolerance = this.#config.referenceTolerance;
    const coverage: ReferenceCoverage =
      relativePosition === null
        ? 'unavailable'
        : relativePosition > 1 + tolerance
          ? 'beyond-focus-reference'
          : relativePosition < -tolerance
            ? 'beyond-mind-wandering-reference'
            : Math.abs(relativePosition) <= tolerance ||
                Math.abs(relativePosition - 1) <= tolerance
              ? 'at-or-near-reference'
              : 'between-references';
    const nearestReference =
      deltaFromFocus === null || deltaFromMindWandering === null
        ? ('unavailable' as const)
        : Math.abs(deltaFromFocus) === Math.abs(deltaFromMindWandering)
          ? ('equidistant' as const)
          : Math.abs(deltaFromFocus) < Math.abs(deltaFromMindWandering)
            ? ('focus' as const)
            : ('mind-wandering' as const);
    const medianQuality = valid.length
      ? median(valid.map((item) => item.qualityScore))
      : 0;
    const signalConfidence = valid.length
      ? clamp01(valid.length / this.#config.minimumValidEpochs) * medianQuality
      : 0;
    const calibrationMultiplier =
      calibrationQuality === 'high'
        ? 1
        : calibrationQuality === 'medium'
          ? 0.8
          : calibrationQuality === 'low'
            ? 0.5
            : 0;
    const confidence = signalConfidence * calibrationMultiplier;
    const measurementConfidence: ConfidenceLevel =
      confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low';
    const signalQuality = !valid.length
      ? ('unavailable' as const)
      : medianQuality >= 0.8
        ? ('good' as const)
        : medianQuality >= 0.6
          ? ('fair' as const)
          : ('poor' as const);
    const variabilityMad = mad(valid.map((item) => item.logTbr));
    const previousStates = this.#states.filter(
      (item) =>
        item.timestampMs >=
        epoch.timestampMs -
          this.#config.checkpointIntervalMs *
            (this.#config.trendWindowCount - 1),
    );
    const positions = [
      ...previousStates.map((item) => item.relativePosition),
      relativePosition,
    ].filter((value): value is number => value !== null);
    const relativePositionPrevious = positions.at(-2) ?? null;
    const relativePositionSlope =
      positions.length < this.#config.trendWindowCount
        ? null
        : (positions.at(-1)! - positions[0]!) / (positions.length - 1);
    const trend: AttentionTrend =
      relativePositionSlope === null
        ? 'insufficient-history'
        : relativePositionSlope > this.#config.trendDeltaThreshold
          ? 'toward-focus'
          : relativePositionSlope < -this.#config.trendDeltaThreshold
            ? 'toward-mind-wandering'
            : 'stable';
    const trajectory: StateTrajectory =
      relativePositionSlope === null
        ? 'unavailable'
        : variabilityMad !== null &&
            variabilityMad > this.#config.highVariabilityMad
          ? 'volatile'
          : trend === 'toward-focus'
            ? 'improving'
            : trend === 'toward-mind-wandering'
              ? 'declining'
              : 'stable';
    const mindWanderingBoundary =
      1 - this.#config.mindWanderingLeaningThreshold;
    const sustainedMindWanderingWindows =
      relativePosition !== null && relativePosition <= mindWanderingBoundary
        ? (this.#states.at(-1)?.sustainedMindWanderingWindows ?? 0) + 1
        : 0;
    const label =
      signalQuality === 'unavailable' || relativePosition === null
        ? ('uncertain' as const)
        : relativePosition > 1 - this.#config.focusLeaningThreshold
          ? ('focus-leaning' as const)
          : relativePosition <= mindWanderingBoundary
            ? ('mind-wandering-leaning' as const)
            : ('intermediate' as const);
    // Visualization only; not a probability and not used for reasoning.
    const focusPosition =
      relativePosition === null
        ? null
        : 0.5 + 0.5 * Math.tanh((relativePosition - 0.5) / 2);
    const mindWanderingPosition =
      focusPosition === null ? null : 1 - focusPosition;
    const state: AttentionState = {
      timestampMs: epoch.timestampMs,
      phase: sessionPhase(epoch.timestampMs, this.#config),
      currentLogTbr,
      focusReferenceLogTbr,
      mindWanderingReferenceLogTbr,
      referenceGap,
      referenceGapAbs,
      calibrationNoise,
      separationRatio,
      calibrationQuality,
      measurementConfidence,
      signalQuality,
      relativePosition,
      deltaFromFocus,
      deltaFromMindWandering,
      nearestReference,
      coverage,
      relativePositionPrevious,
      relativePositionSlope,
      trajectory,
      stateEstimationVersion: 'reference_unbounded_v2',
      focusPosition,
      mindWanderingPosition,
      unboundedMindWanderingPosition:
        relativePosition === null ? null : 1 - relativePosition,
      label,
      trend,
      trendDeltaPerCheckpoint: relativePositionSlope,
      variabilityMad,
      sustainedMindWanderingWindows,
      confidence,
      validEpochCount: valid.length,
    };
    this.#states.push(state);
    return structuredClone(state);
  }
  get states(): readonly AttentionState[] {
    return this.#states;
  }
}
