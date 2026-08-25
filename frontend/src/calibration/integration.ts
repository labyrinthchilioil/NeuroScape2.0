import type {
  CalibrationProfile,
  TbrEpoch,
} from '@neuroscape/adaptive-planner';
import type { Profile } from './types.js';

const SUPPORTED_FEATURE_VERSION =
  'raw_welch_frontal_log_tbr_median_block_protocol_v4';

interface LiveStartResponse {
  after_sample_index: number;
}

interface LiveEpochResponse {
  ready: boolean;
  available_samples?: number;
  required_samples?: number;
  end_sample_index?: number;
  log_tbr?: number | null;
  valid?: boolean;
  quality_score?: number;
  artifact_flags?: string[];
}

async function calibrationRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`/api/calibration${path}`, init);
  const payload = (await response.json()) as T & { detail?: string };
  if (!response.ok)
    throw new Error(
      payload.detail ?? `Calibration service failed (${response.status})`,
    );
  return payload;
}

export function toPlannerCalibrationProfile(
  profile: Profile,
): CalibrationProfile {
  const usable =
    profile.ready_to_continue &&
    profile.focused_meditation_anchor !== null &&
    profile.free_thought_anchor !== null &&
    profile.pooled_mad !== null &&
    profile.feature_version === SUPPORTED_FEATURE_VERSION;
  return {
    profileId: profile.session_id,
    focusedAnchorLogTbr: profile.focused_meditation_anchor ?? 0,
    mindWanderingAnchorLogTbr: profile.free_thought_anchor ?? 0,
    pooledMad: profile.pooled_mad ?? 0,
    mappingAvailable: usable,
    qualityStatus: usable ? 'provisional' : 'fail',
    featureVersion: profile.feature_version,
  };
}

export class LiveEegEpochSource {
  #afterSampleIndex = -1;
  #recordingStartSampleIndex = -1;
  #epochNumber = 0;

  constructor(private readonly profileSessionId?: string) {}

  async start(): Promise<void> {
    const profilePath = this.profileSessionId
      ? `/live/start/${encodeURIComponent(this.profileSessionId)}`
      : '/live/start';
    const result = await calibrationRequest<LiveStartResponse>(profilePath, {
        method: 'POST',
      });
    this.#afterSampleIndex = result.after_sample_index;
    this.#recordingStartSampleIndex = result.after_sample_index;
    this.#epochNumber = 0;
  }

  rawCsv(): Promise<Blob> {
    return fetchRawEegCsv(this.#recordingStartSampleIndex);
  }

  async next(): Promise<TbrEpoch | null> {
    const result = await calibrationRequest<LiveEpochResponse>(
      `/live/epoch?after_sample_index=${this.#afterSampleIndex}`,
    );
    if (!result.ready || result.end_sample_index === undefined) return null;
    this.#afterSampleIndex = result.end_sample_index;
    this.#epochNumber += 1;
    return {
      timestampMs: this.#epochNumber * 10_000,
      logTbr: result.log_tbr ?? null,
      valid: result.valid === true,
      qualityScore: result.quality_score ?? 0,
      artifactFlags: result.artifact_flags ?? [],
    };
  }
}

export interface RawEegRecordingSource {
  rawCsv(): Promise<Blob>;
}

export class LiveRawEegRecorder implements RawEegRecordingSource {
  #afterSampleIndex = -1;

  async start(): Promise<void> {
    const result = await calibrationRequest<LiveStartResponse>(
      '/live/recording/start',
      { method: 'POST' },
    );
    this.#afterSampleIndex = result.after_sample_index;
  }

  rawCsv(): Promise<Blob> {
    return fetchRawEegCsv(this.#afterSampleIndex);
  }
}

async function fetchRawEegCsv(afterSampleIndex: number): Promise<Blob> {
  const response = await fetch(
    `/api/calibration/live/raw.csv?after_sample_index=${afterSampleIndex}`,
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      detail?: string;
    };
    throw new Error(
      payload.detail ?? `Raw EEG export failed (${response.status})`,
    );
  }
  return response.blob();
}
