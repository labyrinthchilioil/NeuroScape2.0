import type {
  AdaptationDecision,
  AdaptationGoal,
  AdaptationScope,
  Decision2Input,
  DecisionContext,
  DecisionProvider,
  LlmUsage,
  PlanningProvider,
  PlanningResult,
  SoundscapePlanPatch,
} from './types.js';
import { reasoningAttentionState } from './types.js';

export const DECISION_1_PROMPT_VERSION = 'decision-1-reference-unbounded-v3';

const scopes: readonly AdaptationScope[] = [
  'maintain',
  'within-scene',
  'scene-transition',
];
const intents = [
  'gently_reorient_attention',
  'support_grounding',
  'reduce_stimulation',
  'support_sustained_focus',
  'refresh_engagement',
  'preserve_recovery',
  'maintain',
] as const;
const saliences = ['minimal', 'low', 'moderate'] as const;

interface Decision1WireOutput {
  decision: 'adapt' | 'maintain';
  intent: (typeof intents)[number];
  salience: (typeof saliences)[number];
  scope: AdaptationScope;
  evidence_summary: {
    position:
      | 'focus-leaning'
      | 'intermediate'
      | 'mind-wandering-leaning'
      | 'unavailable';
    trajectory:
      'improving' | 'stable' | 'declining' | 'volatile' | 'unavailable';
    confidence: 'high' | 'medium' | 'low';
  };
  reason: string;
  maintain_reason: string | null;
  constraints_for_decision_2: string[];
}

export const decision1OutputSchema: Record<string, unknown> = Object.freeze({
  name: 'neuroscape_decision_1',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'decision',
      'intent',
      'salience',
      'scope',
      'evidence_summary',
      'reason',
      'maintain_reason',
      'constraints_for_decision_2',
    ],
    properties: {
      decision: { type: 'string', enum: ['adapt', 'maintain'] },
      intent: { type: 'string', enum: intents },
      salience: { type: 'string', enum: saliences },
      scope: { type: 'string', enum: scopes },
      evidence_summary: {
        type: 'object',
        additionalProperties: false,
        required: ['position', 'trajectory', 'confidence'],
        properties: {
          position: {
            type: 'string',
            enum: [
              'focus-leaning',
              'intermediate',
              'mind-wandering-leaning',
              'unavailable',
            ],
          },
          trajectory: {
            type: 'string',
            enum: [
              'improving',
              'stable',
              'declining',
              'volatile',
              'unavailable',
            ],
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
      reason: { type: 'string' },
      maintain_reason: { type: ['string', 'null'] },
      constraints_for_decision_2: { type: 'array', items: { type: 'string' } },
    },
  },
});

export function buildDecision1Prompt(context: DecisionContext): string {
  return [
    'You are NeuroScape Decision 1: Should Adapt?',
    'Decide whether the current soundscape should be adapted at this eligible checkpoint.',
    'The deterministic eligibility gate has already approved an LLM assessment. Eligibility does not itself mean an adaptation is necessary.',
    'The two calibration values are empirical reference anchors, not lower and upper bounds.',
    'relativePosition is unbounded and is not a percentage or probability. Values below 0 or above 1 are valid directional positions.',
    'A large magnitude can result from weak calibration separation, so always interpret it together with calibration quality, raw distance, signal quality, and temporal trend.',
    'Do not infer a definitive mental state from a single checkpoint.',
    'Sustained focus does not automatically require maintain; low-salience supportive adaptation is allowed.',
    'Never invent mind wandering merely to justify a soundscape change.',
    'Use relative position, raw log-TBR deltas, trajectory, variability, measurement confidence, signal quality, scene history, stasis, and restrictions.',
    'For focus-leaning attention that is stable or improving, consider maintain, preserve_recovery, or a minimal support_sustained_focus evolution.',
    'For intermediate attention that is stable, a low-cost within-scene gently-reorient event may be appropriate when no recent intervention is awaiting effect.',
    'For intermediate attention trending toward mind-wandering, normally adapt with a gently-reorient within-scene intervention unless a restriction or recent intervention specifically argues against it.',
    'For high-confidence mind-wandering-leaning attention, normally adapt. Prefer gently-reorient for a new or brief deviation and support-grounding when the deviation is sustained across checkpoints.',
    'Escalate to refresh-engagement or a scene transition only after lighter interventions have not produced a durable improvement.',
    'Prefer maintain only when evidence is transient, already improving, low-confidence, or a recent intervention has not had enough time to take effect; do not maintain merely because the state is intermediate.',
    'Use within-scene adaptation before scene transition. Scene transition is a rare, high-salience intervention for sustained, severe mind-wandering after lighter interventions were insufficient, and only when restrictions allow it.',
    'Opening and closing phase restrictions are authoritative. Never request a forbidden event, body anchor, or scene transition.',
    'When stasisPressure is true, do not maintain indefinitely merely because evidence is focus-leaning; prefer minimal support_sustained_focus or refresh_engagement unless continuity constraints justify maintain.',
    'Low-confidence or unusable EEG cannot support a corrective claim. It may only support conservative history-driven evolution or maintain.',
    'If decision=maintain, intent must be maintain or preserve_recovery, scope must be maintain, and maintain_reason must be concrete.',
    'If decision=adapt, intent and scope must not be maintain. Pass salience and constraints_for_decision_2 without selecting assets.',
    'Maintain means preserving the currently scheduled Base Plan evolution; it never means freezing the current soundscape or cancelling scheduled future events.',
    'Use supplied prior outcomes only as non-causal, provisional observations. If the last applied patch is not yet observable, avoid stacking another intervention unless clearly necessary.',
    'Provide a concise, inspectable rationale based only on supplied observations. Do not claim objective mind-wandering detection and do not expose hidden chain-of-thought.',
    `INPUT_JSON=${JSON.stringify({
      eegState: reasoningAttentionState(context.state),
      recentAttentionStates: context.recentStates.map(reasoningAttentionState),
      currentPlan: context.currentPlan,
      recentAdaptations: context.history.slice(-6),
      restrictions: context.restrictions,
      secondsSinceLastMeaningfulChange:
        context.secondsSinceLastMeaningfulChange,
      stasisPressure: context.stasisPressure,
      transitionInProgress: context.transitionInProgress,
      relevantPriorOutcomes: context.relevantPriorOutcomes?.slice(0, 3) ?? [],
    })}`,
  ].join('\n');
}

interface OpenAIProxyResponse<T> {
  output: T;
  model: string;
  responseId: string;
  usage: LlmUsage;
}

export interface OpenAIProviderOptions {
  baseUrl?: string;
  sessionId?: string;
  fetchImpl?: typeof fetch;
}

async function requestStructuredOutput<T>(
  path: string,
  body: Record<string, unknown>,
  options: OpenAIProviderOptions,
): Promise<OpenAIProxyResponse<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl ?? ''}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, sessionId: options.sessionId }),
  });
  const payload = (await response.json()) as
    OpenAIProxyResponse<T> | { error?: string };
  if (!response.ok || !('output' in payload))
    throw new Error(
      `OpenAI planner request failed (${response.status}): ${
        'error' in payload && payload.error
          ? payload.error
          : response.statusText
      }`,
    );
  return payload;
}

function assertDecision1(
  value: Decision1WireOutput,
  context: DecisionContext,
): void {
  if (
    !intents.includes(value.intent) ||
    !saliences.includes(value.salience) ||
    !scopes.includes(value.scope)
  )
    throw new Error(
      'Decision 1 returned an unsupported intent, salience, or scope.',
    );
  if (
    (value.decision === 'maintain' &&
      (!['maintain', 'preserve_recovery'].includes(value.intent) ||
        value.scope !== 'maintain' ||
        !value.maintain_reason)) ||
    (value.decision === 'adapt' &&
      (value.intent === 'maintain' || value.scope === 'maintain'))
  )
    throw new Error(
      'Decision 1 returned an inconsistent decision/intent/scope.',
    );
  if (
    value.scope === 'scene-transition' &&
    !context.restrictions.allowSceneTransition
  )
    throw new Error('Decision 1 requested a forbidden scene transition.');
  if (
    value.intent === 'support_grounding' &&
    !context.restrictions.allowBodyAnchor
  )
    throw new Error('Decision 1 requested a forbidden body anchor.');
}

export class OpenAIDecisionProvider implements DecisionProvider {
  readonly #options: OpenAIProviderOptions;

  constructor(options: OpenAIProviderOptions = {}) {
    this.#options = options;
  }

  async decide(context: DecisionContext): Promise<AdaptationDecision> {
    const prompt = buildDecision1Prompt(context);
    const response = await requestStructuredOutput<Decision1WireOutput>(
      '/api/llm/decision-1',
      {
        promptVersion: DECISION_1_PROMPT_VERSION,
        prompt,
        outputSchema: decision1OutputSchema,
      },
      this.#options,
    );
    try {
      assertDecision1(response.output, context);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        decision: 'maintain',
        intent: 'maintain',
        salience: 'minimal',
        evidenceSummary: {
          position:
            context.state.label === 'uncertain'
              ? 'unavailable'
              : context.state.label,
          trajectory: context.state.trajectory,
          confidence: context.state.measurementConfidence,
        },
        reason: `decision_1_validation_error: ${reason}`,
        maintainReason: 'Invalid Decision 1 output; safe maintain fallback.',
        constraintsForDecision2: [],
        shouldAdapt: false,
        goal: 'maintain',
        scope: 'maintain',
        rationale: `Invalid Decision 1 output; safe maintain fallback. ${reason}`,
        provider: 'openai-validation-fallback',
        promptVersion: DECISION_1_PROMPT_VERSION,
        prompt,
        outputSchema: decision1OutputSchema,
        model: response.model,
        responseId: response.responseId,
        usage: response.usage,
      };
    }
    const goalByIntent: Record<Decision1WireOutput['intent'], AdaptationGoal> =
      {
        gently_reorient_attention: 'gently-reorient',
        support_grounding: 'support-grounding',
        reduce_stimulation: 'reduce-stimulation',
        support_sustained_focus: 'support-sustained-focus',
        refresh_engagement: 'refresh-engagement',
        preserve_recovery: 'preserve-recovery',
        maintain: 'maintain',
      };
    const decision: AdaptationDecision = {
      decision: response.output.decision,
      intent: response.output.intent,
      salience: response.output.salience,
      evidenceSummary: response.output.evidence_summary,
      reason: response.output.reason,
      maintainReason: response.output.maintain_reason,
      constraintsForDecision2: response.output.constraints_for_decision_2,
      shouldAdapt: response.output.decision === 'adapt',
      goal: goalByIntent[response.output.intent],
      scope: response.output.scope,
      rationale: response.output.reason,
      provider: 'openai-responses',
      promptVersion: DECISION_1_PROMPT_VERSION,
      prompt,
      outputSchema: decision1OutputSchema,
      model: response.model,
      responseId: response.responseId,
      usage: response.usage,
    };
    return decision;
  }
}

interface Decision2WireOutput {
  status: 'PATCH_PROPOSED' | 'NO_SAFE_PATCH';
  intent: AdaptationDecision['intent'];
  patchOperations: Array<{
    operation:
      'KEEP' | 'ADJUST' | 'RESCHEDULE' | 'REPLACE' | 'SUPPRESS' | 'INSERT';
    targetElementId: string | null;
    effectiveStartMs: number;
    transitionMs: number;
    replacementAssetId: string | null;
  }>;
  preservedElementIds: string[];
  adaptationHypothesis: Record<string, string>;
  reflectionUsed: {
    priorAdaptationIds: string[];
    lessonCode: string | null;
    lessonConfidence: 'high' | 'medium' | 'low' | 'unavailable';
  };
  reasonCodes: string[];
  patch: SoundscapePlanPatch & {
    journey?: SoundscapePlanPatch['journey'] | null;
  };
  selectedAssetIds: string[];
  rationale: string;
}

function normalizePatch(
  patch: Decision2WireOutput['patch'],
): SoundscapePlanPatch {
  const normalized: SoundscapePlanPatch = {
    reasoningSummary: patch.reasoningSummary,
  };
  if (patch.journey) normalized.journey = patch.journey;
  if (patch.upsertAmbient?.length)
    normalized.upsertAmbient = patch.upsertAmbient;
  if (patch.upsertAction?.length) normalized.upsertAction = patch.upsertAction;
  if (patch.upsertEvent?.length) normalized.upsertEvent = patch.upsertEvent;
  if (patch.removeIds?.length) normalized.removeIds = patch.removeIds;
  if (patch.transitionDurationMs !== undefined)
    normalized.transitionDurationMs = patch.transitionDurationMs;
  return normalized;
}

export class OpenAIPlanningProvider implements PlanningProvider {
  readonly #options: OpenAIProviderOptions;

  constructor(options: OpenAIProviderOptions = {}) {
    this.#options = options;
  }

  async plan(
    _context: DecisionContext,
    decision: AdaptationDecision,
    input: Decision2Input,
  ): Promise<PlanningResult> {
    const response = await requestStructuredOutput<Decision2WireOutput>(
      '/api/llm/decision-2',
      {
        promptVersion: input.promptVersion,
        prompt: input.prompt,
        outputSchema: input.outputSchema,
        reasoningEffort: input.reasoningEffort,
      },
      this.#options,
    );
    if (response.output.intent !== decision.intent)
      throw new Error('Decision 2 attempted to change Decision 1 intent.');
    return {
      patch: normalizePatch(response.output.patch),
      selectedAssetIds: response.output.selectedAssetIds,
      candidateAssetIds: input.candidates.map((candidate) => candidate.assetId),
      promptVersion: input.promptVersion,
      prompt: input.prompt,
      outputSchema: input.outputSchema,
      rationale: response.output.rationale,
      provider: 'openai-responses',
      model: response.model,
      responseId: response.responseId,
      usage: response.usage,
    };
  }
}
