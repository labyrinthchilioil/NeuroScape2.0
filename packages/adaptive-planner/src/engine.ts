import type { SceneJourneyPlan } from '@neuroscape/contracts';
import type { AdaptivePlannerConfig } from './config.js';
import {
  prepareDecision2Input,
  validateDecision2Selection,
} from './audio-retrieval.js';
import { evaluateEligibility, restrictionsFor } from './gate.js';
import { AttentionInterpreter } from './interpreter.js';
import { mergePlanPatch } from './plan-merge.js';
import { materializeBasePlan, type BaseScenePlan } from './base-plan.js';
import {
  normalizeLegacyPlanPatch,
  validateAndProjectPatch,
  type FutureScenePatch,
} from './patching.js';
import {
  evaluateAdaptationOutcome,
  SessionAdaptationMemory,
  transitionLifecycle,
  type AdaptationLifecycle,
  type AdaptationOutcome,
} from './reflection.js';
import type {
  AdaptationHistoryItem,
  AdaptiveCheckpointResult,
  AttentionState,
  CalibrationProfile,
  DecisionProvider,
  PlanningProvider,
  TbrEpoch,
} from './types.js';

export class AdaptivePlannerEngine {
  readonly #config: AdaptivePlannerConfig;
  readonly #profile: CalibrationProfile;
  readonly #interpreter: AttentionInterpreter;
  readonly #decisionProvider: DecisionProvider;
  readonly #planningProvider: PlanningProvider;
  readonly #checkpointStates: AttentionState[] = [];
  readonly #history: AdaptationHistoryItem[] = [];
  #currentPlan: SceneJourneyPlan;
  #transitionUntilMs = 0;
  #basePlan?: BaseScenePlan;
  readonly #acceptedPatches: FutureScenePatch[] = [];
  readonly #lifecycles = new Map<string, AdaptationLifecycle>();
  readonly #memory = new SessionAdaptationMemory();
  #requestSequence = 0;

  constructor(options: {
    config: AdaptivePlannerConfig;
    profile: CalibrationProfile;
    initialPlan: SceneJourneyPlan;
    decisionProvider: DecisionProvider;
    planningProvider: PlanningProvider;
    basePlan?: BaseScenePlan;
  }) {
    this.#config = options.config;
    this.#profile = options.profile;
    this.#basePlan = options.basePlan
      ? structuredClone(options.basePlan)
      : undefined;
    this.#currentPlan = this.#basePlan
      ? materializeBasePlan(this.#basePlan)
      : structuredClone(options.initialPlan);
    this.#decisionProvider = options.decisionProvider;
    this.#planningProvider = options.planningProvider;
    this.#interpreter = new AttentionInterpreter(
      options.profile,
      options.config,
    );
  }

  async ingest(epoch: TbrEpoch): Promise<AdaptiveCheckpointResult | null> {
    const rawState = this.#interpreter.ingest(epoch);
    if (!this.isCheckpoint(epoch.timestampMs)) return null;
    const state = this.withCheckpointTrend(rawState);
    this.#checkpointStates.push(state);
    const outcome = this.evaluatePendingOutcome(state);
    const lastMeaningfulChange =
      this.#history.at(-1)?.timestampMs ?? this.#config.openingDurationMs;
    const secondsSinceLastMeaningfulChange = Math.max(
      0,
      (state.timestampMs - lastMeaningfulChange) / 1_000,
    );
    const stasisPressure =
      state.timestampMs - lastMeaningfulChange >=
      this.#config.maxMeaningfulStasisMs;
    const eligibility = {
      ...evaluateEligibility(
        state,
        this.#profile,
        this.#history,
        this.#config,
        this.#transitionUntilMs,
        stasisPressure,
      ),
      secondsSinceLastMeaningfulChange,
      stasisPressure,
      transitionInProgress: state.timestampMs < this.#transitionUntilMs,
      ...(this.#basePlan
        ? {
            basePlan: structuredClone(this.#basePlan),
            upcomingBaseHorizon: structuredClone(
              this.#basePlan.scheduledElements.filter(
                (element) =>
                  element.startMs >=
                    state.timestampMs + this.#config.executionFreezeBufferMs &&
                  element.startMs <=
                    state.timestampMs +
                      this.#config.executionFreezeBufferMs +
                      this.#config.patchHorizonMs,
              ),
            ),
            relevantPriorOutcomes: this.#memory.retrieve({
              trajectory: state.trajectory,
              scenePhase: state.phase,
            }),
          }
        : {}),
    };
    const result: AdaptiveCheckpointResult = {
      state,
      eligibility,
      ...(outcome ? { outcome } : {}),
    };
    if (!eligibility.eligible) return result;
    const context = {
      state,
      recentStates: structuredClone(this.#checkpointStates.slice(-6)),
      currentPlan: structuredClone(this.#currentPlan),
      history: structuredClone(this.#history),
      restrictions: restrictionsFor(state, this.#history, this.#config),
      secondsSinceLastMeaningfulChange,
      stasisPressure,
      transitionInProgress: state.timestampMs < this.#transitionUntilMs,
    };
    const requestId = ++this.#requestSequence;
    const decision = await this.#decisionProvider.decide(context);
    if (requestId !== this.#requestSequence) {
      result.eligibility.reasons.push('stale_decision_1_response');
      return result;
    }
    result.decision = decision;
    if (!decision.shouldAdapt) return result;
    const decision2Input = prepareDecision2Input(
      context,
      decision,
      this.#config,
    );
    const planning = await this.#planningProvider.plan(
      context,
      decision,
      decision2Input,
    );
    if (requestId !== this.#requestSequence) {
      result.eligibility.reasons.push('stale_decision_2_response');
      return result;
    }
    validateDecision2Selection(planning, decision2Input);
    let plan: SceneJourneyPlan;
    if (this.#basePlan) {
      const futurePatch = normalizeLegacyPlanPatch({
        adaptationId: `adapt-${state.timestampMs}`,
        patch: planning.patch,
        decision,
        basePlan: this.#basePlan,
        nowMs: state.timestampMs,
        freezeBufferMs: this.#config.executionFreezeBufferMs,
      });
      const validation = validateAndProjectPatch({
        basePlan: this.#basePlan,
        acceptedPatches: this.#acceptedPatches,
        proposedPatch: futurePatch,
        nowMs: state.timestampMs,
        config: this.#config,
        recentAssetIds: this.#history.flatMap((item) => item.assetIds),
      });
      result.futurePatch = futurePatch;
      result.patchValidation = validation;
      const lifecycle: AdaptationLifecycle = {
        adaptationId: futurePatch.adaptationId,
        patch: futurePatch,
        hypothesis: futurePatch.hypothesis,
        contextBefore: structuredClone(state),
        transitions: [
          { status: 'PROPOSED', timestampMs: state.timestampMs },
          {
            status: validation.valid ? 'VALIDATED' : 'REJECTED',
            timestampMs: state.timestampMs,
            ...(!validation.valid
              ? { reasonCode: validation.violations.join(',') }
              : {}),
          },
        ],
      };
      result.lifecycle = lifecycle;
      this.#lifecycles.set(futurePatch.adaptationId, lifecycle);
      if (
        !validation.valid ||
        futurePatch.status === 'NO_SAFE_PATCH' ||
        !validation.projectedPlan
      ) {
        result.planning = planning;
        return result;
      }
      this.#basePlan = validation.projectedPlan;
      this.#acceptedPatches.push(futurePatch);
      plan = materializeBasePlan(this.#basePlan);
    } else {
      plan = mergePlanPatch(
        this.#currentPlan,
        planning.patch,
        state.timestampMs,
      );
    }
    this.#currentPlan = plan;
    this.#transitionUntilMs =
      state.timestampMs + Math.max(planning.patch.transitionDurationMs ?? 0, 0);
    this.#history.push({
      timestampMs: state.timestampMs,
      goal: decision.goal,
      scope: decision.scope,
      assetIds: planning.selectedAssetIds,
      rationale: `${decision.rationale} ${planning.rationale}`,
      intent: decision.intent,
      salience: decision.salience,
    });
    result.planning = planning;
    result.plan = structuredClone(plan);
    return result;
  }

  get currentPlan(): SceneJourneyPlan {
    return structuredClone(this.#currentPlan);
  }
  get history(): readonly AdaptationHistoryItem[] {
    return structuredClone(this.#history);
  }
  get attentionStates(): readonly AttentionState[] {
    return structuredClone(this.#interpreter.states);
  }
  get acceptedPatches(): readonly FutureScenePatch[] {
    return structuredClone(this.#acceptedPatches);
  }
  get adaptationMemory() {
    return this.#memory.cases;
  }
  acknowledgeApplication(
    adaptationId: string,
    status: 'APPLIED' | 'FAILED',
    timestampMs: number,
  ): void {
    const lifecycle = this.#lifecycles.get(adaptationId);
    if (!lifecycle) return;
    lifecycle.transitions.push({ status, timestampMs });
    if (status === 'APPLIED') {
      lifecycle.appliedAtMs = timestampMs;
      lifecycle.transitions.push({
        status: 'WAITING_FOR_OBSERVATION',
        timestampMs:
          timestampMs +
          lifecycle.patch.operations.reduce(
            (max, op) => Math.max(max, op.transitionMs),
            0,
          ),
      });
      lifecycle.transitionCompletedAtMs =
        lifecycle.transitions.at(-1)!.timestampMs;
    }
  }

  private evaluatePendingOutcome(
    state: AttentionState,
  ): AdaptationOutcome | undefined {
    const lifecycle = [...this.#lifecycles.values()].find((item) => {
      const last = item.transitions.at(-1)?.status;
      return (
        last === 'WAITING_FOR_OBSERVATION' || last === 'PROVISIONALLY_EVALUATED'
      );
    });
    if (!lifecycle?.appliedAtMs) return undefined;
    const windowStartMs = state.timestampMs - this.#config.analysisWindowMs;
    const outcome = evaluateAdaptationOutcome({
      lifecycle,
      postState: state,
      window: {
        windowStartMs,
        windowEndMs: state.timestampMs,
        concurrentBasePlanChange:
          this.#basePlan?.scheduledElements.some(
            (element) =>
              element.startMs > lifecycle.appliedAtMs! &&
              element.startMs <= state.timestampMs,
          ) ?? false,
        concurrentPatchCount: this.#acceptedPatches.filter((patch) => {
          const applied = this.#lifecycles.get(patch.adaptationId)?.appliedAtMs;
          return (
            applied !== undefined &&
            applied > windowStartMs &&
            applied <= state.timestampMs
          );
        }).length,
      },
    });
    if (outcome.observedResponse === 'not_yet_observable') return outcome;
    const nextStatus = lifecycle.transitions.some(
      (item) => item.status === 'PROVISIONALLY_EVALUATED',
    )
      ? 'UPDATED_EVALUATION'
      : 'PROVISIONALLY_EVALUATED';
    const updated = transitionLifecycle(
      lifecycle,
      nextStatus,
      state.timestampMs,
    );
    this.#lifecycles.set(lifecycle.adaptationId, updated);
    const operation = lifecycle.patch.operations[0];
    this.#memory.add({
      adaptationId: lifecycle.adaptationId,
      contextSignature: {
        positionBand: lifecycle.contextBefore.label,
        trajectory: lifecycle.contextBefore.trajectory,
        stability:
          lifecycle.contextBefore.trajectory === 'volatile' ? 'low' : 'medium',
        sceneDensity:
          (this.#basePlan?.scheduledElements.length ?? 0) > 5
            ? 'medium'
            : 'low',
        scenePhase: lifecycle.contextBefore.phase,
      },
      actionSignature: {
        intent: lifecycle.patch.intent,
        layer: operation?.insertedElement?.layer ?? 'mixed',
        operation: operation?.operation ?? 'KEEP',
        assetFamily:
          operation?.insertedElement?.assetFamily ??
          operation?.replacementAssetId?.replace(/_\d+$/, '') ??
          'existing',
        salience: lifecycle.patch.salience,
      },
      outcome: {
        observedResponse: outcome.observedResponse,
        confidence: outcome.outcomeConfidence,
        evidenceCount: outcome.evidenceCount,
      },
      updatedAtMs: state.timestampMs,
    });
    return outcome;
  }

  private isCheckpoint(timestampMs: number): boolean {
    if (timestampMs < this.#config.openingDurationMs) return false;
    return (
      (timestampMs - this.#config.openingDurationMs) %
        this.#config.checkpointIntervalMs ===
      0
    );
  }

  private withCheckpointTrend(state: AttentionState): AttentionState {
    const recent = [
      ...this.#checkpointStates.slice(-(this.#config.trendWindowCount - 1)),
      state,
    ];
    const first = recent[0]?.relativePosition;
    const current = state.relativePosition;
    const delta =
      recent.length < this.#config.trendWindowCount ||
      first === null ||
      first === undefined ||
      current === null
        ? null
        : (current - first) / (recent.length - 1);
    const trend =
      delta === null
        ? 'insufficient-history'
        : delta > this.#config.trendDeltaThreshold
          ? 'toward-focus'
          : delta < -this.#config.trendDeltaThreshold
            ? 'toward-mind-wandering'
            : 'stable';
    const previous =
      this.#checkpointStates.at(-1)?.sustainedMindWanderingWindows ?? 0;
    const sustained =
      current !== null &&
      current <= 1 - this.#config.mindWanderingLeaningThreshold
        ? previous + 1
        : 0;
    return {
      ...state,
      trend,
      trendDeltaPerCheckpoint: delta,
      relativePositionPrevious: recent.at(-2)?.relativePosition ?? null,
      relativePositionSlope: delta,
      trajectory:
        delta === null
          ? 'unavailable'
          : state.variabilityMad !== null &&
              state.variabilityMad > this.#config.highVariabilityMad
            ? 'volatile'
            : delta > this.#config.trendDeltaThreshold
              ? 'improving'
              : delta < -this.#config.trendDeltaThreshold
                ? 'declining'
                : 'stable',
      sustainedMindWanderingWindows: sustained,
    };
  }
}
