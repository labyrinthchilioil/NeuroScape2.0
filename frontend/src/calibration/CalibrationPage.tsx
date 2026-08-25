import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import './calibration.css';
import { useLive } from './hooks/useLive';
import {
  api,
  type SavedCalibrationSession,
  type SelfReportPayload,
} from './services/api';
import type {
  CalibrationBlock,
  Condition,
  ConditionEvaluation,
  Profile,
  Status,
} from './types';

const fmt = (value: number | null | undefined, digits = 2) =>
  value == null ? '—' : value.toFixed(digits);
const timer = (value = 0) => {
  const seconds = Math.max(0, Math.ceil(value));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
};

const guidance: Record<
  'acclimation' | Condition,
  {
    title: string;
    chinese: string[];
    english: string[];
    repeat?: { chinese: string[]; english: string[] };
  }
> = {
  acclimation: {
    title: 'Acclimation｜适应阶段',
    chinese: [
      '我们先进行一分钟的适应。请闭上眼睛，保持自然呼吸，让身体逐渐稳定下来。',
      '你暂时不需要完成任何特别的任务，只需要适应现在的坐姿、头带和耳机。我会在一分钟结束后提醒你。',
    ],
    english: [
      'We’ll begin with a one-minute acclimation period. Please close your eyes and breathe naturally, allowing your body to settle.',
      'You do not need to perform any particular task right now. Simply get used to your posture, the headband, and the headphones. I’ll let you know when the minute is over.',
    ],
  },
  focused_meditation: {
    title: 'Focused Meditation｜专注冥想',
    chinese: [
      '接下来，请尝试将注意力集中在你的呼吸和自己的身体上。',
      '如果你不知道怎么做，可以试着慢慢感受自己的吸气和呼气，并数一数每次呼吸。',
      '请保持闭眼和身体静止。准备好后请告诉我，我会开始记录。',
    ],
    english: [
      'Now, try focusing your attention on your breathing and the sensations in your body.',
      'If you’re not sure how to start, try counting your breaths.',
      'Please keep your eyes closed and your head still. Let me know when you’re ready, and I’ll begin recording.',
    ],
    repeat: {
      chinese: [
        '接下来是另一个呼吸专注练习。请继续闭眼并保持头部不动，准备好后告诉我。',
      ],
      english: [
        'Next is another breath-focus block. Please keep your eyes closed and your head still, and let me know when you’re ready.',
      ],
    },
  },
  free_thought: {
    title: 'Free Thought｜自由思绪',
    chinese: [
      '接下来，请放松对注意力的控制，让思绪自然地流动。',
      '你不需要刻意选择或一直思考某一个主题。一个想法淡去时，就让其他想法自然出现。',
      '如果你不知道怎么开始，可以想一想即将到来的新学期：你有什么规划和期待？',
      '请继续保持闭眼和身体静止。准备好后请告诉我，我会开始记录。',
    ],
    english: [
      'Next, try not to control your attention. Just let your thoughts flow naturally.',
      'You don’t need to choose a topic or keep thinking about the same thing. When one thought fades, simply let another arise.',
      'If you’re not sure how to begin, think about the upcoming semester. What plans or expectations do you have?',
      'Again, please keep your eyes closed and your head still. Let me know when you’re ready, and I’ll begin recording.',
    ],
    repeat: {
      chinese: [
        '接下来是另一个自由思绪练习。请继续闭眼并保持头部不动，准备好后告诉我。',
      ],
      english: [
        'Next is another free-thought block. Please keep your eyes closed and your head still, and let me know when you’re ready.',
      ],
    },
  },
};

function Metric({
  label,
  value,
  tone = '',
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SavedProfileLauncher({
  onContinue,
}: {
  onContinue: (profile: Profile) => void | Promise<void>;
}) {
  const [sessions, setSessions] = useState<SavedCalibrationSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    void api
      .sessions()
      .then((items) => {
        const completed = items.filter((item) => item.completed_at);
        setSessions(completed);
        setSessionId(completed[0]?.session_id ?? '');
      })
      .catch((reason) =>
        setLoadError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setLoading(false));
  }, []);

  const start = async () => {
    if (!sessionId) return;
    setStarting(true);
    setLoadError('');
    try {
      const details = await api.session(sessionId);
      if (!details.profile || details.profile_compatible === false)
        throw new Error(
          details.profile_error ||
            'This session has no compatible calibration profile.',
        );
      if (!details.profile.ready_to_continue)
        throw new Error(
          'This calibration profile is not ready for a real-time session.',
        );
      await onContinue(details.profile);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="panel saved-profile-launcher">
      <div>
        <p className="eyebrow">EXISTING CALIBRATION</p>
        <h2>Run real-time again</h2>
        <p>Select a saved profile from data/sessions and skip calibration.</p>
      </div>
      <div className="saved-profile-controls">
        <select
          aria-label="Saved calibration profile"
          value={sessionId}
          onChange={(event) => setSessionId(event.target.value)}
          disabled={loading || starting}
        >
          {!sessions.length && (
            <option value="">
              {loading
                ? 'Loading saved profiles…'
                : 'No completed profiles found'}
            </option>
          )}
          {sessions.map((item) => (
            <option value={item.session_id} key={item.session_id}>
              {item.participant_id} · {item.session_id}
            </option>
          ))}
        </select>
        <button disabled={!sessionId || starting} onClick={() => void start()}>
          {starting ? 'Starting…' : 'Enter Real-Time with Saved Profile'}
        </button>
      </div>
      {loadError && (
        <p className="saved-profile-error" role="alert">
          {loadError}
        </p>
      )}
    </section>
  );
}

function Shell({
  children,
  status,
  onHome,
}: {
  children: React.ReactNode;
  status: Status | null;
  onHome?: () => void;
}) {
  return (
    <div className="calibration-root app-shell">
      <header>
        <div className="brand-mark">N</div>
        <div>
          <p className="eyebrow">LOCAL INVESTIGATOR TOOL</p>
          <h1>NeuroScape Calibration</h1>
        </div>
        {onHome && <button onClick={onHome}>Return Home</button>}
        <div
          className={`connection-pill ${status?.connection.connected ? 'online' : ''}`}
        >
          <i />
          {status?.connection.connected ? 'Muse streaming' : 'Not connected'}
        </div>
      </header>
      <main>{children}</main>
      <footer>
        Local processing only <span>•</span> Mind Monitor OSC <span>•</span>{' '}
        Median-based participant anchors
      </footer>
    </div>
  );
}

function ContactGrid({ status }: { status: Status }) {
  return (
    <div className="contact-grid">
      {['TP9', 'AF7', 'AF8', 'TP10'].map((channel) => {
        const value = status.connection.hsi[channel];
        return (
          <div
            className={`contact ${value === 4 ? 'bad' : value == null ? '' : 'good'}`}
            key={channel}
          >
            <span>{channel}</span>
            <strong>{value ?? '—'}</strong>
            <small>
              {value == null
                ? 'Waiting'
                : value === 4
                  ? 'Poor contact'
                  : 'Contact detected'}
            </small>
          </div>
        );
      })}
    </div>
  );
}

function Waveform({ status }: { status: Status }) {
  const unavailable = !status.connection.connected
    ? [
        'No active EEG stream.',
        'Start Mind Monitor OSC streaming to receive real /muse/eeg packets.',
      ]
    : status.connection.headband_on !== true
      ? [
          'Headband is not being worn.',
          'Waveform preview is hidden until HeadBandOn is Yes.',
        ]
      : [
          'Waiting for frontal samples.',
          'The preview appears when valid AF7 and AF8 packets arrive.',
        ];
  return (
    <section className="panel waveform-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">LIVE PREVIEW · DOWNSAMPLED</p>
          <h2>Frontal waveform</h2>
        </div>
        <div className="legend">
          <span className="af7">AF7</span>
          <span className="af8">AF8</span>
        </div>
      </div>
      {status.waveform.length ? (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={status.waveform}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="sample_index" hide />
            <YAxis width={48} domain={['auto', 'auto']} />
            <Tooltip labelFormatter={(value) => `Sample ${value}`} />
            <Line
              dataKey="af7"
              dot={false}
              stroke="#277769"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            <Line
              dataKey="af8"
              dot={false}
              stroke="#d17b43"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="empty-chart">
          <div className="trace-icon">⌁</div>
          <p>{unavailable[0]}</p>
          <small>{unavailable[1]}</small>
        </div>
      )}
    </section>
  );
}

function ConnectionPage({
  status,
  onProceed,
  initialParticipantId,
}: {
  status: Status;
  onProceed: () => void;
  initialParticipantId: string;
}) {
  const [participant, setParticipant] = useState(initialParticipantId);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const [error, setError] = useState('');
  const normalized = participant.trim().toUpperCase();
  const validParticipant = /^P0*[1-9][0-9]*$/.test(normalized);
  const participantNumber = validParticipant
    ? Number(normalized.slice(1))
    : null;
  const previewOrder =
    participantNumber == null ? null : participantNumber % 2 ? 'A' : 'B';
  const act = async (task: () => Promise<unknown>) => {
    setError('');
    try {
      await task();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const test = () =>
    act(async () => {
      setTesting(true);
      try {
        setTestResult(await api.test());
      } finally {
        setTesting(false);
      }
    });
  const age = status.connection.last_packet_age_seconds;
  return (
    <div className="page-grid">
      <section className="intro">
        <p className="eyebrow">STEP 1 OF 3</p>
        <h2>Connect and assign.</h2>
        <p>
          Create a pseudonymous participant record, verify real Muse data, then
          begin the investigator-led protocol.
        </p>
      </section>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <section className="panel setup-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MIND MONITOR SETUP</p>
            <h2>Network destination</h2>
          </div>
          <span className="step-number">01</span>
        </div>
        <div className="destination">
          <div>
            <span>Computer IPv4</span>
            <strong>{status.local_ipv4}</strong>
          </div>
          <div>
            <span>OSC UDP port</span>
            <strong>{status.osc_port}</strong>
          </div>
        </div>
        <ol>
          <li>Connect phone and computer to the same Wi-Fi.</li>
          <li>
            Set Mind Monitor OSC IP to <b>{status.local_ipv4}</b> and port to{' '}
            <b>{status.osc_port}</b>.
          </li>
          <li>Enable RAW EEG, wear Muse 2, and start OSC streaming.</li>
        </ol>
      </section>
      <section className="panel session-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PSEUDONYMOUS RECORD</p>
            <h2>Participant assignment</h2>
          </div>
          <span className="step-number">02</span>
        </div>
        {status.session ? (
          <div className="session-created">
            <span>
              Active session · Order {status.session.calibration_order}
            </span>
            <strong>{status.session.participant_id}</strong>
            <code>{status.session.session_id}</code>
          </div>
        ) : (
          <>
            <label htmlFor="participant">Participant ID</label>
            <div className="input-row">
              <input
                id="participant"
                value={participant}
                onChange={(event) => setParticipant(event.target.value)}
                placeholder="e.g. P1"
              />
              <button
                disabled={!validParticipant}
                onClick={() => act(() => api.create(normalized))}
              >
                Create Session
              </button>
            </div>
            <small>
              Use P followed by a positive integer.{' '}
              {previewOrder
                ? `${normalized} will be assigned to Order ${previewOrder}.`
                : 'Odd IDs use Order A; even IDs use Order B.'}
            </small>
          </>
        )}
      </section>
      <section className="panel signal-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">REAL-TIME INTAKE</p>
            <h2>Signal status</h2>
          </div>
          <span className="step-number">03</span>
        </div>
        <div className="metrics">
          <Metric
            label="EEG samples"
            value={status.connection.total_eeg_samples.toLocaleString()}
          />
          <Metric
            label="Sample rate"
            value={`${fmt(status.connection.estimated_sample_rate_hz, 1)} Hz`}
            tone={status.connection.low_rate_warning ? 'warn' : ''}
          />
          <Metric
            label="Last packet"
            value={age == null ? 'Never' : `${fmt(age, 1)} s ago`}
          />
          <Metric
            label="HeadBandOn"
            value={
              status.connection.headband_on == null
                ? 'Unknown'
                : status.connection.headband_on
                  ? 'Yes'
                  : 'No'
            }
          />
          <Metric
            label="Completeness"
            value={`${fmt(status.connection.packet_completeness * 100, 0)}%`}
          />
          <Metric
            label="Malformed"
            value={status.connection.malformed_messages}
          />
        </div>
        <h3>Contact quality (HSI)</h3>
        <ContactGrid status={status} />
        {status.connection.low_rate_warning && (
          <div className="alert warning">
            Incoming rate is below 90% of the expected 256 Hz.
          </div>
        )}
        <div className="actions">
          <button
            className="secondary"
            disabled={!status.session || testing}
            onClick={test}
          >
            {testing ? 'Testing real data… 10 s' : 'Test Connection'}
          </button>
          <button disabled={status.state !== 'READY'} onClick={onProceed}>
            Proceed to Protocol
          </button>
        </div>
        {testResult && (
          <div className={`test-result ${testResult.ready ? 'pass' : 'fail'}`}>
            <strong>
              {testResult.ready ? 'Connection passed' : 'Connection not ready'}
            </strong>
            <span>{String(testResult.message)}</span>
            <small>
              {Number(testResult.sample_count).toLocaleString()} samples ·{' '}
              {fmt(Number(testResult.estimated_sample_rate_hz), 1)} Hz · filter{' '}
              {testResult.filter_success ? 'passed' : 'failed'}
            </small>
          </div>
        )}
      </section>
      <Waveform status={status} />
    </div>
  );
}

function GuidancePanel({
  kind,
  repeated = false,
}: {
  kind: 'acclimation' | Condition;
  repeated?: boolean;
}) {
  const item = guidance[kind];
  const script = repeated && item.repeat ? item.repeat : item;
  return (
    <section className="panel guidance-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">VERBAL GUIDANCE · READ ALOUD</p>
          <h2>{item.title}</h2>
        </div>
      </div>
      <div className="guidance-columns">
        <div lang="zh">
          <h3>中文</h3>
          {script.chinese.map((text) => (
            <p key={text}>“{text}”</p>
          ))}
        </div>
        <div lang="en">
          <h3>English</h3>
          {script.english.map((text) => (
            <p key={text}>“{text}”</p>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProtocolProgress({ status }: { status: Status }) {
  const completed = status.protocol.completed_blocks;
  return (
    <section className="panel protocol-progress">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            CALIBRATION ORDER {status.protocol.calibration_order}
          </p>
          <h2>Four planned blocks</h2>
        </div>
        <b>{completed.filter((block) => !block.is_redo).length}/4 complete</b>
      </div>
      <div className="schedule-grid">
        {status.protocol.original_schedule.map((task) => {
          const record = completed.find(
            (block) => block.task_id === task.task_id,
          );
          const active =
            status.protocol.current_block?.task_id === task.task_id;
          return (
            <div
              className={`schedule-card ${record ? 'complete' : active ? 'active' : ''}`}
              key={task.task_id}
            >
              <span>{task.sequence_number.toString().padStart(2, '0')}</span>
              <strong>{task.condition_label}</strong>
              <small>
                {record
                  ? `${record.subjective_validity?.status} · EEG ${record.eeg_quality?.status}`
                  : active
                    ? 'Recording'
                    : 'Pending'}
              </small>
            </div>
          );
        })}
      </div>
      {status.protocol.next_block?.is_redo && (
        <div className="redo-callout">
          <strong>Additional block required</strong>
          <span>
            {status.protocol.next_block.condition_label} redo ·{' '}
            {status.protocol.next_block.redo_reason?.join(', ')}
          </span>
        </div>
      )}
    </section>
  );
}

function RatingButtons({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="rating-buttons">
      {[1, 2, 3, 4, 5, 6, 7].map((score) => (
        <button
          type="button"
          className={value === score ? 'selected' : 'secondary'}
          aria-pressed={value === score}
          disabled={disabled}
          onClick={() => onChange(score)}
          key={score}
        >
          {score}
        </button>
      ))}
    </div>
  );
}

function SelfReportPanel({
  block,
  submit,
  busy,
}: {
  block: CalibrationBlock;
  submit: (payload: SelfReportPayload) => void;
  busy: boolean;
}) {
  const [mindWandering, setMindWandering] = useState<number | null>(null);
  const [drowsiness, setDrowsiness] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [unable, setUnable] = useState(false);
  const canSubmit = unable || (mindWandering != null && drowsiness != null);
  return (
    <section className="panel self-report-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            INVESTIGATOR ENTRY · {block.condition_label.toUpperCase()}
          </p>
          <h2>Block self-report</h2>
        </div>
        <span className="quality-chip">
          Block {block.condition_block_number}
          {block.is_redo ? ' · redo' : ''}
        </span>
      </div>
      <fieldset disabled={unable || busy}>
        <legend>Q1 · Mind wandering</legend>
        <p>在刚才这段练习中，你觉得自己在多大程度上出现了 mind wandering?</p>
        <small>1 = 完全没有 · 7 = 几乎整个过程都是如此</small>
        <RatingButtons
          value={mindWandering}
          onChange={setMindWandering}
          disabled={unable || busy}
        />
      </fieldset>
      <fieldset disabled={unable || busy}>
        <legend>Q2 · Drowsiness｜困倦程度</legend>
        <p>在刚才这段练习中，你在多大程度上感到困倦、昏沉或快要睡着？</p>
        <small>1 = 完全没有 · 7 = 非常明显</small>
        <RatingButtons
          value={drowsiness}
          onChange={setDrowsiness}
          disabled={unable || busy}
        />
      </fieldset>
      <label className="checkbox unable-check">
        <input
          type="checkbox"
          checked={unable}
          onChange={(event) => setUnable(event.target.checked)}
        />{' '}
        Participant is unable to judge this block
      </label>
      <label htmlFor="notes">Investigator notes · optional</label>
      <textarea
        id="notes"
        rows={4}
        maxLength={2000}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Equipment adjustment, interruption, observation, or protocol note"
      />
      <div className="actions">
        <button
          disabled={!canSubmit || busy}
          onClick={() =>
            submit({
              mind_wandering: unable ? null : mindWandering,
              drowsiness: unable ? null : drowsiness,
              investigator_notes: notes,
              unable_to_judge: unable,
            })
          }
        >
          {busy ? 'Saving and evaluating…' : 'Submit Self-report & Continue'}
        </button>
      </div>
    </section>
  );
}

function LiveQuality({ status }: { status: Status }) {
  const blinkLabel = status.connection.blink_events_current_or_last_label
    ? `Blink events · ${status.connection.blink_events_current_or_last_label}`
    : 'Blink events · current/last';
  const lastBlink =
    status.connection.last_blink_age_seconds == null
      ? 'None received'
      : status.connection.last_blink_age_seconds < 1
        ? 'Just now'
        : `${fmt(status.connection.last_blink_age_seconds, 1)} s ago`;
  return (
    <section className="panel live-quality">
      <div className="section-heading">
        <div>
          <p className="eyebrow">INVESTIGATOR CHECKS</p>
          <h2>Live acquisition quality</h2>
        </div>
      </div>
      <div className="metrics">
        <Metric
          label="Sample rate"
          value={`${fmt(status.connection.estimated_sample_rate_hz, 1)} Hz`}
        />
        <Metric
          label="HeadBandOn"
          value={status.connection.headband_on ? 'Yes' : 'No'}
        />
        <Metric label="AF7 HSI" value={status.connection.hsi.AF7 ?? '—'} />
        <Metric label="AF8 HSI" value={status.connection.hsi.AF8 ?? '—'} />
        <Metric
          label={blinkLabel}
          value={
            status.connection.blink_events_current_or_last_recording ?? '—'
          }
        />
        <Metric
          label="Blink events · session"
          value={status.connection.blink_events_session}
        />
        <Metric label="Last blink event" value={lastBlink} />
      </div>
      <p className="live-monitor-note">
        Live blink events come from Mind Monitor and do not detect whether the
        eyes are closed. Final quality uses the number of 10-second epochs
        containing one or more blink events, not this raw event count.
      </p>
      <ContactGrid status={status} />
    </section>
  );
}

function ProtocolPage({ status }: { status: Status }) {
  const [override, setOverride] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const poor = ['AF7', 'AF8'].filter(
    (channel) => status.connection.hsi[channel] === 4,
  );
  const act = async (task: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await task();
      setOverride(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const next = status.protocol.next_block;
  const current = status.protocol.current_block;
  const latestAcclimation = status.protocol.acclimation_attempts.at(-1);
  const guidanceKind: 'acclimation' | Condition = [
    'READY',
    'ACCLIMATION',
    'ACCLIMATION_COMPLETE',
  ].includes(status.state)
    ? 'acclimation'
    : current?.condition || next?.condition || 'acclimation';
  const repeatedGuidance =
    guidanceKind !== 'acclimation' &&
    status.protocol.completed_blocks.some(
      (block) => block.condition === guidanceKind,
    );
  const recording = ['ACCLIMATION', 'BLOCK_RECORDING'].includes(status.state);
  const endEarly = () => {
    if (
      !window.confirm(
        'End this recording early? It will be marked incomplete and cannot enter the anchor.',
      )
    )
      return;
    void act(
      status.state === 'ACCLIMATION'
        ? api.endAcclimationEarly
        : api.endBlockEarly,
    );
  };
  return (
    <div className="page-grid">
      <section className="intro">
        <p className="eyebrow">
          STEP 2 OF 3 · ORDER {status.protocol.calibration_order}
        </p>
        <h2>Investigator-led calibration.</h2>
        <p>
          Read the bilingual script, confirm readiness, monitor the real signal,
          and complete self-report after every 75-second block.
        </p>
      </section>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <ProtocolProgress status={status} />
      {status.state !== 'SELF_REPORT' && (
        <GuidancePanel kind={guidanceKind} repeated={repeatedGuidance} />
      )}
      <section className="panel investigator-panel">
        <div className="state-row">
          <div>
            <p className="eyebrow">INVESTIGATOR ACTION</p>
            <span className={`state-badge ${status.state.toLowerCase()}`}>
              {status.state.replaceAll('_', ' ')}
            </span>
          </div>
          <div className="total-time">
            <span>{recording ? 'Time remaining' : 'Recorded block time'}</span>
            <strong>
              {recording
                ? timer(status.timing.active_remaining_seconds)
                : timer(status.timing.total_recorded_seconds)}
            </strong>
          </div>
        </div>
        {status.state === 'READY' && (
          <>
            <div className="phase-instruction">
              Read the acclimation guidance, confirm the participant is settled,
              then start the automatic 60-second timer.
            </div>
            <div className="control-row">
              <button
                disabled={busy || (poor.length > 0 && !override)}
                onClick={() => act(() => api.startAcclimation(override))}
              >
                Start Acclimation · 1:00
              </button>
            </div>
          </>
        )}
        {status.state === 'ACCLIMATION' && (
          <>
            <div className="phase-instruction">
              Acclimation is recording. Monitor contact quality and obvious
              movement; these data will not enter either anchor.
            </div>
            <div className="active-timer">
              {timer(status.timing.active_remaining_seconds)}
            </div>
            <div className="control-row">
              <button
                className="danger ghost"
                disabled={busy}
                onClick={endEarly}
              >
                End Early
              </button>
            </div>
          </>
        )}
        {status.state === 'ACCLIMATION_COMPLETE' && (
          <>
            <div className="phase-instruction">
              Review signal stability. Accept the full attempt or adjust the
              equipment and repeat acclimation.
            </div>
            {latestAcclimation &&
              !latestAcclimation.completed_automatically && (
                <div className="alert warning">
                  This attempt ended early and must be repeated.
                </div>
              )}
            <div className="control-row">
              <button
                disabled={busy || !latestAcclimation?.completed_automatically}
                onClick={() => act(api.acceptAcclimation)}
              >
                Accept & Continue
              </button>
              <button
                className="secondary"
                disabled={busy || (poor.length > 0 && !override)}
                onClick={() => act(() => api.repeatAcclimation(override))}
              >
                Repeat Acclimation
              </button>
            </div>
          </>
        )}
        {status.state === 'BLOCK_READY' && next && (
          <>
            <div className="phase-instruction">
              Next: {next.condition_label} {next.condition_block_number}
              {next.is_redo ? ' (redo)' : ''}. Read the{' '}
              {repeatedGuidance ? 'brief reminder' : 'full guidance'} and wait
              for the participant to say they are ready.
            </div>
            <div className="control-row">
              <button
                disabled={busy || (poor.length > 0 && !override)}
                onClick={() => act(() => api.startBlock(override))}
              >
                Start {next.condition_label} · 1:15
              </button>
            </div>
          </>
        )}
        {status.state === 'BLOCK_RECORDING' && current && (
          <>
            <div className="phase-instruction">
              {current.condition_label} is recording. Do not provide further
              verbal prompts. Continue monitoring EEG quality.
            </div>
            <div className="active-timer">
              {timer(status.timing.active_remaining_seconds)}
            </div>
            <div className="control-row">
              <button
                className="danger ghost"
                disabled={busy}
                onClick={endEarly}
              >
                End Early
              </button>
            </div>
          </>
        )}
        {status.state === 'ERROR' && (
          <div className="alert error">
            Processing failed. All recorded files remain local. Reset before
            starting another session.
          </div>
        )}
        {poor.length > 0 && !recording && (
          <div className="alert warning">
            <strong>Poor HSI: {poor.join(', ')}</strong>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={override}
                onChange={(event) => setOverride(event.target.checked)}
              />{' '}
              Record investigator quality override and allow the next start
            </label>
          </div>
        )}
      </section>
      {status.state === 'SELF_REPORT' && current && (
        <SelfReportPanel
          block={current}
          busy={busy}
          submit={(payload) => void act(() => api.submitSelfReport(payload))}
        />
      )}
      <LiveQuality status={status} />
      <Waveform status={status} />
    </div>
  );
}

const processingSteps = [
  ['block_selection', 'Select blocks that pass self-report and EEG quality'],
  [
    'median_anchor_calculation',
    'Calculate median Focused Meditation and Free Thought anchors',
  ],
  [
    'median_anchor_calculation',
    'Calculate pooled MAD and pilot separation indicators',
  ],
  ['profile_generation', 'Save the versioned local calibration profile'],
] as const;

function ProcessingPage({ status }: { status: Status }) {
  const order = [
    'block_selection',
    'median_anchor_calculation',
    'profile_generation',
    'complete',
  ];
  const current = order.indexOf(status.processing_stage || 'block_selection');
  return (
    <div className="page-grid">
      <section className="intro">
        <p className="eyebrow">PROCESSING</p>
        <h2>Building participant anchors.</h2>
        <p>
          Self-report gates block inclusion but is never numerically added to
          EEG.
        </p>
      </section>
      <section className="panel processing-panel">
        {processingSteps.map(([stage, label], index) => {
          const stageIndex = order.indexOf(stage);
          const itemState =
            current > stageIndex
              ? 'done'
              : current === stageIndex
                ? 'active'
                : 'pending';
          return (
            <div
              className={`processing-step ${itemState}`}
              key={`${stage}-${index}`}
            >
              <i>{itemState === 'done' ? '✓' : index + 1}</i>
              <span>{label}</span>
              <b>{itemState}</b>
            </div>
          );
        })}
      </section>
    </div>
  );
}

const conditionTitle: Record<Condition, string> = {
  focused_meditation: 'Focused Meditation',
  free_thought: 'Free Thought',
};

function ConditionQualityCard({
  condition,
  detail,
}: {
  condition: Condition;
  detail: ConditionEvaluation;
}) {
  const validPercent = detail.total_epochs
    ? (detail.valid_epochs / detail.total_epochs) * 100
    : 0;
  return (
    <article className="condition-quality-card">
      <div className="condition-quality-heading">
        <div>
          <p className="eyebrow">{conditionTitle[condition].toUpperCase()}</p>
          <h3>
            {detail.valid_epochs}/{detail.total_epochs} valid epochs
          </h3>
        </div>
        <strong
          className={detail.status === 'pass' ? 'pass-text' : 'fail-text'}
        >
          {detail.status === 'pass' ? 'PASS' : 'REVIEW'}
        </strong>
      </div>
      <div className="quality-row">
        <span>Usable epochs</span>
        <b>{Math.round(validPercent)}%</b>
      </div>
      <div className="quality-bar">
        <i className="valid" style={{ width: `${validPercent}%` }} />
      </div>
      <div className="quality-row">
        <span>Blink-flagged epochs · informational</span>
        <b>{detail.blink_epochs}</b>
      </div>
      <div className="rejection-summary">
        <span>Selected blocks</span>
        <small>{detail.selected_block_ids.join(', ') || 'None'}</small>
      </div>
      {detail.issues.length > 0 && (
        <div className="reason-list">
          {detail.issues.map((issue) => (
            <span key={issue}>{issue.replaceAll('_', ' ')}</span>
          ))}
        </div>
      )}
    </article>
  );
}

function BlockReview({ block }: { block: CalibrationBlock }) {
  return (
    <article
      className={`block-review ${block.included_in_anchor ? 'included' : ''}`}
    >
      <div>
        <p className="eyebrow">
          {block.condition_label.toUpperCase()} ·{' '}
          {block.is_redo ? 'REDO' : `BLOCK ${block.condition_block_number}`}
        </p>
        <h3>
          {block.included_in_anchor ? 'Included in anchor' : 'Not included'}
        </h3>
      </div>
      <div className="block-review-grid">
        <span>
          MW <b>{block.self_report?.mind_wandering ?? '—'}</b>
        </span>
        <span>
          Drowsiness <b>{block.self_report?.drowsiness ?? '—'}</b>
        </span>
        <span>
          Subjective <b>{block.subjective_validity?.status ?? '—'}</b>
        </span>
        <span>
          Ideal distance <b>{block.subjective_ideal_distance ?? '—'}</b>
        </span>
        <span>
          EEG{' '}
          <b>
            {block.eeg_quality
              ? `${block.eeg_quality.valid_epochs}/${block.eeg_quality.expected_epochs}`
              : '—'}
          </b>
        </span>
        <span>
          Blink events <b>{block.blink_event_count ?? '—'}</b>
        </span>
        <span>
          Blink epochs <b>{block.eeg_quality?.blink_epochs ?? '—'}</b>
        </span>
        <span>
          Auto-ended <b>{block.completed_automatically ? 'Yes' : 'No'}</b>
        </span>
      </div>
      {block.self_report?.investigator_notes && (
        <p className="investigator-note">
          Note: {block.self_report.investigator_notes}
        </p>
      )}
    </article>
  );
}

function ResultsPage({
  profile,
  onNew,
  onContinue,
}: {
  profile: Profile;
  onNew: () => void;
  onContinue: (profile: Profile) => void | Promise<void>;
}) {
  const focused = profile.quality.condition_summary.focused_meditation;
  const free = profile.quality.condition_summary.free_thought;
  const chart = useMemo(
    () =>
      Array.from(
        { length: Math.max(focused.epoch_tbrs.length, free.epoch_tbrs.length) },
        (_, index) => ({
          epoch: index + 1,
          focused: focused.epoch_tbrs[index],
          freeThought: free.epoch_tbrs[index],
        }),
      ),
    [focused.epoch_tbrs, free.epoch_tbrs],
  );
  const base = `/api/calibration/sessions/${profile.session_id}`;
  return (
    <div className="page-grid">
      <section className="intro">
        <p className="eyebrow">STEP 3 OF 3</p>
        <h2>Calibration results.</h2>
        <p>
          These are task-elicited, participant-reported reference conditions—not
          objective ground truth for spontaneous mind wandering.
        </p>
      </section>
      <section
        className={`quality-banner ${profile.ready_to_continue ? 'valid' : 'invalid'}`}
        role="status"
        aria-live="polite"
      >
        <div>
          <span>
            {profile.ready_to_continue
              ? 'CALIBRATION COMPLETE'
              : 'COLLECTION INSUFFICIENT'}
          </span>
          <strong>
            {profile.ready_to_continue
              ? 'Calibration profile created successfully'
              : 'Do not continue'}
          </strong>
        </div>
        <div className="quality-banner-detail">
          <p>{profile.mapping_explanation}</p>
          {profile.ready_to_continue && (
            <button
              className="adaptive-system-button"
              onClick={() => onContinue(profile)}
            >
              Return Home
            </button>
          )}
        </div>
      </section>
      <section className="panel quality-report">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CALIBRATION QUALITY</p>
            <h2>Block and condition review</h2>
          </div>
          <span
            className={`quality-chip ${profile.ready_to_continue ? 'pass' : 'fail'}`}
          >
            {profile.mapping_status} mapping
          </span>
        </div>
        <div className="quality-condition-grid">
          <ConditionQualityCard
            condition="focused_meditation"
            detail={focused}
          />
          <ConditionQualityCard condition="free_thought" detail={free} />
        </div>
        <div className="quality-overview">
          <Metric
            label="Packet completeness"
            value={`${fmt(profile.quality.packet_completeness * 100, 1)}%`}
          />
          <Metric
            label="Valid frontal channels"
            value={`${fmt(profile.quality.valid_frontal_fraction * 100, 1)}%`}
          />
          <Metric
            label="Minimum per condition"
            value={`${profile.quality.condition_policy.minimum_valid_epochs} epochs`}
          />
          <Metric
            label="P2P channel limit"
            value={`${profile.quality.peak_to_peak_threshold_uv} µV`}
          />
        </div>
        <div className="quality-note">
          <strong>Pilot-safe status:</strong> anchor separation is calculated
          and displayed, but δ_min, S_min, and the direction gate are
          intentionally not configured. Therefore a quality-valid collection is
          marked provisional rather than formally mapping-available.
        </div>
      </section>
      <section className="panel profile-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              FINAL CALIBRATION PROFILE · ORDER {profile.calibration_order}
            </p>
            <h2>Median participant anchors</h2>
          </div>
          <span className="feature-version">{profile.feature_version}</span>
        </div>
        <div className="profile-identifiers">
          <span>
            Participant <b>{profile.participant_id}</b>
          </span>
          <span>
            Session <b>{profile.session_id}</b>
          </span>
        </div>
        <div className="result-grid">
          <Metric
            label="Focused Meditation Anchor"
            value={fmt(profile.focused_meditation_anchor, 4)}
          />
          <Metric
            label="Free Thought Anchor"
            value={fmt(profile.free_thought_anchor, 4)}
          />
          <Metric
            label="Difference (Free − Focused)"
            value={fmt(profile.difference, 4)}
          />
          <Metric
            label="Direction"
            value={profile.direction?.replaceAll('_', ' ') || 'Unavailable'}
          />
          <Metric label="Pooled MAD" value={fmt(profile.pooled_mad, 4)} />
          <Metric
            label="Separation Score"
            value={fmt(profile.separation_score, 3)}
          />
          <Metric label="Mapping Status" value={profile.mapping_status} />
          <Metric
            label="Ready to Continue"
            value={profile.ready_to_continue ? 'Yes' : 'No'}
          />
        </div>
        <details className="profile-json">
          <summary>Show complete profile JSON</summary>
          <pre>{JSON.stringify(profile, null, 2)}</pre>
        </details>
      </section>
      <section className="panel block-report">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BLOCK REPORT</p>
            <h2>Why each block was included or excluded</h2>
          </div>
        </div>
        <div className="block-review-list">
          {profile.blocks.map((block) => (
            <BlockReview block={block} key={block.block_id} />
          ))}
        </div>
      </section>
      <section className="panel result-chart">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SELECTED EPOCH ANALYSIS</p>
            <h2>Frontal log-TBR by epoch</h2>
          </div>
          <div className="legend">
            <span className="af7">Focused</span>
            <span className="af8">Free Thought</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chart}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="epoch" />
            <YAxis width={55} />
            <Tooltip />
            <Line
              dataKey="focused"
              connectNulls={false}
              stroke="#277769"
              strokeWidth={2}
            />
            <Line
              dataKey="freeThought"
              connectNulls={false}
              stroke="#c87343"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <div className="disclaimer">
        Self-report checks condition manipulation and gates block inclusion. It
        is not added to EEG values and cannot provide per-epoch ground truth.
        These references are not medical, psychological, diagnostic, or
        objective attention measurements.
      </div>
      <div className="actions wide">
        <a
          className="button secondary"
          href={`${base}/files/calibration_profile.json`}
        >
          Download Profile
        </a>
        <a
          className="button secondary"
          href={`${base}/files/quality_report.json`}
        >
          Download Quality Report
        </a>
        <a
          className="button secondary"
          href={`${base}/files/calibration_record.json`}
        >
          Download Protocol Record
        </a>
        <a className="button secondary" href={`${base}/download`}>
          Download Session Data
        </a>
        <button className="ghost" onClick={onNew}>
          Start New Calibration
        </button>
      </div>
    </div>
  );
}

export function CalibrationPage({
  onContinue,
  onHome,
  initialParticipantId = '',
}: {
  onContinue: (profile: Profile) => void | Promise<void>;
  onHome?: () => void;
  initialParticipantId?: string;
}) {
  const [initial, setInitial] = useState<Status | null>(null);
  const status = useLive(initial);
  const [protocolView, setProtocolView] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .status()
      .then(setInitial)
      .catch((reason) => setError(reason.message));
  }, []);
  useEffect(() => {
    if (status?.state === 'COMPLETE')
      api
        .result()
        .then(setProfile)
        .catch((reason) => setError(reason.message));
  }, [status?.state]);
  if (error && !status)
    return (
      <Shell status={status} onHome={onHome}>
        <div className="fatal">
          <h2>Application unavailable</h2>
          <p>{error}</p>
        </div>
      </Shell>
    );
  if (!status)
    return (
      <Shell status={null} onHome={onHome}>
        <div className="loading">Opening local receiver…</div>
      </Shell>
    );
  const newCalibration = async () => {
    await api.reset();
    setProfile(null);
    setProtocolView(false);
    setError('');
  };
  const protocolStates = [
    'ACCLIMATION',
    'ACCLIMATION_COMPLETE',
    'BLOCK_READY',
    'BLOCK_RECORDING',
    'SELF_REPORT',
    'ERROR',
  ];
  let page: React.ReactNode;
  if (status.state === 'PROCESSING') page = <ProcessingPage status={status} />;
  else if (status.state === 'COMPLETE' && profile)
    page = (
      <ResultsPage
        profile={profile}
        onNew={newCalibration}
        onContinue={onContinue}
      />
    );
  else if (
    (protocolView && status.state === 'READY') ||
    protocolStates.includes(status.state)
  )
    page = <ProtocolPage status={status} />;
  else
    page = (
      <ConnectionPage
        status={status}
        initialParticipantId={initialParticipantId}
        onProceed={() => setProtocolView(true)}
      />
    );
  return (
    <Shell status={status} onHome={onHome}>
      {error && <div className="alert error global-error">{error}</div>}
      {page}
    </Shell>
  );
}
