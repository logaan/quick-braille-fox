// src/core — pure domain logic (no DOM, no React, no I/O).
// Public API surface; see docs/ARCHITECTURE.md "Core API".

export type { Cell, Translation } from './braille';
export {
  CAPITAL_INDICATOR,
  cellCount,
  dotsToUnicode,
  textToCells,
  textToUnicode,
  translate,
} from './braille';

export { WORDS } from './corpus';

export type { QbfResult } from './qbf';
export { QBF_MIN_CELLS, QBF_SENTENCE, qbfResult } from './qbf';

export type { Prompt, PromptProps, TutorState, TutorStateProps } from './types';
export {
  ACTIVE_SKILL_COUNT,
  CORRECT_BONUS,
  LEARNT_THRESHOLD,
  MISTAKE_PENALTY,
  MISTAKES_BEFORE_PENALTY,
  QBF_INTERVAL,
  REVISION_PROBABILITY,
  answerBeforeHintPossible,
  hintDelayMs,
  isLearntScore,
  makePrompt,
  makeTutorState,
} from './types';

export type { ProgressSummary } from './progress';
export {
  activeSkills,
  hintDelayFor,
  isSkillLearnt,
  knownSkillIds,
  learntSkills,
  progressSummary,
  scoreFor,
} from './progress';

export type { GeneratedPrompt } from './prompts';
export { generatePrompt, pickTarget } from './prompts';

export type { SerializedTutorState } from './session';
export {
  deserialize,
  isPromptComplete,
  keystroke,
  nextPrompt,
  revealHint,
  serialize,
  startSession,
} from './session';

import { textToUnicode } from './braille';
import type { TutorState } from './types';

/**
 * The hint for the current prompt: its answer as braille cells (U+2800
 * string), or null when there is nothing to hint (no prompt, or the qbf
 * challenge, which never shows hints).
 */
export function hintForPrompt(state: TutorState): string | null {
  const p = state.prompt;
  if (!p || p.isQbf) return null;
  return textToUnicode(p.text);
}
