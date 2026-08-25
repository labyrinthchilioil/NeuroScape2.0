import type { AdaptivePlannerConfig } from './config.js';
import {
  measureBasePlan,
  type BasePlanElement,
  type BaseScenePlan,
} from './base-plan.js';
import type { AdaptationIntent, AdaptationSalience } from './types.js';
import type { AdaptationDecision, SoundscapePlanPatch } from './types.js';

export const PATCH_POLICY_VERSION = 'future_patch_v1';
export type PatchOperationKind =
  'KEEP' | 'ADJUST' | 'RESCHEDULE' | 'REPLACE' | 'SUPPRESS' | 'INSERT';
export interface FuturePatchOperation {
  operation: PatchOperationKind;
  targetElementId?: string;
  effectiveStartMs: number;
  transitionMs: number;
  gain?: number;
  replacementAssetId?: string;
  insertedElement?: BasePlanElement;
}
export interface AdaptationHypothesis {
  mechanismCode: string;
  expectedResponseCode:
    | 'REDUCE_VARIABILITY_OR_HALT_DECLINE'
    | 'PRESERVE_STABILITY'
    | 'GENTLE_REORIENTATION';
  failureSignalCode:
    | 'CONTINUED_DECLINE_WITH_VALID_SIGNAL'
    | 'INCREASED_VARIABILITY'
    | 'LOSS_OF_STABILITY';
}
export interface FutureScenePatch {
  adaptationId: string;
  status: 'PATCH_PROPOSED' | 'NO_SAFE_PATCH';
  intent: AdaptationIntent;
  salience: AdaptationSalience;
  operations: FuturePatchOperation[];
  preservedElementIds: string[];
  hypothesis: AdaptationHypothesis;
  priorAdaptationIds: string[];
  lessonCode: string | null;
  lessonConfidence: 'high' | 'medium' | 'low' | 'unavailable';
  reasonCodes: string[];
}
export interface ComplexityProjection {
  projectedConcurrentSources: number;
  projectedAmbientLayers: number;
  projectedEventRate: number;
  projectedBodyAnchorRate: number;
  projectedSalienceLoad: number;
  projectedTransitionOverlap: number;
  recentAssetRepetition: number;
  cumulativePatchCount: number;
  usesReservedHeadroom: boolean;
}
export interface PatchValidationResult {
  valid: boolean;
  violations: string[];
  projection: ComplexityProjection;
  projectedPlan?: BaseScenePlan;
}

function applyOperation(
  elements: BasePlanElement[],
  operation: FuturePatchOperation,
): void {
  const index = operation.targetElementId
    ? elements.findIndex((e) => e.elementId === operation.targetElementId)
    : -1;
  if (operation.operation === 'KEEP') return;
  if (operation.operation === 'INSERT' && operation.insertedElement) {
    elements.push(structuredClone(operation.insertedElement));
    return;
  }
  if (index < 0) return;
  const target = elements[index]!;
  if (operation.operation === 'SUPPRESS') {
    elements.splice(index, 1);
    return;
  }
  if (operation.operation === 'ADJUST' && operation.gain !== undefined) {
    target.gain = operation.gain;
    (target.payload as { gain: number }).gain = operation.gain;
  }
  if (operation.operation === 'RESCHEDULE') {
    const duration = target.endMs - target.startMs;
    target.startMs = operation.effectiveStartMs;
    target.endMs = target.startMs + duration;
    if (target.layer === 'event') {
      const payload = target.payload as {
        activationTimeMs: number;
        trajectory: Array<{ timestampMs: number }>;
      };
      const shift = target.startMs - payload.activationTimeMs;
      payload.activationTimeMs = target.startMs;
      payload.trajectory.forEach((waypoint) => {
        waypoint.timestampMs += shift;
      });
    }
  }
  if (operation.operation === 'REPLACE' && operation.replacementAssetId) {
    target.assetId = operation.replacementAssetId;
    target.assetFamily = operation.replacementAssetId.replace(/_\d+$/, '');
    (target.payload as { assetId: string }).assetId =
      operation.replacementAssetId;
  }
}

export function validateAndProjectPatch(options: {
  basePlan: BaseScenePlan;
  acceptedPatches: readonly FutureScenePatch[];
  proposedPatch: FutureScenePatch;
  nowMs: number;
  config: AdaptivePlannerConfig;
  recentAssetIds?: readonly string[];
}): PatchValidationResult {
  const { basePlan, acceptedPatches, proposedPatch, nowMs, config } = options;
  const violations: string[] = [];
  const freezeEnd = nowMs + config.executionFreezeBufferMs;
  const horizonEnd = freezeEnd + config.patchHorizonMs;
  if (proposedPatch.status === 'NO_SAFE_PATCH')
    return {
      valid: true,
      violations,
      projection: projection(
        basePlan,
        acceptedPatches.length,
        options.recentAssetIds,
      ),
    };
  if (proposedPatch.operations.length > config.maxPatchOperations)
    violations.push('too_many_patch_operations');
  for (const op of proposedPatch.operations) {
    if (op.effectiveStartMs < freezeEnd)
      violations.push('operation_inside_freeze_buffer');
    if (op.effectiveStartMs > horizonEnd)
      violations.push('operation_outside_patch_horizon');
    const target = op.targetElementId
      ? basePlan.scheduledElements.find(
          (e) => e.elementId === op.targetElementId,
        )
      : undefined;
    if (op.operation !== 'INSERT' && !target)
      violations.push('unknown_target_element');
    if (target && target.startMs < freezeEnd && op.operation !== 'KEEP')
      violations.push('target_is_immutable');
    if (op.operation === 'ADJUST' && !target?.adjustable)
      violations.push('target_not_adjustable');
    if (op.operation === 'REPLACE' && !target?.replaceable)
      violations.push('target_not_replaceable');
    if (op.operation === 'SUPPRESS' && !target?.suppressible)
      violations.push('target_not_suppressible');
  }
  const projectedPlan = structuredClone(basePlan);
  proposedPatch.operations.forEach((op) =>
    applyOperation(projectedPlan.scheduledElements, op),
  );
  const projected = projection(
    projectedPlan,
    acceptedPatches.length + 1,
    options.recentAssetIds,
  );
  if (projected.projectedConcurrentSources > config.maxConcurrentSources)
    violations.push('concurrent_source_budget_exceeded');
  if (projected.projectedAmbientLayers > config.maxAmbientLayers)
    violations.push('ambient_layer_budget_exceeded');
  if (projected.projectedEventRate > config.maxEventsPerMinute)
    violations.push('event_rate_budget_exceeded');
  if (projected.projectedBodyAnchorRate > config.maxBodyAnchorsPerMinute)
    violations.push('body_anchor_rate_budget_exceeded');
  if (projected.projectedSalienceLoad > config.maxSalienceLoad)
    violations.push('salience_budget_exceeded');
  if (projected.cumulativePatchCount > config.maxCumulativePatches)
    violations.push('cumulative_patch_budget_exceeded');
  if (
    proposedPatch.operations.some((op) => op.operation === 'INSERT') &&
    !proposedPatch.reasonCodes.includes('NO_SMALLER_OPERATION_AVAILABLE')
  )
    violations.push('insert_not_minimal');
  return {
    valid: violations.length === 0,
    violations: [...new Set(violations)],
    projection: projected,
    ...(violations.length ? {} : { projectedPlan }),
  };
}

function projection(
  plan: BaseScenePlan,
  cumulativePatchCount: number,
  recentAssetIds: readonly string[] = [],
): ComplexityProjection {
  const metrics = measureBasePlan(plan);
  const minutes = plan.profile.durationMs / 60_000;
  const events = plan.scheduledElements.filter((e) => e.layer === 'event');
  const actions = plan.scheduledElements.filter((e) => e.layer === 'action');
  const repetitions = plan.scheduledElements.filter((e) =>
    recentAssetIds.includes(e.assetId),
  ).length;
  return {
    projectedConcurrentSources: metrics.peakConcurrentSources,
    projectedAmbientLayers: metrics.ambientCount,
    projectedEventRate: events.length / minutes,
    projectedBodyAnchorRate: actions.length / minutes,
    projectedSalienceLoad: metrics.peakSalienceLoad,
    projectedTransitionOverlap: 0,
    recentAssetRepetition: repetitions,
    cumulativePatchCount,
    usesReservedHeadroom:
      metrics.peakConcurrentSources >
        plan.profile.maxConcurrentSources -
          Math.ceil(plan.profile.reservedAdaptationHeadroom) ||
      metrics.peakSalienceLoad >
        plan.profile.maxSalienceLoad - plan.profile.reservedAdaptationHeadroom,
  };
}

export function normalizeLegacyPlanPatch(options: {
  adaptationId: string;
  patch: SoundscapePlanPatch;
  decision: AdaptationDecision;
  basePlan: BaseScenePlan;
  nowMs: number;
  freezeBufferMs: number;
}): FutureScenePatch {
  const { patch, decision, basePlan, nowMs, freezeBufferMs } = options;
  const earliest = nowMs + freezeBufferMs;
  const operations: FuturePatchOperation[] = [];
  for (const id of patch.removeIds ?? []) {
    const target = basePlan.scheduledElements.find((e) => e.elementId === id);
    operations.push({
      operation: 'SUPPRESS',
      targetElementId: id,
      effectiveStartMs: Math.max(earliest, target?.startMs ?? earliest),
      transitionMs: patch.transitionDurationMs ?? 0,
    });
  }
  const upserts = [
    ...(patch.upsertAmbient ?? []).map((payload) => ({
      layer: 'ambient' as const,
      payload,
    })),
    ...(patch.upsertAction ?? []).map((payload) => ({
      layer: 'action' as const,
      payload,
    })),
    ...(patch.upsertEvent ?? []).map((payload) => ({
      layer: 'event' as const,
      payload,
    })),
  ];
  for (const { layer, payload } of upserts) {
    const target = basePlan.scheduledElements.find(
      (e) => e.elementId === payload.id,
    );
    const startMs =
      layer === 'event'
        ? Math.max(
            earliest,
            (payload as { activationTimeMs: number }).activationTimeMs,
          )
        : earliest;
    if (target) {
      operations.push({
        operation: target.assetId === payload.assetId ? 'ADJUST' : 'REPLACE',
        targetElementId: target.elementId,
        effectiveStartMs: Math.max(startMs, target.startMs),
        transitionMs: patch.transitionDurationMs ?? 0,
        gain: payload.gain,
        ...(target.assetId === payload.assetId
          ? {}
          : { replacementAssetId: payload.assetId }),
      });
      continue;
    }
    const durationMs =
      layer === 'event'
        ? (payload as { durationMs: number }).durationMs
        : 60_000;
    operations.push({
      operation: 'INSERT',
      effectiveStartMs: startMs,
      transitionMs: patch.transitionDurationMs ?? 0,
      insertedElement: {
        elementId: payload.id,
        assetId: payload.assetId,
        layer,
        startMs,
        endMs: Math.min(basePlan.profile.durationMs, startMs + durationMs),
        gain: payload.gain,
        salience:
          decision.salience === 'moderate'
            ? 0.45
            : decision.salience === 'low'
              ? 0.25
              : 0.15,
        assetFamily: payload.assetId.replace(/_\d+$/, ''),
        spatialBehavior: 'decision_2_authored',
        adjustable: true,
        replaceable: true,
        suppressible: true,
        payload: structuredClone(payload),
      },
    });
  }
  return {
    adaptationId: options.adaptationId,
    status: operations.length ? 'PATCH_PROPOSED' : 'NO_SAFE_PATCH',
    intent: decision.intent,
    salience: decision.salience,
    operations,
    preservedElementIds: basePlan.scheduledElements
      .filter((e) => !patch.removeIds?.includes(e.elementId))
      .map((e) => e.elementId),
    hypothesis: {
      mechanismCode: decision.intent.toUpperCase(),
      expectedResponseCode:
        decision.intent === 'preserve_recovery' ||
        decision.intent === 'support_sustained_focus'
          ? 'PRESERVE_STABILITY'
          : decision.intent === 'gently_reorient_attention' ||
              decision.intent === 'refresh_engagement'
            ? 'GENTLE_REORIENTATION'
            : 'REDUCE_VARIABILITY_OR_HALT_DECLINE',
      failureSignalCode:
        decision.intent === 'preserve_recovery'
          ? 'LOSS_OF_STABILITY'
          : 'CONTINUED_DECLINE_WITH_VALID_SIGNAL',
    },
    priorAdaptationIds: [],
    lessonCode: null,
    lessonConfidence: 'unavailable',
    reasonCodes: [
      'COMPATIBILITY_NORMALIZED_PATCH',
      ...(operations.some((op) => op.operation === 'INSERT')
        ? ['NO_SMALLER_OPERATION_AVAILABLE']
        : ['MINIMAL_SUFFICIENT_PATCH']),
      'PRESERVE_BASE_CONTINUITY',
    ],
  };
}
