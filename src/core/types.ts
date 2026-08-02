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
 * occurrence, and typed before *that occurrence's* hint was revealed.
 */
export const CLEAN_AWARD = 2;
/**
 * Score gained for typing a skill occurrence otherwise (its hint was
 * already revealed, or the occurrence was mistyped once first) — typing a
 * skill always earns at least this.
 */
export const BASE_AWARD = 1;
/** Score lost per mistake once two-on-the-occurrence is reached (floored at 0). */
export const MISTAKE_PENALTY = 1;
/** Mistakes on the same occurrence before penalty + forced hint. */
export const MISTAKES_BEFORE_PENALTY = 2;
/**
 * The fox challenge runs on every Nth prompt, counting from the learner's
 * very first one (prompt counters 0, N, 2N, …).
 */
export const FOX_INTERVAL = 50;
/**
 * Score gained per skill for each occurrence typed correctly during a fox
 * run. The challenge offers no hints and ends on the first mistake, so
 * typing an occurrence there proves the skill outright — one occurrence is
 * worth LEARNT_THRESHOLD, i.e. instantly learnt.
 */
export const FOX_AWARD = LEARNT_THRESHOLD;
/** Chance that a prompt revises a learnt skill instead of an active one. */
export const REVISION_PROBABILITY = 1 / 3;

/** Is a raw score enough for the skill to count as learnt? */
export function isLearntScore(score: number): boolean {
  return score >= LEARNT_THRESHOLD;
}

/**
 * Milliseconds before the hint is auto-shown for an *unlearnt* skill.
 * Learnt skills get no time-based hint (see hintDelayForSkills).
 */
export function hintDelayMs(score: number): number {
  return 400 + 300 * score;
}

// --- Prompt ----------------------------------------------------------------

export interface PromptProps {
  /** The print text the learner must type, exactly. */
  text: string;
  /** Skill this prompt drills; null for the fox challenge. */
  targetSkillId: string | null;
  /** Whether this is the every-FOX_INTERVAL-th fox challenge. */
  isFox: boolean;
  /** What the learner has typed so far (as reported by keystroke()). */
  typed: string;
  /**
   * The cells the learner has chorded so far, as a U+2800 string (one
   * character per cell; empty when they are not chording). On a cell-judged
   * round this is what the round is actually measured against and `typed`
   * is its back-translation, kept for display only.
   */
  typedUnicode: string;
  /**
   * Whether this round is judged on the cells the learner chorded rather
   * than the print those cells produce (emulated mode, non-fox rounds).
   * Everything positional — which units are finished, where a mistake
   * lands — is then counted in cells; see scoring.ts unitEnds().
   */
  judgedByCells: boolean;
  /**
   * Mistake events per translation-unit index of `text` (missing = 0).
   * This is *history*: a mistake that has since been backspaced away still
   * happened, and the second mistake on the same unit still costs its
   * skills a point and force-shows the hint (see keystroke()).
   */
  unitMistakes: Map<number, number>;
  /**
   * Indexes of units whose hint has been revealed. Per unit, not per
   * prompt: a unit typed before *its own* hint appeared still scores
   * CLEAN_AWARD, however much of the prompt was hinted before it.
   */
  hintedUnits: Set<number>;
  /** Whether the typed text currently diverges from the expected prefix. */
  diverged: boolean;
  /** Whether the prompt is finished (typed correctly, or fox failed). */
  completed: boolean;
  /** fox only: the challenge was failed by a mistake. */
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

// --- TutorState -------------------------------------------------------------

export interface TutorStateProps {
  /** skill id -> score. Missing key = 0. */
  scores: Map<string, number>;
  /** Number of completed prompts (correct, or fox-failed), ever. */
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

/**
 * Is this occurrence still on course for CLEAN_AWARD — no mistake on it,
 * and its own hint not yet revealed? Per occurrence, not per prompt: signs
 * elsewhere in the prompt being hinted or mistyped is irrelevant.
 */
export function unitTypedClean(prompt: Prompt, unitIndex: number): boolean {
  return !prompt.hintedUnits.has(unitIndex) && prompt.unitMistakes.get(unitIndex, 0) === 0;
}
