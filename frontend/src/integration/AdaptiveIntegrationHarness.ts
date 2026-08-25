import {
  AdaptivePlannerEngine,
  MockDecisionProvider,
  MockPlanningProvider,
  OpenAIDecisionProvider,
  OpenAIPlanningProvider,
  createMockTbrReplay,
  createMatchedForestBasePlans,
  assignMatchedBasePlans,
  materializeBasePlan,
  mockCalibrationProfile,
  phase1Config,
  type AdaptiveCheckpointResult,
  type AttentionState,
  type CalibrationProfile,
  type TbrEpoch,
} from '@neuroscape/adaptive-planner';
import {
  NEUROSCAPE_PROTOCOL_VERSION,
  type AdaptiveTraceRecord,
  type NeuroState,
  type ServerMessage,
} from '@neuroscape/contracts';
import {
  ActionController,
  AmbientController,
  EventController,
  JourneyController,
  PlanValidator,
  RuntimeController,
  RuntimeEventBus,
  RuntimeWorldStateBuilder,
  SceneGraph,
  SemanticLocationMapper,
  TransitionController,
} from '@neuroscape/runtime-scene-controller';
import { runtimeDiagnostics } from '../debug/index.js';
import {
  dispatchServerMessage,
  parseServerMessage,
} from '../network/protocol.js';
import { sessionRecorder } from '../recording/recordingStore.js';
import { runtimeStore, type RuntimeStore } from '../runtime/RuntimeStore.js';
import { forestSceneGraph } from './canonicalForestScenario.js';

export interface AdaptiveHarnessState {
  status: 'idle' | 'running' | 'paused' | 'ended';
  timestampMs: number;
  checkpointCount: number;
  adaptationCount: number;
}
export type AdaptiveRunMode = 'mock-fast' | 'study-realtime';
export interface AdaptiveHarnessStartOptions {
  sessionId?: string;
  runMode?: AdaptiveRunMode;
  plannerMode?: 'openai' | 'mock';
  calibrationProfile?: CalibrationProfile;
  epochSource?: AdaptiveEpochSource;
  sessionDurationMs?: number;
  participantId?: string;
  condition?: 'adaptive' | 'non-adaptive';
}
export interface AdaptiveEpochSource {
  next(): Promise<TbrEpoch | null>;
}
export interface AdaptiveIntervalApi {
  set(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
}
const intervals: AdaptiveIntervalApi = {
  set: (callback, milliseconds) => setInterval(callback, milliseconds),
  clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class AdaptiveIntegrationHarness {
  readonly #store: RuntimeStore;
  readonly #intervals: AdaptiveIntervalApi;
  readonly #listeners = new Set<() => void>();
  #sessionId = 'adaptive-mock-session';
  #runMode: AdaptiveRunMode = 'mock-fast';
  #plannerMode: 'openai' | 'mock' = 'openai';
  #condition: 'adaptive' | 'non-adaptive' = 'adaptive';
  #runtime: RuntimeController | null = null;
  #planner: AdaptivePlannerEngine | null = null;
  #timer: unknown;
  #busy = false;
  #epochIndex = 0;
  #replay = createMockTbrReplay();
  #epochSource: AdaptiveEpochSource | null = null;
  #sessionDurationMs = phase1Config.sessionDurationMs;
  #state: AdaptiveHarnessState = {
    status: 'idle',
    timestampMs: 0,
    checkpointCount: 0,
    adaptationCount: 0,
  };

  constructor(
    store: RuntimeStore = runtimeStore,
    intervalApi: AdaptiveIntervalApi = intervals,
  ) {
    this.#store = store;
    this.#intervals = intervalApi;
  }
  getState = () => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  start(options: AdaptiveHarnessStartOptions = {}): void {
    this.end(false);
    this.#sessionId = options.sessionId ?? 'adaptive-mock-session';
    this.#runMode = options.runMode ?? 'mock-fast';
    this.#plannerMode = options.plannerMode ?? 'openai';
    this.#condition = options.condition ?? 'adaptive';
    this.#epochSource = options.epochSource ?? null;
    this.#sessionDurationMs =
      options.sessionDurationMs ?? phase1Config.sessionDurationMs;
    this.#store.getState().resetSessionStreams();
    runtimeDiagnostics.reset();
    this.#runtime = this.createRuntime();
    const assignment = assignMatchedBasePlans(options.participantId ?? 'P001');
    const assignedPlanId =
      this.#condition === 'adaptive'
        ? assignment.adaptiveBasePlanId
        : assignment.nonAdaptiveBasePlanId;
    const basePlan = createMatchedForestBasePlans(phase1Config).find(
      (plan) => plan.planId === assignedPlanId,
    )!;
    const initialPlan = materializeBasePlan(basePlan);
    this.#planner =
      this.#condition === 'adaptive'
        ? new AdaptivePlannerEngine({
            config: phase1Config,
            profile: options.calibrationProfile ?? mockCalibrationProfile,
            initialPlan,
            basePlan,
            decisionProvider:
              this.#plannerMode === 'openai'
                ? new OpenAIDecisionProvider({ sessionId: this.#sessionId })
                : new MockDecisionProvider(),
            planningProvider:
              this.#plannerMode === 'openai'
                ? new OpenAIPlanningProvider({ sessionId: this.#sessionId })
                : new MockPlanningProvider(),
          })
        : null;
    this.#runtime.initialize(initialPlan);
    this.#epochIndex = 0;
    this.#state = {
      status: 'running',
      timestampMs: 0,
      checkpointCount: 0,
      adaptationCount: 0,
    };
    this.dispatch('PlannerStatus', 0, {
      status: 'ready',
      message:
        this.#condition === 'adaptive'
          ? `Module 01/02 ${this.#plannerMode === 'openai' ? 'OpenAI GPT-5.6' : 'mock'} providers ready · opening phase`
          : `Non-Adaptive ${basePlan.planId} ready · EEG cannot alter playback`,
    });
    this.trace(0, 'base-plan', 'deterministic', `Loaded ${basePlan.planId}`, {
      basePlanId: basePlan.planId,
      basePlanVersion: basePlan.version,
      profileId: basePlan.profile.profileId,
      assignment,
    });
    this.dispatch('SceneJourneyPlan', 0, initialPlan);
    this.dispatch('RuntimeWorldState', 0, this.#runtime.currentState!);
    this.dispatch('SessionStatus', 0, {
      status: 'running',
      elapsedTimeMs: 0,
      message:
        this.#runMode === 'mock-fast'
          ? `${this.#sessionDurationMs / 60_000}-minute adaptive mock replay · 10× accelerated`
          : this.#epochSource
            ? `${this.#sessionDurationMs / 60_000}-minute adaptive session · live Muse EEG`
            : `${this.#sessionDurationMs / 60_000}-minute adaptive study replay · realtime`,
    });
    this.startTimer();
    this.emit();
  }

  pause(): void {
    if (this.#state.status !== 'running') return;
    this.clearTimer();
    this.#state = { ...this.#state, status: 'paused' };
    this.dispatch('SessionStatus', this.#state.timestampMs, {
      status: 'paused',
      elapsedTimeMs: this.#state.timestampMs,
    });
    this.emit();
  }
  resume(): void {
    if (this.#state.status !== 'paused') return;
    this.#state = { ...this.#state, status: 'running' };
    this.dispatch('SessionStatus', this.#state.timestampMs, {
      status: 'running',
      elapsedTimeMs: this.#state.timestampMs,
    });
    this.startTimer();
    this.emit();
  }
  end(publish = true): void {
    this.clearTimer();
    this.#runtime?.shutdown();
    this.#runtime = null;
    this.#planner = null;
    if (publish) {
      this.dispatch('SessionStatus', this.#state.timestampMs, {
        status: 'ended',
        elapsedTimeMs: this.#state.timestampMs,
        message: 'Adaptive mock session complete; recording bundle is ready.',
      });
      this.#state = { ...this.#state, status: 'ended' };
      this.emit();
    }
  }

  async tick(deltaTimeMs = 1_000): Promise<void> {
    if (this.#busy || !this.#runtime || this.#state.status !== 'running')
      return;
    this.#busy = true;
    try {
      const nextTimestamp = Math.min(
        this.#sessionDurationMs,
        this.#state.timestampMs + deltaTimeMs,
      );
      const epochs: TbrEpoch[] = [];
      if (this.#epochSource) {
        const epoch = await this.#epochSource.next();
        if (epoch) epochs.push(epoch);
      } else {
        while (
          this.#epochIndex < this.#replay.length &&
          this.#replay[this.#epochIndex]!.timestampMs <= nextTimestamp
        )
          epochs.push(this.#replay[this.#epochIndex++]!);
      }
      for (const epoch of epochs) {
        if (!this.#planner) continue;
        this.trace(
          epoch.timestampMs,
          'eeg-epoch',
          this.#epochSource ? 'live-eeg' : 'deterministic',
          `${this.#epochSource ? 'Live Muse' : 'Mock'} log-TBR epoch ${epoch.valid ? 'accepted' : 'rejected'}`,
          epoch,
        );
        if (this.#plannerMode === 'openai') void this.processEpoch(epoch);
        else await this.processEpoch(epoch);
      }
      const startedAt = performance.now();
      const snapshot = this.#runtime.update(
        nextTimestamp - this.#state.timestampMs,
      );
      runtimeDiagnostics.recordModule03Update(performance.now() - startedAt);
      this.dispatch('RuntimeWorldState', snapshot.timestampMs, snapshot);
      this.dispatch('SessionStatus', snapshot.timestampMs, {
        status: 'running',
        elapsedTimeMs: snapshot.timestampMs,
        message: this.#epochSource
          ? 'Adaptive live Muse session'
          : 'Adaptive mock replay',
      });
      this.#state = { ...this.#state, timestampMs: snapshot.timestampMs };
      this.emit();
      if (snapshot.timestampMs >= this.#sessionDurationMs) this.end();
    } finally {
      this.#busy = false;
    }
  }

  private async processEpoch(epoch: TbrEpoch): Promise<void> {
    const planner = this.#planner;
    if (!planner || this.#state.status !== 'running') return;
    let result: AdaptiveCheckpointResult | null = null;
    try {
      result = await planner.ingest(epoch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.trace(
        epoch.timestampMs,
        'llm-error',
        this.#plannerMode === 'openai' ? 'openai' : 'mock-llm',
        message,
        {
          message,
          plannerMode: this.#plannerMode,
          fallback: 'continue_base_plan',
        },
      );
      this.dispatch('PlannerStatus', epoch.timestampMs, {
        status: 'error',
        message: `Planner error; Base Plan playback continues. ${message}`,
      });
    }
    if (planner !== this.#planner || this.#state.status !== 'running') return;
    const state = result?.state ?? planner.attentionStates.at(-1);
    if (state)
      this.dispatch(
        'NeuroState',
        epoch.timestampMs,
        this.toProtocolNeuroState(state),
      );
    if (!result) return;
    try {
      this.handleCheckpoint(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (result.futurePatch)
        planner.acknowledgeApplication(
          result.futurePatch.adaptationId,
          'FAILED',
          result.state.timestampMs,
        );
      this.trace(
        result.state.timestampMs,
        'plan-error',
        'deterministic',
        `Plan application failed: ${message}`,
        {
          message,
          planId: result.plan?.planId,
          fallback: 'continue_base_plan',
        },
      );
      this.dispatch('PlannerStatus', result.state.timestampMs, {
        status: 'error',
        message: `Plan rejected; Base Plan playback continues. ${message}`,
      });
    }
  }

  private handleCheckpoint(result: AdaptiveCheckpointResult): void {
    this.#state = {
      ...this.#state,
      checkpointCount: this.#state.checkpointCount + 1,
    };
    this.trace(
      result.state.timestampMs,
      'attention-state',
      'deterministic',
      `${result.state.label}; trend ${result.state.trend}`,
      result.state,
    );
    if (result.outcome) {
      this.trace(
        result.state.timestampMs,
        'reflection-outcome',
        'deterministic',
        `${result.outcome.adaptationId}: ${result.outcome.observedResponse}`,
        result.outcome,
      );
    }
    this.trace(
      result.state.timestampMs,
      'eligibility',
      'deterministic',
      result.eligibility.eligible
        ? 'Eligible for Decision 1'
        : `Maintain: ${result.eligibility.reasons.join(', ')}`,
      result.eligibility,
    );
    if (!result.eligibility.eligible) {
      this.dispatch('PlannerStatus', result.state.timestampMs, {
        status: 'ready',
        message: `Eligibility gate: ${result.eligibility.reasons.join(', ')}. Maintain current soundscape.`,
      });
      return;
    }
    if (result.decision) {
      this.trace(
        result.state.timestampMs,
        'decision-1',
        result.decision.provider.startsWith('openai') ? 'openai' : 'mock-llm',
        result.decision.rationale,
        result.decision,
      );
      this.dispatch('PlannerStatus', result.state.timestampMs, {
        status: result.decision.shouldAdapt ? 'planning' : 'ready',
        message: `Decision 1 · ${result.decision.shouldAdapt ? 'adapt' : 'maintain'}: ${result.decision.rationale}`,
      });
    }
    if (result.planning && result.plan && this.#runtime) {
      this.trace(
        result.state.timestampMs,
        'decision-2',
        result.planning.provider.startsWith('openai') ? 'openai' : 'mock-llm',
        result.planning.rationale,
        result.planning,
      );
      this.#runtime.applyPlan(result.plan);
      if (result.futurePatch) {
        this.#planner?.acknowledgeApplication(
          result.futurePatch.adaptationId,
          'APPLIED',
          result.state.timestampMs,
        );
        this.trace(
          result.state.timestampMs,
          'patch-lifecycle',
          'deterministic',
          `${result.futurePatch.adaptationId} applied`,
          {
            patch: result.futurePatch,
            validation: result.patchValidation,
            lifecycle: result.lifecycle,
          },
        );
      }
      this.dispatch('SceneJourneyPlan', result.state.timestampMs, result.plan);
      this.trace(
        result.state.timestampMs,
        'plan-applied',
        'deterministic',
        `Module 03 accepted ${result.plan.planId}`,
        {
          planId: result.plan.planId,
          selectedAssetIds: result.planning.selectedAssetIds,
        },
      );
      this.dispatch('PlannerStatus', result.state.timestampMs, {
        status: 'ready',
        message: `Decision 2 · ${result.planning.rationale}`,
      });
      this.#state = {
        ...this.#state,
        adaptationCount: this.#state.adaptationCount + 1,
      };
    }
  }

  private toProtocolNeuroState(state: AttentionState): NeuroState {
    const focus = state.focusPosition ?? 0.5;
    return {
      timestampMs: state.timestampMs,
      arousal: {
        value: focus,
        trend:
          state.trend === 'toward-focus'
            ? 'increasing'
            : state.trend === 'toward-mind-wandering'
              ? 'decreasing'
              : 'stable',
      },
      confidence: state.confidence,
      attention: {
        currentLogTbr: state.currentLogTbr,
        relativePosition: state.relativePosition,
        referenceGap: state.referenceGap,
        deltaFromFocus: state.deltaFromFocus,
        deltaFromMindWandering: state.deltaFromMindWandering,
        coverage: state.coverage,
        trajectory: state.trajectory,
        relativePositionSlope: state.relativePositionSlope,
        measurementConfidence: state.measurementConfidence,
        calibrationQuality: state.calibrationQuality,
        signalQuality: state.signalQuality,
        stateEstimationVersion: state.stateEstimationVersion,
        focusPosition: state.focusPosition,
        mindWanderingPosition: state.mindWanderingPosition,
        label: state.label,
        trend: state.trend,
        variabilityMad: state.variabilityMad,
        phase: state.phase,
        validEpochCount: state.validEpochCount,
      },
    };
  }

  private trace(
    timestampMs: number,
    kind: AdaptiveTraceRecord['kind'],
    source: AdaptiveTraceRecord['source'],
    summary: string,
    data: object,
  ): void {
    sessionRecorder.appendAdaptiveTrace({
      timestampMs,
      kind,
      source,
      summary,
      data: structuredClone(data) as Record<string, unknown>,
    });
  }
  private createRuntime(): RuntimeController {
    const graph = new SceneGraph(forestSceneGraph),
      mapper = new SemanticLocationMapper(graph),
      events = new RuntimeEventBus(),
      transitions = new TransitionController(events);
    return new RuntimeController({
      validator: new PlanValidator(graph),
      stateBuilder: new RuntimeWorldStateBuilder(),
      journey: new JourneyController(mapper, events),
      ambient: new AmbientController(mapper, transitions),
      action: new ActionController(transitions),
      event: new EventController(mapper, transitions, events),
      transitions,
      events,
    });
  }
  private dispatch(
    type: ServerMessage['type'],
    timestampMs: number,
    payload: unknown,
  ): void {
    const parsed = parseServerMessage(
      {
        type,
        protocolVersion: NEUROSCAPE_PROTOCOL_VERSION,
        sessionId: this.#sessionId,
        timestampMs,
        payload,
      },
      this.#sessionId,
    );
    if (!parsed.valid)
      throw new Error(`Adaptive protocol failure: ${parsed.error}`);
    dispatchServerMessage(parsed.message, this.#store, performance.now());
  }
  private startTimer(): void {
    this.#timer = this.#intervals.set(
      () => void this.tick(),
      this.#runMode === 'mock-fast' ? 100 : 1_000,
    );
  }
  private clearTimer(): void {
    if (this.#timer !== undefined) this.#intervals.clear(this.#timer);
    this.#timer = undefined;
  }
  private emit(): void {
    this.#listeners.forEach((listener) => listener());
  }
}

export const adaptiveIntegrationHarness = new AdaptiveIntegrationHarness();
