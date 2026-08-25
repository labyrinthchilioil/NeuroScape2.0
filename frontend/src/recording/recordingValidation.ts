import {
  NEUROSCAPE_PROTOCOL_VERSION,
  RECORDED_SESSION_SCHEMA_VERSION,
  type RecordedSession,
} from '@neuroscape/contracts';
import {
  validateNeuroState,
  validateRuntimeWorldState,
  validateSceneJourneyPlan,
} from '../runtime/validation.js';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const ordered = (values: readonly number[]) =>
  values.every(
    (value, index) =>
      Number.isFinite(value) &&
      value >= 0 &&
      (index === 0 || value > values[index - 1]!),
  );
const nondecreasing = (values: readonly number[]) =>
  values.every(
    (value, index) =>
      Number.isFinite(value) &&
      value >= 0 &&
      (index === 0 || value >= values[index - 1]!),
  );
export type RecordingValidation =
  | { valid: true; recording: RecordedSession }
  | { valid: false; errors: string[] };

export function validateRecordedSession(value: unknown): RecordingValidation {
  const errors: string[] = [];
  if (!record(value) || !record(value.metadata))
    return { valid: false, errors: ['Recording and metadata must be objects'] };
  if (value.metadata.schemaVersion !== RECORDED_SESSION_SCHEMA_VERSION)
    errors.push('Unsupported recording schema version');
  if (value.metadata.protocolVersion !== NEUROSCAPE_PROTOCOL_VERSION)
    errors.push('Unsupported protocol version');
  if (typeof value.metadata.sessionId !== 'string' || !value.metadata.sessionId)
    errors.push('Missing sessionId');
  if (
    typeof value.metadata.durationMs !== 'number' ||
    value.metadata.durationMs < 0
  )
    errors.push('Invalid durationMs');
  if (
    !Array.isArray(value.runtimeSnapshots) ||
    !value.runtimeSnapshots.every(
      (item) => validateRuntimeWorldState(item).valid,
    ) ||
    !ordered(
      (value.runtimeSnapshots as Array<{ timestampMs: number }>).map(
        (item) => item.timestampMs,
      ),
    )
  )
    errors.push('Invalid or unordered runtimeSnapshots');
  if (
    !Array.isArray(value.neuroStates) ||
    !value.neuroStates.every(validateNeuroState) ||
    !ordered(
      (value.neuroStates as Array<{ timestampMs: number }>).map(
        (item) => item.timestampMs,
      ),
    )
  )
    errors.push('Invalid or unordered neuroStates');
  if (
    !Array.isArray(value.sceneJourneyPlans) ||
    !value.sceneJourneyPlans.every(
      (item) =>
        record(item) &&
        typeof item.timestampMs === 'number' &&
        validateSceneJourneyPlan(item.value),
    ) ||
    !ordered(
      (value.sceneJourneyPlans as Array<{ timestampMs: number }>).map(
        (item) => item.timestampMs,
      ),
    )
  )
    errors.push('Invalid or unordered sceneJourneyPlans');
  const eventStream = (candidate: unknown, statuses: readonly string[]) =>
    Array.isArray(candidate) &&
    candidate.every(
      (item) =>
        record(item) &&
        typeof item.timestampMs === 'number' &&
        record(item.value) &&
        statuses.includes(String(item.value.status)),
    ) &&
    nondecreasing(
      (candidate as Array<{ timestampMs: number }>).map(
        (item) => item.timestampMs,
      ),
    );
  if (
    !eventStream(value.sessionEvents, [
      'loading',
      'preview',
      'running',
      'paused',
      'ended',
    ])
  )
    errors.push('Invalid or unordered sessionEvents');
  if (!eventStream(value.plannerEvents, ['idle', 'planning', 'ready', 'error']))
    errors.push('Invalid or unordered plannerEvents');
  if (
    !Array.isArray(value.adaptiveTrace) ||
    !nondecreasing(
      (value.adaptiveTrace as Array<{ timestampMs: number }>).map(
        (item) => item.timestampMs,
      ),
    )
  )
    errors.push('Invalid or unordered adaptiveTrace');
  if (errors.length) return { valid: false, errors };
  return {
    valid: true,
    recording: structuredClone(value) as unknown as RecordedSession,
  };
}
