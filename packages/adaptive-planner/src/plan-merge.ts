import type { SceneJourneyPlan } from '@neuroscape/contracts';
import type { SoundscapePlanPatch } from './types.js';

function mergeById<T extends { id: string }>(
  current: readonly T[],
  upserts: readonly T[] = [],
  removeIds: readonly string[] = [],
): T[] {
  const merged = new Map(
    current
      .filter((item) => !removeIds.includes(item.id))
      .map((item) => [item.id, structuredClone(item)]),
  );
  upserts.forEach((item) => merged.set(item.id, structuredClone(item)));
  return [...merged.values()];
}

function normalizeAmbient(
  items: SceneJourneyPlan['soundscape']['ambient'],
): SceneJourneyPlan['soundscape']['ambient'] {
  return items.map((item) => {
    if (item.mode !== 'global') return item;
    const { locationId: _locationId, ...globalItem } = item;
    return globalItem;
  });
}

export function mergePlanPatch(
  current: SceneJourneyPlan,
  patch: SoundscapePlanPatch,
  timestampMs: number,
): SceneJourneyPlan {
  return {
    planId: `adaptive-plan-${timestampMs}`,
    planningHorizonSec: Math.max(
      1,
      (patch.transitionDurationMs ??
        current.transitionPolicy.defaultDurationMs) /
        1000 +
        10,
    ),
    reasoningSummary: patch.reasoningSummary,
    userJourney: structuredClone(patch.journey ?? current.userJourney),
    soundscape: {
      ambient: normalizeAmbient(
        mergeById(
          current.soundscape.ambient,
          patch.upsertAmbient,
          patch.removeIds,
        ),
      ),
      action: mergeById(
        current.soundscape.action,
        patch.upsertAction,
        patch.removeIds,
      ),
      event: mergeById(
        current.soundscape.event,
        patch.upsertEvent,
        patch.removeIds,
      ),
    },
    transitionPolicy: {
      defaultDurationMs:
        patch.transitionDurationMs ??
        current.transitionPolicy.defaultDurationMs,
      curve: 'smoothstep',
    },
  };
}
