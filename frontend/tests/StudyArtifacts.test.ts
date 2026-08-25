import { describe, expect, it, vi } from 'vitest';
import {
  createStudyArtifactBundle,
  saveBundleToBackend,
} from '../src/study/StudyArtifacts.js';
import { recordedSession } from './recordingFixtures.js';

describe('study artifact finalization', () => {
  it('creates analysis tables, structured decisions, session JSON, and spatial audio', () => {
    const recording = recordedSession();
    recording.metadata.participantId = 'P001';
    recording.metadata.runMode = 'study-realtime';
    recording.adaptiveTrace.push({
      timestampMs: 0,
      kind: 'eeg-epoch',
      source: 'deterministic',
      summary: 'epoch',
      data: { logTbr: 1.2, valid: true, qualityScore: 0.9, artifactFlags: [] },
    });
    const bundle = createStudyArtifactBundle(
      recording,
      {
        blob: new Blob(['mix']),
        mimeType: 'audio/webm',
        extension: 'webm',
        durationMs: 600_000,
      },
      [],
      new Blob(['sample_index,tp9\n1,2\n'], { type: 'text/csv' }),
    );
    expect(bundle.folderName).toBe('P001/session-1');
    expect(bundle.files.map((file) => file.filename)).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'eeg-epochs.csv',
        'attention-states.csv',
        'decision-1.jsonl',
        'final-session-bundle.json',
        'spatial-audio-mix.webm',
        'raw_eeg.csv',
      ]),
    );
  });

  it('uploads every artifact and finalizes the local folder', async () => {
    const recording = recordedSession();
    recording.metadata.participantId = 'P001';
    const bundle = createStudyArtifactBundle(recording, null);
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        calls += 1;
        return {
          ok: true,
          status: init?.method === 'PUT' ? 201 : 200,
          json: async () => ({ directory: '/tmp/P001/session-1' }),
        } as Response;
      }),
    );
    expect(await saveBundleToBackend(bundle)).toBe('/tmp/P001/session-1');
    expect(calls).toBe(bundle.files.length + 2);
  });
});
