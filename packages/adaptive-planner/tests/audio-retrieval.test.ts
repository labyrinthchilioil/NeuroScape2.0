import { describe, expect, it } from 'vitest';
import {
  DECISION_2_PROMPT_VERSION,
  initialForestPlan,
  phase1Config,
  prepareDecision2Input,
  validateDecision2Selection,
} from '../src/index.js';
import type {
  AdaptationDecision,
  DecisionContext,
  PlanningResult,
} from '../src/index.js';

const context = (): DecisionContext => ({
  state: {
    timestampMs: 180_000,
    phase: 'adaptive',
    currentLogTbr: 1.7,
    focusPosition: 0.12,
    mindWanderingPosition: 0.88,
    unboundedMindWanderingPosition: 0.88,
    label: 'mind-wandering-leaning',
    trend: 'toward-mind-wandering',
    trendDeltaPerCheckpoint: 0.08,
    variabilityMad: 0.04,
    sustainedMindWanderingWindows: 3,
    confidence: 0.9,
    validEpochCount: 6,
  },
  recentStates: [],
  currentPlan: structuredClone(initialForestPlan),
  history: [],
  restrictions: {
    allowEvent: true,
    allowBodyAnchor: true,
    allowSceneTransition: true,
    sceneTransitionsRemaining: 2,
  },
});

const decision = (
  goal: AdaptationDecision['goal'],
  scope: AdaptationDecision['scope'] = 'within-scene',
): AdaptationDecision => ({
  shouldAdapt: true,
  goal,
  scope,
  rationale: 'test',
  provider: 'test',
});

describe('Decision 2 audio-library retrieval', () => {
  it('provides compatible authored event metadata and motion duration to the prompt', () => {
    const input = prepareDecision2Input(
      context(),
      decision('gently-reorient'),
      phase1Config,
    );
    expect(input.promptVersion).toBe(DECISION_2_PROMPT_VERSION);
    expect(input.currentScene).toBe('forest');
    expect(input.candidates.length).toBeGreaterThanOrEqual(3);
    expect(input.candidates.some((item) => item.layer === 'ambient')).toBe(
      true,
    );
    expect(input.candidates.some((item) => item.layer === 'event')).toBe(true);
    const bird = input.candidates.find(
      (item) => item.assetId === 'forest_bird_far_01',
    );
    expect(bird?.defaultMotion.durationSec).toBe(6);
    expect(bird?.autoDeleteAfterSec).toBe(8);
    expect(input.prompt).toContain('defaultMotion.durationSec');
    expect(input.prompt).toContain(
      'durationMs MUST equal defaultMotion.durationSec * 1000',
    );
    expect(input.prompt).toContain('forest_bird_far_01');
    expect(input.prompt).toContain('Use only assetId values in candidates');
    expect(input.prompt).toContain('listenerReachableLocations');
    expect(input.prompt).toContain('restrained but perceptibly layered');
    expect(input.prompt).toContain('gently-reorient: prioritize one perceptible event');
    expect(input.prompt).toContain('ambient-only changes should not satisfy this goal');
    expect(input.outputSchema).toMatchObject({
      name: 'neuroscape_decision_2',
      strict: true,
      schema: { additionalProperties: false },
    });
    expect(JSON.stringify(input.outputSchema)).not.toContain('uniqueItems');
    const serializedSchema = JSON.stringify(input.outputSchema);
    expect(serializedSchema).toContain(
      '"assetId":{"type":"string","enum":["forest_bird_far_01"]}',
    );
    expect(serializedSchema).toContain(
      '"durationMs":{"type":"number","enum":[6000]}',
    );
    expect(serializedSchema).toContain(
      '"gain":{"type":"number","enum":[0.24]}',
    );
  });

  it('offers ambient plus action candidates for grounding', () => {
    const input = prepareDecision2Input(
      context(),
      decision('support-grounding'),
      phase1Config,
    );
    expect(input.candidates.some((item) => item.layer === 'ambient')).toBe(
      true,
    );
    expect(input.candidates.some((item) => item.layer === 'action')).toBe(true);
    expect(input.candidates.some((item) => item.layer === 'event')).toBe(false);
    expect(input.prompt).toContain(
      'support-grounding: prioritize one body-anchored action',
    );
  });

  it('uses family cooldown to withhold all recently used bird variants', () => {
    const value = context();
    value.history.push({
      timestampMs: 150_000,
      goal: 'gently-reorient',
      scope: 'within-scene',
      assetIds: ['forest_bird_far_01'],
      rationale: 'test',
    });
    const input = prepareDecision2Input(
      value,
      decision('gently-reorient'),
      phase1Config,
    );
    expect(
      input.candidates.some((item) => item.assetId.startsWith('forest_bird')),
    ).toBe(false);
  });

  it('rejects a planning result that invents an asset outside retrieval', () => {
    const input = prepareDecision2Input(
      context(),
      decision('support-grounding'),
      phase1Config,
    );
    const result: PlanningResult = {
      patch: { reasoningSummary: 'invalid' },
      selectedAssetIds: ['invented_asset'],
      candidateAssetIds: input.candidates.map((item) => item.assetId),
      promptVersion: input.promptVersion,
      prompt: input.prompt,
      outputSchema: input.outputSchema,
      rationale: 'invalid',
      provider: 'test',
    };
    expect(() => validateDecision2Selection(result, input)).toThrow(
      'outside the retrieved candidate set',
    );
  });

  it('rejects duplicate selected asset IDs after structured output parsing', () => {
    const input = prepareDecision2Input(
      context(),
      decision('gently-reorient'),
      phase1Config,
    );
    const candidate = input.candidates[0]!;
    const result: PlanningResult = {
      patch: { reasoningSummary: 'invalid duplicate selection' },
      selectedAssetIds: [candidate.assetId, candidate.assetId],
      candidateAssetIds: input.candidates.map((item) => item.assetId),
      promptVersion: input.promptVersion,
      prompt: input.prompt,
      outputSchema: input.outputSchema,
      rationale: 'invalid',
      provider: 'test',
    };
    expect(() => validateDecision2Selection(result, input)).toThrow(
      'selectedAssetIds must not contain duplicates',
    );
  });

  it('rejects an event lifecycle value when an authored motion duration exists', () => {
    const input = prepareDecision2Input(
      context(),
      decision('gently-reorient'),
      phase1Config,
    );
    const bird = input.candidates.find(
      (candidate) => candidate.assetId === 'forest_bird_far_01',
    )!;
    const result: PlanningResult = {
      patch: {
        reasoningSummary: 'invalid lifecycle duration',
        upsertEvent: [
          {
            id: 'bird-test',
            assetId: bird.assetId,
            activationTimeMs: 180_000,
            durationMs: 8_000,
            trajectory: [{ locationId: 'clearing', timestampMs: 180_000 }],
            gain: bird.recommendedVolume,
          },
        ],
      },
      selectedAssetIds: [bird.assetId],
      candidateAssetIds: input.candidates.map((item) => item.assetId),
      promptVersion: input.promptVersion,
      prompt: input.prompt,
      outputSchema: input.outputSchema,
      rationale: 'invalid',
      provider: 'test',
    };
    expect(() => validateDecision2Selection(result, input)).toThrow(
      'authored event motion/lifecycle duration',
    );
  });

  it('rejects a candidate placed in the wrong layer or with invented gain', () => {
    const input = prepareDecision2Input(
      context(),
      decision('gently-reorient'),
      phase1Config,
    );
    const candidate = input.candidates[0]!;
    const result: PlanningResult = {
      patch: {
        reasoningSummary: 'invalid',
        upsertAmbient: [
          {
            id: 'wrong-layer',
            assetId: candidate.assetId,
            mode: 'global',
            gain: 0.99,
            active: true,
          },
        ],
      },
      selectedAssetIds: [candidate.assetId],
      candidateAssetIds: input.candidates.map((item) => item.assetId),
      promptVersion: input.promptVersion,
      prompt: input.prompt,
      outputSchema: input.outputSchema,
      rationale: 'invalid',
      provider: 'test',
    };
    expect(() => validateDecision2Selection(result, input)).toThrow(
      'wrong sound layer',
    );
  });
});
