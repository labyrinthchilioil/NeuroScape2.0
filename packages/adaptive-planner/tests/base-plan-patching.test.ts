import { describe, expect, it } from 'vitest';
import {
  assignMatchedBasePlans,
  createMatchedForestBasePlans,
  measureBasePlan,
  phase1Config,
  validateAndProjectPatch,
  validateMatchedBasePlans,
  type FutureScenePatch,
} from '../src/index.js';

describe('matched Base Plans and future patching', () => {
  const [a, b] = createMatchedForestBasePlans(phase1Config);
  it('provides distinct, complete, restrained and matched A/B plans', () => {
    expect(
      validateMatchedBasePlans(a, b, phase1Config.basePlanMatchTolerance),
    ).toEqual([]);
    expect(measureBasePlan(a).durationMs).toBe(600_000);
    expect(measureBasePlan(b).durationMs).toBe(600_000);
    expect(a.scheduledElements.map((e) => [e.assetId, e.startMs])).not.toEqual(
      b.scheduledElements.map((e) => [e.assetId, e.startMs]),
    );
  });
  it('counterbalances the two conditions deterministically', () => {
    const assignment = assignMatchedBasePlans('P002');
    expect(assignment.adaptiveBasePlanId).not.toBe(
      assignment.nonAdaptiveBasePlanId,
    );
    expect(assignment.assignmentRuleVersion).toBe('matched_ab_v1');
  });
  const patch = (
    operation: FutureScenePatch['operations'][number],
  ): FutureScenePatch => ({
    adaptationId: 'adapt-1',
    status: 'PATCH_PROPOSED',
    intent: 'reduce_stimulation',
    salience: 'low',
    operations: [operation],
    preservedElementIds: ['base-a-bed'],
    hypothesis: {
      mechanismCode: 'REDUCE_FOREGROUND',
      expectedResponseCode: 'REDUCE_VARIABILITY_OR_HALT_DECLINE',
      failureSignalCode: 'CONTINUED_DECLINE_WITH_VALID_SIGNAL',
    },
    priorAdaptationIds: [],
    lessonCode: null,
    lessonConfidence: 'unavailable',
    reasonCodes: ['MINIMAL_SUFFICIENT_PATCH'],
  });
  it.each(['ADJUST', 'RESCHEDULE', 'REPLACE', 'SUPPRESS'] as const)(
    'accepts future %s without touching the freeze buffer',
    (kind) => {
      const target = a.scheduledElements.find(
        (e) => e.elementId === 'base-a-leaves',
      )!;
      const operation = {
        operation: kind,
        targetElementId: target.elementId,
        effectiveStartMs: 330_000,
        transitionMs: 5_000,
        ...(kind === 'ADJUST' ? { gain: 0.12 } : {}),
        ...(kind === 'REPLACE'
          ? { replacementAssetId: 'forest_bird_far_02' }
          : {}),
      };
      expect(
        validateAndProjectPatch({
          basePlan: a,
          acceptedPatches: [],
          proposedPatch: patch(operation),
          nowMs: 200_000,
          config: phase1Config,
        }).valid,
      ).toBe(true);
    },
  );
  it('rejects immutable history/freeze-buffer operations and non-minimal INSERT', () => {
    const insertedElement = structuredClone(a.scheduledElements[1]!);
    insertedElement.elementId = 'inserted';
    insertedElement.startMs = 210_000;
    insertedElement.endMs = 218_000;
    const result = validateAndProjectPatch({
      basePlan: a,
      acceptedPatches: [],
      proposedPatch: patch({
        operation: 'INSERT',
        effectiveStartMs: 210_000,
        transitionMs: 3_000,
        insertedElement,
      }),
      nowMs: 200_000,
      config: phase1Config,
    });
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('operation_inside_freeze_buffer');
    expect(result.violations).toContain('insert_not_minimal');
  });
  it('treats NO_SAFE_PATCH as a safe Base Plan continuation', () => {
    const noSafe = {
      ...patch({
        operation: 'KEEP',
        targetElementId: 'base-a-bed',
        effectiveStartMs: 220_000,
        transitionMs: 0,
      }),
      status: 'NO_SAFE_PATCH' as const,
      operations: [],
    };
    expect(
      validateAndProjectPatch({
        basePlan: a,
        acceptedPatches: [],
        proposedPatch: noSafe,
        nowMs: 200_000,
        config: phase1Config,
      }).valid,
    ).toBe(true);
  });
  it('materializes ADJUST into the runtime payload rather than metadata only', () => {
    const result = validateAndProjectPatch({
      basePlan: a,
      acceptedPatches: [],
      proposedPatch: patch({
        operation: 'ADJUST',
        targetElementId: 'base-a-leaves',
        effectiveStartMs: 335_000,
        transitionMs: 5_000,
        gain: 0.12,
      }),
      nowMs: 200_000,
      config: phase1Config,
    });
    const element = result.projectedPlan?.scheduledElements.find(
      (item) => item.elementId === 'base-a-leaves',
    );
    expect(element?.gain).toBe(0.12);
    expect((element?.payload as { gain: number }).gain).toBe(0.12);
  });
});
