import { useEffect, useState } from 'react';
import {
  api,
  type SavedCalibrationSession,
} from '../../calibration/services/api.js';
import type { Profile } from '../../calibration/types.js';

export interface CalibrationSessionIntent {
  participantId: string;
  durationMinutes: number;
}
export interface SessionIntent {
  worldDescription: string;
  durationMinutes: number;
  eegSource: 'muse' | 'recorded';
}
export type AdaptiveRunMode = 'mock-fast' | 'study-realtime';
export interface AdaptiveSessionIntent {
  participantId: string;
  runMode: AdaptiveRunMode;
  plannerMode: 'openai' | 'mock';
}

export function HomePage({
  onCalibration,
  onRealTime,
  onNonAdaptive,
}: {
  onCalibration: (intent: CalibrationSessionIntent) => void;
  onRealTime: (profile: Profile) => void | Promise<void>;
  onNonAdaptive: (participantId: string) => void;
}) {
  const [participantId, setParticipantId] = useState('P001');
  const [sessions, setSessions] = useState<SavedCalibrationSession[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const normalized = participantId.trim().toUpperCase();
  const valid = /^P0*[1-9][0-9]*$/.test(normalized);

  useEffect(() => {
    void api
      .sessions()
      .then((items) => {
        const completed = items.filter((item) => item.completed_at);
        setSessions(completed);
        setSelected(completed[0]?.session_id ?? '');
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  const startRealTime = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const details = await api.session(selected);
      if (!details.profile || details.profile_compatible === false)
        throw new Error(
          details.profile_error ||
            'This session has no compatible calibration profile.',
        );
      await onRealTime(details.profile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flow-page home-page">
      <p className="flow-brand">NeuroScape</p>
      <h1>Study Home</h1>
      <label className="home-participant">
        Participant ID
        <input
          aria-label="Participant ID"
          value={participantId}
          onChange={(event) => setParticipantId(event.target.value)}
        />
      </label>
      {!valid && (
        <small>Use P followed by a positive integer, for example P001.</small>
      )}
      {error && (
        <p role="alert" className="summary-error">
          {error}
        </p>
      )}
      <section className="home-entry-grid">
        <article className="glass-panel">
          <span>01</span>
          <h2>Calibration</h2>
          <p>Create and save an EEG calibration profile.</p>
          <button
            disabled={!valid}
            onClick={() =>
              onCalibration({ participantId: normalized, durationMinutes: 10 })
            }
          >
            Enter Calibration
          </button>
        </article>
        <article className="glass-panel">
          <span>02</span>
          <h2>10 min Real-Time Adaptive Meditation</h2>
          <p>Uses live EEG and the selected saved calibration profile.</p>
          <select
            aria-label="Calibration profile"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {!sessions.length && (
              <option value="">No completed profiles found</option>
            )}
            {sessions.map((item) => (
              <option key={item.session_id} value={item.session_id}>
                {item.participant_id} · {item.session_id}
              </option>
            ))}
          </select>
          <button
            disabled={!selected || busy}
            onClick={() => void startRealTime()}
          >
            {busy ? 'Starting…' : 'Start Adaptive Meditation'}
          </button>
        </article>
        <article className="glass-panel">
          <span>03</span>
          <h2>10 min Non-Adaptive Meditation</h2>
          <p>Plays the same pre-rendered control audio for every participant.</p>
          <button disabled={!valid} onClick={() => onNonAdaptive(normalized)}>
            Start Non-Adaptive Meditation
          </button>
        </article>
      </section>
    </main>
  );
}
