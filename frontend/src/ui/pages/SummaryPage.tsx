import type { RecordedSession } from '@neuroscape/contracts';
import { useState, useSyncExternalStore, type ChangeEvent } from 'react';
import {
  activateImportedRecording,
  downloadRecording,
  loadRecordingReplay,
  printSummary,
} from '../../recording/recordingIO.js';
import { recordingStore } from '../../recording/recordingStore.js';
import { downloadStudyZip } from '../../study/StudyArtifacts.js';
import { studyArtifactStore } from '../../study/studyArtifactStore.js';
import {
  audioActivePeriods,
  deriveSummary,
  descriptiveReflection,
  plannerTimeline,
  semanticLocationDurations,
} from '../summary/index.js';

const percent = (value: number | null) =>
  value === null ? '—' : `${Math.round(value * 100)}%`;
const time = (milliseconds: number) =>
  `${Math.floor(milliseconds / 60000)}:${String(Math.floor((milliseconds % 60000) / 1000)).padStart(2, '0')}`;
const points = (values: readonly number[], width = 600, height = 130) =>
  values
    .map(
      (value, index) =>
        `${values.length === 1 ? width / 2 : (index / (values.length - 1)) * width},${height - value * height}`,
    )
    .join(' ');

export function SummaryPage({
  recording: supplied,
  onReplay,
  onHome,
}: {
  recording?: RecordedSession | null;
  onReplay?: () => void;
  onHome?: () => void;
}) {
  const stored = useSyncExternalStore(
    recordingStore.subscribe,
    recordingStore.getState,
    recordingStore.getState,
  );
  const recording = supplied ?? stored;
  const artifacts = useSyncExternalStore(
    studyArtifactStore.subscribe,
    studyArtifactStore.getState,
    studyArtifactStore.getState,
  );
  const [importError, setImportError] = useState('');
  if (!recording)
    return (
      <main className="summary-page summary-empty">
        <p className="flow-brand">NeuroScape</p>
        <h1>Session Reflection</h1>
        <p>No accepted session recording is available.</p>
        {onHome && <button onClick={onHome}>Return Home</button>}
      </main>
    );
  const metrics = deriveSummary(recording),
    audio = audioActivePeriods(recording),
    plans = plannerTimeline(recording),
    locations = semanticLocationDurations(recording);
  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then((json) => {
      const result = activateImportedRecording(json);
      setImportError(result.valid ? '' : result.errors.join('; '));
    });
  };
  const replay = () => {
    loadRecordingReplay(recording);
    onReplay?.();
  };
  const path = recording.runtimeSnapshots.map(
    (item) => item.listener.worldPosition,
  );
  const xs = path.map((item) => item[0]),
    zs = path.map((item) => item[2]),
    minX = Math.min(...xs, 0),
    maxX = Math.max(...xs, 1),
    minZ = Math.min(...zs, 0),
    maxZ = Math.max(...zs, 1);
  const spatialPoints = path
    .map(
      ([x, , z]) =>
        `${20 + ((x - minX) / Math.max(1, maxX - minX)) * 560},${20 + ((z - minZ) / Math.max(1, maxZ - minZ)) * 260}`,
    )
    .join(' ');
  return (
    <main className="summary-page">
      <header>
        <div>
          <p className="flow-brand">NeuroScape</p>
          <span>Session Reflection · recorded data</span>
        </div>
        <div className="summary-actions">
          {onHome && <button onClick={onHome}>Return Home</button>}
          <button onClick={() => downloadRecording(recording)}>
            Export Recording
          </button>
          {artifacts.bundle && (
            <button onClick={() => void downloadStudyZip(artifacts.bundle!)}>
              Download Study ZIP
            </button>
          )}
          <label>
            Import Recording
            <input
              type="file"
              accept="application/json"
              onChange={importFile}
            />
          </label>
          <button onClick={printSummary}>Print</button>
          <button onClick={replay}>Replay Session</button>
        </div>
      </header>
      {importError && (
        <p className="summary-error">Import rejected: {importError}</p>
      )}
      {recording.metadata.participantId && (
        <section className="summary-panel">
          <h2>Study Artifacts</h2>
          <p>
            <strong>Participant:</strong> {recording.metadata.participantId} ·{' '}
            <strong>Mode:</strong> {recording.metadata.runMode} ·{' '}
            <strong>Planner:</strong>{' '}
            {recording.metadata.plannerMode ?? 'not recorded'}
          </p>
          <p>
            {artifacts.backend.status === 'saving'
              ? 'Saving local participant folder…'
              : artifacts.backend.status === 'saved'
                ? `Saved automatically to ${artifacts.backend.directory}`
                : artifacts.backend.status === 'failed'
                  ? `Automatic local save failed: ${artifacts.backend.error}. Download Study ZIP remains available.`
                  : 'Study bundle ready.'}
          </p>
        </section>
      )}
      <section className="overview-grid">
        {[
          ['Arousal', percent(metrics.averageArousal)],
          ['Duration', time(metrics.durationMs)],
          ['Journey', `${metrics.journeyDistance.toFixed(2)} m`],
        ].map(([label, value]) => (
          <article className="summary-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="summary-panel neuro-timeline">
        <h2>Neuro Arousal Timeline / Calibration-Relative Attention</h2>
        {recording.neuroStates.length ? (
          <>
            <svg
              viewBox="0 0 600 140"
              role="img"
              aria-label="Recorded attention timeline"
            >
              <polyline
                className="arousal-line"
                points={points(
                  recording.neuroStates.map(
                    (item) =>
                      item.attention?.focusPosition ?? item.arousal.value,
                  ),
                )}
              />
            </svg>
            <div className="timeline-legend">
              <span>Calibration-relative focus</span>
            </div>
          </>
        ) : (
          <p className="neutral">No recorded NeuroState data.</p>
        )}
      </section>
      <div className="summary-columns">
        <section className="summary-panel">
          <h2>Planned Semantic Journey</h2>
          {plans.length ? (
            plans.map((plan) => (
              <article className="timeline-entry" key={plan.timestampMs}>
                <time>{time(plan.timestampMs)}</time>
                <div>
                  <strong>{plan.goal}</strong>
                  <p>{plan.journey.join(' → ') || 'No waypoints supplied'}</p>
                  <small>
                    {plan.reasoningSummary ?? 'Planner reasoning unavailable.'}
                  </small>
                </div>
              </article>
            ))
          ) : (
            <p className="neutral">No recorded planner updates.</p>
          )}
        </section>
        <section className="summary-panel">
          <h2>Executed Listener Journey</h2>
          {path.length ? (
            <>
              <svg
                className="spatial-summary"
                viewBox="0 0 600 300"
                role="img"
                aria-label="Actual recorded listener path"
              >
                <polyline points={spatialPoints} />
                {path.length && (
                  <>
                    <circle
                      cx={spatialPoints.split(' ')[0]?.split(',')[0]}
                      cy={spatialPoints.split(' ')[0]?.split(',')[1]}
                      r="7"
                    />
                    <circle
                      className="end"
                      cx={spatialPoints.split(' ').at(-1)?.split(',')[0]}
                      cy={spatialPoints.split(' ').at(-1)?.split(',')[1]}
                      r="7"
                    />
                  </>
                )}
              </svg>
              <ul>
                {Object.entries(locations).map(([location, duration]) => (
                  <li key={location}>
                    {location}
                    <span>{time(duration)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="neutral">No recorded listener path.</p>
          )}
        </section>
      </div>
      <section className="summary-panel">
        <h2>Audio Experience Timeline</h2>
        {audio.length ? (
          <div className="audio-summary">
            {audio.map((period) => (
              <div key={`${period.key}:${period.startMs}`}>
                <span>
                  {period.category} · {period.assetId}
                </span>
                <i
                  style={{
                    marginLeft: `${(period.startMs / Math.max(1, metrics.durationMs)) * 100}%`,
                    width: `${(period.durationMs / Math.max(1, metrics.durationMs)) * 100}%`,
                  }}
                />
                <small>
                  {time(period.startMs)}–{time(period.endMs)}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="neutral">No evidenced active sound periods.</p>
        )}
      </section>
      <div className="summary-columns">
        <section className="summary-panel">
          <h2>Planner Adaptations</h2>
          {plans.length ? (
            plans.map((plan) => (
              <article
                className="timeline-entry"
                key={`adapt-${plan.timestampMs}`}
              >
                <time>{time(plan.timestampMs)}</time>
                <div>
                  <strong>{plan.goal}</strong>
                  <p>{plan.reasoningSummary ?? 'Reasoning unavailable.'}</p>
                  <small>
                    {plan.transitionPolicy.curve} ·{' '}
                    {plan.transitionPolicy.defaultDurationMs} ms
                  </small>
                </div>
              </article>
            ))
          ) : (
            <p className="neutral">No recorded adaptations.</p>
          )}
        </section>
        <section className="summary-panel reflection">
          <h2>Reflection</h2>
          <p>{descriptiveReflection(recording)}</p>
          <h3>Recorded planner interpretation</h3>
          {plans.some((plan) => plan.reasoningSummary) ? (
            plans
              .filter((plan) => plan.reasoningSummary)
              .map((plan) => (
                <blockquote key={plan.timestampMs}>
                  {plan.reasoningSummary}
                </blockquote>
              ))
          ) : (
            <p className="neutral">No planner interpretation was recorded.</p>
          )}
        </section>
      </div>
      <section className="summary-panel">
        <h2>Module 01/02 Decision Trace</h2>
        {recording.adaptiveTrace.length ? (
          recording.adaptiveTrace.map((entry, index) => (
            <article
              className="timeline-entry"
              key={`${entry.timestampMs}-${entry.kind}-${index}`}
            >
              <time>{time(entry.timestampMs)}</time>
              <div>
                <strong>
                  {entry.kind} · {entry.source}
                </strong>
                <p>{entry.summary}</p>
              </div>
            </article>
          ))
        ) : (
          <p className="neutral">No adaptive decision trace was recorded.</p>
        )}
      </section>
    </main>
  );
}
