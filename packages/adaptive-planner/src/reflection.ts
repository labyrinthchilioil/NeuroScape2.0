import type {
  AttentionState,
  ConfidenceLevel,
  StateTrajectory,
} from './types.js';
import type {
  AdaptationHypothesis,
  FutureScenePatch,
  PatchOperationKind,
} from './patching.js';

export const OUTCOME_EVALUATOR_VERSION = 'outcome_v1';
export const MEMORY_POLICY_VERSION = 'session_memory_v1';
export type AdaptationLifecycleStatus =
  | 'PROPOSED'
  | 'VALIDATED'
  | 'QUEUED'
  | 'APPLYING'
  | 'APPLIED'
  | 'WAITING_FOR_OBSERVATION'
  | 'PROVISIONALLY_EVALUATED'
  | 'UPDATED_EVALUATION'
  | 'REJECTED'
  | 'FAILED';
export interface LifecycleTransition {
  status: AdaptationLifecycleStatus;
  timestampMs: number;
  reasonCode?: string;
}
export interface AdaptationLifecycle {
  adaptationId: string;
  patch: FutureScenePatch;
  hypothesis: AdaptationHypothesis;
  contextBefore: AttentionState;
  transitions: LifecycleTransition[];
  appliedAtMs?: number;
  transitionCompletedAtMs?: number;
}
export type ObservedResponse =
  | 'aligned_with_hypothesis'
  | 'opposed_to_hypothesis'
  | 'no_clear_change'
  | 'inconclusive'
  | 'not_yet_observable';
export interface AdaptationOutcome {
  adaptationId: string;
  observedResponse: ObservedResponse;
  outcomeConfidence: ConfidenceLevel | 'unavailable';
  reasonCodes: string[];
  causalClaimAllowed: false;
  evaluationVersion: typeof OUTCOME_EVALUATOR_VERSION;
  evaluatedAtMs: number;
  evidenceCount: number;
}
export interface AdaptationMemoryCase {
  adaptationId: string;
  contextSignature: {
    positionBand: string;
    trajectory: StateTrajectory;
    stability: string;
    sceneDensity: string;
    scenePhase: string;
  };
  actionSignature: {
    intent: string;
    layer: string;
    operation: PatchOperationKind;
    assetFamily: string;
    salience: string;
  };
  outcome: {
    observedResponse: ObservedResponse;
    confidence: ConfidenceLevel | 'unavailable';
    evidenceCount: number;
  };
  updatedAtMs: number;
}
export interface ObservationWindow {
  windowStartMs: number;
  windowEndMs: number;
  concurrentBasePlanChange: boolean;
  concurrentPatchCount: number;
}

export function transitionLifecycle(
  lifecycle: AdaptationLifecycle,
  status: AdaptationLifecycleStatus,
  timestampMs: number,
  reasonCode?: string,
): AdaptationLifecycle {
  const terminal = lifecycle.transitions.at(-1)?.status;
  if (['REJECTED', 'FAILED'].includes(terminal ?? ''))
    throw new Error('terminal_adaptation_cannot_transition');
  const next = structuredClone(lifecycle);
  next.transitions.push({
    status,
    timestampMs,
    ...(reasonCode ? { reasonCode } : {}),
  });
  if (status === 'APPLIED') next.appliedAtMs = timestampMs;
  if (status === 'WAITING_FOR_OBSERVATION')
    next.transitionCompletedAtMs = timestampMs;
  return next;
}

export function evaluateAdaptationOutcome(options: {
  lifecycle: AdaptationLifecycle;
  postState: AttentionState;
  window: ObservationWindow;
}): AdaptationOutcome {
  const { lifecycle, postState, window } = options;
  const applied = lifecycle.appliedAtMs;
  const completed = lifecycle.transitionCompletedAtMs;
  const base: Pick<
    AdaptationOutcome,
    | 'adaptationId'
    | 'causalClaimAllowed'
    | 'evaluationVersion'
    | 'evaluatedAtMs'
    | 'evidenceCount'
  > = {
    adaptationId: lifecycle.adaptationId,
    causalClaimAllowed: false as const,
    evaluationVersion: OUTCOME_EVALUATOR_VERSION,
    evaluatedAtMs: window.windowEndMs,
    evidenceCount: 1,
  };
  if (
    !applied ||
    !completed ||
    lifecycle.transitions.some(
      (t) => t.status === 'FAILED' || t.status === 'REJECTED',
    )
  )
    return {
      ...base,
      observedResponse: 'not_yet_observable',
      outcomeConfidence: 'unavailable',
      reasonCodes: ['PATCH_NOT_APPLIED'],
    };
  const overlap = Math.max(0, applied - window.windowStartMs);
  if (window.windowEndMs <= completed || overlap > 0)
    return {
      ...base,
      observedResponse: 'not_yet_observable',
      outcomeConfidence: 'low',
      reasonCodes: ['PRE_ADAPTATION_WINDOW_OVERLAP'],
    };
  if (
    postState.signalQuality === 'poor' ||
    postState.signalQuality === 'unavailable' ||
    postState.calibrationQuality === 'unusable' ||
    postState.calibrationQuality === 'low'
  )
    return {
      ...base,
      observedResponse: 'inconclusive',
      outcomeConfidence: 'unavailable',
      reasonCodes: ['INVALID_OR_LOW_CONFIDENCE_SIGNAL'],
    };
  if (
    window.concurrentBasePlanChange ||
    window.concurrentPatchCount > 1 ||
    postState.trajectory === 'volatile'
  )
    return {
      ...base,
      observedResponse: 'inconclusive',
      outcomeConfidence: 'low',
      reasonCodes: [
        window.concurrentBasePlanChange
          ? 'CONCURRENT_BASE_PLAN_CHANGE'
          : 'CONCURRENT_OR_VOLATILE',
      ],
    };
  const pre = lifecycle.contextBefore.relativePosition;
  const post = postState.relativePosition;
  const delta = pre === null || post === null ? null : post - pre;
  if (delta === null)
    return {
      ...base,
      observedResponse: 'inconclusive',
      outcomeConfidence: 'unavailable',
      reasonCodes: ['POSITION_UNAVAILABLE'],
    };
  const aligned =
    postState.trajectory === 'improving' ||
    (lifecycle.contextBefore.trajectory === 'declining' &&
      postState.trajectory === 'stable') ||
    delta > 0.05;
  const opposed = postState.trajectory === 'declining' && delta < -0.05;
  return {
    ...base,
    observedResponse: aligned
      ? 'aligned_with_hypothesis'
      : opposed
        ? 'opposed_to_hypothesis'
        : 'no_clear_change',
    outcomeConfidence: postState.measurementConfidence,
    reasonCodes: [
      aligned
        ? 'DECLINE_HALTED_OR_IMPROVED'
        : opposed
          ? 'CONTINUED_DECLINE'
          : 'NO_CLEAR_CHANGE',
      'TEMPORAL_ASSOCIATION_ONLY',
    ],
  };
}

export class SessionAdaptationMemory {
  readonly #cases: AdaptationMemoryCase[] = [];
  add(memoryCase: AdaptationMemoryCase): void {
    const i = this.#cases.findIndex(
      (item) => item.adaptationId === memoryCase.adaptationId,
    );
    if (i >= 0) this.#cases[i] = structuredClone(memoryCase);
    else this.#cases.push(structuredClone(memoryCase));
  }
  retrieve(
    signature: Partial<AdaptationMemoryCase['contextSignature']> & {
      intent?: string;
    },
    limit = 3,
  ): AdaptationMemoryCase[] {
    return this.#cases
      .filter(
        (item) =>
          item.outcome.observedResponse !== 'inconclusive' &&
          item.outcome.observedResponse !== 'not_yet_observable',
      )
      .map((item) => ({
        item,
        score:
          (item.contextSignature.trajectory === signature.trajectory ? 3 : 0) +
          (item.contextSignature.scenePhase === signature.scenePhase ? 2 : 0) +
          (item.actionSignature.intent === signature.intent ? 3 : 0) +
          (item.outcome.confidence === 'high'
            ? 2
            : item.outcome.confidence === 'medium'
              ? 1
              : 0),
      }))
      .sort(
        (a, b) => b.score - a.score || b.item.updatedAtMs - a.item.updatedAtMs,
      )
      .slice(0, Math.min(3, limit))
      .map(({ item }) => structuredClone(item));
  }
  generalizedLesson(
    key: Pick<
      AdaptationMemoryCase['actionSignature'],
      'intent' | 'operation' | 'assetFamily'
    >,
  ): {
    lessonCode: string;
    confidence: ConfidenceLevel;
    evidenceCount: number;
  } | null {
    const matching = this.#cases.filter(
      (item) =>
        item.actionSignature.intent === key.intent &&
        item.actionSignature.operation === key.operation &&
        item.actionSignature.assetFamily === key.assetFamily &&
        ['aligned_with_hypothesis', 'opposed_to_hypothesis'].includes(
          item.outcome.observedResponse,
        ),
    );
    if (matching.length < 2) return null;
    const aligned = matching.filter(
      (item) => item.outcome.observedResponse === 'aligned_with_hypothesis',
    ).length;
    const opposed = matching.length - aligned;
    if (aligned === opposed) return null;
    return {
      lessonCode:
        aligned > opposed
          ? 'SIMILAR_STRATEGY_REPEATEDLY_ALIGNED'
          : 'AVOID_IMMEDIATE_REPEAT_OF_OPPOSED_STRATEGY',
      confidence: matching.length >= 3 ? 'high' : 'medium',
      evidenceCount: matching.length,
    };
  }
  get cases(): readonly AdaptationMemoryCase[] {
    return structuredClone(this.#cases);
  }
}
