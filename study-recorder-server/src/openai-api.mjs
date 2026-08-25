const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

function usageFrom(response) {
  return {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
    reasoningTokens:
      response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

function errorMessage(payload, status) {
  return (
    payload?.error?.message ??
    payload?.error ??
    `OpenAI Responses API returned HTTP ${status}.`
  );
}

function outputTextFrom(response) {
  // `output_text` is a convenience property exposed by OpenAI SDKs. The raw
  // Responses REST payload returned by `fetch` stores text in
  // output[].content[].text, so support both representations.
  if (typeof response?.output_text === 'string' && response.output_text)
    return response.output_text;

  const parts = [];
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string')
        parts.push(content.text);
    }
  }
  return parts.join('');
}

function noOutputMessage(payload) {
  const refusal = (payload?.output ?? [])
    .flatMap((item) => item?.content ?? [])
    .find((content) => content?.type === 'refusal')?.refusal;
  if (refusal) return `OpenAI refused the structured response: ${refusal}`;

  const incompleteReason = payload?.incomplete_details?.reason;
  if (payload?.status === 'incomplete' || incompleteReason)
    return `OpenAI response was incomplete${
      incompleteReason ? ` (${incompleteReason})` : ''
    } and contained no structured output.`;

  const upstreamError = payload?.error;
  if (upstreamError)
    return `OpenAI response error${
      upstreamError.code ? ` [${upstreamError.code}]` : ''
    }: ${upstreamError.message ?? String(upstreamError)}`;

  const outputTypes = (payload?.output ?? [])
    .map((item) => item?.type)
    .filter(Boolean)
    .join(', ');
  return `OpenAI returned no structured output (status=${
    payload?.status ?? 'unknown'
  }, output_types=${outputTypes || 'none'}).`;
}

export function createOpenAIRequester(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  return async function requestOpenAI({
    stage,
    prompt,
    promptVersion,
    outputSchema,
    reasoningEffort: requestedReasoningEffort,
  }) {
    if (!apiKey)
      throw new Error(
        'OPENAI_API_KEY is not configured in the repository root .env file.',
      );
    const decisionOne = stage === 'decision-1';
    const model =
      (decisionOne
        ? process.env.OPENAI_DECISION_1_MODEL
        : process.env.OPENAI_DECISION_2_MODEL) ??
      process.env.OPENAI_MODEL ??
      'gpt-5.6';
    const reasoningEffort = decisionOne
      ? 'low'
      : requestedReasoningEffort === 'medium'
        ? 'medium'
        : 'low';
    const timeoutMs = Number(
      decisionOne
        ? (process.env.OPENAI_DECISION_1_TIMEOUT_MS ?? 15_000)
        : (process.env.OPENAI_DECISION_2_TIMEOUT_MS ?? 30_000),
    );
    const maxOutputTokens = Number(
      decisionOne
        ? (process.env.OPENAI_DECISION_1_MAX_OUTPUT_TOKENS ?? 900)
        : (process.env.OPENAI_DECISION_2_MAX_OUTPUT_TOKENS ?? 2_000),
    );
    const response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: reasoningEffort, context: 'current_turn' },
        input: prompt,
        text: {
          format: { type: 'json_schema', ...outputSchema },
        },
        max_output_tokens: maxOutputTokens,
        store: false,
        metadata: {
          neuroscape_stage: stage,
          prompt_version: promptVersion,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    const outputText = outputTextFrom(payload);
    if (!outputText) throw new Error(noOutputMessage(payload));
    let output;
    try {
      output = JSON.parse(outputText);
    } catch {
      throw new Error(
        'OpenAI returned structured output that was not valid JSON.',
      );
    }
    return {
      output,
      model: payload.model ?? model,
      responseId: payload.id,
      usage: usageFrom(payload),
    };
  };
}
