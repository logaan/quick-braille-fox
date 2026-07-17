// src/core — pure domain logic (no DOM, no React, no I/O).
// Public API surface; see docs/ARCHITECTURE.md "Core API".

export type { Cell, Translation, TranslationUnit } from './braille';
export {
  CAPITAL_INDICATOR,
  cellCount,
  dotsToUnicode,
  textToCells,
  textToUnicode,
  translate,
} from './braille';

export { WORDS } from './corpus';

export type { BackTranslateOptions } from './backtranslate';
export { backTranslateBuffer, backTranslateWord } from './backtranslate';

export type { QbfResult } from './qbf';
export { QBF_MIN_CELLS, QBF_SENTENCE, qbfResult } from './qbf';

export type { Prompt, PromptProps, TutorState, TutorStateProps } from './types';
export {
  ACTIVE_SKILL_COUNT,
  CORRECT_BONUS,
  HINTED_BONUS,
  HINT_REVEAL_COOLDOWN_MS,
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

export type { HintWord } from './hints';
export { hintWordForPrompt } from './hints';

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
