import { afterEach, describe, expect, it } from 'vitest';
import { AdaptiveIntegrationHarness } from '../src/integration/AdaptiveIntegrationHarness.js';
import {
  createMockTbrReplay,
  mockCalibrationProfile,
} from '@neuroscape/adaptive-planner';
import { recordingStore } from '../src/recording/recordingStore.js';
import { runtimeStore } from '../src/runtime/RuntimeStore.js';

describe('Phase 1 adaptive end-to-end harness', () => {
  afterEach(() => {
    if (recordingStore.stop()) runtimeStore.getState().resetSessionStreams();
  });

  it('replays mock EEG through Decisions 1/2, Module 03, recording, and closing phase', async () => {
    const harness = new AdaptiveIntegrationHarness(runtimeStore, {
      set: () => 1,
      clear: () => undefined,
    });
    recordingStore.start({
      sessionId: 'adaptive-e2e',
      participantId: 'P001',
      runMode: 'mock-fast',
      userPrompt: 'adaptive e2e test',
      eegMode: 'recorded',
    });
    harness.start({
      sessionId: 'adaptive-e2e',
      runMode: 'mock-fast',
      plannerMode: 'mock',
    });
    for (let index = 0; index < 600; index += 1) await harness.tick(1_000);
    const recording = recordingStore.stop();
    expect(harness.getState().status).toBe('ended');
    expect(recording?.metadata.durationMs).toBe(600_000);
    expect(recording?.neuroStates).toHaveLength(60);
    expect(recording?.sceneJourneyPlans.length).toBeGreaterThan(1);
    expect(
      recording?.adaptiveTrace.some((entry) => entry.kind === 'decision-1'),
    ).toBe(true);
    expect(
      recording?.adaptiveTrace.some((entry) => entry.kind === 'decision-2'),
    ).toBe(true);
    expect(
      recording?.adaptiveTrace.some((entry) => entry.kind === 'plan-applied'),
    ).toBe(true);
    expect(
      recording?.adaptiveTrace.some(
        (entry) =>
          entry.kind === 'eligibility' &&
          entry.summary.includes('closing_phase'),
      ),
    ).toBe(true);
    expect(recording?.runtimeSnapshots.at(-1)?.timestampMs).toBe(600_000);
  });

  it('accepts a participant profile and live EEG epoch source', async () => {
    const replay = createMockTbrReplay();
    let index = 0;
    let polls = 0;
    const harness = new AdaptiveIntegrationHarness(runtimeStore, {
      set: () => 1,
      clear: () => undefined,
    });
    recordingStore.start({
      sessionId: 'adaptive-live-e2e',
      participantId: 'P1',
      runMode: 'study-realtime',
      plannerMode: 'mock',
      userPrompt: 'adaptive live e2e test',
      eegMode: 'muse',
      calibrationProfile: mockCalibrationProfile,
    });
    harness.start({
      sessionId: 'adaptive-live-e2e',
      runMode: 'study-realtime',
      plannerMode: 'mock',
      calibrationProfile: mockCalibrationProfile,
      epochSource: {
        next: async () => {
          polls += 1;
          return polls % 10 === 0 ? (replay[index++] ?? null) : null;
        },
      },
    });
    for (let tick = 0; tick < 600; tick += 1) await harness.tick(1_000);
    const recording = recordingStore.stop();
    expect(recording?.calibrationProfile?.profileId).toBe(
      mockCalibrationProfile.profileId,
    );
    expect(
      recording?.adaptiveTrace.some(
        (entry) => entry.kind === 'eeg-epoch' && entry.source === 'live-eeg',
      ),
    ).toBe(true);
  });

  it('runs the assigned Non-Adaptive Base Plan without Decision 1/2 or freezing its scheduled timeline', async () => {
    const harness = new AdaptiveIntegrationHarness(runtimeStore, {
      set: () => 1,
      clear: () => undefined,
    });
    recordingStore.start({
      sessionId: 'non-adaptive-base-plan',
      participantId: 'P002',
      runMode: 'non-adaptive',
      plannerMode: 'fixed',
      eegMode: 'muse',
    });
    harness.start({
      sessionId: 'non-adaptive-base-plan',
      participantId: 'P002',
      condition: 'non-adaptive',
      runMode: 'study-realtime',
      plannerMode: 'mock',
    });
    for (let tick = 0; tick < 600; tick += 1) await harness.tick(1_000);
    const recording = recordingStore.stop();
    expect(recording?.sceneJourneyPlans).toHaveLength(1);
    expect(recording?.sceneJourneyPlans[0]?.value.planningHorizonSec).toBe(600);
    expect(
      recording?.sceneJourneyPlans[0]?.value.soundscape.event.length,
    ).toBeGreaterThan(0);
    expect(
      recording?.adaptiveTrace.some(
        (entry) => entry.kind === 'decision-1' || entry.kind === 'decision-2',
      ),
    ).toBe(false);
    expect(recording?.runtimeSnapshots.at(-1)?.timestampMs).toBe(600_000);
  });
});
