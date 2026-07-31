// src/core — pure domain logic (no DOM, no React, no I/O).
// Public API surface; see docs/ARCHITECTURE.md "Core API".

export type { Cell, Translation, TranslationUnit } from './braille';
export {
  cellCount,
  dotsToUnicode,
  textToCells,
  textToUnicode,
  translate,
  tryTranslate,
} from './braille';

export { capitalizeFirst, commonPrefixLength } from './text';

export { WORDS } from './corpus';

export type { AttributedBackTranslation, BackTranslateOptions } from './backtranslate';
export {
  backTranslateBuffer,
  backTranslateBufferAttributed,
  backTranslateWord,
} from './backtranslate';

export type { FoxResult, FoxSign } from './fox';
export {
  FOX_MIN_CELLS,
  FOX_SENTENCE,
  divergentCells,
  expectedSignAt,
  foxResult,
} from './fox';

export type { Prompt, PromptProps, TutorState, TutorStateProps } from './types';
export {
  ACTIVE_SKILL_COUNT,
  BASE_AWARD,
  CLEAN_AWARD,
  HINT_REVEAL_COOLDOWN_MS,
  LEARNT_THRESHOLD,
  MISTAKE_PENALTY,
  MISTAKES_BEFORE_PENALTY,
  FOX_AWARD,
  FOX_INTERVAL,
  REVISION_PROBABILITY,
  hintDelayMs,
  isLearntScore,
  makePrompt,
  makeTutorState,
  unitTypedClean,
} from './types';

export {
  activeSkills,
  hintDelayFor,
  isSkillLearnt,
  knownSkillIds,
  learntSkills,
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
