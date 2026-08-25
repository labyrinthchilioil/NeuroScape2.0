import type { SceneJourneyPlan } from '@neuroscape/contracts';
import type { CalibrationProfile, TbrEpoch } from './types.js';

export const mockCalibrationProfile: CalibrationProfile = Object.freeze({
  profileId: 'mock-calibration-01',
  focusedAnchorLogTbr: 1.0,
  mindWanderingAnchorLogTbr: 1.8,
  pooledMad: 0.08,
  mappingAvailable: true,
  qualityStatus: 'provisional',
  featureVersion: 'raw_welch_frontal_log_tbr_median_block_protocol_v4',
});

export const initialForestPlan: SceneJourneyPlan = {
  planId: 'adaptive-initial-forest',
  planningHorizonSec: 600,
  reasoningSummary:
    'Opening phase: establish one quiet forest bed without an attention-grabbing event.',
  userJourney: {
    goal: 'Remain settled in the forest clearing',
    waypoints: [{ locationId: 'clearing' }],
  },
  soundscape: {
    ambient: [
      {
        id: 'forest-bed',
        assetId: 'forest_ambient_bed_01',
        mode: 'global',
        gain: 0.38,
        active: true,
      },
      {
        id: 'forest-wind',
        assetId: 'forest_wind_leaves_01',
        mode: 'localized',
        locationId: 'clearing',
        gain: 0.18,
        active: true,
      },
    ],
    action: [],
    event: [],
  },
  transitionPolicy: { defaultDurationMs: 3_000, curve: 'smoothstep' },
};

/** 60 deterministic 10-second epochs: settled, decline, sustained decline, then recovery. */
export function createMockTbrReplay(): TbrEpoch[] {
  return Array.from({ length: 60 }, (_, index) => {
    const timestampMs = (index + 1) * 10_000;
    const seconds = timestampMs / 1000;
    let logTbr: number;
    if (seconds <= 80) logTbr = 1.12 + ((index % 3) - 1) * 0.015;
    else if (seconds <= 180) logTbr = 1.2 + ((seconds - 80) / 100) * 0.45;
    else if (seconds <= 480) logTbr = 1.72 + ((index % 4) - 1.5) * 0.018;
    else logTbr = 1.68 - ((seconds - 480) / 120) * 0.42;
    return {
      timestampMs,
      logTbr,
      valid: index !== 32,
      qualityScore: index === 32 ? 0.2 : 0.92,
      artifactFlags: index === 32 ? ['mock_blink_artifact'] : [],
    };
  });
}
