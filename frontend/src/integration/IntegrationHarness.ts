import {
  NEUROSCAPE_PROTOCOL_VERSION,
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
import { runtimeStore, type RuntimeStore } from '../runtime/RuntimeStore.js';
import {
  forestPlans,
  forestSceneGraph,
  simulatedNeuroStates,
} from './canonicalForestScenario.js';
import {
  LONG_FOREST_DURATION_MS,
  longForestNeuroStates,
  longForestPlans,
  longForestPlanTransitionTimesMs,
  longForestSceneGraph,
} from './longForestScenario.js';
import {
  SPATIAL_DIAGNOSTIC_DURATION_MS,
  spatialDiagnosticNeuroStates,
  spatialDiagnosticPlans,
  spatialDiagnosticPlanTransitionTimesMs,
  spatialDiagnosticSceneGraph,
} from './spatialDiagnosticScenario.js';

export interface IntegrationScenario {
  readonly graph: typeof forestSceneGraph;
  readonly plans: typeof forestPlans;
  readonly neuroStates: typeof simulatedNeuroStates;
  readonly planTransitionTimesMs: readonly number[];
  readonly durationMs: number;
  readonly timerIntervalMs: number;
  readonly timerDeltaMs: number;
  readonly message: string;
}
export const canonicalForestIntegrationScenario: IntegrationScenario = {
  graph: forestSceneGraph,
  plans: forestPlans,
  neuroStates: simulatedNeuroStates,
  planTransitionTimesMs: [0, 9000, 19000],
  durationMs: 27000,
  timerIntervalMs: 100,
  timerDeltaMs: 250,
  message: 'Deterministic integration demo',
};
export const longForestIntegrationScenario: IntegrationScenario = {
  graph: longForestSceneGraph,
  plans: longForestPlans,
  neuroStates: longForestNeuroStates,
  planTransitionTimesMs: longForestPlanTransitionTimesMs,
  durationMs: LONG_FOREST_DURATION_MS,
  timerIntervalMs: 100,
  timerDeltaMs: 100,
  message: 'Long forest perceptual validation',
};
export const spatialDiagnosticIntegrationScenario: IntegrationScenario = {
  graph: spatialDiagnosticSceneGraph,
  plans: spatialDiagnosticPlans,
  neuroStates: spatialDiagnosticNeuroStates,
  planTransitionTimesMs: spatialDiagnosticPlanTransitionTimesMs,
  durationMs: SPATIAL_DIAGNOSTIC_DURATION_MS,
  timerIntervalMs: 100,
  timerDeltaMs: 100,
  message: 'Spatial event HRTF stress test',
};

export interface IntegrationState {
  status: 'idle' | 'running' | 'paused' | 'ended';
  timestampMs: number;
  appliedPlanIndex: number;
}
export interface IntervalApi {
  set(callback: () => void, milliseconds: number): unknown;
  clear(handle: unknown): void;
}
const intervals: IntervalApi = {
  set: (callback, milliseconds) => setInterval(callback, milliseconds),
  clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class IntegrationHarness {
  readonly #store: RuntimeStore;
  readonly #intervals: IntervalApi;
  readonly #sessionId: string;
  readonly #scenario: IntegrationScenario;
  readonly #listeners = new Set<() => void>();
  #controller: RuntimeController | null = null;
  #timer: unknown;
  #state: IntegrationState = {
    status: 'idle',
    timestampMs: 0,
    appliedPlanIndex: 0,
  };
  #neuroIndex = 0;
  constructor(
    store: RuntimeStore = runtimeStore,
    sessionId = 'demo-integration-session',
    intervalApi: IntervalApi = intervals,
    scenario: IntegrationScenario = canonicalForestIntegrationScenario,
  ) {
    this.#store = store;
    this.#sessionId = sessionId;
    this.#intervals = intervalApi;
    this.#scenario = scenario;
  }
  getState = () => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  start(): void {
    this.end(false);
    this.#store.getState().resetSessionStreams();
    runtimeDiagnostics.reset();
    this.#controller = this.#createController();
    this.#controller.initialize(this.#scenario.plans[0]!);
    this.#neuroIndex = 0;
    this.#state = { status: 'running', timestampMs: 0, appliedPlanIndex: 0 };
    this.#dispatch('PlannerStatus', 0, {
      status: 'ready',
      message: 'Fixed trajectory ready',
    });
    this.#dispatch('SceneJourneyPlan', 0, this.#scenario.plans[0]!);
    const firstNeuroState = this.#scenario.neuroStates[0];
    if (firstNeuroState) {
      this.#dispatch('NeuroState', 0, firstNeuroState);
      this.#neuroIndex = 1;
    }
    this.#dispatch('RuntimeWorldState', 0, this.#controller.currentState!);
    this.#dispatch('SessionStatus', 0, {
      status: 'running',
      elapsedTimeMs: 0,
      message: this.#scenario.message,
    });
    this.#startTimer();
    this.#emit();
  }
  pause(): void {
    if (this.#state.status !== 'running') return;
    this.#clearTimer();
    this.#state = { ...this.#state, status: 'paused' };
    this.#dispatch('SessionStatus', this.#state.timestampMs, {
      status: 'paused',
      elapsedTimeMs: this.#state.timestampMs,
    });
    this.#emit();
  }
  resume(): void {
    if (this.#state.status !== 'paused') return;
    this.#state = { ...this.#state, status: 'running' };
    this.#dispatch('SessionStatus', this.#state.timestampMs, {
      status: 'running',
      elapsedTimeMs: this.#state.timestampMs,
    });
    this.#startTimer();
    this.#emit();
  }
  end(publish = true): void {
    this.#clearTimer();
    if (publish && this.#controller && this.#state.status !== 'ended')
      this.#dispatch('SessionStatus', this.#state.timestampMs, {
        status: 'ended',
        elapsedTimeMs: this.#state.timestampMs,
      });
    this.#controller?.shutdown();
    this.#controller = null;
    if (publish) {
      this.#state = { ...this.#state, status: 'ended' };
      this.#emit();
    }
  }
  tick(deltaTimeMs = 250): void {
    if (!this.#controller || this.#state.status !== 'running') return;
    const nextTimestamp = this.#state.timestampMs + deltaTimeMs;
    let planIndex = 0;
    for (
      let index = 1;
      index < this.#scenario.planTransitionTimesMs.length;
      index += 1
    )
      if (this.#scenario.planTransitionTimesMs[index]! <= nextTimestamp)
        planIndex = index;
    if (planIndex !== this.#state.appliedPlanIndex) {
      this.#dispatch('PlannerStatus', nextTimestamp, {
        status: 'ready',
        message: `Simulated plan ${planIndex + 1} accepted`,
      });
      this.#dispatch(
        'SceneJourneyPlan',
        nextTimestamp,
        this.#scenario.plans[planIndex]!,
      );
      this.#controller.applyPlan(this.#scenario.plans[planIndex]!);
    }
    while (
      this.#neuroIndex < this.#scenario.neuroStates.length &&
      this.#scenario.neuroStates[this.#neuroIndex]!.timestampMs <= nextTimestamp
    ) {
      const neuro = this.#scenario.neuroStates[this.#neuroIndex++]!;
      this.#dispatch('NeuroState', neuro.timestampMs, neuro);
    }
    const startedAt = performance.now();
    const snapshot = this.#controller.update(deltaTimeMs);
    runtimeDiagnostics.recordModule03Update(performance.now() - startedAt);
    this.#dispatch('RuntimeWorldState', snapshot.timestampMs, snapshot);
    this.#dispatch('SessionStatus', snapshot.timestampMs, {
      status: 'running',
      elapsedTimeMs: snapshot.timestampMs,
    });
    this.#state = {
      status: 'running',
      timestampMs: snapshot.timestampMs,
      appliedPlanIndex: planIndex,
    };
    this.#emit();
    if (snapshot.timestampMs >= this.#scenario.durationMs) this.end();
  }
  #createController(): RuntimeController {
    const graph = new SceneGraph(this.#scenario.graph),
      mapper = new SemanticLocationMapper(graph),
      events = new RuntimeEventBus(),
      transitions = new TransitionController(events);
    return new RuntimeController({
      validator: new PlanValidator(graph),
      stateBuilder: new RuntimeWorldStateBuilder((duration: number) =>
        runtimeDiagnostics.recordWorldStateBuild(duration),
      ),
      journey: new JourneyController(mapper, events),
      ambient: new AmbientController(mapper, transitions),
      action: new ActionController(transitions),
      event: new EventController(mapper, transitions, events),
      transitions,
      events,
    });
  }
  #dispatch(
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
      throw new Error(`Demo protocol failure: ${parsed.error}`);
    dispatchServerMessage(parsed.message, this.#store, performance.now());
  }
  #startTimer(): void {
    this.#timer = this.#intervals.set(
      () => this.tick(this.#scenario.timerDeltaMs),
      this.#scenario.timerIntervalMs,
    );
  }
  #clearTimer(): void {
    if (this.#timer !== undefined) this.#intervals.clear(this.#timer);
    this.#timer = undefined;
  }
  #emit(): void {
    this.#listeners.forEach((listener) => listener());
  }
}
export const integrationHarness = new IntegrationHarness();
export const longIntegrationHarness = new IntegrationHarness(
  runtimeStore,
  'long-demo-integration-session',
  intervals,
  longForestIntegrationScenario,
);
export const spatialDiagnosticHarness = new IntegrationHarness(
  runtimeStore,
  'spatial-diagnostic-session',
  intervals,
  spatialDiagnosticIntegrationScenario,
);
