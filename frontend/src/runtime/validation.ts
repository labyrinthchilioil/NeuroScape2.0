import type {
  NeuroState,
  RuntimeWorldState,
  SceneJourneyPlan,
} from '@neuroscape/contracts';

export interface RuntimeValidationFailure {
  valid: false;
  errors: string[];
}

export interface RuntimeValidationSuccess {
  valid: true;
  state: Readonly<RuntimeWorldState>;
}

export type RuntimeValidationResult =
  RuntimeValidationFailure | RuntimeValidationSuccess;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function vector(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite))
    errors.push(`${path} must be a finite Vector3`);
}

function quaternion(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finite)) {
    errors.push(`${path} must be a finite Quaternion`);
    return;
  }
  const magnitude = Math.hypot(...value);
  if (Math.abs(magnitude - 1) > 0.001)
    errors.push(`${path} must be normalized`);
}

function gain(value: unknown, path: string, errors: string[]): void {
  if (!finite(value) || value < 0 || value > 1)
    errors.push(`${path} must be between 0 and 1`);
}

function identity(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!text(value.id)) errors.push(`${path}.id must be a non-empty string`);
  if (!text(value.assetId))
    errors.push(`${path}.assetId must be a non-empty string`);
  if (typeof value.active !== 'boolean')
    errors.push(`${path}.active must be boolean`);
  gain(value.gain, `${path}.gain`, errors);
}

function validateObjects(
  value: unknown,
  kind: 'ambient' | 'action' | 'event',
  errors: string[],
): void {
  if (!Array.isArray(value)) {
    errors.push(`${kind} must be an array`);
    return;
  }
  const ids = new Set<string>();
  value.forEach((entry, index) => {
    const path = `${kind}[${index}]`;
    identity(entry, path, errors);
    if (!isRecord(entry)) return;
    if (typeof entry.id === 'string') {
      if (ids.has(entry.id))
        errors.push(`${kind} contains duplicate id ${entry.id}`);
      ids.add(entry.id);
    }
    if (kind === 'ambient') {
      if (entry.mode !== 'global' && entry.mode !== 'localized')
        errors.push(`${path}.mode is invalid`);
      if (entry.mode === 'localized')
        vector(entry.worldPosition, `${path}.worldPosition`, errors);
      if (entry.mode === 'global' && entry.worldPosition !== undefined)
        errors.push(`${path}.worldPosition must be absent for global ambience`);
    } else if (kind === 'action') {
      if (!['head', 'chest', 'feet', 'body'].includes(String(entry.attachment)))
        errors.push(`${path}.attachment is invalid`);
      vector(entry.relativePosition, `${path}.relativePosition`, errors);
      vector(entry.worldPosition, `${path}.worldPosition`, errors);
    } else {
      vector(entry.worldPosition, `${path}.worldPosition`, errors);
      vector(entry.velocity, `${path}.velocity`, errors);
      if (!['waiting', 'active', 'finished'].includes(String(entry.lifecycle)))
        errors.push(`${path}.lifecycle is invalid`);
    }
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export function immutableCopy<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value));
}

export function validateNeuroState(value: unknown): value is NeuroState {
  if (!isRecord(value) || !finite(value.timestampMs) || value.timestampMs < 0)
    return false;
  if (
    Object.keys(value).some(
      (key) =>
        !['timestampMs', 'arousal', 'confidence', 'attention'].includes(key),
    )
  )
    return false;
  const metric = (candidate: unknown) =>
    isRecord(candidate) &&
    finite(candidate.value) &&
    candidate.value >= 0 &&
    candidate.value <= 1 &&
    ['increasing', 'decreasing', 'stable'].includes(String(candidate.trend));
  const attention = value.attention;
  const validAttention =
    attention === undefined ||
    (isRecord(attention) &&
      (attention.currentLogTbr === null || finite(attention.currentLogTbr)) &&
      (attention.focusPosition === null ||
        (finite(attention.focusPosition) &&
          attention.focusPosition >= 0 &&
          attention.focusPosition <= 1)) &&
      (attention.mindWanderingPosition === null ||
        (finite(attention.mindWanderingPosition) &&
          attention.mindWanderingPosition >= 0 &&
          attention.mindWanderingPosition <= 1)) &&
      [
        'focus-leaning',
        'intermediate',
        'mind-wandering-leaning',
        'uncertain',
      ].includes(String(attention.label)) &&
      [
        'toward-focus',
        'toward-mind-wandering',
        'stable',
        'insufficient-history',
      ].includes(String(attention.trend)) &&
      (attention.variabilityMad === null || finite(attention.variabilityMad)) &&
      ['opening', 'adaptive', 'closing'].includes(String(attention.phase)) &&
      Number.isInteger(attention.validEpochCount) &&
      Number(attention.validEpochCount) >= 0);
  return (
    metric(value.arousal) &&
    validAttention &&
    (value.confidence === undefined ||
      (finite(value.confidence) &&
        value.confidence >= 0 &&
        value.confidence <= 1))
  );
}

export function validateSceneJourneyPlan(
  value: unknown,
): value is SceneJourneyPlan {
  if (
    !isRecord(value) ||
    !text(value.planId) ||
    !finite(value.planningHorizonSec) ||
    value.planningHorizonSec < 0 ||
    !isRecord(value.userJourney) ||
    !isRecord(value.soundscape) ||
    !isRecord(value.transitionPolicy)
  )
    return false;
  if (
    !text(value.userJourney.goal) ||
    !Array.isArray(value.userJourney.waypoints) ||
    !value.userJourney.waypoints.every(
      (item) => isRecord(item) && text(item.locationId),
    )
  )
    return false;
  if (
    !Array.isArray(value.soundscape.ambient) ||
    !Array.isArray(value.soundscape.action) ||
    !Array.isArray(value.soundscape.event)
  )
    return false;
  return (
    finite(value.transitionPolicy.defaultDurationMs) &&
    value.transitionPolicy.defaultDurationMs >= 0 &&
    ['linear', 'smoothstep', 'cubic', 'catmull-rom'].includes(
      String(value.transitionPolicy.curve),
    ) &&
    (value.reasoningSummary === undefined ||
      typeof value.reasoningSummary === 'string')
  );
}

export function validateRuntimeWorldState(
  value: unknown,
): RuntimeValidationResult {
  const errors: string[] = [];
  if (!isRecord(value))
    return { valid: false, errors: ['snapshot must be an object'] };
  if (!finite(value.timestampMs) || value.timestampMs < 0)
    errors.push('timestampMs must be a non-negative finite number');
  if (!isRecord(value.listener)) errors.push('listener must be an object');
  else {
    vector(value.listener.worldPosition, 'listener.worldPosition', errors);
    quaternion(value.listener.orientation, 'listener.orientation', errors);
    vector(value.listener.velocity, 'listener.velocity', errors);
    if (!text(value.listener.semanticLocation))
      errors.push('listener.semanticLocation must be a non-empty string');
  }
  if (value.journey !== undefined) {
    if (!isRecord(value.journey)) errors.push('journey must be an object');
    else {
      if (!Array.isArray(value.journey.plannedPath))
        errors.push('journey.plannedPath must be an array');
      else
        value.journey.plannedPath.forEach((point, index) =>
          vector(point, `journey.plannedPath[${index}]`, errors),
        );
      if (
        !Number.isInteger(value.journey.currentSegmentIndex) ||
        Number(value.journey.currentSegmentIndex) < -1
      )
        errors.push('journey.currentSegmentIndex must be an integer >= -1');
      if (!Array.isArray(value.journey.remainingWaypoints))
        errors.push('journey.remainingWaypoints must be an array');
      else
        value.journey.remainingWaypoints.forEach((point, index) =>
          vector(point, `journey.remainingWaypoints[${index}]`, errors),
        );
    }
  }
  validateObjects(value.ambient, 'ambient', errors);
  validateObjects(value.action, 'action', errors);
  validateObjects(value.event, 'event', errors);
  if (errors.length) return { valid: false, errors };
  return {
    valid: true,
    state: immutableCopy(value) as Readonly<RuntimeWorldState>,
  };
}

export function isRuntimeMessage(value: unknown): value is RuntimeWorldState {
  return validateRuntimeWorldState(value).valid;
}
