import { audioLibrary, audioLibraryById } from '@neuroscape/contracts';
import type { AudioAssetDefinition } from './AudioAssetManager.js';

/**
 * Temporary compatibility aliases for existing Module 03/04 demos. New plans
 * should emit the canonical asset_id values authored in audio_library.json.
 */
const legacyAliases = {
  'ambient.forest.light': 'forest_ambient_bed_01',
  'ambient.forest.wind': 'forest_wind_leaves_01',
  // TBD_AUDIO_GAP: these two water aliases currently reuse ocean assets until
  // matching forest stream/waterfall clips are added to the authored library.
  'ambient.stream.near': 'ocean_shoreline_wash_01',
  'ambient.waterfall': 'ocean_waves_soft_01',
  'action.guided-breath': 'body_slow_breath_01',
  'action.footsteps': 'forest_grass_footstep_01',
  'event.bird-pass': 'forest_bird_far_01',
  'event.leaves': 'forest_leaf_rustle_mid_01',
} as const;

export const legacyAudioAssetAliases: Readonly<Record<string, string>> =
  Object.freeze(legacyAliases);

export const forestDemoAssetIds = Object.keys(legacyAliases);

export function createProductionAudioManifest(
  baseUrl: string,
): AudioAssetDefinition[] {
  const base = baseUrl.replace(/\/$/, '');
  const canonical = audioLibrary.map((asset) => ({
    assetId: asset.asset_id,
    url: `${base}/${asset.asset_ref}`,
    preload: asset.is_primary_ambient,
  }));
  const aliases = Object.entries(legacyAliases).map(
    ([assetId, canonicalId]) => {
      const asset = audioLibraryById.get(canonicalId);
      if (!asset)
        throw new Error(
          `Legacy audio alias ${assetId} references unknown asset ${canonicalId}.`,
        );
      return {
        assetId,
        url: `${base}/${asset.asset_ref}`,
        preload: asset.is_primary_ambient,
      };
    },
  );
  return [...canonical, ...aliases];
}

const configuredBase = (
  import.meta as ImportMeta & {
    env?: { VITE_AUDIO_ASSET_BASE_URL?: string };
  }
).env?.VITE_AUDIO_ASSET_BASE_URL;

/** Local Vite development serves frontend/public/audio at /audio. */
export const audioAssetManifest = createProductionAudioManifest(
  configuredBase || '/audio',
);
