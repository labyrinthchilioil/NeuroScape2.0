import { describe, expect, it } from 'vitest';
import {
  AttentionInterpreter,
  SessionAdaptationMemory,
  evaluateAdaptationOutcome,
  phase1Config,
  transitionLifecycle,
  type AdaptationLifecycle,
  type FutureScenePatch,
} from '../src/index.js';
import { mockCalibrationProfile } from '../src/fixtures.js';

const stateAt = (timestampMs: number, logTbr: number) =>
  new AttentionInterpreter(mockCalibrationProfile, phase1Config).ingest({
    timestampMs,
    logTbr,
    valid: true,
    qualityScore: 0.95,
    artifactFlags: [],
  });
const patch: FutureScenePatch = {
  adaptationId: 'adapt-1',
  status: 'PATCH_PROPOSED',
  intent: 'support_grounding',
  salience: 'low',
  operations: [],
  preservedElementIds: [],
  hypothesis: {
    mechanismCode: 'BODY_ANCHOR_GROUNDING',
    expectedResponseCode: 'REDUCE_VARIABILITY_OR_HALT_DECLINE',
    failureSignalCode: 'CONTINUED_DECLINE_WITH_VALID_SIGNAL',
  },
  priorAdaptationIds: [],
  lessonCode: null,
  lessonConfidence: 'unavailable',
  reasonCodes: [],
};
function lifecycle(): AdaptationLifecycle {
  const before = { ...stateAt(200_000, 1.6), trajectory: 'declining' as const };
  let value: AdaptationLifecycle = {
    adaptationId: 'adapt-1',
    patch,
    hypothesis: patch.hypothesis,
    contextBefore: before,
    transitions: [{ status: 'PROPOSED', timestampMs: 190_000 }],
  };
  value = transitionLifecycle(value, 'VALIDATED', 195_000);
  value = transitionLifecycle(value, 'APPLIED', 205_000);
  return transitionLifecycle(value, 'WAITING_FOR_OBSERVATION', 213_000);
}

describe('deterministic reflection memory', () => {
  it('does not evaluate an overlapping first post-adaptation window', () => {
    const outcome = evaluateAdaptationOutcome({
      lifecycle: lifecycle(),
      postState: { ...stateAt(240_000, 1.5), trajectory: 'stable' },
      window: {
        windowStartMs: 180_000,
        windowEndMs: 240_000,
        concurrentBasePlanChange: false,
        concurrentPatchCount: 1,
      },
    });
    expect(outcome.observedResponse).toBe('not_yet_observable');
    expect(outcome.causalClaimAllowed).toBe(false);
  });
  it('evaluates a fully post-adaptation observation conservatively', () => {
    const outcome = evaluateAdaptationOutcome({
      lifecycle: lifecycle(),
      postState: { ...stateAt(290_000, 1.35), trajectory: 'improving' },
      window: {
        windowStartMs: 220_000,
        windowEndMs: 280_000,
        concurrentBasePlanChange: false,
        concurrentPatchCount: 1,
      },
    });
    expect(outcome.observedResponse).toBe('aligned_with_hypothesis');
    expect(outcome.reasonCodes).toContain('TEMPORAL_ASSOCIATION_ONLY');
  });
  it('requires repeated directional evidence before generalizing', () => {
    const memory = new SessionAdaptationMemory();
    const base = {
      contextSignature: {
        positionBand: 'intermediate',
        trajectory: 'declining' as const,
        stability: 'medium',
        sceneDensity: 'low',
        scenePhase: 'sustaining',
      },
      actionSignature: {
        intent: 'support_grounding',
        layer: 'action',
        operation: 'REPLACE' as const,
        assetFamily: 'footstep',
        salience: 'low',
      },
      outcome: {
        observedResponse: 'opposed_to_hypothesis' as const,
        confidence: 'medium' as const,
        evidenceCount: 1,
      },
      updatedAtMs: 280_000,
    };
    memory.add({ adaptationId: 'a1', ...base });
    expect(
      memory.generalizedLesson({
        intent: 'support_grounding',
        operation: 'REPLACE',
        assetFamily: 'footstep',
      }),
    ).toBeNull();
    memory.add({ adaptationId: 'a2', ...base, updatedAtMs: 360_000 });
    expect(
      memory.generalizedLesson({
        intent: 'support_grounding',
        operation: 'REPLACE',
        assetFamily: 'footstep',
      })?.lessonCode,
    ).toContain('AVOID');
  });
});
