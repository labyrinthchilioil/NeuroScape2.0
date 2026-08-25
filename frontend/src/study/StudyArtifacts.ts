import { mockCalibrationProfile } from '@neuroscape/adaptive-planner';
import type {
  AdaptiveTraceRecord,
  RecordedSession,
} from '@neuroscape/contracts';
import JSZip from 'jszip';
import type { CapturedAudio } from '../audio/AudioEngine.js';

export interface StudyArtifact {
  filename: string;
  mimeType: string;
  content: Blob;
}
export interface StudyArtifactBundle {
  participantId: string;
  sessionId: string;
  folderName: string;
  files: StudyArtifact[];
}
export type BackendSaveState = {
  status: 'idle' | 'saving' | 'saved' | 'failed';
  directory?: string;
  error?: string;
};

const json = (value: unknown) =>
  new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
const lines = (values: readonly unknown[]) =>
  new Blob(
    [
      values.map((value) => JSON.stringify(value)).join('\n') +
        (values.length ? '\n' : ''),
    ],
    { type: 'application/x-ndjson' },
  );
const csvCell = (value: unknown) =>
  `"${String(value ?? '').replaceAll('"', '""')}"`;
const csv = (headers: string[], rows: unknown[][]) =>
  new Blob(
    [
      [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') +
        '\n',
    ],
    { type: 'text/csv' },
  );

function trace(recording: RecordedSession, kind: AdaptiveTraceRecord['kind']) {
  return recording.adaptiveTrace.filter((item) => item.kind === kind);
}

export function createStudyArtifactBundle(
  recording: RecordedSession,
  audio: CapturedAudio | null,
  errors: readonly string[] = [],
  rawEeg: Blob | null = null,
): StudyArtifactBundle {
  const participantId = recording.metadata.participantId ?? 'UNASSIGNED';
  const sessionId = recording.metadata.sessionId;
  const eegEpochs = trace(recording, 'eeg-epoch');
  const recordedErrors = trace(recording, 'llm-error').map(
    (item) => `${item.timestampMs}ms · ${item.summary}`,
  );
  const allErrors = [...recordedErrors, ...errors];
  const files: StudyArtifact[] = [
    {
      filename: 'calibration-profile.json',
      mimeType: 'application/json',
      content: json(recording.calibrationProfile ?? mockCalibrationProfile),
    },
    {
      filename: 'eeg-epochs.csv',
      mimeType: 'text/csv',
      content: csv(
        ['timestampMs', 'logTbr', 'valid', 'qualityScore', 'artifactFlags'],
        eegEpochs.map((item) => [
          item.timestampMs,
          item.data.logTbr,
          item.data.valid,
          item.data.qualityScore,
          Array.isArray(item.data.artifactFlags)
            ? item.data.artifactFlags.join('|')
            : '',
        ]),
      ),
    },
    {
      filename: 'attention-states.csv',
      mimeType: 'text/csv',
      content: csv(
        [
          'timestampMs',
          'currentLogTbr',
          'relativePositionUnbounded',
          'referenceGap',
          'deltaFromFocus',
          'deltaFromMindWandering',
          'coverage',
          'trajectory',
          'relativePositionSlope',
          'measurementConfidence',
          'calibrationQuality',
          'signalQuality',
          'stateEstimationVersion',
          'focusPosition',
          'mindWanderingPosition',
          'label',
          'trend',
          'variabilityMad',
          'phase',
          'confidence',
          'validEpochCount',
        ],
        recording.neuroStates.map((item) => [
          item.timestampMs,
          item.attention?.currentLogTbr,
          item.attention?.relativePosition,
          item.attention?.referenceGap,
          item.attention?.deltaFromFocus,
          item.attention?.deltaFromMindWandering,
          item.attention?.coverage,
          item.attention?.trajectory,
          item.attention?.relativePositionSlope,
          item.attention?.measurementConfidence,
          item.attention?.calibrationQuality,
          item.attention?.signalQuality,
          item.attention?.stateEstimationVersion,
          item.attention?.focusPosition,
          item.attention?.mindWanderingPosition,
          item.attention?.label,
          item.attention?.trend,
          item.attention?.variabilityMad,
          item.attention?.phase,
          item.confidence,
          item.attention?.validEpochCount,
        ]),
      ),
    },
    {
      filename: 'eligibility-decisions.jsonl',
      mimeType: 'application/x-ndjson',
      content: lines(trace(recording, 'eligibility')),
    },
    {
      filename: 'decision-1.jsonl',
      mimeType: 'application/x-ndjson',
      content: lines(trace(recording, 'decision-1')),
    },
    {
      filename: 'decision-2.jsonl',
      mimeType: 'application/x-ndjson',
      content: lines(trace(recording, 'decision-2')),
    },
    {
      filename: 'scene-journey-plans.jsonl',
      mimeType: 'application/x-ndjson',
      content: lines(recording.sceneJourneyPlans),
    },
    {
      filename: 'runtime-events.jsonl',
      mimeType: 'application/x-ndjson',
      content: lines(
        [
          ...recording.sessionEvents.map((item) => ({
            ...item,
            stream: 'session',
          })),
          ...recording.plannerEvents.map((item) => ({
            ...item,
            stream: 'planner',
          })),
        ].sort((a, b) => a.timestampMs - b.timestampMs),
      ),
    },
    {
      filename: 'final-session-bundle.json',
      mimeType: 'application/json',
      content: json(recording),
    },
    {
      filename: 'errors.log',
      mimeType: 'text/plain',
      content: new Blob(
        [
          allErrors.length
            ? `${allErrors.join('\n')}\n`
            : 'No recorded finalization errors.\n',
        ],
        {
          type: 'text/plain',
        },
      ),
    },
  ];
  if (audio)
    files.push({
      filename: `spatial-audio-mix.${audio.extension}`,
      mimeType: audio.mimeType,
      content: audio.blob,
    });
  if (rawEeg)
    files.push({
      filename: 'raw_eeg.csv',
      mimeType: 'text/csv',
      content: rawEeg,
    });
  const manifest = {
    participantId,
    sessionId,
    createdAt: new Date().toISOString(),
    schemaVersion: '1.0',
    logicalDurationMs: recording.metadata.durationMs,
    runMode: recording.metadata.runMode,
    plannerMode: recording.metadata.plannerMode,
    capturedAudioDurationMs: audio?.durationMs ?? null,
    audioMimeType: audio?.mimeType ?? null,
    errorCount: allErrors.length,
    files: files.map((file) => ({
      filename: file.filename,
      mimeType: file.mimeType,
      bytes: file.content.size,
    })),
  };
  files.unshift({
    filename: 'manifest.json',
    mimeType: 'application/json',
    content: json(manifest),
  });
  return {
    participantId,
    sessionId,
    folderName: `${participantId}/${sessionId}`,
    files,
  };
}

export async function saveBundleToBackend(
  bundle: StudyArtifactBundle,
): Promise<string> {
  const prefix = `/api/study/sessions/${encodeURIComponent(bundle.participantId)}/${encodeURIComponent(bundle.sessionId)}`;
  const health = await fetch('/api/study/health');
  if (!health.ok) throw new Error('Local study recorder is unavailable.');
  for (const file of bundle.files) {
    const response = await fetch(
      `${prefix}/artifacts/${encodeURIComponent(file.filename)}`,
      {
        method: 'PUT',
        headers: { 'content-type': file.mimeType },
        body: file.content,
      },
    );
    if (!response.ok)
      throw new Error(
        `Failed to save ${file.filename}: HTTP ${response.status}`,
      );
  }
  const finalized = await fetch(`${prefix}/finalize`, { method: 'POST' });
  if (!finalized.ok)
    throw new Error(
      `Failed to finalize local study folder: HTTP ${finalized.status}`,
    );
  const result = (await finalized.json()) as { directory?: string };
  return result.directory ?? bundle.folderName;
}

export async function downloadStudyZip(
  bundle: StudyArtifactBundle,
): Promise<void> {
  const zip = new JSZip();
  for (const file of bundle.files) zip.file(file.filename, file.content);
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 4 },
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `neuroscape-${bundle.participantId}-${bundle.sessionId}.zip`;
  anchor.click();
  URL.revokeObjectURL(url);
}
