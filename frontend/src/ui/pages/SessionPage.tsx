import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { audioEngine } from '../../audio/AudioEngine.js';
import { runtimeDiagnostics } from '../../debug/index.js';
import {
  integrationHarness,
  longIntegrationHarness,
  spatialDiagnosticHarness,
} from '../../integration/IntegrationHarness.js';
import { adaptiveIntegrationHarness } from '../../integration/AdaptiveIntegrationHarness.js';
import { liveRuntimeClient } from '../../network/liveRuntime.js';
import { sessionRecorder } from '../../recording/recordingStore.js';
import { runtimeReplay } from '../../replay/index.js';
import { runtimeStore } from '../../runtime/RuntimeStore.js';
import { RuntimeWorldViewer } from '../../scene/RuntimeWorldViewer.js';
import { ActiveSoundscapePanel } from '../components/ActiveSoundscapePanel.js';
import { AIAdaptationPanel } from '../components/AIAdaptationPanel.js';
import { JourneyPlanPanel } from '../components/JourneyPlanPanel.js';
import { NeuroStatePanel } from '../components/NeuroStatePanel.js';
import {
  api as calibrationApi,
  type SavedCalibrationSession,
} from '../../calibration/services/api.js';
import type { Profile } from '../../calibration/types.js';

const clock = (milliseconds: number) => {
  const total = Math.floor(milliseconds / 1000);
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
};

export function SessionPage({
  mode = 'live',
  onRestartRealTime,
  onHome,
}: {
  mode?:
    | 'live'
    | 'adaptive'
    | 'non-adaptive'
    | 'demo'
    | 'long-demo'
    | 'diagnostic'
    | 'replay';
  onRestartRealTime?: (profile: Profile) => Promise<void>;
  onHome?: () => void;
}) {
  const [restartOpen, setRestartOpen] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedCalibrationSession[]>(
    [],
  );
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [restartError, setRestartError] = useState('');
  const [restartBusy, setRestartBusy] = useState(false);
  const session = useStore(runtimeStore, (state) => state.sessionRuntime);
  const connection = useStore(runtimeStore, (state) => state.connectionState);
  const runtime = useStore(runtimeStore, (state) => state.runtimeWorldState);
  const errors = useStore(
    runtimeStore,
    (state) => state.runtimeValidationErrors,
  );
  const guidance = useStore(
    runtimeStore,
    (state) => state.sceneJourneyPlan?.reasoningSummary,
  );
  const replay = useSyncExternalStore(
    runtimeReplay.subscribe,
    runtimeReplay.getState,
    runtimeReplay.getState,
  );
  const audio = useSyncExternalStore(
    audioEngine.subscribe,
    audioEngine.getState,
    audioEngine.getState,
  );
  const diagnostics = useSyncExternalStore(
    runtimeDiagnostics.subscribe,
    runtimeDiagnostics.getState,
    runtimeDiagnostics.getState,
  );
  const activeCounts = {
    ambient: runtime?.ambient.filter((item) => item.active).length ?? 0,
    action: runtime?.action.filter((item) => item.active).length ?? 0,
    event: runtime?.event.filter((item) => item.active).length ?? 0,
  };
  useEffect(() => {
    if (!restartOpen) return;
    setRestartError('');
    void calibrationApi
      .sessions()
      .then((sessions) => {
        const completed = sessions.filter((item) => item.completed_at);
        setSavedSessions(completed);
        setSelectedSessionId(
          (current) => current || completed[0]?.session_id || '',
        );
      })
      .catch((error) =>
        setRestartError(error instanceof Error ? error.message : String(error)),
      );
  }, [restartOpen]);
  const restartRealTime = async () => {
    if (!onRestartRealTime || !selectedSessionId) return;
    setRestartBusy(true);
    setRestartError('');
    try {
      const details = await calibrationApi.session(selectedSessionId);
      if (!details.profile || details.profile_compatible === false)
        throw new Error(
          details.profile_error ||
            'This session has no compatible calibration profile.',
        );
      await onRestartRealTime(details.profile);
      setRestartOpen(false);
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : String(error));
    } finally {
      setRestartBusy(false);
    }
  };
  const demoHarness =
    mode === 'adaptive'
      ? adaptiveIntegrationHarness
      : mode === 'non-adaptive'
        ? integrationHarness
        : mode === 'long-demo'
          ? longIntegrationHarness
          : mode === 'diagnostic'
            ? spatialDiagnosticHarness
            : integrationHarness;
  const pauseResume = () => {
    if (
      mode === 'adaptive' ||
      mode === 'non-adaptive' ||
      mode === 'demo' ||
      mode === 'long-demo' ||
      mode === 'diagnostic'
    ) {
      if (session.status === 'paused') demoHarness.resume();
      else demoHarness.pause();
    } else if (mode === 'replay') {
      if (replay.status === 'playing') runtimeReplay.pause();
      else runtimeReplay.play();
    } else
      liveRuntimeClient.sendCommand({
        command: session.status === 'paused' ? 'resumeSession' : 'pauseSession',
      });
  };
  const end = () => {
    if (
      mode === 'adaptive' ||
      mode === 'non-adaptive' ||
      mode === 'demo' ||
      mode === 'long-demo' ||
      mode === 'diagnostic'
    )
      demoHarness.end();
    else liveRuntimeClient.sendCommand({ command: 'endSession' });
  };
  const modeLabel =
    mode === 'non-adaptive'
      ? '10 min · approved fixed trajectory · EEG/LLM disabled'
      : mode === 'live'
        ? `Live · ${connection.status}${connection.latencyMs === null ? '' : ` · ${connection.latencyMs} ms`}`
        : mode === 'adaptive'
          ? 'Phase 1 · adaptive planner + Module 03/04'
          : mode === 'demo'
            ? 'Demo / Integration · Module 03 active'
            : mode === 'long-demo'
              ? 'Long validation · Module 03 active'
              : mode === 'diagnostic'
                ? 'Spatial diagnostic · Module 03 active'
                : 'Replay · recorded session';
  return (
    <main className="session-shell">
      <header>
        <p className="flow-brand">NeuroScape</p>
        {onHome && <button onClick={onHome}>Return Home</button>}
        <div
          className={`connection-badge connection-badge--${mode === 'live' ? connection.status : mode}`}
        >
          <i />
          {modeLabel}
        </div>
      </header>
      <div className="session-grid">
        <aside>
          <JourneyPlanPanel />
          <ActiveSoundscapePanel />
        </aside>
        <section className="world-card glass-panel">
          <div className="world-heading">
            <span>Runtime World</span>
            <strong>
              [{runtime?.listener.semanticLocation ?? 'Awaiting state'}]
            </strong>
          </div>
          <RuntimeWorldViewer />
          <p className="world-guidance">
            {guidance ?? 'Awaiting planner guidance.'}
          </p>
        </section>
        <aside>
          {mode === 'non-adaptive' ? (
            <div className="glass-panel">
              <h3>Non-Adaptive Control</h3>
              <p>No EEG is read and no LLM is called during this session.</p>
            </div>
          ) : (
            <>
              <NeuroStatePanel />
              <AIAdaptationPanel />
            </>
          )}
        </aside>
      </div>
      <footer className="session-footer">
        <div>
          <strong>{clock(session.elapsedTimeMs)}</strong>
          <span>Authoritative session time</span>
        </div>
        <div className="session-controls">
          <button
            onClick={() => void audioEngine.enable()}
            disabled={audio.status === 'running'}
          >
            Audio: {audio.status}
          </button>
          <label>
            Volume{' '}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={audio.masterGain}
              onChange={(event) =>
                audioEngine.setMasterGain(Number(event.target.value))
              }
            />
          </label>
          <button onClick={pauseResume}>
            {session.status === 'paused' || replay.status === 'paused'
              ? 'Resume'
              : 'Pause'}
          </button>
          {onRestartRealTime && (
            <button onClick={() => setRestartOpen((open) => !open)}>
              Restart Real-Time
            </button>
          )}
          <button onClick={end}>End</button>
        </div>
        {restartOpen && (
          <section
            className="realtime-restart-panel"
            aria-label="Restart real-time session"
          >
            <label>
              Calibration session
              <select
                value={selectedSessionId}
                onChange={(event) => setSelectedSessionId(event.target.value)}
                disabled={restartBusy}
              >
                {!savedSessions.length && (
                  <option value="">No completed profiles found</option>
                )}
                {savedSessions.map((item) => (
                  <option value={item.session_id} key={item.session_id}>
                    {item.participant_id} · {item.session_id}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => void restartRealTime()}
              disabled={!selectedSessionId || restartBusy}
            >
              {restartBusy ? 'Restarting…' : 'Restart with Selected Profile'}
            </button>
            {restartError && <p role="alert">{restartError}</p>}
          </section>
        )}
        <details className="developer-controls">
          <summary>Runtime diagnostics</summary>
          <div className="diagnostic-grid">
            <span>
              Runtime timestamp <b>{runtime?.timestampMs ?? '—'} ms</b>
            </span>
            <span>
              Module 03{' '}
              <b>
                {diagnostics.module03UpdateHz.toFixed(1)} Hz /{' '}
                {diagnostics.averageModule03UpdateMs.toFixed(2)} ms
              </b>
            </span>
            <span>
              State build{' '}
              <b>{diagnostics.averageWorldStateBuildMs.toFixed(2)} ms</b>
            </span>
            <span>
              Store update{' '}
              <b>{diagnostics.averageStoreUpdateMs.toFixed(2)} ms</b>
            </span>
            <span>
              Three.js{' '}
              <b>
                {diagnostics.threeFps.toFixed(1)} FPS /{' '}
                {diagnostics.averageThreeFrameMs.toFixed(2)} ms
              </b>
            </span>
            <span>
              Listener{' '}
              <b>
                {runtime?.listener.worldPosition
                  .map((value) => value.toFixed(2))
                  .join(', ') ?? '—'}
              </b>
            </span>
            <span>
              Active A/A/E{' '}
              <b>
                {activeCounts.ambient}/{activeCounts.action}/
                {activeCounts.event}
              </b>
            </span>
            <span>
              Audio sources / HRTF{' '}
              <b>
                {audio.sourceCount}/{audioEngine.diagnostics().length}
              </b>
            </span>
            <span>
              Master audio capture <b>{audio.recordingStatus}</b>
            </span>
            <span>
              Rejected <b>{diagnostics.rejectedMessages}</b>
            </span>
            <span>
              Recording <b>{sessionRecorder.active ? 'active' : 'stopped'}</b>
            </span>
            <span>
              Heap estimate{' '}
              <b>
                {diagnostics.estimatedHeapBytes === null
                  ? 'unavailable'
                  : `${(diagnostics.estimatedHeapBytes / 1048576).toFixed(1)} MB`}
              </b>
            </span>
          </div>
          {mode !== 'adaptive' &&
            mode !== 'demo' &&
            mode !== 'long-demo' &&
            mode !== 'diagnostic' && (
              <>
                <button onClick={() => runtimeReplay.play()}>
                  Play Replay
                </button>
                <button onClick={() => runtimeReplay.pause()}>Pause</button>
                <button onClick={() => runtimeReplay.step()}>Step</button>
                <button onClick={() => runtimeReplay.reset()}>Reset</button>
                <span>
                  {replay.status} {replay.nextIndex}/{replay.total}
                </span>
              </>
            )}
          {errors.length > 0 && <em>{errors.join('; ')}</em>}
        </details>
      </footer>
    </main>
  );
}
