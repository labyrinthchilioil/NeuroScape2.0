import { describe, expect, it } from 'vitest';
import { audioLibrary } from '@neuroscape/contracts';
import {
  PlanValidator,
  SceneGraph,
} from '@neuroscape/runtime-scene-controller';
import {
  audioAssetManifest,
  createProductionAudioManifest,
  forestDemoAssetIds,
} from '../src/audio/audioAssetManifest.js';
import { AudioAssetManager } from '../src/audio/AudioAssetManager.js';
import {
  forestPlans,
  forestSceneGraph,
} from '../src/integration/canonicalForestScenario.js';
import { parseServerMessage } from '../src/network/protocol.js';
describe('integration failure boundaries', () => {
  it('rejects invalid plans and unknown semantic locations', () => {
    const validator = new PlanValidator(new SceneGraph(forestSceneGraph));
    expect(
      validator.validate({ ...forestPlans[0], planningHorizonSec: 0 }).valid,
    ).toBe(false);
    const invalid = structuredClone(forestPlans[0]!);
    invalid.userJourney.waypoints[1]!.locationId = 'unknown';
    const result = validator.validate(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('unknown location');
  });
  it('rejects malformed runtime protocol data', () =>
    expect(
      parseServerMessage(
        {
          type: 'RuntimeWorldState',
          protocolVersion: '1.0',
          sessionId: 's',
          timestampMs: 1,
          payload: { malformed: true },
        },
        's',
      ).valid,
    ).toBe(false));
  it('resolves forest assets to local browser URLs', () => {
    expect(forestDemoAssetIds).toEqual(
      expect.arrayContaining([
        'ambient.forest.light',
        'ambient.forest.wind',
        'ambient.stream.near',
        'ambient.waterfall',
        'action.guided-breath',
        'action.footsteps',
        'event.bird-pass',
        'event.leaves',
      ]),
    );
    expect(audioAssetManifest).toHaveLength(
      audioLibrary.length + forestDemoAssetIds.length,
    );
    expect(
      audioLibrary.every((asset) =>
        audioAssetManifest.some((item) => item.assetId === asset.asset_id),
      ),
    ).toBe(true);
    expect(
      audioAssetManifest.every((item) => item.url.startsWith('/audio/')),
    ).toBe(true);
  });
  it('builds configurable production asset URLs without embedding filesystem paths', () => {
    const manifest = createProductionAudioManifest(
      'https://assets.example/neuroscape/audio/',
    );
    expect(
      manifest.find((item) => item.assetId === 'ambient.waterfall')?.url,
    ).toBe(
      'https://assets.example/neuroscape/audio/ocean_beach/ambient/ocean_waves_soft_01.wav',
    );
    expect(
      manifest.find((item) => item.assetId === 'forest_bird_far_02')?.url,
    ).toBe(
      'https://assets.example/neuroscape/audio/forest/event/forest_bird_far_02.wav',
    );
    expect(manifest.every((item) => item.url.startsWith('https://'))).toBe(
      true,
    );
  });
  it('handles an unknown forest asset without fetching or throwing', async () => {
    let fetched = false;
    const manager = new AudioAssetManager(
      audioAssetManifest,
      async () => ({}) as AudioBuffer,
      async () => {
        fetched = true;
        throw new Error('unexpected fetch');
      },
    );
    const result = await manager.load('unknown.forest.asset');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_REGISTERED');
    expect(fetched).toBe(false);
  });
  it('keeps canonical scenario sources URL-free and registered', () => {
    const registered = new Set(forestDemoAssetIds);
    for (const plan of forestPlans) {
      const sources = [
        ...plan.soundscape.ambient,
        ...plan.soundscape.action,
        ...plan.soundscape.event,
      ];
      expect(sources.every((source) => registered.has(source.assetId))).toBe(
        true,
      );
      expect(sources.every((source) => !('url' in source))).toBe(true);
    }
  });
});
