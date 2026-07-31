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

export type { QbfResult, QbfSign } from './qbf';
export {
  QBF_MIN_CELLS,
  QBF_SENTENCE,
  divergentCells,
  expectedSignAt,
  qbfResult,
} from './qbf';

export type { Prompt, PromptProps, TutorState, TutorStateProps } from './types';
export {
  ACTIVE_SKILL_COUNT,
  BASE_AWARD,
  CLEAN_AWARD,
  HINT_REVEAL_COOLDOWN_MS,
  LEARNT_THRESHOLD,
  MISTAKE_PENALTY,
  MISTAKES_BEFORE_PENALTY,
  QBF_AWARD,
  QBF_INTERVAL,
  REVISION_PROBABILITY,
  hintDelayMs,
  isLearntScore,
  makePrompt,
  makeTutorState,
  unitTypedClean,
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

export type { HintUnit, HintWord, PendingHint } from './hints';
export { hintWordForPrompt, nextHintFor } from './hints';

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
