// Core state shapes (Immutable.js Records) and game constants.

import { Map, Record, Set } from 'immutable';
import type { RecordOf } from 'immutable';

// --- Game constants --------------------------------------------------------

/** A skill is learnt when its score reaches this. */
export const LEARNT_THRESHOLD = 10;
/** How many unlearnt skills are actively being taught at once. */
export const ACTIVE_SKILL_COUNT = 5;
/**
 * Score gained for typing a skill occurrence cleanly: no mistake on that
 * occurrence, before the hint became visible.
 */
export const CLEAN_AWARD = 2;
/**
 * Score gained for typing a skill occurrence otherwise (hint already
 * showing, or the occurrence was mistyped once first) — typing a skill
 * always earns at least this.
 */
export const BASE_AWARD = 1;
/** Score lost per mistake once two-on-the-occurrence is reached (floored at 0). */
export const MISTAKE_PENALTY = 1;
/** Mistakes on the same occurrence before penalty + forced hint. */
export const MISTAKES_BEFORE_PENALTY = 2;
/**
 * The qbf challenge runs on every Nth prompt, counting from the learner's
 * very first one (prompt counters 0, N, 2N, …).
 */
export const QBF_INTERVAL = 50;
/**
 * Score gained per skill for each occurrence typed correctly during a qbf
 * run. The challenge offers no hints and ends on the first mistake, so
 * typing an occurrence there proves the skill outright — one occurrence is
 * worth LEARNT_THRESHOLD, i.e. instantly learnt.
 */
export const QBF_AWARD = LEARNT_THRESHOLD;
/** Chance that a prompt revises a learnt skill instead of an active one. */
export const REVISION_PROBABILITY = 1 / 3;

/** Is a raw score enough for the skill to count as learnt? */
export function isLearntScore(score: number): boolean {
  return score >= LEARNT_THRESHOLD;
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
  /** Whether this is the every-QBF_INTERVAL-th qbf challenge. */
  isQbf: boolean;
  /** What the learner has typed so far (as reported by keystroke()). */
  typed: string;
  /**
   * Mistake events per translation-unit index of `text` (missing = 0).
   * The second mistake on the same unit costs its skills a point and
   * force-shows the hint (see keystroke()).
   */
  unitMistakes: Map<number, number>;
  /** Indexes of units whose skills have already scored this prompt. */
  awardedUnits: Set<number>;
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
    unitMistakes: Map<number, number>(),
    awardedUnits: Set<number>(),
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
