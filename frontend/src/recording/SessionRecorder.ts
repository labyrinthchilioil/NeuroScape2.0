import {
  NEUROSCAPE_PROTOCOL_VERSION,
  RECORDED_SESSION_SCHEMA_VERSION,
  type AdaptiveTraceRecord,
  type RecordedSession,
  type RecordedCalibrationProfile,
  type SessionStatusPayload,
} from '@neuroscape/contracts';
import type {
  RuntimeStore,
  RuntimeStoreState,
} from '../runtime/RuntimeStore.js';
import { immutableCopy } from '../runtime/validation.js';

export interface RecordingStartOptions {
  sessionId: string;
  userPrompt?: string;
  eegMode?: 'muse' | 'recorded' | 'none';
  participantId?: string;
  runMode?: 'mock-fast' | 'study-realtime' | 'non-adaptive';
  plannerMode?: 'openai' | 'mock' | 'fixed';
  startedAtIso?: string;
  controlAudioId?: string;
  controlTrajectoryId?: string;
  basePlanId?: string;
  basePlanVersion?: string;
  basePlanProfileId?: string;
  assignmentRuleVersion?: string;
  conditionOrder?: ('non_adaptive' | 'adaptive')[];
  pairedBasePlanId?: string;
  basePlanExecutionMode?:
    'structured-runtime' | 'prerendered-compatible-fallback';
  calibrationProfile?: RecordedCalibrationProfile;
}
export class SessionRecorder {
  readonly #store: RuntimeStore;
  #unsubscribe: (() => void) | null = null;
  #recording: RecordedSession | null = null;
  constructor(store: RuntimeStore) {
    this.#store = store;
  }
  get active(): boolean {
    return this.#unsubscribe !== null;
  }
  start(options: RecordingStartOptions): void {
    if (this.active) return;
    const initial = this.#store.getState();
    this.#recording = {
      metadata: {
        sessionId: options.sessionId,
        protocolVersion: NEUROSCAPE_PROTOCOL_VERSION,
        schemaVersion: RECORDED_SESSION_SCHEMA_VERSION,
        durationMs: 0,
        startState: initial.sessionRuntime.status,
        endState: initial.sessionRuntime.status,
        userPrompt: options.userPrompt,
        eegMode: options.eegMode,
        participantId: options.participantId,
        runMode: options.runMode,
        plannerMode: options.plannerMode,
        startedAtIso: options.startedAtIso,
        controlAudioId: options.controlAudioId,
        controlTrajectoryId: options.controlTrajectoryId,
        basePlanId: options.basePlanId,
        basePlanVersion: options.basePlanVersion,
        basePlanProfileId: options.basePlanProfileId,
        assignmentRuleVersion: options.assignmentRuleVersion,
        conditionOrder: options.conditionOrder,
        pairedBasePlanId: options.pairedBasePlanId,
        basePlanExecutionMode: options.basePlanExecutionMode,
      },
      calibrationProfile: options.calibrationProfile
        ? structuredClone(options.calibrationProfile)
        : undefined,
      runtimeSnapshots: [],
      neuroStates: [],
      sceneJourneyPlans: [],
      sessionEvents: [],
      plannerEvents: [],
      adaptiveTrace: [],
    };
    this.#unsubscribe = this.#store.subscribe((state, previous) =>
      this.#capture(state, previous),
    );
  }
  stop(): RecordedSession | null {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (!this.#recording) return null;
    const session = this.#store.getState().sessionRuntime;
    this.#recording.metadata.durationMs = Math.max(
      session.elapsedTimeMs,
      this.#recording.runtimeSnapshots.at(-1)?.timestampMs ?? 0,
      this.#recording.neuroStates.at(-1)?.timestampMs ?? 0,
    );
    this.#recording.metadata.endState = session.status;
    return immutableCopy(this.#recording) as RecordedSession;
  }
  snapshot(): RecordedSession | null {
    return this.#recording ? structuredClone(this.#recording) : null;
  }
  appendAdaptiveTrace(record: AdaptiveTraceRecord): void {
    if (this.#recording)
      this.#recording.adaptiveTrace.push(structuredClone(record));
  }
  #capture(state: RuntimeStoreState, previous: RuntimeStoreState): void {
    const output = this.#recording;
    if (!output) return;
    if (
      state.runtimeWorldState !== previous.runtimeWorldState &&
      state.runtimeWorldState
    )
      output.runtimeSnapshots.push(structuredClone(state.runtimeWorldState));
    if (state.neuroState !== previous.neuroState && state.neuroState)
      output.neuroStates.push(structuredClone(state.neuroState));
    if (
      state.sceneJourneyPlan !== previous.sceneJourneyPlan &&
      state.sceneJourneyPlan &&
      state.sceneJourneyPlanReceivedAtMs !== null
    )
      output.sceneJourneyPlans.push({
        timestampMs: state.sceneJourneyPlanReceivedAtMs,
        value: structuredClone(state.sceneJourneyPlan),
      });
    if (
      state.sessionRuntime.status !== previous.sessionRuntime.status ||
      state.sessionRuntime.elapsedTimeMs !==
        previous.sessionRuntime.elapsedTimeMs
    ) {
      const status = state.sessionRuntime.status;
      if (status !== 'idle')
        output.sessionEvents.push({
          timestampMs: state.sessionRuntime.elapsedTimeMs,
          value: {
            status,
            elapsedTimeMs: state.sessionRuntime.elapsedTimeMs,
            message: state.sessionRuntime.message,
          } as SessionStatusPayload,
        });
    }
    if (
      state.sessionRuntime.plannerStatus !==
        previous.sessionRuntime.plannerStatus ||
      state.sessionRuntime.plannerMessage !==
        previous.sessionRuntime.plannerMessage
    )
      output.plannerEvents.push({
        timestampMs: state.sessionRuntime.elapsedTimeMs,
        value: {
          status: state.sessionRuntime.plannerStatus,
          message: state.sessionRuntime.plannerMessage,
        },
      });
  }
}
