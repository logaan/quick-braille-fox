export type { Cell, Translation, TranslationUnit } from './braille';
export {
  cellCount,
  dotsToUnicode,
  spellOutCells,
  textToCells,
  textToUnicode,
  translate,
  tryTranslate,
  unicodeToDots,
} from './braille';

export { capitalizeFirst, commonPrefixLength } from './text';

export type { Column, RowModel, RowModelInput } from './columns';
export { buildRowModel } from './columns';

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
  coveredUnitCount,
  derivedScores,
  divergedTail,
  judgedPrintCaret,
  pendingScoreDeltas,
  promptUnicode,
  unitEnds,
} from './scoring';

export {
  activeSkills,
  forcedSkills,
  hintDelayForSkills,
  isLearntIn,
  isSkillLearnt,
  knownSkillIds,
  learntSkills,
  learntSkillsIn,
  revisableSkills,
  scoreFor,
} from './progress';

export type { SkillPolicy } from './policy';
export {
  DEFAULT_SKILL_POLICY,
  SKILL_POLICIES,
  isSkillPolicy,
  policyFor,
  setAllPolicies,
  setGroupPolicy,
  setSkillPolicy,
} from './policy';

export type { GeneratedPrompt } from './prompts';
export { generatePrompt, pickTarget } from './prompts';

export type { HintUnit, HintWord, PendingHint } from './hints';
export { hintWordForPrompt, nextHintFor } from './hints';

export type { KeystrokeInput, SerializedTutorState } from './session';
export {
  deserialize,
  isPromptComplete,
  keystroke,
  nextPrompt,
  revealHint,
  serialize,
  setRevealTimer,
  startSession,
} from './session';
