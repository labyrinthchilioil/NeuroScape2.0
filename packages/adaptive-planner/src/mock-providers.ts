import type {
  ActionPlanItem,
  AmbientPlanItem,
  EventPlanItem,
} from '@neuroscape/contracts';
import { audioLibrary } from '@neuroscape/contracts';
import type {
  AdaptationDecision,
  DecisionContext,
  Decision2Input,
  DecisionProvider,
  PlanningProvider,
  PlanningResult,
} from './types.js';

export interface SoundAssetKnowledge {
  assetId: string;
  family: string;
  label: string;
  layer: 'ambient' | 'event' | 'body-anchor';
  description: string;
  scenes: string[];
  tags: string[];
  loop: boolean;
  intensity: number;
  suddenness: number;
  recommendedDistance: string;
  useWhen: string[];
  avoidWhen: string[];
  spatialBehavior: string[];
  defaultPosition: [number, number, number];
  defaultMotionType: string;
  motionDurationMs: number | null;
  autoDeleteAfterMs: number | null;
  recommendedVolume: number;
  fadeInMs: number;
  fadeOutMs: number;
  priority: number;
  isPrimaryAmbient: boolean;
  isRareEvent: boolean;
}

export const phase1SoundKnowledge: readonly SoundAssetKnowledge[] =
  Object.freeze(
    audioLibrary.map((asset) => ({
      assetId: asset.asset_id,
      family: asset.asset_id.replace(/_\d+$/, ''),
      label: asset.label,
      layer: (asset.layer === 'action' ? 'body-anchor' : asset.layer) as
        'ambient' | 'event' | 'body-anchor',
      description: asset.description,
      scenes: [...asset.scene],
      tags: [...asset.tags],
      loop: asset.loop,
      intensity: asset.intensity,
      suddenness: asset.suddenness,
      recommendedDistance: asset.recommended_distance,
      useWhen: [...asset.use_when],
      avoidWhen: [...asset.avoid_when],
      spatialBehavior: [...asset.spatial_behavior],
      defaultPosition: [...asset.default_position] as [number, number, number],
      defaultMotionType: asset.default_motion.type,
      motionDurationMs:
        asset.default_motion.duration === undefined
          ? null
          : asset.default_motion.duration * 1_000,
      autoDeleteAfterMs:
        asset.auto_delete_after_sec === null
          ? null
          : asset.auto_delete_after_sec * 1_000,
      recommendedVolume: asset.recommended_volume,
      fadeInMs: asset.fade_in_sec * 1_000,
      fadeOutMs: asset.fade_out_sec * 1_000,
      priority: asset.priority,
      isPrimaryAmbient: asset.is_primary_ambient,
      isRareEvent: asset.is_rare_event,
    })),
  );

export class MockDecisionProvider implements DecisionProvider {
  async decide(context: DecisionContext): Promise<AdaptationDecision> {
    const state = context.state;
    const mindWandering =
      state.relativePosition === null ? null : 1 - state.relativePosition;
    const evidenceSummary = {
      position:
        state.label === 'uncertain' ? ('unavailable' as const) : state.label,
      trajectory: state.trajectory,
      confidence: state.measurementConfidence,
    };
    if (context.stasisPressure && state.label === 'focus-leaning') {
      return {
        decision: 'adapt',
        intent: 'support_sustained_focus',
        salience: 'minimal',
        evidenceSummary,
        reason:
          'Stable focus plus prolonged scene stasis supports a minimal, non-corrective evolution.',
        maintainReason: null,
        constraintsForDecision2: [
          'preserve_scene_continuity',
          'avoid_high_salience_event',
        ],
        shouldAdapt: true,
        goal: 'support-sustained-focus',
        scope: 'within-scene',
        rationale:
          'Stable focus plus prolonged scene stasis supports a minimal, non-corrective evolution.',
        provider: 'mock-decision-v2',
      };
    }
    if (
      mindWandering !== null &&
      mindWandering >= 0.84 &&
      state.sustainedMindWanderingWindows >= 3 &&
      context.restrictions.allowSceneTransition
    ) {
      return {
        decision: 'adapt',
        intent: 'refresh_engagement',
        salience: 'moderate',
        evidenceSummary,
        reason: 'Sustained reliable decline followed lighter interventions.',
        maintainReason: null,
        constraintsForDecision2: ['preserve_scene_continuity'],
        shouldAdapt: true,
        goal: 'refresh-engagement',
        scope: 'scene-transition',
        rationale:
          'Sustained high calibration-relative mind-wandering followed lighter interventions; a low-frequency scene transition is allowed.',
        provider: 'mock-decision-v2',
      };
    }
    if (
      mindWandering !== null &&
      mindWandering >= 0.7 &&
      state.sustainedMindWanderingWindows >= 2 &&
      context.restrictions.allowBodyAnchor
    ) {
      return {
        decision: 'adapt',
        intent: 'support_grounding',
        salience: 'low',
        evidenceSummary,
        reason: 'Reliable unstable or sustained decline supports grounding.',
        maintainReason: null,
        constraintsForDecision2: [
          'preserve_scene_continuity',
          'avoid_high_salience_event',
        ],
        shouldAdapt: true,
        goal: 'support-grounding',
        scope: 'within-scene',
        rationale:
          'Mind-wandering is sustained across windows; use a body-relative anchor while keeping the semantic scene stable.',
        provider: 'mock-decision-v2',
      };
    }
    if (
      mindWandering !== null &&
      mindWandering >= 0.52 &&
      state.trend === 'toward-mind-wandering' &&
      context.restrictions.allowEvent
    ) {
      return {
        decision: 'adapt',
        intent: 'gently_reorient_attention',
        salience: 'low',
        evidenceSummary,
        reason:
          'Reliable unbounded trajectory is declining toward the mind-wandering reference direction.',
        maintainReason: null,
        constraintsForDecision2: [
          'preserve_scene_continuity',
          'avoid_high_salience_event',
        ],
        shouldAdapt: true,
        goal: 'gently-reorient',
        scope: 'within-scene',
        rationale:
          'Attention is moving toward the personal mind-wandering reference; use one sparse directional event.',
        provider: 'mock-decision-v2',
      };
    }
    return {
      decision: 'maintain',
      intent:
        state.trajectory === 'improving' ? 'preserve_recovery' : 'maintain',
      salience: 'minimal',
      evidenceSummary,
      reason:
        'Current evidence and scene history do not justify a meaningful change.',
      maintainReason:
        'The current scene remains suitable and no stasis pressure requires supportive evolution.',
      constraintsForDecision2: [],
      shouldAdapt: false,
      goal: 'maintain',
      scope: 'maintain',
      rationale:
        'The current calibration-relative state does not justify a new intervention at this checkpoint.',
      provider: 'mock-decision-v2',
    };
  }
}

export class MockPlanningProvider implements PlanningProvider {
  async plan(
    context: DecisionContext,
    decision: AdaptationDecision,
    input: Decision2Input,
  ): Promise<PlanningResult> {
    if (!decision.shouldAdapt)
      throw new Error(
        'PlanningProvider must not be called for a maintain decision.',
      );
    const now = context.state.timestampMs;
    if (decision.scope === 'scene-transition') {
      const current =
        context.currentPlan.userJourney.waypoints.at(-1)?.locationId ??
        'clearing';
      const destination =
        current === 'waterfall'
          ? 'waterfall'
          : current === 'stream_bank'
            ? 'waterfall'
            : 'stream_bank';
      const candidate = input.candidates.find(
        (item) => item.layer === 'ambient',
      );
      if (!candidate)
        throw new Error(
          'No scene-compatible ambient candidate is available for Decision 2.',
        );
      const localized = !candidate.spatialBehavior.includes('wide');
      const ambient: AmbientPlanItem = {
        id: 'scene-ambient',
        assetId: candidate.assetId,
        mode: localized ? 'localized' : 'global',
        ...(localized ? { locationId: destination } : {}),
        gain: candidate.recommendedVolume,
        active: true,
      };
      return {
        patch: {
          reasoningSummary: decision.rationale,
          journey: {
            goal: `Move gently from ${current} toward ${destination}`,
            waypoints: [{ locationId: current }, { locationId: destination }],
          },
          upsertAmbient: [ambient],
          removeIds: context.currentPlan.soundscape.ambient
            .filter((item) => item.mode === 'global')
            .map((item) => item.id),
          transitionDurationMs: 8_000,
        },
        selectedAssetIds: [ambient.assetId],
        candidateAssetIds: input.candidates.map((item) => item.assetId),
        promptVersion: input.promptVersion,
        prompt: input.prompt,
        outputSchema: input.outputSchema,
        rationale: `${candidate.label} is the highest-ranked scene-compatible ambient candidate. The authored library currently lacks dedicated forest stream/waterfall recordings, so the prototype preserves the forest sound family while testing the journey transition.`,
        provider: 'mock-planner-v1',
      };
    }
    if (decision.goal === 'support-grounding') {
      const candidate =
        input.candidates.find((item) => item.tags.includes('breath')) ??
        input.candidates.find((item) => item.layer === 'action');
      if (!candidate)
        throw new Error(
          'No body-anchor candidate is available for Decision 2.',
        );
      const action: ActionPlanItem = {
        id: 'breathing',
        assetId: candidate.assetId,
        attachment: 'chest',
        relativePosition: [...candidate.defaultPosition],
        gain: candidate.recommendedVolume,
        active: true,
      };
      return {
        patch: {
          reasoningSummary: decision.rationale,
          upsertAction: [action],
          transitionDurationMs: 3_000,
        },
        selectedAssetIds: [action.assetId],
        candidateAssetIds: input.candidates.map((item) => item.assetId),
        promptVersion: input.promptVersion,
        prompt: input.prompt,
        outputSchema: input.outputSchema,
        rationale: `${candidate.label} is authored for grounding and body-anchored near-field presentation without listener movement.`,
        provider: 'mock-planner-v1',
      };
    }
    if (decision.goal === 'support-sustained-focus') {
      const candidate = input.candidates.find(
        (item) => item.layer === 'ambient',
      );
      if (!candidate)
        throw new Error(
          'No continuous ambient candidate is available for sustained-focus support.',
        );
      const ambient: AmbientPlanItem = {
        id: 'supportive-ambient',
        assetId: candidate.assetId,
        mode: candidate.spatialBehavior.includes('wide')
          ? 'global'
          : 'localized',
        ...(!candidate.spatialBehavior.includes('wide')
          ? { locationId: 'clearing' }
          : {}),
        gain: candidate.recommendedVolume,
        active: true,
      };
      return {
        patch: {
          reasoningSummary: decision.rationale,
          upsertAmbient: [ambient],
          transitionDurationMs: 6_000,
        },
        selectedAssetIds: [ambient.assetId],
        candidateAssetIds: input.candidates.map((item) => item.assetId),
        promptVersion: input.promptVersion,
        prompt: input.prompt,
        outputSchema: input.outputSchema,
        rationale: `${candidate.label} provides a minimal continuity-preserving evolution for sustained focus.`,
        provider: 'mock-planner-v2',
      };
    }
    const candidate = input.candidates.find((item) => item.layer === 'event');
    if (!candidate) {
      throw new Error(
        'No event asset satisfies library compatibility and cooldown filtering.',
      );
    }
    const assetId = candidate.assetId;
    const durationMs = Math.round(
      (candidate.defaultMotion.durationSec ??
        candidate.autoDeleteAfterSec ??
        6) * 1_000,
    );
    const currentLocation =
      context.currentPlan.userJourney.waypoints.at(-1)?.locationId ??
      'clearing';
    const moving = candidate.defaultMotion.type !== 'none';
    const event: EventPlanItem = {
      id: `event-${now}`,
      assetId,
      activationTimeMs: now + 2_000,
      durationMs,
      trajectory: moving
        ? [
            { locationId: 'forest_entry', timestampMs: now + 2_000 },
            {
              locationId: currentLocation,
              timestampMs: now + 2_000 + durationMs,
            },
          ]
        : [{ locationId: currentLocation, timestampMs: now + 2_000 }],
      gain: candidate.recommendedVolume,
    };
    return {
      patch: {
        reasoningSummary: decision.rationale,
        upsertEvent: [event],
        transitionDurationMs: 2_000,
      },
      selectedAssetIds: [assetId],
      candidateAssetIds: input.candidates.map((item) => item.assetId),
      promptVersion: input.promptVersion,
      prompt: input.prompt,
      outputSchema: input.outputSchema,
      rationale: `${candidate.label} is a compatible low-intensity event. Its ${durationMs / 1_000}-second timing and ${candidate.defaultMotion.type} behavior come directly from the audio library.`,
      provider: 'mock-planner-v1',
    };
  }
}
