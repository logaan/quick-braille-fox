import { Map, Record, Set } from 'immutable';
import type { RecordOf } from 'immutable';
import type { SkillPolicy } from './policy';

export const LEARNT_THRESHOLD = 10;
export const ACTIVE_SKILL_COUNT = 5;
export const CLEAN_AWARD = 2;
export const BASE_AWARD = 1;
export const MISTAKE_PENALTY = 1;
export const MISTAKES_BEFORE_PENALTY = 2;
export const FOX_INTERVAL = 50;
export const FOX_AWARD = LEARNT_THRESHOLD;
export const REVISION_PROBABILITY = 1 / 3;

export function isLearntScore(score: number): boolean {
  return score >= LEARNT_THRESHOLD;
}

export function hintDelayMs(score: number): number {
  return 400 + 300 * score;
}

export interface PromptProps {
  text: string;
  targetSkillId: string | null;
  isFox: boolean;
  typed: string;
  typedUnicode: string;
  judgedByCells: boolean;
  unitMistakes: Map<number, number>;
  hintedUnits: Set<number>;
  diverged: boolean;
  completed: boolean;
  failed: boolean;
}

export const makePrompt = Record<PromptProps>(
  {
    text: '',
    targetSkillId: null,
    isFox: false,
    typed: '',
    typedUnicode: '',
    judgedByCells: false,
    unitMistakes: Map<number, number>(),
    hintedUnits: Set<number>(),
    diverged: false,
    completed: false,
    failed: false,
  },
  'Prompt',
);
export type Prompt = RecordOf<PromptProps>;

export interface TutorStateProps {
  scores: Map<string, number>;
  policies: Map<string, SkillPolicy>;
  promptCounter: number;
  prompt: Prompt | null;
  seed: number;
}

export const makeTutorState = Record<TutorStateProps>(
  {
    scores: Map<string, number>(),
    policies: Map<string, SkillPolicy>(),
    promptCounter: 0,
    prompt: null,
    seed: 1,
  },
  'TutorState',
);
export type TutorState = RecordOf<TutorStateProps>;

export function unitTypedClean(prompt: Prompt, unitIndex: number): boolean {
  return !prompt.hintedUnits.has(unitIndex) && prompt.unitMistakes.get(unitIndex, 0) === 0;
}
