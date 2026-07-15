// Session flow: pure transition functions over TutorState, plus JSON
// (de)serialisation for the persistence layer.

import { Map } from 'immutable';
import { generatePromptText, pickTarget } from './prompts';
import { scoreFor } from './progress';
import { QBF_SENTENCE } from './qbf';
import { drawSeed, mulberry32 } from './rng';
import type { Prompt, TutorState } from './types';
import {
  CORRECT_BONUS,
  HINTED_BONUS,
  MISTAKE_PENALTY,
  MISTAKES_BEFORE_PENALTY,
  QBF_INTERVAL,
  makePrompt,
  makeTutorState,
} from './types';

/** Start a fresh session. Pass a seed (e.g. Date.now()) for variety. */
export function startSession(seed: number = 1): TutorState {
  return nextPrompt(makeTutorState({ seed: seed >>> 0 || 1 }));
}

/**
 * Replace the current prompt with a freshly generated one (also used to
 * skip). Every QBF_INTERVAL-th completed prompt is the qbf challenge.
 * Consumes state.seed and stores a fresh one.
 */
export function nextPrompt(state: TutorState): TutorState {
  const rng = mulberry32(state.seed);
  let prompt: Prompt;
  if ((state.promptCounter + 1) % QBF_INTERVAL === 0) {
    prompt = makePrompt({ text: QBF_SENTENCE, isQbf: true });
  } else {
    const target = pickTarget(state, rng);
    prompt = makePrompt({
      text: generatePromptText(state, target, rng),
      targetSkillId: target.id,
    });
  }
  return state.set('prompt', prompt).set('seed', drawSeed(rng));
}

function addScore(state: TutorState, skillId: string, delta: number): TutorState {
  const next = Math.max(0, scoreFor(state, skillId) + delta);
  return state.set('scores', state.scores.set(skillId, next));
}

/**
 * Feed the current *resulting* typed text (not a single key) after an input
 * event. Progressive matching against the expected text:
 *
 * - typed == expected text: prompt completed; the target skill scores
 *   +CORRECT_BONUS if the hint was never shown, +HINTED_BONUS if it was;
 *   promptCounter increments.
 * - typed is a proper prefix: fine, no event.
 * - typed diverges from the expected prefix: one mistake *event* (further
 *   keystrokes while still diverged are the same mistake; the learner must
 *   backspace to the matching prefix, after which a new divergence counts
 *   again). The second consecutive mistake on the item costs
 *   MISTAKE_PENALTY (score floored at 0, and learnt skills may drop below
 *   the learnt threshold) and forces the hint to show. On a qbf prompt any
 *   mistake fails the challenge immediately and completes the prompt.
 *
 * Once the prompt is completed, further keystrokes are ignored; the state
 * layer should call nextPrompt().
 */
export function keystroke(state: TutorState, typed: string): TutorState {
  const p = state.prompt;
  if (!p || p.completed || typed === p.typed) return state;

  if (typed === p.text) {
    let next = state
      .set('prompt', p.merge({ typed, diverged: false, completed: true }))
      .set('promptCounter', state.promptCounter + 1);
    if (!p.isQbf && p.targetSkillId !== null) {
      next = addScore(next, p.targetSkillId, p.hintShown ? HINTED_BONUS : CORRECT_BONUS);
    }
    return next;
  }

  const isPrefix = p.text.startsWith(typed);

  if (p.isQbf) {
    if (isPrefix) return state.set('prompt', p.set('typed', typed));
    return state
      .set('prompt', p.merge({ typed, diverged: true, failed: true, completed: true }))
      .set('promptCounter', state.promptCounter + 1);
  }

  if (isPrefix) return state.set('prompt', p.merge({ typed, diverged: false }));
  if (p.diverged) return state.set('prompt', p.set('typed', typed));

  // A new mistake event (prefix -> divergence transition).
  const mistakes = p.mistakesInARow + 1;
  let prompt = p.merge({ typed, diverged: true, mistakesInARow: mistakes });
  let next = state;
  if (mistakes >= MISTAKES_BEFORE_PENALTY) {
    prompt = prompt.set('hintShown', true);
    if (p.targetSkillId !== null) {
      next = addScore(next, p.targetSkillId, -MISTAKE_PENALTY);
    }
  }
  return next.set('prompt', prompt);
}

/**
 * Record that the hint was shown (the state layer calls this when the
 * hintDelayFor() timer fires). Drops the completion bonus from
 * CORRECT_BONUS to HINTED_BONUS. No-op on qbf prompts (never hinted) and
 * completed/absent prompts.
 */
export function revealHint(state: TutorState): TutorState {
  const p = state.prompt;
  if (!p || p.completed || p.isQbf || p.hintShown) return state;
  return state.set('prompt', p.set('hintShown', true));
}

/** Whether the current prompt is finished (correct, or qbf failed). */
export function isPromptComplete(state: TutorState): boolean {
  return state.prompt?.completed ?? false;
}

// --- Serialisation ----------------------------------------------------------

/** Plain-JSON shape of a TutorState (localStorage-safe). */
export interface SerializedTutorState {
  version: 1;
  seed: number;
  promptCounter: number;
  scores: { [skillId: string]: number };
  prompt: {
    text: string;
    targetSkillId: string | null;
    isQbf: boolean;
    typed: string;
    mistakesInARow: number;
    hintShown: boolean;
    diverged: boolean;
    completed: boolean;
    failed: boolean;
  } | null;
}

/** Convert state to a plain object that survives JSON.stringify/parse. */
export function serialize(state: TutorState): SerializedTutorState {
  return {
    version: 1,
    seed: state.seed,
    promptCounter: state.promptCounter,
    scores: state.scores.toObject(),
    prompt: state.prompt === null ? null : state.prompt.toObject(),
  };
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Rebuild a TutorState from serialize() output. Throws on garbage input. */
export function deserialize(raw: unknown): TutorState {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('deserialize: expected an object');
  }
  const o = raw as Partial<SerializedTutorState>;
  if (o.version !== 1) {
    throw new TypeError(`deserialize: unsupported version ${String(o.version)}`);
  }
  let scores = Map<string, number>();
  if (typeof o.scores === 'object' && o.scores !== null) {
    for (const [id, score] of Object.entries(o.scores)) {
      if (typeof score === 'number' && Number.isFinite(score)) {
        scores = scores.set(id, score);
      }
    }
  }
  const p = o.prompt;
  const prompt =
    typeof p === 'object' && p !== null
      ? makePrompt({
          text: str(p.text, ''),
          targetSkillId: typeof p.targetSkillId === 'string' ? p.targetSkillId : null,
          isQbf: bool(p.isQbf),
          typed: str(p.typed, ''),
          mistakesInARow: num(p.mistakesInARow, 0),
          hintShown: bool(p.hintShown),
          diverged: bool(p.diverged),
          completed: bool(p.completed),
          failed: bool(p.failed),
        })
      : null;
  return makeTutorState({
    seed: num(o.seed, 1) >>> 0 || 1,
    promptCounter: num(o.promptCounter, 0),
    scores,
    prompt,
  });
}
