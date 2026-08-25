import { describe, expect, it } from 'vitest';
import { audioLibrary } from '../src/index.js';
import type { NeuroState, RuntimeWorldState } from '../src/index.js';

describe('shared contracts', () => {
  it('accepts canonical contract fixtures', () => {
    const neuroState: NeuroState = {
      timestampMs: 0,
      arousal: { value: 0.4, trend: 'decreasing' },
      confidence: 0.9,
    };
    const runtimeState: RuntimeWorldState = {
      timestampMs: 0,
      listener: {
        worldPosition: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        velocity: [0, 0, 0],
        semanticLocation: 'forest_entry',
      },
      ambient: [],
      action: [],
      event: [],
    };

    expect(neuroState.arousal.value).toBe(0.4);
    expect(runtimeState.listener.worldPosition).toEqual([0, 0, 0]);
  });

  it('loads the canonical authored audio library including motion durations', () => {
    expect(audioLibrary).toHaveLength(24);
    expect(
      audioLibrary.find((asset) => asset.asset_id === 'forest_bird_far_01')
        ?.default_motion.duration,
    ).toBe(6);
    expect(
      audioLibrary.find((asset) => asset.asset_id === 'forest_wind_leaves_01')
        ?.default_motion.duration,
    ).toBe(16);
    expect(
      audioLibrary.find(
        (asset) => asset.asset_id === 'forest_leaf_rustle_mid_01',
      )?.auto_delete_after_sec,
    ).toBe(7);
    expect(
      audioLibrary.find(
        (asset) => asset.asset_id === 'forest_stream_ambient_bed_01',
      )?.asset_ref,
    ).toBe('forest/ambient/forest_stream_ambient_bed_01.mp3');
    expect(
      audioLibrary.find(
        (asset) => asset.asset_id === 'forest_body_slow_creek_steps_01',
      )?.asset_ref,
    ).toBe('forest/action/forest_body_slow_creek_steps_01.wav');
  });
});
