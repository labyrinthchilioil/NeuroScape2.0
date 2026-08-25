import type { AdaptivePlannerConfig } from './config.js';
import type {
  AdaptationHistoryItem,
  AttentionState,
  CalibrationProfile,
  EligibilityResult,
} from './types.js';

export function evaluateEligibility(
  state: AttentionState,
  _profile: CalibrationProfile,
  history: readonly AdaptationHistoryItem[],
  config: AdaptivePlannerConfig,
  transitionUntilMs = 0,
  stasisPressure = false,
): EligibilityResult {
  const reasons: string[] = [];
  if (state.phase === 'opening') reasons.push('opening_phase');
  if (state.phase === 'closing') reasons.push('closing_phase');
  if (state.timestampMs < transitionUntilMs)
    reasons.push('transition_in_progress');
  if (state.validEpochCount < config.minimumValidEpochs && !stasisPressure)
    reasons.push('insufficient_valid_epochs');
  const lastAdaptation = history.at(-1);
  if (
    lastAdaptation &&
    state.timestampMs - lastAdaptation.timestampMs < config.adaptationCooldownMs
  )
    reasons.push('adaptation_cooldown');
  return {
    eligible: reasons.length === 0,
    timestampMs: state.timestampMs,
    reasons: reasons.length ? reasons : ['eligible'],
  };
}

export function restrictionsFor(
  state: AttentionState,
  history: readonly AdaptationHistoryItem[],
  config: AdaptivePlannerConfig,
) {
  const transitions = history.filter(
    (item) => item.scope === 'scene-transition',
  );
  const lastTransition = transitions.at(-1);
  const lastBodyAnchor = [...history]
    .reverse()
    .find((item) => item.assetIds.some((id) => id.startsWith('action.')));
  return {
    allowEvent: state.phase === 'adaptive',
    allowBodyAnchor:
      state.phase === 'adaptive' &&
      (!lastBodyAnchor ||
        state.timestampMs - lastBodyAnchor.timestampMs >=
          config.bodyAnchorCooldownMs),
    allowSceneTransition:
      state.phase === 'adaptive' &&
      transitions.length < config.maxSceneTransitions &&
      (!lastTransition ||
        state.timestampMs - lastTransition.timestampMs >=
          config.sceneTransitionCooldownMs),
    sceneTransitionsRemaining: Math.max(
      0,
      config.maxSceneTransitions - transitions.length,
    ),
  };
}
