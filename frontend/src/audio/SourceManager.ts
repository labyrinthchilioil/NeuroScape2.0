import type { ListenerState, Quaternion, RuntimeWorldState, Vector3 } from '@neuroscape/contracts';
import type { AudioAssetError, AudioAssetManager } from './AudioAssetManager.js';
import type { GainManager } from './GainManager.js';
import type { HRTFRenderer, SpatialDiagnostics } from './HRTFRenderer.js';
import type { PlaybackScheduler, PlaybackTarget } from './PlaybackScheduler.js';

export type SourceCategory = 'globalAmbient' | 'localizedAmbient' | 'action' | 'event';
const AMBIENT_OUTPUT_GAIN = 0.2;
export interface RuntimeSound { id: string; assetId: string; gain: number; active: boolean; worldPosition?: Vector3; lifecycle?: 'waiting' | 'active' | 'finished' }
export interface ManagedSource extends PlaybackTarget {
  key: string; runtimeId: string; assetId: string; category: SourceCategory; gainNode: GainNode; spatializer: PannerNode | null;
  playbackState: 'idle' | 'loading' | 'playing' | 'stopped' | 'error';
  error?: AudioAssetError; diagnostics?: SpatialDiagnostics; generation: number;
}
export interface AudioSourceDiagnostics extends SpatialDiagnostics {
  runtimeId: string; assetId: string; category: SourceCategory; playbackState: ManagedSource['playbackState']; gain: number;
}

export class SourceManager {
  readonly sources = new Map<string, ManagedSource>();
  readonly #context: BaseAudioContext;
  readonly #master: AudioNode;
  readonly #assets: AudioAssetManager;
  readonly #gains: GainManager;
  readonly #playback: PlaybackScheduler;
  readonly #hrtf: HRTFRenderer;
  readonly #onChange: () => void;

  constructor(context: BaseAudioContext, master: AudioNode, assets: AudioAssetManager, gains: GainManager, playback: PlaybackScheduler, hrtf: HRTFRenderer, onChange: () => void = () => undefined) {
    this.#context = context; this.#master = master; this.#assets = assets; this.#gains = gains; this.#playback = playback; this.#hrtf = hrtf; this.#onChange = onChange;
  }

  reconcile(state: Readonly<RuntimeWorldState>): void {
    const desired = new Map<string, { category: SourceCategory; sound: RuntimeSound }>();
    state.ambient.forEach((sound) => desired.set(`${sound.mode === 'global' ? 'globalAmbient' : 'localizedAmbient'}:${sound.id}`, { category: sound.mode === 'global' ? 'globalAmbient' : 'localizedAmbient', sound }));
    state.action.forEach((sound) => desired.set(`action:${sound.id}`, { category: 'action', sound }));
    state.event.forEach((sound) => desired.set(`event:${sound.id}`, { category: 'event', sound }));
    for (const [key, source] of this.sources) if (!desired.has(key)) this.#release(key, source);
    desired.forEach(({ category, sound }, key) => this.#update(key, category, sound, state.listener, state.timestampMs));
  }

  diagnostics(): AudioSourceDiagnostics[] {
    return [...this.sources.values()].filter((source): source is ManagedSource & { diagnostics: SpatialDiagnostics } => Boolean(source.diagnostics)).map((source) => ({
      ...source.diagnostics, runtimeId: source.runtimeId, assetId: source.assetId, category: source.category,
      playbackState: source.playbackState, gain: source.gainNode.gain.value,
    }));
  }

  dispose(): void { this.#playback.dispose(this.sources.values()); [...this.sources].forEach(([key, source]) => this.#release(key, source)); }

  #create(key: string, category: SourceCategory, sound: RuntimeSound): ManagedSource {
    const gainNode = this.#context.createGain();
    const spatializer = category === 'globalAmbient' ? null : this.#hrtf.createSpatializer();
    gainNode.connect(spatializer ?? this.#master);
    const source: ManagedSource = {
      key, runtimeId: sound.id, assetId: sound.assetId, category, gainNode, spatializer, input: gainNode,
      source: null, playing: false, activationPlayed: false, playbackState: 'idle', generation: 0,
    };
    source.onPlaybackEnded = () => { source.playbackState = 'stopped'; this.#onChange(); };
    this.sources.set(key, source); return source;
  }

  #update(key: string, category: SourceCategory, sound: RuntimeSound, listener: ListenerState, timestampMs: number): void {
    let source = this.sources.get(key);
    if (source && source.assetId !== sound.assetId) { this.#release(key, source); source = undefined; }
    source ??= this.#create(key, category, sound);
    const outputGain =
      category === 'globalAmbient' || category === 'localizedAmbient'
        ? sound.gain * AMBIENT_OUTPUT_GAIN
        : sound.gain;
    this.#gains.apply(source.gainNode.gain, outputGain, this.#context.currentTime);
    if (source.spatializer && sound.worldPosition) {
      source.diagnostics = this.#hrtf.update(key, source.spatializer, sound.worldPosition, listener.worldPosition, listener.orientation as Quaternion, this.#context.currentTime);
    }
    const shouldPlay = sound.active && (category !== 'event' || sound.lifecycle === 'active');
    if (!shouldPlay) {
      this.#playback.stop(source, this.#context.currentTime); this.#playback.resetActivation(source); source.playbackState = 'stopped'; return;
    }
    if (source.playing || source.playbackState === 'loading' || (source.activationPlayed && category !== 'globalAmbient' && category !== 'localizedAmbient')) return;
    source.playbackState = 'loading'; const generation = ++source.generation;
    void this.#assets.load(sound.assetId).then((result) => {
      if (source?.generation !== generation || this.sources.get(key) !== source) return;
      if (!result.ok) { source.playbackState = 'error'; source.error = result.error; this.#onChange(); return; }
      const loop = category !== 'event';
      if (this.#playback.start(source, result.buffer, loop, this.#audioTimeFor(timestampMs))) source.playbackState = 'playing';
      this.#onChange();
    });
  }

  #audioTimeFor(_timestampMs: number): number {
    // Replay/network delivery already occurs on the authoritative session timeline.
    return this.#context.currentTime;
  }

  #release(key: string, source: ManagedSource): void {
    source.generation += 1; this.#playback.stop(source, this.#context.currentTime); source.gainNode.disconnect();
    if (source.spatializer) this.#hrtf.release(key, source.spatializer);
    this.sources.delete(key);
  }
}
