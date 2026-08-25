import libraryData from './audio_library.json' with { type: 'json' };

export type AudioLibraryLayer = 'ambient' | 'event' | 'action';
export type AudioLibraryScene = 'forest' | 'ocean_beach';
export type AudioDistance = 'near' | 'middle' | 'far' | 'wide';
export type AudioMotionType =
  'none' | 'drift' | 'overhead_pass' | 'local_random' | 'approach_recede';

export type AudioVector3 = [number, number, number];

export interface AudioLibraryMotion {
  type: AudioMotionType;
  start?: AudioVector3;
  mid?: AudioVector3;
  end?: AudioVector3;
  center?: AudioVector3;
  radius?: number;
  speed?: number;
  /** Duration of the default spatial motion, in seconds. */
  duration?: number;
  repeat?: boolean;
  volume_curve?: string;
}

export interface AudioLibraryAsset {
  asset_id: string;
  label: string;
  description: string;
  asset_ref: string;
  scene: AudioLibraryScene[];
  layer: AudioLibraryLayer;
  role: string;
  tags: string[];
  loop: boolean;
  suddenness: number;
  intensity: number;
  recommended_distance: AudioDistance;
  recommended_volume: number;
  use_when: string[];
  avoid_when: string[];
  spatial_behavior: string[];
  default_position: AudioVector3;
  default_motion: AudioLibraryMotion;
  fade_in_sec: number;
  fade_out_sec: number;
  auto_delete_after_sec: number | null;
  repeat_count: number;
  repeat_interval_sec: number;
  priority: number;
  is_primary_ambient: boolean;
  is_rare_event: boolean;
}

/**
 * Canonical, shared source of truth for planner retrieval and runtime loading.
 * The JSON is intentionally exported without renaming its authored fields.
 */
export const audioLibrary: readonly AudioLibraryAsset[] = Object.freeze(
  libraryData as AudioLibraryAsset[],
);

export const audioLibraryById: ReadonlyMap<string, AudioLibraryAsset> = new Map(
  audioLibrary.map((asset) => [asset.asset_id, asset]),
);
