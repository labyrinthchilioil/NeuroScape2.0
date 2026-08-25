import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioContextManager } from '../src/audio/AudioContextManager.js';
import { AudioEngine } from '../src/audio/AudioEngine.js';
import { createRuntimeStore } from '../src/runtime/RuntimeStore.js';
import { FakeAudioContext, FakeCapturingAudioContext } from './audioFakes.js';
import { snapshot } from './fixtures.js';

afterEach(() => vi.unstubAllGlobals());

describe('AudioEngine integration', () => {
  it('resumes from a gesture, reconciles replay snapshots, and closes the session context', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(1),
      })),
    );
    const fake = new FakeAudioContext();
    const store = createRuntimeStore();
    const engine = new AudioEngine(
      store,
      new AudioContextManager(() => fake as unknown as AudioContext),
    );
    await engine.enable();
    expect(engine.getState().status).toBe('running');
    await engine.suspend();
    expect(engine.getState().status).toBe('suspended');
    await engine.enable();
    expect(engine.getState().status).toBe('running');
    store.getState().publishRuntimeWorldState(snapshot(0));
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.getState().sourceCount).toBe(4);
    expect(
      engine
        .diagnostics()
        .map((item) => item.runtimeId)
        .sort(),
    ).toEqual(['bird', 'breath', 'water']);
    store
      .getState()
      .publishRuntimeWorldState({ ...snapshot(1000), action: [], event: [] });
    expect(engine.getState().sourceCount).toBe(2);
    await engine.dispose();
    expect(fake.closed).toBe(true);
    expect(engine.getState().status).toBe('disabled');
  });
  it('captures the final master mix with MediaRecorder', async () => {
    class FakeMediaRecorder extends EventTarget {
      static isTypeSupported = () => true;
      state: RecordingState = 'inactive';
      mimeType = 'audio/webm;codecs=opus';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.ondataavailable?.({
          data: new Blob(['mix'], { type: this.mimeType }),
        } as BlobEvent);
        this.state = 'inactive';
        this.dispatchEvent(new Event('stop'));
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(1),
      })),
    );
    const fake = new FakeCapturingAudioContext(),
      engine = new AudioEngine(
        createRuntimeStore(),
        new AudioContextManager(() => fake as unknown as AudioContext),
      );
    await engine.startRecording();
    expect(engine.getState().recordingStatus).toBe('recording');
    const capture = await engine.stopRecording();
    expect(capture?.blob.size).toBe(3);
    expect(capture?.extension).toBe('webm');
    expect(engine.getState().recordingStatus).toBe('idle');
  });
  it('plays the opening once through the non-spatialized master mix', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(1),
      })),
    );
    const fake = new FakeAudioContext();
    const engine = new AudioEngine(
      createRuntimeStore(),
      new AudioContextManager(() => fake as unknown as AudioContext),
    );
    await engine.playOpening();
    const opening = fake.sources.at(-1)!;
    expect(opening.loop).toBe(false);
    expect(opening.starts).toEqual([fake.currentTime]);
    expect(fake.panners).toHaveLength(0);
    engine.stopOpening();
    expect(opening.stops).toEqual([fake.currentTime]);
    await engine.dispose();
  });
});
