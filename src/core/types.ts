// Core state shapes (Immutable.js Records) and game constants.

import { Map, Record } from 'immutable';
import type { RecordOf } from 'immutable';

// --- Game constants --------------------------------------------------------

/** A skill is learnt when its score is strictly greater than this. */
export const LEARNT_THRESHOLD = 10;
/** How many unlearnt skills are actively being taught at once. */
export const ACTIVE_SKILL_COUNT = 5;
/** Score gained for answering correctly before the hint is shown. */
export const CORRECT_BONUS = 2;
/** Score lost per mistake once two-in-a-row is reached (floored at 0). */
export const MISTAKE_PENALTY = 1;
/** Consecutive mistakes on the current item before penalty + forced hint. */
export const MISTAKES_BEFORE_PENALTY = 2;
/** Every Nth completed prompt is the qbf challenge. */
export const QBF_INTERVAL = 100;
/** Chance that a prompt revises a learnt skill instead of an active one. */
export const REVISION_PROBABILITY = 1 / 3;

/** Is a raw score enough for the skill to count as learnt? */
export function isLearntScore(score: number): boolean {
  return score > LEARNT_THRESHOLD;
}

/**
 * Milliseconds before the hint is auto-shown for an *unlearnt* skill.
 * Learnt skills get no time-based hint (see hintDelayFor).
 */
export function hintDelayMs(score: number): number {
  return 400 + 300 * score;
}

/**
 * Milliseconds between successive reveal units once the hint is showing:
 * the hint uncovers the caret word one sign at a time (see hints.ts), and
 * each further sign waits this long, giving the learner a beat to recall
 * it unaided.
 */
export const HINT_REVEAL_COOLDOWN_MS = 1000;

// --- Prompt ----------------------------------------------------------------

export interface PromptProps {
  /** The print text the learner must type, exactly. */
  text: string;
  /** Skill this prompt drills; null for the qbf challenge. */
  targetSkillId: string | null;
  /** Whether this is the every-100th qbf challenge. */
  isQbf: boolean;
  /** What the learner has typed so far (as reported by keystroke()). */
  typed: string;
  /** Consecutive mistakes on this item (resets only with a new prompt). */
  mistakesInARow: number;
  /** Whether the hint (the answer as braille cells) has been shown. */
  hintShown: boolean;
  /** Whether the typed text currently diverges from the expected prefix. */
  diverged: boolean;
  /** Whether the prompt is finished (typed correctly, or qbf failed). */
  completed: boolean;
  /** qbf only: the challenge was failed by a mistake. */
  failed: boolean;
}

export const makePrompt = Record<PromptProps>(
  {
    text: '',
    targetSkillId: null,
    isQbf: false,
    typed: '',
    mistakesInARow: 0,
    hintShown: false,
    diverged: false,
    completed: false,
    failed: false,
  },
  'Prompt',
);
export type Prompt = RecordOf<PromptProps>;

// --- TutorState -------------------------------------------------------------

export interface TutorStateProps {
  /** skill id -> score. Missing key = 0. */
  scores: Map<string, number>;
  /** Number of completed prompts (correct, or qbf-failed), ever. */
  promptCounter: number;
  /** The prompt currently on screen, if any. */
  prompt: Prompt | null;
  /** PRNG seed consumed and replaced by nextPrompt(). */
  seed: number;
}

export const makeTutorState = Record<TutorStateProps>(
  {
    scores: Map<string, number>(),
    promptCounter: 0,
    prompt: null,
    seed: 1,
  },
  'TutorState',
);
export type TutorState = RecordOf<TutorStateProps>;

/** Can a correct answer still earn the before-hint bonus on this prompt? */
export function answerBeforeHintPossible(prompt: Prompt): boolean {
  return !prompt.completed && !prompt.hintShown && !prompt.isQbf;
}
