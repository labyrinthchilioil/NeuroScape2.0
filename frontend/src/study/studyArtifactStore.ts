import type {
  BackendSaveState,
  StudyArtifactBundle,
} from './StudyArtifacts.js';

export interface StudyArtifactState {
  bundle: StudyArtifactBundle | null;
  backend: BackendSaveState;
}
let state: StudyArtifactState = { bundle: null, backend: { status: 'idle' } };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const studyArtifactStore = {
  getState: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reset: () => {
    state = { bundle: null, backend: { status: 'idle' } };
    emit();
  },
  setBundle: (bundle: StudyArtifactBundle) => {
    state = { bundle, backend: { status: 'idle' } };
    emit();
  },
  setBackend: (backend: BackendSaveState) => {
    state = { ...state, backend };
    emit();
  },
};
