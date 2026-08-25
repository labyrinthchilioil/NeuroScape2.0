import { describe, expect, it } from 'vitest';
import {
  AttentionInterpreter,
  MockDecisionProvider,
  evaluateEligibility,
  initialForestPlan,
  phase1Config,
  type CalibrationProfile,
  type TbrEpoch,
} from '../src/index.js';

const profile = (
  focus: number,
  mindWandering: number,
  pooledMad = 0.01,
): CalibrationProfile => ({
  profileId: 'test',
  focusedAnchorLogTbr: focus,
  mindWanderingAnchorLogTbr: mindWandering,
  pooledMad,
  mappingAvailable: true,
  qualityStatus: 'provisional',
  featureVersion: 'test',
});
const epoch = (logTbr: number, timestampMs = 10_000): TbrEpoch => ({
  timestampMs,
  logTbr,
  valid: true,
  qualityScore: 1,
  artifactFlags: [],
});
const position = (mindWandering: number, focus: number, value: number) =>
  new AttentionInterpreter(profile(focus, mindWandering), phase1Config).ingest(
    epoch(value),
  ).relativePosition;

describe('unbounded calibration-reference state', () => {
  it('maps forward references without clipping', () => {
    expect(position(0.4, 0.5, 0.4)).toBeCloseTo(0);
    expect(position(0.4, 0.5, 0.45)).toBeCloseTo(0.5);
    expect(position(0.4, 0.5, 0.5)).toBeCloseTo(1);
    expect(position(0.4, 0.5, 0.56)).toBeCloseTo(1.6);
    expect(position(0.4, 0.5, 0.36)).toBeCloseTo(-0.4);
  });

  it('preserves direction when the reference order is reversed', () => {
    expect(position(0.6, 0.4, 0.6)).toBeCloseTo(0);
    expect(position(0.6, 0.4, 0.5)).toBeCloseTo(0.5);
    expect(position(0.6, 0.4, 0.4)).toBeCloseTo(1);
    expect(position(0.6, 0.4, 0.3)).toBeCloseTo(1.5);
  });

  it('returns null for coincident references and lowers weak-separation confidence', () => {
    const unusable = new AttentionInterpreter(
      profile(0.4, 0.4),
      phase1Config,
    ).ingest(epoch(0.5));
    expect(unusable.relativePosition).toBeNull();
    expect(unusable.calibrationQuality).toBe('unusable');
    const weak = new AttentionInterpreter(
      profile(0.401, 0.4, 0.1),
      phase1Config,
    ).ingest(epoch(0.5));
    expect(weak.relativePosition).toBeGreaterThan(1);
    expect(weak.measurementConfidence).toBe('low');
  });

  it('detects decline while values remain beyond the focus reference', () => {
    const config = { ...phase1Config, analysisWindowMs: 1 };
    const interpreter = new AttentionInterpreter(profile(0.5, 0.4), config);
    const values = [0.58, 0.555, 0.521, 0.488];
    const states = values.map((value, index) =>
      interpreter.ingest(epoch(value, 10_000 + index * 40_000)),
    );
    expect(states.map((state) => state.relativePosition)).toEqual(
      expect.arrayContaining([
        expect.closeTo(1.8),
        expect.closeTo(1.55),
        expect.closeTo(1.21),
        expect.closeTo(0.88),
      ]),
    );
    expect(states[2]!.trajectory).toBe('declining');
    expect(states[2]!.relativePositionSlope).toBeLessThan(0);
  });

  it('allows sustained focus to request minimal supportive evolution after stasis', async () => {
    const state = new AttentionInterpreter(
      profile(0.5, 0.4),
      phase1Config,
    ).ingest(epoch(0.55, 180_000));
    const decision = await new MockDecisionProvider().decide({
      state: { ...state, label: 'focus-leaning', trajectory: 'stable' },
      recentStates: [],
      currentPlan: structuredClone(initialForestPlan),
      history: [],
      restrictions: {
        allowEvent: true,
        allowBodyAnchor: true,
        allowSceneTransition: true,
        sceneTransitionsRemaining: 5,
      },
      secondsSinceLastMeaningfulChange: 180,
      stasisPressure: true,
      transitionInProgress: false,
    });
    expect(decision.decision).toBe('adapt');
    expect(decision.intent).toBe('support_sustained_focus');
    expect(decision.salience).toBe('minimal');
  });

  it('hard-blocks adaptation while a transition is in progress', () => {
    const state = new AttentionInterpreter(
      profile(0.5, 0.4),
      phase1Config,
    ).ingest(epoch(0.45, 180_000));
    const gate = evaluateEligibility(
      state,
      profile(0.5, 0.4),
      [],
      phase1Config,
      200_000,
      true,
    );
    expect(gate.eligible).toBe(false);
    expect(gate.reasons).toContain('transition_in_progress');
  });
});
