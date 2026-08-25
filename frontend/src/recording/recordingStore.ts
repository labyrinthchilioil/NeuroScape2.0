import type { RecordedSession } from '@neuroscape/contracts';
import { runtimeStore } from '../runtime/RuntimeStore.js';
import {
  SessionRecorder,
  type RecordingStartOptions,
} from './SessionRecorder.js';

let current: RecordedSession | null = null;
const listeners = new Set<() => void>();
export const sessionRecorder = new SessionRecorder(runtimeStore);
export const recordingStore = {
  getState: () => current,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  start: (options: RecordingStartOptions) => {
    sessionRecorder.start(options);
    current = null;
    listeners.forEach((listener) => listener());
  },
  stop: () => {
    current = sessionRecorder.stop();
    listeners.forEach((listener) => listener());
    return current;
  },
  set: (recording: RecordedSession) => {
    current = recording;
    listeners.forEach((listener) => listener());
  },
};
