import type {
  ActionPlanItem,
  AmbientPlanItem,
  EventPlanItem,
  SceneJourneyPlan,
} from '@neuroscape/contracts';
import type { AdaptivePlannerConfig } from './config.js';

export const BASE_PLAN_VERSION = 'base_plan_v2';
export const ASSIGNMENT_RULE_VERSION = 'matched_ab_v1';

export type BasePlanPhaseId =
  'settling' | 'deepening' | 'sustaining' | 'closing';
export type BasePlanLayer = 'ambient' | 'event' | 'action';
export type BasePlanDensity = 'low' | 'medium';
export type BasePlanFlexibility = 'low' | 'medium' | 'high';

export interface BasePlanProfile {
  profileId: string;
  durationMs: number;
  sceneFamily: string;
  complexityEnvelopeId: 'meditation_restrained_v1';
  maxConcurrentSources: number;
  maxAmbientLayers: number;
  maxEventsPerMinute: number;
  maxBodyAnchorsPerMinute: number;
  maxSalienceLoad: number;
  reservedAdaptationHeadroom: number;
}

export interface BasePlanPhase {
  phaseId: BasePlanPhaseId;
  startMs: number;
  endMs: number;
  targetDensity: BasePlanDensity;
  adaptationFlexibility: BasePlanFlexibility;
}

export interface BasePlanElement {
  elementId: string;
  assetId: string;
  layer: BasePlanLayer;
  startMs: number;
  endMs: number;
  gain: number;
  salience: number;
  assetFamily: string;
  spatialBehavior: string;
  adjustable: boolean;
  replaceable: boolean;
  suppressible: boolean;
  payload: AmbientPlanItem | ActionPlanItem | EventPlanItem;
}

export interface BaseScenePlan {
  planId: 'forest_A' | 'forest_B';
  version: typeof BASE_PLAN_VERSION;
  profile: BasePlanProfile;
  phases: BasePlanPhase[];
  scheduledElements: BasePlanElement[];
  journey: SceneJourneyPlan['userJourney'];
  transitionPolicy: SceneJourneyPlan['transitionPolicy'];
}

export interface BasePlanMetrics {
  durationMs: number;
  phaseCount: number;
  ambientCount: number;
  eventCount: number;
  bodyAnchorCount: number;
  peakConcurrentSources: number;
  peakSalienceLoad: number;
  spatialMovementCount: number;
  assetFamilies: number;
}

export interface BasePlanAssignment {
  participantId: string;
  conditionOrder: ['non_adaptive', 'adaptive'] | ['adaptive', 'non_adaptive'];
  nonAdaptiveBasePlanId: BaseScenePlan['planId'];
  adaptiveBasePlanId: BaseScenePlan['planId'];
  assignmentRuleVersion: typeof ASSIGNMENT_RULE_VERSION;
}

const phases = (): BasePlanPhase[] => [
  {
    phaseId: 'settling',
    startMs: 0,
    endMs: 120_000,
    targetDensity: 'low',
    adaptationFlexibility: 'low',
  },
  {
    phaseId: 'deepening',
    startMs: 120_000,
    endMs: 260_000,
    targetDensity: 'medium',
    adaptationFlexibility: 'medium',
  },
  {
    phaseId: 'sustaining',
    startMs: 260_000,
    endMs: 540_000,
    targetDensity: 'low',
    adaptationFlexibility: 'high',
  },
  {
    phaseId: 'closing',
    startMs: 540_000,
    endMs: 600_000,
    targetDensity: 'low',
    adaptationFlexibility: 'low',
  },
];

function profile(config: AdaptivePlannerConfig): BasePlanProfile {
  return {
    profileId: 'forest_restrained_v1',
    durationMs: config.sessionDurationMs,
    sceneFamily: 'forest',
    complexityEnvelopeId: 'meditation_restrained_v1',
    maxConcurrentSources: config.maxConcurrentSources,
    maxAmbientLayers: config.maxAmbientLayers,
    maxEventsPerMinute: config.maxEventsPerMinute,
    maxBodyAnchorsPerMinute: config.maxBodyAnchorsPerMinute,
    maxSalienceLoad: config.maxSalienceLoad,
    reservedAdaptationHeadroom: config.reservedAdaptationHeadroom,
  };
}

const ambient = (
  id: string,
  assetId: string,
  gain: number,
): BasePlanElement => ({
  elementId: id,
  assetId,
  layer: 'ambient',
  startMs: 0,
  endMs: 600_000,
  gain,
  salience: 0.2,
  assetFamily: 'forest_ambient',
  spatialBehavior: 'global_stable',
  adjustable: true,
  replaceable: true,
  suppressible: false,
  payload: { id, assetId, mode: 'global', gain, active: true },
});

const event = (
  id: string,
  assetId: string,
  at: number,
  duration: number,
  gain: number,
  locationId: string,
): BasePlanElement => ({
  elementId: id,
  assetId,
  layer: 'event',
  startMs: at,
  endMs: at + duration,
  gain,
  salience: 0.25,
  assetFamily: assetId.replace(/_\d+$/, ''),
  spatialBehavior: 'stationary_distant',
  adjustable: true,
  replaceable: true,
  suppressible: true,
  payload: {
    id,
    assetId,
    activationTimeMs: at,
    durationMs: duration,
    trajectory: [{ locationId, timestampMs: at }],
    gain,
  },
});

export function createMatchedForestBasePlans(
  config: AdaptivePlannerConfig,
): readonly [BaseScenePlan, BaseScenePlan] {
  const shared: Omit<BaseScenePlan, 'planId' | 'scheduledElements'> = {
    version: BASE_PLAN_VERSION,
    profile: profile(config),
    phases: phases(),
    journey: {
      goal: 'Follow a restrained ten-minute forest meditation arc',
      waypoints: [{ locationId: 'clearing', arrivalTimeMs: 0 }],
    },
    transitionPolicy: {
      defaultDurationMs: 5_000,
      curve: 'smoothstep' as const,
    },
  };
  const a: BaseScenePlan = {
    ...structuredClone(shared),
    planId: 'forest_A',
    scheduledElements: [
      ambient('base-a-bed', 'forest_ambient_bed_01', 0.38),
      event(
        'base-a-bird',
        'forest_bird_far_01',
        155_000,
        8_000,
        0.24,
        'forest_entry',
      ),
      event(
        'base-a-leaves',
        'forest_leaf_rustle_mid_01',
        335_000,
        7_000,
        0.24,
        'clearing',
      ),
      event(
        'base-a-drop',
        'forest_water_drop_far_01',
        485_000,
        6_000,
        0.2,
        'waterfall',
      ),
    ],
  };
  const b: BaseScenePlan = {
    ...structuredClone(shared),
    planId: 'forest_B',
    scheduledElements: [
      ambient('base-b-bed', 'forest_ambient_bed_02', 0.36),
      event(
        'base-b-leaves',
        'forest_leaf_rustle_mid_01',
        145_000,
        7_000,
        0.24,
        'stream_bank',
      ),
      event(
        'base-b-bird',
        'forest_bird_far_02',
        350_000,
        8_000,
        0.2,
        'forest_entry',
      ),
      event(
        'base-b-owl',
        'forest_soft_owl_far_01',
        495_000,
        7_000,
        0.1,
        'waterfall',
      ),
    ],
  };
  return [a, b];
}

export function measureBasePlan(plan: BaseScenePlan): BasePlanMetrics {
  const points = [
    ...new Set(plan.scheduledElements.flatMap((e) => [e.startMs, e.endMs])),
  ];
  const activeAt = (t: number) =>
    plan.scheduledElements.filter((e) => e.startMs <= t && t < e.endMs);
  return {
    durationMs: plan.profile.durationMs,
    phaseCount: plan.phases.length,
    ambientCount: plan.scheduledElements.filter((e) => e.layer === 'ambient')
      .length,
    eventCount: plan.scheduledElements.filter((e) => e.layer === 'event')
      .length,
    bodyAnchorCount: plan.scheduledElements.filter((e) => e.layer === 'action')
      .length,
    peakConcurrentSources: Math.max(
      ...points.map((t) => activeAt(t).length),
      0,
    ),
    peakSalienceLoad: Math.max(
      ...points.map((t) => activeAt(t).reduce((sum, e) => sum + e.salience, 0)),
      0,
    ),
    spatialMovementCount: plan.scheduledElements.filter((e) =>
      e.spatialBehavior.includes('moving'),
    ).length,
    assetFamilies: new Set(plan.scheduledElements.map((e) => e.assetFamily))
      .size,
  };
}

export function validateBasePlan(plan: BaseScenePlan): string[] {
  const m = measureBasePlan(plan);
  const p = plan.profile;
  const errors: string[] = [];
  if (m.durationMs !== 600_000)
    errors.push('base_plan_duration_must_be_600_seconds');
  if (
    plan.phases[0]?.startMs !== 0 ||
    plan.phases.at(-1)?.endMs !== p.durationMs
  )
    errors.push('base_plan_phases_do_not_cover_duration');
  if (
    m.peakConcurrentSources >
    p.maxConcurrentSources - Math.ceil(p.reservedAdaptationHeadroom)
  )
    errors.push('reserved_adaptation_headroom_missing');
  if (m.peakSalienceLoad > p.maxSalienceLoad - p.reservedAdaptationHeadroom)
    errors.push('base_plan_salience_headroom_missing');
  return errors;
}

export function validateMatchedBasePlans(
  a: BaseScenePlan,
  b: BaseScenePlan,
  tolerance: number,
): string[] {
  const errors = [...validateBasePlan(a), ...validateBasePlan(b)];
  const am = measureBasePlan(a);
  const bm = measureBasePlan(b);
  for (const key of [
    'durationMs',
    'phaseCount',
    'ambientCount',
    'eventCount',
    'bodyAnchorCount',
    'peakConcurrentSources',
  ] as const) {
    const scale = Math.max(1, am[key], bm[key]);
    if (Math.abs(am[key] - bm[key]) / scale > tolerance)
      errors.push(`matched_metric_mismatch:${key}`);
  }
  if (
    JSON.stringify(a.scheduledElements.map((e) => [e.assetId, e.startMs])) ===
    JSON.stringify(b.scheduledElements.map((e) => [e.assetId, e.startMs]))
  )
    errors.push('matched_plans_must_not_be_identical');
  return errors;
}

export function assignMatchedBasePlans(
  participantId: string,
  adaptiveFirst = false,
): BasePlanAssignment {
  const parity =
    [...participantId].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 2;
  const nonAdaptiveBasePlanId = parity === 0 ? 'forest_A' : 'forest_B';
  return {
    participantId,
    conditionOrder: adaptiveFirst
      ? ['adaptive', 'non_adaptive']
      : ['non_adaptive', 'adaptive'],
    nonAdaptiveBasePlanId,
    adaptiveBasePlanId:
      nonAdaptiveBasePlanId === 'forest_A' ? 'forest_B' : 'forest_A',
    assignmentRuleVersion: ASSIGNMENT_RULE_VERSION,
  };
}

export function materializeBasePlan(plan: BaseScenePlan): SceneJourneyPlan {
  return {
    planId: plan.planId,
    planningHorizonSec: plan.profile.durationMs / 1000,
    reasoningSummary:
      'Complete restrained Base Plan; maintain preserves its scheduled evolution.',
    userJourney: structuredClone(plan.journey),
    soundscape: {
      ambient: plan.scheduledElements
        .filter((e) => e.layer === 'ambient')
        .map((e) => structuredClone(e.payload as AmbientPlanItem)),
      action: plan.scheduledElements
        .filter((e) => e.layer === 'action' && e.startMs === 0)
        .map((e) => structuredClone(e.payload as ActionPlanItem)),
      event: plan.scheduledElements
        .filter((e) => e.layer === 'event')
        .map((e) => structuredClone(e.payload as EventPlanItem)),
    },
    transitionPolicy: structuredClone(plan.transitionPolicy),
  };
}
