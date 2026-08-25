import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { liveRuntimeClient } from '../network/liveRuntime.js';
import { runtimeStore } from '../runtime/RuntimeStore.js';
import {
  HomePage,
  type AdaptiveSessionIntent,
  type CalibrationSessionIntent,
  type SessionIntent,
} from '../ui/pages/HomePage.js';
import { LoadingPage } from '../ui/pages/LoadingPage.js';
import { PreviewPage } from '../ui/pages/PreviewPage.js';
import { SessionPage } from '../ui/pages/SessionPage.js';
import { SummaryPage } from '../ui/pages/SummaryPage.js';
import {
  recordingStore,
  sessionRecorder,
} from '../recording/recordingStore.js';
import {
  integrationHarness,
  longIntegrationHarness,
  spatialDiagnosticHarness,
} from '../integration/IntegrationHarness.js';
import { adaptiveIntegrationHarness } from '../integration/AdaptiveIntegrationHarness.js';
import { audioEngine } from '../audio/AudioEngine.js';
import {
  createStudyArtifactBundle,
  saveBundleToBackend,
} from '../study/StudyArtifacts.js';
import { studyArtifactStore } from '../study/studyArtifactStore.js';
import { liveSessionId } from '../network/liveRuntime.js';
import { CalibrationPage } from '../calibration/CalibrationPage.js';
import {
  LiveEegEpochSource,
  LiveRawEegRecorder,
  type RawEegRecordingSource,
  toPlannerCalibrationProfile,
} from '../calibration/integration.js';
import type { Profile } from '../calibration/types.js';
import {
  assignMatchedBasePlans,
  BASE_PLAN_VERSION,
} from '@neuroscape/adaptive-planner';

type Page =
  'home' | 'calibration' | 'loading' | 'preview' | 'session' | 'summary';
export function App() {
  const finalizing = useRef(false);
  const audioCaptureError = useRef<string | null>(null);
  const rawEegSource = useRef<RawEegRecordingSource | null>(null);
  const returnHomeAfterFinalize = useRef(false);
  const [page, setPage] = useState<Page>('home');
  const [calibrationIntent, setCalibrationIntent] =
    useState<CalibrationSessionIntent>({
      participantId: 'P001',
      durationMinutes: 10,
    });
  const [mode, setMode] = useState<
    | 'live'
    | 'adaptive'
    | 'non-adaptive'
    | 'demo'
    | 'long-demo'
    | 'diagnostic'
    | 'replay'
  >('live');
  const [realTimeRestartEnabled, setRealTimeRestartEnabled] = useState(false);
  const startAdaptiveAudio = async () => {
    try {
      await audioEngine.startRecording();
    } catch (error) {
      audioCaptureError.current =
        error instanceof Error ? error.message : String(error);
      console.error('Audio capture unavailable; session will continue.', error);
    }
    try {
      await audioEngine.playOpening();
    } catch (error) {
      console.error(
        'Meditation opening unavailable; session will continue.',
        error,
      );
    }
  };
  const sessionStatus = useStore(
    runtimeStore,
    (state) => state.sessionRuntime.status,
  );
  // Live commands connect lazily. Home, demo, and replay modes do not require a backend.
  useEffect(
    () => () => {
      liveRuntimeClient.disconnect();
      adaptiveIntegrationHarness.end(false);
      integrationHarness.end(false);
      longIntegrationHarness.end(false);
      spatialDiagnosticHarness.end(false);
    },
    [],
  );
  useEffect(() => {
    if (page === 'loading' && sessionStatus === 'preview') setPage('preview');
    if (sessionStatus === 'running') setPage('session');
    if (
      sessionStatus === 'ended' &&
      sessionRecorder.active &&
      !finalizing.current
    ) {
      finalizing.current = true;
      void (async () => {
        let audio = null;
        let rawEeg: Blob | null = null;
        const finalizationErrors: string[] = [];
        audioEngine.stopOpening();
        try {
          audio = await audioEngine.stopRecording();
        } catch (error) {
          audioCaptureError.current =
            error instanceof Error ? error.message : String(error);
          console.error(
            'Master-audio finalization failed; study data will still be saved.',
            error,
          );
        }
        try {
          rawEeg = (await rawEegSource.current?.rawCsv()) ?? null;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          finalizationErrors.push(`Raw EEG finalization failed: ${message}`);
          console.error('Raw EEG finalization failed.', error);
        }
        rawEegSource.current = null;
        const recording = recordingStore.stop();
        if (recording?.metadata.participantId) {
          const bundle = createStudyArtifactBundle(
            recording,
            audio,
            [
              ...(audioCaptureError.current ? [audioCaptureError.current] : []),
              ...finalizationErrors,
            ],
            rawEeg,
          );
          studyArtifactStore.setBundle(bundle);
          setPage(returnHomeAfterFinalize.current ? 'home' : 'summary');
          studyArtifactStore.setBackend({ status: 'saving' });
          try {
            const directory = await saveBundleToBackend(bundle);
            studyArtifactStore.setBackend({ status: 'saved', directory });
          } catch (error) {
            studyArtifactStore.setBackend({
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else setPage(returnHomeAfterFinalize.current ? 'home' : 'summary');
        returnHomeAfterFinalize.current = false;
        finalizing.current = false;
      })();
    }
  }, [page, sessionStatus]);
  const start = (intent: SessionIntent) => {
    setRealTimeRestartEnabled(false);
    setMode('live');
    recordingStore.start({
      sessionId: liveSessionId,
      userPrompt: intent.worldDescription,
      eegMode: intent.eegSource,
      startedAtIso: new Date().toISOString(),
    });
    liveRuntimeClient.sendCommand({ command: 'startSession', ...intent });
    setPage('loading');
  };
  const startDemo = () => {
    setRealTimeRestartEnabled(false);
    liveRuntimeClient.disconnect();
    setMode('demo');
    recordingStore.start({
      sessionId: `demo-${Date.now()}`,
      userPrompt: 'Deterministic forest integration scenario',
      eegMode: 'recorded',
      startedAtIso: new Date().toISOString(),
    });
    integrationHarness.start();
    setPage('session');
  };
  const startAdaptive = async (intent: AdaptiveSessionIntent) => {
    const assignment = assignMatchedBasePlans(intent.participantId);
    setRealTimeRestartEnabled(false);
    if (intent.plannerMode === 'openai') {
      try {
        const response = await fetch('/api/llm/health');
        const health = (await response.json()) as { configured?: boolean };
        if (!response.ok || !health.configured) {
          window.alert(
            'OpenAI planner is not configured. Add OPENAI_API_KEY to the repository-root .env file and restart npm run dev, or choose Offline mock.',
          );
          return;
        }
      } catch {
        window.alert(
          'The local OpenAI planner service is unavailable. Restart npm run dev or choose Offline mock.',
        );
        return;
      }
    }
    liveRuntimeClient.disconnect();
    setMode('adaptive');
    studyArtifactStore.reset();
    audioCaptureError.current = null;
    const sessionId = `session-${new Date().toISOString().replaceAll(/\D/g, '')}-${crypto.randomUUID().slice(0, 8)}`;
    runtimeStore.getState().resetSessionStreams();
    recordingStore.start({
      sessionId,
      participantId: intent.participantId,
      runMode: intent.runMode,
      plannerMode: intent.plannerMode,
      userPrompt: `10-minute Module 01/02 adaptive replay · ${intent.plannerMode}`,
      eegMode: 'recorded',
      startedAtIso: new Date().toISOString(),
      basePlanId: assignment.adaptiveBasePlanId,
      pairedBasePlanId: assignment.nonAdaptiveBasePlanId,
      basePlanVersion: BASE_PLAN_VERSION,
      basePlanProfileId: 'forest_restrained_v1',
      assignmentRuleVersion: assignment.assignmentRuleVersion,
      conditionOrder: assignment.conditionOrder,
      basePlanExecutionMode: 'structured-runtime',
    });
    adaptiveIntegrationHarness.start({
      sessionId,
      runMode: intent.runMode,
      plannerMode: intent.plannerMode,
      participantId: intent.participantId,
    });
    setPage('session');
    void startAdaptiveAudio();
  };
  const startCalibratedAdaptive = async (profile: Profile) => {
    const assignment = assignMatchedBasePlans(profile.participant_id);
    try {
      const response = await fetch('/api/llm/health');
      const health = (await response.json()) as { configured?: boolean };
      if (!response.ok || !health.configured)
        throw new Error(
          'OpenAI planner is not configured. Add OPENAI_API_KEY and restart npm run dev.',
        );
      const epochSource = new LiveEegEpochSource(profile.session_id);
      await epochSource.start();
      rawEegSource.current = epochSource;
      const plannerProfile = toPlannerCalibrationProfile(profile);
      liveRuntimeClient.disconnect();
      setMode('adaptive');
      setRealTimeRestartEnabled(true);
      studyArtifactStore.reset();
      audioCaptureError.current = null;
      const sessionId = `session-${new Date().toISOString().replaceAll(/\D/g, '')}-${crypto.randomUUID().slice(0, 8)}`;
      recordingStore.start({
        sessionId,
        participantId: profile.participant_id,
        runMode: 'study-realtime',
        plannerMode: 'openai',
        userPrompt: `10-minute adaptive session · live Muse EEG · calibration ${profile.session_id}`,
        eegMode: 'muse',
        startedAtIso: new Date().toISOString(),
        calibrationProfile: plannerProfile,
        basePlanId: assignment.adaptiveBasePlanId,
        pairedBasePlanId: assignment.nonAdaptiveBasePlanId,
        basePlanVersion: BASE_PLAN_VERSION,
        basePlanProfileId: 'forest_restrained_v1',
        assignmentRuleVersion: assignment.assignmentRuleVersion,
        conditionOrder: assignment.conditionOrder,
        basePlanExecutionMode: 'structured-runtime',
      });
      adaptiveIntegrationHarness.start({
        sessionId,
        runMode: 'study-realtime',
        plannerMode: 'openai',
        sessionDurationMs: 10 * 60_000,
        calibrationProfile: plannerProfile,
        epochSource,
        participantId: profile.participant_id,
      });
      setPage('session');
      void startAdaptiveAudio();
    } catch (error) {
      rawEegSource.current = null;
      window.alert(error instanceof Error ? error.message : String(error));
    }
  };
  const startLongDemo = () => {
    setRealTimeRestartEnabled(false);
    liveRuntimeClient.disconnect();
    setMode('long-demo');
    recordingStore.start({
      sessionId: `long-demo-${Date.now()}`,
      userPrompt: 'Long forest perceptual validation scenario',
      eegMode: 'recorded',
      startedAtIso: new Date().toISOString(),
    });
    longIntegrationHarness.start();
    setPage('session');
  };
  const startSpatialDiagnostic = () => {
    setRealTimeRestartEnabled(false);
    liveRuntimeClient.disconnect();
    setMode('diagnostic');
    recordingStore.start({
      sessionId: `diagnostic-${Date.now()}`,
      userPrompt: 'Spatial event HRTF diagnostic scenario',
      eegMode: 'recorded',
      startedAtIso: new Date().toISOString(),
    });
    spatialDiagnosticHarness.start();
    setPage('session');
  };
  const startNonAdaptive = async (participantId: string) => {
    const assignment = assignMatchedBasePlans(participantId);
    try {
      const recorder = new LiveRawEegRecorder();
      await recorder.start();
      rawEegSource.current = recorder;
    } catch (error) {
      rawEegSource.current = null;
      window.alert(error instanceof Error ? error.message : String(error));
      return;
    }
    liveRuntimeClient.disconnect();
    setMode('non-adaptive');
    setRealTimeRestartEnabled(false);
    studyArtifactStore.reset();
    audioCaptureError.current = null;
    const sessionId = `session-${new Date().toISOString().replaceAll(/\D/g, '')}-${crypto.randomUUID().slice(0, 8)}`;
    recordingStore.start({
      sessionId,
      participantId,
      runMode: 'non-adaptive',
      plannerMode: 'fixed',
      eegMode: 'muse',
      userPrompt:
        'Approved fixed 10-minute non-adaptive trajectory; Muse EEG is recorded for analysis but is not used for adaptation',
      startedAtIso: new Date().toISOString(),
      basePlanId: assignment.nonAdaptiveBasePlanId,
      pairedBasePlanId: assignment.adaptiveBasePlanId,
      basePlanVersion: BASE_PLAN_VERSION,
      basePlanProfileId: 'forest_restrained_v1',
      assignmentRuleVersion: assignment.assignmentRuleVersion,
      conditionOrder: assignment.conditionOrder,
      basePlanExecutionMode: 'structured-runtime',
    });
    adaptiveIntegrationHarness.start({
      sessionId,
      runMode: 'study-realtime',
      plannerMode: 'mock',
      participantId,
      condition: 'non-adaptive',
    });
    setPage('session');
    void startAdaptiveAudio();
  };
  if (page === 'home')
    return (
      <HomePage
        onRealTime={startCalibratedAdaptive}
        onNonAdaptive={startNonAdaptive}
        onCalibration={(intent) => {
          setCalibrationIntent(intent);
          setPage('calibration');
        }}
      />
    );
  if (page === 'calibration')
    return (
      <CalibrationPage
        initialParticipantId={calibrationIntent.participantId}
        onContinue={async () => setPage('home')}
        onHome={() => setPage('home')}
      />
    );
  if (page === 'loading') return <LoadingPage />;
  if (page === 'preview')
    return (
      <PreviewPage
        onEnter={() => {
          liveRuntimeClient.sendCommand({ command: 'resumeSession' });
          setPage('session');
        }}
      />
    );
  if (page === 'summary')
    return (
      <SummaryPage
        onHome={() => setPage('home')}
        onReplay={() => {
          setMode('replay');
          setPage('session');
        }}
      />
    );
  const restartCalibratedAdaptive = async (profile: Profile) => {
    adaptiveIntegrationHarness.end(false);
    recordingStore.stop();
    try {
      await audioEngine.stopRecording();
    } catch {
      // A missing/unsupported recording must not prevent a test restart.
    }
    await startCalibratedAdaptive(profile);
  };
  const returnFromSession = () => {
    if (sessionStatus === 'ended' || !sessionRecorder.active) setPage('home');
    else {
      returnHomeAfterFinalize.current = true;
      if (mode === 'adaptive' || mode === 'non-adaptive')
        adaptiveIntegrationHarness.end();
      else runtimeStore.getState().setSessionRuntime({ status: 'ended' });
    }
  };
  return (
    <SessionPage
      mode={mode}
      onHome={returnFromSession}
      onRestartRealTime={
        realTimeRestartEnabled ? restartCalibratedAdaptive : undefined
      }
    />
  );
}
