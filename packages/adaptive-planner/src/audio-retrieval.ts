import { audioLibrary, audioLibraryById } from '@neuroscape/contracts';
import type { AudioLibraryAsset } from '@neuroscape/contracts';
import type { AdaptivePlannerConfig } from './config.js';
import type {
  AdaptationDecision,
  Decision2Candidate,
  Decision2Input,
  DecisionContext,
  PlanningResult,
} from './types.js';
import { reasoningAttentionState } from './types.js';

export const DECISION_2_PROMPT_VERSION = 'decision-2-future-patch-v5';

function authoredEventDurationMs(candidate: Decision2Candidate): number {
  return (
    (candidate.defaultMotion.durationSec ?? candidate.autoDeleteAfterSec ?? 0) *
    1_000
  );
}

const locationScene: Readonly<Record<string, string>> = Object.freeze({
  forest_entry: 'forest',
  clearing: 'forest',
  stream_bank: 'forest',
  waterfall: 'forest',
});

const locationNeighbors: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    forest_entry: ['clearing'],
    clearing: ['forest_entry', 'stream_bank'],
    stream_bank: ['clearing', 'waterfall'],
    waterfall: ['stream_bank'],
  });

const goalTags: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'gently-reorient': ['attention_low', 'adaptive_shift', 'immersion'],
  'support-grounding': ['grounding', 'settling', 'stability_low'],
  'reduce-stimulation': ['anxiety_high', 'stability_low', 'settling'],
  'refresh-engagement': ['attention_low', 'adaptive_shift', 'immersion'],
  'support-sustained-focus': ['stability_high', 'settling', 'immersion'],
  'preserve-recovery': ['stability_high', 'settling'],
  maintain: ['settling', 'stability_high'],
});

export function audioFamilyId(assetId: string): string {
  return assetId.replace(/_\d+$/, '');
}

function inferCurrentScene(context: DecisionContext): string {
  for (const ambient of context.currentPlan.soundscape.ambient) {
    const asset = audioLibraryById.get(ambient.assetId);
    if (ambient.active && asset?.scene[0]) return asset.scene[0];
  }
  const location = context.currentPlan.userJourney.waypoints.at(-1)?.locationId;
  return (location && locationScene[location]) || 'forest';
}

function allowedLayers(
  decision: AdaptationDecision,
  context: DecisionContext,
): Set<AudioLibraryAsset['layer']> {
  if (decision.scope === 'scene-transition') {
    return new Set(['ambient', 'event']);
  }

  if (decision.goal === 'support-grounding') {
    return new Set(
      context.restrictions.allowBodyAnchor
        ? ['ambient', 'action']
        : ['ambient'],
    );
  }

  if (decision.goal === 'reduce-stimulation') {
    return new Set(['ambient']);
  }

  return new Set(['ambient', 'event']);
}

function candidateFromAsset(asset: AudioLibraryAsset): Decision2Candidate {
  return {
    assetId: asset.asset_id,
    familyId: audioFamilyId(asset.asset_id),
    label: asset.label,
    description: asset.description,
    scene: [...asset.scene],
    layer: asset.layer,
    tags: [...asset.tags],
    loop: asset.loop,
    suddenness: asset.suddenness,
    intensity: asset.intensity,
    recommendedDistance: asset.recommended_distance,
    recommendedVolume: asset.recommended_volume,
    useWhen: [...asset.use_when],
    avoidWhen: [...asset.avoid_when],
    spatialBehavior: [...asset.spatial_behavior],
    defaultPosition: [...asset.default_position],
    defaultMotion: {
      type: asset.default_motion.type,
      durationSec: asset.default_motion.duration ?? null,
      ...(asset.default_motion.start
        ? { start: [...asset.default_motion.start] as [number, number, number] }
        : {}),
      ...(asset.default_motion.mid
        ? { mid: [...asset.default_motion.mid] as [number, number, number] }
        : {}),
      ...(asset.default_motion.end
        ? { end: [...asset.default_motion.end] as [number, number, number] }
        : {}),
    },
    autoDeleteAfterSec: asset.auto_delete_after_sec,
    fadeInSec: asset.fade_in_sec,
    fadeOutSec: asset.fade_out_sec,
    priority: asset.priority,
    isPrimaryAmbient: asset.is_primary_ambient,
    isRareEvent: asset.is_rare_event,
  };
}

export function retrieveDecision2Candidates(
  context: DecisionContext,
  decision: AdaptationDecision,
  config: AdaptivePlannerConfig,
): { currentScene: string; candidates: Decision2Candidate[] } {
  const now = context.state.timestampMs;
  const currentScene = inferCurrentScene(context);
  const layers = allowedLayers(decision, context);
  const activeAssets = new Set(
    [
      ...context.currentPlan.soundscape.ambient.filter((item) => item.active),
      ...context.currentPlan.soundscape.action.filter((item) => item.active),
      ...context.currentPlan.soundscape.event.filter(
        (item) => now < item.activationTimeMs + item.durationMs,
      ),
    ].map((item) => item.assetId),
  );
  const recentAssets = new Set(
    context.history
      .filter((item) => now - item.timestampMs < config.exactAssetCooldownMs)
      .flatMap((item) => item.assetIds),
  );
  const recentFamilies = new Set(
    context.history
      .filter((item) => now - item.timestampMs < config.assetFamilyCooldownMs)
      .flatMap((item) => item.assetIds.map(audioFamilyId)),
  );
  const desiredTags = goalTags[decision.goal] ?? [];
  const stateTags = new Set([
    ...desiredTags,
    context.state.phase,
    context.state.label === 'mind-wandering-leaning'
      ? 'attention_low'
      : 'stability_high',
  ]);

  const scored = audioLibrary
    .filter(
      (asset) =>
        layers.has(asset.layer) &&
        asset.scene.some((scene) => scene === currentScene) &&
        !activeAssets.has(asset.asset_id) &&
        !recentAssets.has(asset.asset_id) &&
        !recentFamilies.has(audioFamilyId(asset.asset_id)) &&
        !asset.avoid_when.some((tag) => stateTags.has(tag)),
    )
    .map((asset) => ({
      asset,
      score:
        asset.priority +
        asset.use_when.filter((tag) => stateTags.has(tag)).length * 2 -
        asset.suddenness -
        asset.intensity * 0.25,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.asset.asset_id.localeCompare(right.asset.asset_id),
    );

  const perLayer = new Map<string, number>();
  const candidates = scored
    .filter(({ asset }) => {
      const count = perLayer.get(asset.layer) ?? 0;
      if (count >= 8) return false;
      perLayer.set(asset.layer, count + 1);
      return true;
    })
    .map(({ asset }) => candidateFromAsset(asset));
  return { currentScene, candidates };
}

export function buildDecision2Prompt(
  context: DecisionContext,
  decision: AdaptationDecision,
  currentScene: string,
  candidates: readonly Decision2Candidate[],
): string {
  const currentLocation =
    context.currentPlan.userJourney.waypoints.at(-1)?.locationId ?? 'clearing';
  const listenerReachableLocations = [
    currentLocation,
    ...(locationNeighbors[currentLocation] ?? []),
  ];
  const payload = {
    decision1: {
      intent: decision.intent,
      salience: decision.salience,
      scope: decision.scope,
      constraintsForDecision2: decision.constraintsForDecision2,
    },
    eegState: reasoningAttentionState(context.state),
    currentScene,
    currentLocation,
    listenerReachableLocations,
    soundSourceLocationIds: Object.keys(locationScene),
    activeRuntimeScene: {
      journey: context.currentPlan.userJourney,
      soundscape: context.currentPlan.soundscape,
    },
    upcomingBaseHorizon: context.upcomingBaseHorizon ?? [],
    relevantPriorOutcomes: context.relevantPriorOutcomes?.slice(0, 3) ?? [],
    restrictions: context.restrictions,
    existingFuturePatches: [],
    candidates,
  };
  return [
    'You are NeuroScape Decision 2: How to Adapt.',
    'Decision 1 has already decided whether and why to adapt. You must not change its intent, reinterpret EEG, or override the code eligibility gate.',
    'Produce only a minimal future-facing local patch for the supplied upcoming Base Plan horizon. Past content and the execution freeze buffer are immutable.',
    'Maintain means the Base Plan continues its scheduled evolution; NO_SAFE_PATCH also safely continues that Base Plan.',
    'Prefer KEEP, ADJUST, RESCHEDULE, REPLACE, or SUPPRESS before INSERT. Adaptation may simplify the scene and is not synonymous with adding sound.',
    'Treat every patch as a provisional hypothesis, never a proven intervention. Use only supplied structured prior outcomes and never infer causality from temporal order.',
    'Plan a restrained but perceptibly layered soundscape patch that realizes the supplied Decision 1 intent, salience, scope, and constraintsForDecision2. When appropriate, combine one subtle ambient adjustment with at most one event or body-anchored action.',
    'Apply this goal-to-layer policy whenever restrictions permit and a compatible candidate exists:',
    '- gently-reorient: prioritize one perceptible event. An ambient adjustment may accompany it, but ambient-only changes should not satisfy this goal.',
    '- support-grounding: prioritize one body-anchored action. An ambient adjustment may accompany it, but ambient-only changes should not satisfy this goal.',
    '- refresh-engagement: prioritize a novel event for within-scene scope, or combine a continuous scene transition with one compatible event when scene-transition scope is authorized.',
    '- reduce-stimulation: remove or reduce event/action activity; do not add a salient cue merely to create change.',
    '- support-sustained-focus: make a minimal continuous within-scene evolution; preserve meditation continuity and avoid framing the change as correction.',
    '- preserve-recovery: normally preserve the current plan; if Decision 1 requested adaptation, use only a minimal continuity-preserving adjustment.',
    'If the most recent adaptation selected only ambient assets, prioritize an eligible event or action in this patch instead of making another ambient-only change.',
    'At least one newly selected asset should create an actually audible source change; do not claim adaptation while merely restating the current plan.',
    'Use only assetId values in candidates. Never invent an asset, location, motion, duration, gain, or numerical range.',
    'Treat candidate metadata as authoritative: description, scene, layer, tags, loop, intensity, suddenness, useWhen, avoidWhen, spatialBehavior, defaultPosition, defaultMotion.durationSec, autoDeleteAfterSec, fades, and recommendedVolume.',
    'For an event, durationMs MUST equal defaultMotion.durationSec * 1000 when defaultMotion.durationSec is non-null; otherwise it MUST equal autoDeleteAfterSec * 1000. autoDeleteAfterSec is only the fallback lifecycle when no authored motion duration exists. A looping asset may remain active until a later patch removes it.',
    'Prefer an unused compatible variant and respect the already-applied exact-asset and family cooldown filtering.',
    'Add at most one new salient event in one patch. Event-source movement is not listener movement. A body-anchored action does not require a scene transition. Footsteps imply listener movement only when explicitly assigned a locomotion role.',
    'For within-scene adaptation, preserve the listener location and semantic scene. For scene-transition scope, preserve narrative continuity and use only scene-compatible candidates.',
    'Journey waypoints must use only listenerReachableLocations. Sound-source waypoints must use only soundSourceLocationIds.',
    'If no candidate can safely realize the requested adaptation, return no selected assets and explain that the planner must maintain rather than invent content.',
    'Return only a strict SoundscapePlanPatch-compatible JSON object plus selectedAssetIds and a concise inspectable rationale. Do not expose hidden chain-of-thought.',
    `INPUT_JSON=${JSON.stringify(payload)}`,
  ].join('\n');
}

export function buildDecision2OutputSchema(
  candidates: readonly Decision2Candidate[],
  context: DecisionContext,
): Record<string, unknown> {
  const assetIds = candidates.map((candidate) => candidate.assetId);
  const currentLocation =
    context.currentPlan.userJourney.waypoints.at(-1)?.locationId ?? 'clearing';
  const journeyLocations = [
    currentLocation,
    ...(locationNeighbors[currentLocation] ?? []),
  ];
  const sourceLocations = Object.keys(locationScene);
  const ambientCandidates = candidates.filter(
    (candidate) => candidate.layer === 'ambient',
  );
  const actionCandidates = candidates.filter(
    (candidate) => candidate.layer === 'action',
  );
  const eventCandidates = candidates.filter(
    (candidate) => candidate.layer === 'event',
  );
  const vector3 = {
    type: 'array',
    items: { type: 'number' },
    minItems: 3,
    maxItems: 3,
  };
  const emptyItemSchema = {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {},
  };
  const ambientItemSchema = ambientCandidates.length
    ? {
        anyOf: ambientCandidates.map((candidate) => ({
          type: 'object',
          additionalProperties: false,
          required: ['id', 'assetId', 'mode', 'locationId', 'gain', 'active'],
          properties: {
            id: { type: 'string' },
            assetId: { type: 'string', enum: [candidate.assetId] },
            mode: { type: 'string', enum: ['global', 'localized'] },
            locationId: {
              anyOf: [
                { type: 'null' },
                { type: 'string', enum: sourceLocations },
              ],
            },
            gain: { type: 'number', enum: [candidate.recommendedVolume] },
            active: { type: 'boolean' },
          },
        })),
      }
    : emptyItemSchema;
  const actionItemSchema = actionCandidates.length
    ? {
        anyOf: actionCandidates.map((candidate) => ({
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'assetId',
            'attachment',
            'relativePosition',
            'gain',
            'active',
          ],
          properties: {
            id: { type: 'string' },
            assetId: { type: 'string', enum: [candidate.assetId] },
            attachment: {
              type: 'string',
              enum: ['head', 'chest', 'feet', 'body'],
            },
            relativePosition: vector3,
            gain: { type: 'number', enum: [candidate.recommendedVolume] },
            active: { type: 'boolean' },
          },
        })),
      }
    : emptyItemSchema;
  const eventItemSchema = eventCandidates.length
    ? {
        anyOf: eventCandidates.map((candidate) => ({
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'assetId',
            'activationTimeMs',
            'durationMs',
            'trajectory',
            'gain',
          ],
          properties: {
            id: { type: 'string' },
            assetId: { type: 'string', enum: [candidate.assetId] },
            activationTimeMs: { type: 'number', minimum: 0 },
            durationMs: {
              type: 'number',
              enum: [authoredEventDurationMs(candidate)],
            },
            trajectory: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['locationId', 'timestampMs'],
                properties: {
                  locationId: { type: 'string', enum: sourceLocations },
                  timestampMs: { type: 'number', minimum: 0 },
                },
              },
            },
            gain: {
              type: 'number',
              enum: [candidate.recommendedVolume],
            },
          },
        })),
      }
    : emptyItemSchema;
  return {
    name: 'neuroscape_decision_2',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'status',
        'intent',
        'patchOperations',
        'preservedElementIds',
        'adaptationHypothesis',
        'reflectionUsed',
        'reasonCodes',
        'patch',
        'selectedAssetIds',
        'rationale',
      ],
      properties: {
        status: { type: 'string', enum: ['PATCH_PROPOSED', 'NO_SAFE_PATCH'] },
        intent: {
          type: 'string',
          enum: [
            'gently_reorient_attention',
            'support_grounding',
            'reduce_stimulation',
            'support_sustained_focus',
            'refresh_engagement',
            'preserve_recovery',
          ],
        },
        patchOperations: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'operation',
              'targetElementId',
              'effectiveStartMs',
              'transitionMs',
              'replacementAssetId',
            ],
            properties: {
              operation: {
                type: 'string',
                enum: [
                  'KEEP',
                  'ADJUST',
                  'RESCHEDULE',
                  'REPLACE',
                  'SUPPRESS',
                  'INSERT',
                ],
              },
              targetElementId: { type: ['string', 'null'] },
              effectiveStartMs: { type: 'number', minimum: 0 },
              transitionMs: { type: 'number', minimum: 0, maximum: 30000 },
              replacementAssetId: {
                anyOf: [{ type: 'null' }, { type: 'string', enum: assetIds }],
              },
            },
          },
        },
        preservedElementIds: { type: 'array', items: { type: 'string' } },
        adaptationHypothesis: {
          type: 'object',
          additionalProperties: false,
          required: [
            'mechanismCode',
            'expectedResponseCode',
            'failureSignalCode',
          ],
          properties: {
            mechanismCode: { type: 'string' },
            expectedResponseCode: {
              type: 'string',
              enum: [
                'REDUCE_VARIABILITY_OR_HALT_DECLINE',
                'PRESERVE_STABILITY',
                'GENTLE_REORIENTATION',
              ],
            },
            failureSignalCode: {
              type: 'string',
              enum: [
                'CONTINUED_DECLINE_WITH_VALID_SIGNAL',
                'INCREASED_VARIABILITY',
                'LOSS_OF_STABILITY',
              ],
            },
          },
        },
        reflectionUsed: {
          type: 'object',
          additionalProperties: false,
          required: ['priorAdaptationIds', 'lessonCode', 'lessonConfidence'],
          properties: {
            priorAdaptationIds: {
              type: 'array',
              maxItems: 3,
              items: { type: 'string' },
            },
            lessonCode: { type: ['string', 'null'] },
            lessonConfidence: {
              type: 'string',
              enum: ['high', 'medium', 'low', 'unavailable'],
            },
          },
        },
        reasonCodes: { type: 'array', maxItems: 5, items: { type: 'string' } },
        patch: {
          type: 'object',
          additionalProperties: false,
          required: [
            'reasoningSummary',
            'journey',
            'upsertAmbient',
            'upsertAction',
            'upsertEvent',
            'removeIds',
            'transitionDurationMs',
          ],
          properties: {
            reasoningSummary: { type: 'string' },
            journey: {
              anyOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['goal', 'waypoints'],
                  properties: {
                    goal: { type: 'string' },
                    waypoints: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 2,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['locationId'],
                        properties: {
                          locationId: {
                            type: 'string',
                            enum: journeyLocations,
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
            upsertAmbient: {
              type: 'array',
              maxItems: ambientCandidates.length ? 2 : 0,
              items: ambientItemSchema,
            },
            upsertAction: {
              type: 'array',
              maxItems: actionCandidates.length ? 1 : 0,
              items: actionItemSchema,
            },
            upsertEvent: {
              type: 'array',
              maxItems: eventCandidates.length ? 1 : 0,
              items: eventItemSchema,
            },
            removeIds: { type: 'array', items: { type: 'string' } },
            transitionDurationMs: {
              type: 'number',
              minimum: 0,
              maximum: 30000,
            },
          },
        },
        selectedAssetIds: {
          type: 'array',
          maxItems: 3,
          items: { type: 'string', enum: assetIds },
        },
        rationale: { type: 'string' },
      },
    },
  };
}

export function prepareDecision2Input(
  context: DecisionContext,
  decision: AdaptationDecision,
  config: AdaptivePlannerConfig,
): Decision2Input {
  const { currentScene, candidates } = retrieveDecision2Candidates(
    context,
    decision,
    config,
  );
  return {
    promptVersion: DECISION_2_PROMPT_VERSION,
    currentScene,
    candidates,
    prompt: buildDecision2Prompt(context, decision, currentScene, candidates),
    outputSchema: buildDecision2OutputSchema(candidates, context),
    reasoningEffort: assessPatchComplexity(context, decision),
  };
}

export function assessPatchComplexity(
  context: DecisionContext,
  decision: AdaptationDecision,
): 'low' | 'medium' {
  const priorConflict = (context.relevantPriorOutcomes ?? []).some(
    (item) =>
      item.outcome.observedResponse === 'opposed_to_hypothesis' &&
      item.outcome.confidence !== 'low',
  );
  const multipleLayers =
    new Set((context.upcomingBaseHorizon ?? []).map((item) => item.layer))
      .size > 1;
  const phaseBoundary = (context.upcomingBaseHorizon ?? []).some((item) =>
    context.basePlan?.phases.some((phase) => phase.startMs === item.startMs),
  );
  return priorConflict ||
    multipleLayers ||
    phaseBoundary ||
    decision.scope === 'scene-transition'
    ? 'medium'
    : 'low';
}

export function validateDecision2Selection(
  result: PlanningResult,
  input: Decision2Input,
): void {
  if (new Set(result.selectedAssetIds).size !== result.selectedAssetIds.length)
    throw new Error('Decision 2 selectedAssetIds must not contain duplicates.');

  const allowed = new Set(
    input.candidates.map((candidate) => candidate.assetId),
  );
  const patchAssetIds = [
    ...(result.patch.upsertAmbient ?? []),
    ...(result.patch.upsertAction ?? []),
    ...(result.patch.upsertEvent ?? []),
  ].map((item) => item.assetId);
  const allOutputAssetIds = [...result.selectedAssetIds, ...patchAssetIds];
  const invalid = allOutputAssetIds.filter((assetId) => !allowed.has(assetId));
  if (invalid.length)
    throw new Error(
      `Decision 2 selected assets outside the retrieved candidate set: ${invalid.join(', ')}`,
    );
  const selected = new Set(result.selectedAssetIds);
  const unreported = patchAssetIds.filter((assetId) => !selected.has(assetId));
  if (unreported.length)
    throw new Error(
      `Decision 2 patch assets are missing from selectedAssetIds: ${unreported.join(', ')}`,
    );
  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.assetId, candidate]),
  );
  const layerErrors = [
    ...(result.patch.upsertAmbient ?? []).map((item) => ({
      assetId: item.assetId,
      expected: 'ambient',
    })),
    ...(result.patch.upsertAction ?? []).map((item) => ({
      assetId: item.assetId,
      expected: 'action',
    })),
    ...(result.patch.upsertEvent ?? []).map((item) => ({
      assetId: item.assetId,
      expected: 'event',
    })),
  ].filter(
    ({ assetId, expected }) => candidateById.get(assetId)?.layer !== expected,
  );
  if (layerErrors.length)
    throw new Error(
      `Decision 2 placed assets in the wrong sound layer: ${layerErrors
        .map(({ assetId, expected }) => `${assetId}→${expected}`)
        .join(', ')}`,
    );
  const gainErrors = [
    ...(result.patch.upsertAmbient ?? []),
    ...(result.patch.upsertAction ?? []),
    ...(result.patch.upsertEvent ?? []),
  ].filter(
    (item) =>
      Math.abs(
        item.gain - (candidateById.get(item.assetId)?.recommendedVolume ?? -1),
      ) > 1e-6,
  );
  if (gainErrors.length)
    throw new Error(
      `Decision 2 must use authored recommendedVolume: ${gainErrors.map((item) => item.assetId).join(', ')}`,
    );
  const durationErrors = (result.patch.upsertEvent ?? []).filter((item) => {
    const candidate = candidateById.get(item.assetId);
    return (
      candidate !== undefined &&
      item.durationMs !== authoredEventDurationMs(candidate)
    );
  });
  if (durationErrors.length)
    throw new Error(
      `Decision 2 must use authored event motion/lifecycle duration: ${durationErrors.map((item) => item.assetId).join(', ')}`,
    );
}
