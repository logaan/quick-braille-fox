// Session flow: pure transition functions over TutorState, plus JSON
// (de)serialisation for the persistence layer.

import { Map, Set } from 'immutable';
import type { TranslationUnit } from './braille';
import { translate } from './braille';
import { generatePromptText, pickTarget } from './prompts';
import { scoreFor } from './progress';
import { QBF_SENTENCE } from './qbf';
import { drawSeed, mulberry32 } from './rng';
import type { Prompt, TutorState } from './types';
import {
  BASE_AWARD,
  CLEAN_AWARD,
  MISTAKE_PENALTY,
  MISTAKES_BEFORE_PENALTY,
  QBF_INTERVAL,
  makePrompt,
  makeTutorState,
  unitTypedClean,
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

/** The prompt text's translation units ([] if it is not translatable). */
function promptUnits(p: Prompt): ReadonlyArray<TranslationUnit> {
  try {
    return translate(p.text).units;
  } catch {
    return [];
  }
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/**
 * The unit a mistake at `caret` is charged to: the skill-bearing unit
 * containing the caret, else the next one after it (a caret on a space
 * charges the word ahead, matching what the hint shows), else the last one
 * (typed past the end of the text). Null when no unit carries skills.
 */
function mistakeUnitIndex(units: ReadonlyArray<TranslationUnit>, caret: number): number | null {
  let last: number | null = null;
  for (let i = 0; i < units.length; i++) {
    const u = units[i] as TranslationUnit;
    if (u.skillIds.length === 0) continue;
    if (caret < u.end) return i;
    last = i;
  }
  return last;
}

/**
 * Score every unit the correct prefix (length `caret`) has newly finished:
 * each of the unit's skills gains CLEAN_AWARD if the occurrence was typed
 * with no mistakes and before *its own* hint was revealed, BASE_AWARD
 * otherwise. Cleanliness is per occurrence, not per prompt — a sign typed
 * promptly keeps its clean award however much of the rest of the prompt
 * had to be hinted.
 */
function awardFinishedUnits(
  state: TutorState,
  p: Prompt,
  units: ReadonlyArray<TranslationUnit>,
  caret: number,
): { state: TutorState; prompt: Prompt } {
  let next = state;
  let awarded = p.awardedUnits;
  for (let i = 0; i < units.length; i++) {
    const u = units[i] as TranslationUnit;
    if (u.end > caret) break;
    if (u.skillIds.length === 0 || awarded.has(i)) continue;
    const delta = unitTypedClean(p, i) ? CLEAN_AWARD : BASE_AWARD;
    for (const id of u.skillIds) next = addScore(next, id, delta);
    awarded = awarded.add(i);
  }
  return { state: next, prompt: p.set('awardedUnits', awarded) };
}

/**
 * Feed the current *resulting* typed text (not a single key) after an input
 * event. Progressive matching against the expected text:
 *
 * - Every skill occurrence (translation unit) the correctly typed prefix
 *   finishes scores *immediately* for each of the unit's skills:
 *   +CLEAN_AWARD when typed with no mistake on the occurrence and before
 *   that occurrence's own hint was revealed, +BASE_AWARD otherwise (typing
 *   a skill always earns at least BASE_AWARD).
 * - typed == expected text: prompt completed (the final units score the
 *   same way); promptCounter increments.
 * - typed is a proper prefix: fine, no event.
 * - typed diverges from the expected prefix: one mistake *event*, charged
 *   to the occurrence at the caret (further keystrokes while still
 *   diverged are the same mistake; the learner must backspace to the
 *   matching prefix, after which a new divergence counts again). The
 *   second mistake on the same occurrence costs its skills
 *   MISTAKE_PENALTY (floored at 0, and learnt skills may drop below the
 *   learnt threshold) and reveals that occurrence's hint. On a qbf prompt any
 *   mistake fails the challenge immediately and completes the prompt.
 *
 * Once the prompt is completed, further keystrokes are ignored; the state
 * layer should call nextPrompt().
 */
export function keystroke(state: TutorState, typed: string): TutorState {
  const p = state.prompt;
  if (!p || p.completed || typed === p.typed) return state;

  if (p.isQbf) {
    if (typed === p.text) {
      return state
        .set('prompt', p.merge({ typed, diverged: false, completed: true }))
        .set('promptCounter', state.promptCounter + 1);
    }
    if (p.text.startsWith(typed)) return state.set('prompt', p.set('typed', typed));
    return state
      .set('prompt', p.merge({ typed, diverged: true, failed: true, completed: true }))
      .set('promptCounter', state.promptCounter + 1);
  }

  const units = promptUnits(p);
  const caret = commonPrefixLength(p.text, typed);
  // Correctly typed occurrences score first, with the hint state as it was
  // when they were typed — even when the same event also brings a mistake
  // further along.
  const scored = awardFinishedUnits(state, p, units, caret);
  let next = scored.state;
  let prompt = scored.prompt;

  if (typed === p.text) {
    return next
      .set('prompt', prompt.merge({ typed, diverged: false, completed: true }))
      .set('promptCounter', state.promptCounter + 1);
  }

  if (p.text.startsWith(typed)) {
    return next.set('prompt', prompt.merge({ typed, diverged: false }));
  }

  if (p.diverged) return next.set('prompt', prompt.set('typed', typed));

  // A new mistake event (prefix -> divergence transition).
  prompt = prompt.merge({ typed, diverged: true });
  const idx = mistakeUnitIndex(units, caret);
  if (idx !== null) {
    const mistakes = prompt.unitMistakes.get(idx, 0) + 1;
    prompt = prompt.set('unitMistakes', prompt.unitMistakes.set(idx, mistakes));
    if (mistakes >= MISTAKES_BEFORE_PENALTY) {
      prompt = prompt.set('hintedUnits', prompt.hintedUnits.add(idx));
      for (const id of (units[idx] as TranslationUnit).skillIds) {
        next = addScore(next, id, -MISTAKE_PENALTY);
      }
    }
  }
  return next.set('prompt', prompt);
}

/**
 * Uncover one sign's hint (the state layer calls this when the timer for
 * the unit nextHintFor() named fires). That occurrence now earns
 * BASE_AWARD instead of CLEAN_AWARD; every *other* occurrence keeps its own
 * clean chance. No-op on qbf prompts (never hinted) and completed/absent
 * prompts.
 */
export function revealHint(state: TutorState, unitIndex: number): TutorState {
  const p = state.prompt;
  if (!p || p.completed || p.isQbf || p.hintedUnits.has(unitIndex)) return state;
  return state.set('prompt', p.set('hintedUnits', p.hintedUnits.add(unitIndex)));
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
    unitMistakes: { [unitIndex: string]: number };
    awardedUnits: number[];
    hintedUnits: number[];
    diverged: boolean;
    completed: boolean;
    failed: boolean;
  } | null;
}

/** Convert state to a plain object that survives JSON.stringify/parse. */
export function serialize(state: TutorState): SerializedTutorState {
  const p = state.prompt;
  return {
    version: 1,
    seed: state.seed,
    promptCounter: state.promptCounter,
    scores: state.scores.toObject(),
    prompt:
      p === null
        ? null
        : {
            text: p.text,
            targetSkillId: p.targetSkillId,
            isQbf: p.isQbf,
            typed: p.typed,
            unitMistakes: p.unitMistakes.mapKeys(String).toObject(),
            awardedUnits: p.awardedUnits.toArray(),
            hintedUnits: p.hintedUnits.toArray(),
            diverged: p.diverged,
            completed: p.completed,
            failed: p.failed,
          },
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

function unitMistakesFrom(value: unknown): Map<number, number> {
  let mistakes = Map<number, number>();
  if (typeof value === 'object' && value !== null) {
    for (const [key, count] of Object.entries(value)) {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 0 && typeof count === 'number') {
        mistakes = mistakes.set(index, count);
      }
    }
  }
  return mistakes;
}

/** A persisted array of translation-unit indexes, garbage filtered out. */
function unitIndexesFrom(value: unknown): Set<number> {
  let indexes = Set<number>();
  if (Array.isArray(value)) {
    for (const index of value) {
      if (Number.isInteger(index) && index >= 0) indexes = indexes.add(index as number);
    }
  }
  return indexes;
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
          unitMistakes: unitMistakesFrom(p.unitMistakes),
          awardedUnits: unitIndexesFrom(p.awardedUnits),
          hintedUnits: unitIndexesFrom(p.hintedUnits),
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
