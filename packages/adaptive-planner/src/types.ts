import type {
  ActionPlanItem,
  AmbientPlanItem,
  EventPlanItem,
  SceneJourneyPlan,
  UserJourneyPlan,
} from '@neuroscape/contracts';
import type { BaseScenePlan } from './base-plan.js';
import type {
  ComplexityProjection,
  FutureScenePatch,
  PatchValidationResult,
} from './patching.js';
import type {
  AdaptationLifecycle,
  AdaptationMemoryCase,
  AdaptationOutcome,
} from './reflection.js';

export type SessionPhase = 'opening' | 'adaptive' | 'closing';
export type AttentionLabel =
  'focus-leaning' | 'intermediate' | 'mind-wandering-leaning' | 'uncertain';
export type AttentionTrend =
  'toward-focus' | 'toward-mind-wandering' | 'stable' | 'insufficient-history';
export type ReferenceCoverage =
  | 'between-references'
  | 'beyond-focus-reference'
  | 'beyond-mind-wandering-reference'
  | 'at-or-near-reference'
  | 'unavailable';
export type StateTrajectory =
  'improving' | 'stable' | 'declining' | 'volatile' | 'unavailable';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface CalibrationProfile {
  profileId: string;
  focusedAnchorLogTbr: number;
  mindWanderingAnchorLogTbr: number;
  pooledMad: number;
  mappingAvailable: boolean;
  qualityStatus: 'pass' | 'provisional' | 'fail';
  featureVersion: string;
}

export interface TbrEpoch {
  timestampMs: number;
  logTbr: number | null;
  valid: boolean;
  qualityScore: number;
  artifactFlags: string[];
}

export interface AttentionState {
  timestampMs: number;
  phase: SessionPhase;
  currentLogTbr: number | null;
  focusReferenceLogTbr: number;
  mindWanderingReferenceLogTbr: number;
  referenceGap: number;
  referenceGapAbs: number;
  calibrationNoise: number;
  separationRatio: number | null;
  calibrationQuality: ConfidenceLevel | 'unusable';
  measurementConfidence: ConfidenceLevel;
  signalQuality: 'good' | 'fair' | 'poor' | 'unavailable';
  relativePosition: number | null;
  deltaFromFocus: number | null;
  deltaFromMindWandering: number | null;
  nearestReference: 'focus' | 'mind-wandering' | 'equidistant' | 'unavailable';
  coverage: ReferenceCoverage;
  relativePositionPrevious: number | null;
  relativePositionSlope: number | null;
  trajectory: StateTrajectory;
  stateEstimationVersion: 'reference_unbounded_v2';
  /** Visualization only; not a probability and not used for reasoning. */
  focusPosition: number | null;
  /** Visualization only; not a probability and not used for reasoning. */
  mindWanderingPosition: number | null;
  unboundedMindWanderingPosition: number | null;
  label: AttentionLabel;
  trend: AttentionTrend;
  trendDeltaPerCheckpoint: number | null;
  variabilityMad: number | null;
  sustainedMindWanderingWindows: number;
  confidence: number;
  validEpochCount: number;
}

export interface EligibilityResult {
  eligible: boolean;
  timestampMs: number;
  reasons: string[];
  secondsSinceLastMeaningfulChange?: number;
  stasisPressure?: boolean;
  transitionInProgress?: boolean;
}

export interface AdaptationRestrictions {
  allowEvent: boolean;
  allowBodyAnchor: boolean;
  allowSceneTransition: boolean;
  sceneTransitionsRemaining: number;
}

export interface AdaptationHistoryItem {
  timestampMs: number;
  goal: AdaptationGoal;
  scope: AdaptationScope;
  assetIds: string[];
  rationale: string;
  intent?: AdaptationIntent;
  salience?: AdaptationSalience;
}

export function reasoningAttentionState(state: AttentionState) {
  const {
    focusPosition: _displayFocus,
    mindWanderingPosition: _displayMindWandering,
    unboundedMindWanderingPosition: _legacyMindWandering,
    ...reasoningState
  } = state;
  void _displayFocus;
  void _displayMindWandering;
  void _legacyMindWandering;
  return reasoningState;
}

export type AdaptationGoal =
  | 'maintain'
  | 'gently-reorient'
  | 'support-grounding'
  | 'support-sustained-focus'
  | 'preserve-recovery'
  | 'reduce-stimulation'
  | 'refresh-engagement';
export type AdaptationScope = 'maintain' | 'within-scene' | 'scene-transition';

export interface DecisionContext {
  state: AttentionState;
  recentStates: AttentionState[];
  currentPlan: SceneJourneyPlan;
  history: AdaptationHistoryItem[];
  restrictions: AdaptationRestrictions;
  secondsSinceLastMeaningfulChange: number;
  stasisPressure: boolean;
  transitionInProgress: boolean;
  basePlan?: BaseScenePlan;
  upcomingBaseHorizon?: BaseScenePlan['scheduledElements'];
  relevantPriorOutcomes?: AdaptationMemoryCase[];
  complexityHeadroom?: ComplexityProjection;
}

export type AdaptationIntent =
  | 'gently_reorient_attention'
  | 'support_grounding'
  | 'reduce_stimulation'
  | 'support_sustained_focus'
  | 'refresh_engagement'
  | 'preserve_recovery'
  | 'maintain';
export type AdaptationSalience = 'minimal' | 'low' | 'moderate';

export interface AdaptationDecision {
  decision: 'adapt' | 'maintain';
  intent: AdaptationIntent;
  salience: AdaptationSalience;
  evidenceSummary: {
    position: AttentionLabel | 'unavailable';
    trajectory: StateTrajectory;
    confidence: ConfidenceLevel;
  };
  reason: string;
  maintainReason: string | null;
  constraintsForDecision2: string[];
  shouldAdapt: boolean;
  goal: AdaptationGoal;
  scope: AdaptationScope;
  rationale: string;
  provider: string;
  promptVersion?: string;
  prompt?: string;
  outputSchema?: Record<string, unknown>;
  model?: string;
  responseId?: string;
  usage?: LlmUsage;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

export interface SoundscapePlanPatch {
  reasoningSummary: string;
  journey?: UserJourneyPlan;
  upsertAmbient?: AmbientPlanItem[];
  upsertAction?: ActionPlanItem[];
  upsertEvent?: EventPlanItem[];
  removeIds?: string[];
  transitionDurationMs?: number;
}

export interface PlanningResult {
  patch: SoundscapePlanPatch;
  selectedAssetIds: string[];
  candidateAssetIds: string[];
  promptVersion: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  rationale: string;
  provider: string;
  model?: string;
  responseId?: string;
  usage?: LlmUsage;
  normalizedFuturePatch?: FutureScenePatch;
}

export interface Decision2Candidate {
  assetId: string;
  familyId: string;
  label: string;
  description: string;
  scene: string[];
  layer: 'ambient' | 'event' | 'action';
  tags: string[];
  loop: boolean;
  suddenness: number;
  intensity: number;
  recommendedDistance: string;
  recommendedVolume: number;
  useWhen: string[];
  avoidWhen: string[];
  spatialBehavior: string[];
  defaultPosition: [number, number, number];
  defaultMotion: {
    type: string;
    durationSec: number | null;
    start?: [number, number, number];
    mid?: [number, number, number];
    end?: [number, number, number];
  };
  autoDeleteAfterSec: number | null;
  fadeInSec: number;
  fadeOutSec: number;
  priority: number;
  isPrimaryAmbient: boolean;
  isRareEvent: boolean;
}

export interface Decision2Input {
  promptVersion: string;
  prompt: string;
  outputSchema: Record<string, unknown>;
  currentScene: string;
  candidates: Decision2Candidate[];
  reasoningEffort: 'low' | 'medium';
}

export interface DecisionProvider {
  decide(context: DecisionContext): Promise<AdaptationDecision>;
}

export interface PlanningProvider {
  plan(
    context: DecisionContext,
    decision: AdaptationDecision,
    input: Decision2Input,
  ): Promise<PlanningResult>;
}

export interface AdaptiveCheckpointResult {
  state: AttentionState;
  eligibility: EligibilityResult;
  decision?: AdaptationDecision;
  planning?: PlanningResult;
  plan?: SceneJourneyPlan;
  futurePatch?: FutureScenePatch;
  patchValidation?: PatchValidationResult;
  lifecycle?: AdaptationLifecycle;
  outcome?: AdaptationOutcome;
}
