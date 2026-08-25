import {
  NEUROSCAPE_PROTOCOL_VERSION,
  RECORDED_SESSION_SCHEMA_VERSION,
  type RecordedSession,
} from '@neuroscape/contracts';
import { journeyPlan, neuroState, snapshot } from './fixtures.js';
export function recordedSession(): RecordedSession {
  const first = snapshot(0),
    second = snapshot(1000),
    third = snapshot(2000);
  first.listener.semanticLocation = 'clearing';
  second.listener.worldPosition = [4, 2, 3];
  second.listener.semanticLocation = 'stream-bank';
  third.listener.worldPosition = [4, 2, -1];
  third.listener.semanticLocation = 'stream-bank';
  third.ambient.forEach((item) => {
    item.active = false;
  });
  third.action = [];
  third.event = [];
  return {
    metadata: {
      sessionId: 'session-1',
      protocolVersion: NEUROSCAPE_PROTOCOL_VERSION,
      schemaVersion: RECORDED_SESSION_SCHEMA_VERSION,
      durationMs: 3000,
      startState: 'idle',
      endState: 'ended',
      userPrompt: 'A forest journey',
      eegMode: 'recorded',
    },
    runtimeSnapshots: [first, second, third],
    neuroStates: [
      neuroState(0),
      { ...neuroState(1000), arousal: { value: 0.5, trend: 'increasing' } },
    ],
    sceneJourneyPlans: [{ timestampMs: 0, value: journeyPlan() }],
    sessionEvents: [
      { timestampMs: 0, value: { status: 'running', elapsedTimeMs: 0 } },
      { timestampMs: 3000, value: { status: 'ended', elapsedTimeMs: 3000 } },
    ],
    plannerEvents: [{ timestampMs: 0, value: { status: 'ready' } }],
    adaptiveTrace: [],
  };
}
