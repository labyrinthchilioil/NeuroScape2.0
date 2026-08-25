import type { Profile, Status } from '../types';

export interface SavedCalibrationSession {
  participant_id: string;
  session_id: string;
  created_at: string;
  completed_at?: string;
}

export interface SavedCalibrationDetails {
  session_id: string;
  profile?: Profile;
  profile_compatible?: boolean;
  profile_error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/calibration${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string | Array<{ msg?: string }>;
    };
    const detail = Array.isArray(body.detail)
      ? body.detail.map((item) => item.msg).filter(Boolean).join('; ')
      : body.detail;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

const startPayload = (quality_override: boolean): RequestInit => ({
  method: 'POST',
  body: JSON.stringify({ quality_override }),
});

export interface SelfReportPayload {
  mind_wandering: number | null;
  drowsiness: number | null;
  investigator_notes: string;
  unable_to_judge: boolean;
}

export const api = {
  status: () => request<Status>('/status'),
  create: (participant_id: string) =>
    request('/session/create', {
      method: 'POST',
      body: JSON.stringify({ participant_id }),
    }),
  test: () =>
    request<Record<string, unknown>>('/connection/test', {
      method: 'POST',
    }),
  startAcclimation: (qualityOverride: boolean) =>
    request(
      '/calibration/acclimation/start',
      startPayload(qualityOverride),
    ),
  endAcclimationEarly: () =>
    request('/calibration/acclimation/end-early', { method: 'POST' }),
  acceptAcclimation: () =>
    request('/calibration/acclimation/accept', { method: 'POST' }),
  repeatAcclimation: (qualityOverride: boolean) =>
    request(
      '/calibration/acclimation/repeat',
      startPayload(qualityOverride),
    ),
  startBlock: (qualityOverride: boolean) =>
    request('/calibration/block/start', startPayload(qualityOverride)),
  endBlockEarly: () =>
    request('/calibration/block/end-early', { method: 'POST' }),
  submitSelfReport: (payload: SelfReportPayload) =>
    request('/calibration/self-report', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  reset: () => request('/calibration/reset', { method: 'POST' }),
  result: () => request<Profile>('/calibration/result'),
  sessions: () => request<SavedCalibrationSession[]>('/sessions'),
  session: (sessionId: string) =>
    request<SavedCalibrationDetails>(`/sessions/${encodeURIComponent(sessionId)}`),
};
