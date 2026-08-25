import { describe, expect, it } from 'vitest';
import { AudioAssetManager } from '../src/audio/AudioAssetManager.js';
import { GainManager } from '../src/audio/GainManager.js';
import { HRTFRenderer } from '../src/audio/HRTFRenderer.js';
import { PlaybackScheduler } from '../src/audio/PlaybackScheduler.js';
import { SourceManager } from '../src/audio/SourceManager.js';
import { FakeAudioContext, FakeNode, FakePanner, fakeBuffer } from './audioFakes.js';
import { snapshot } from './fixtures.js';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('SourceManager', () => {
  it('owns one persistent graph per object, bypasses HRTF globally, and prevents duplicate starts', async () => {
    const context = new FakeAudioContext(); const master = new FakeNode() as unknown as AudioNode;
    const assets = ['ambient.wind', 'ambient.water', 'action.breath', 'event.bird'].map((assetId) => ({ assetId, url: `/${assetId}` }));
    const manager = new SourceManager(
      context as unknown as BaseAudioContext, master,
      new AudioAssetManager(assets, async () => fakeBuffer, async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) })),
      new GainManager(), new PlaybackScheduler(context as unknown as BaseAudioContext), new HRTFRenderer(context as unknown as BaseAudioContext, master),
    );
    const state = snapshot(); manager.reconcile(state); await flush();
    expect(manager.sources.size).toBe(4); expect(manager.sources.get('globalAmbient:wind')?.spatializer).toBeNull();
    expect(manager.sources.get('localizedAmbient:water')?.spatializer).not.toBeNull(); expect(context.panners).toHaveLength(3);
    expect(manager.sources.get('globalAmbient:wind')?.gainNode.gain.value).toBeCloseTo(0.08);
    expect(manager.sources.get('localizedAmbient:water')?.gainNode.gain.value).toBeCloseTo(0.16);
    expect(manager.sources.get('action:breath')?.gainNode.gain.value).toBe(0.5);
    expect(manager.sources.get('event:bird')?.gainNode.gain.value).toBe(0.6);
    expect(context.sources).toHaveLength(4); manager.reconcile(state); await flush(); expect(context.sources).toHaveLength(4);
    expect((manager.sources.get('action:breath')?.spatializer as unknown as FakePanner).positionX.value).toBe(8);
    expect((manager.sources.get('event:bird')?.spatializer as unknown as FakePanner).positionX.value).toBe(-4);
  });

  it('cleans removed sources and all remaining graphs on shutdown', async () => {
    const context = new FakeAudioContext(); const master = new FakeNode() as unknown as AudioNode;
    const manager = new SourceManager(context as unknown as BaseAudioContext, master,
      new AudioAssetManager([{ assetId: 'ambient.wind', url: '/wind' }], async () => fakeBuffer, async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) })),
      new GainManager(), new PlaybackScheduler(context as unknown as BaseAudioContext), new HRTFRenderer(context as unknown as BaseAudioContext, master));
    const state = snapshot(); state.ambient = [state.ambient[0]!]; state.action = []; state.event = [];
    manager.reconcile(state); await flush(); const gain = manager.sources.get('globalAmbient:wind')!.gainNode as unknown as FakeNode;
    state.ambient = []; manager.reconcile(state); expect(manager.sources.size).toBe(0); expect(gain.disconnected).toBe(true);
    manager.dispose();
  });
});
