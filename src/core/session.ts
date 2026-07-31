// Session flow: pure transition functions over TutorState, plus JSON
// (de)serialisation for the persistence layer.

import { Map, Set } from 'immutable';
import type { TranslationUnit } from './braille';
import { tryTranslate } from './braille';
import { generatePromptText, pickTarget } from './prompts';
import { scoreFor } from './progress';
import { FOX_SENTENCE } from './fox';
import { drawSeed, mulberry32 } from './rng';
import { commonPrefixLength } from './text';
import type { Prompt, TutorState } from './types';
import {
  BASE_AWARD,
  CLEAN_AWARD,
  MISTAKE_PENALTY,
  MISTAKES_BEFORE_PENALTY,
  FOX_AWARD,
  FOX_INTERVAL,
  makePrompt,
  makeTutorState,
  unitTypedClean,
} from './types';

/** Start a fresh session. Pass a seed (e.g. Date.now()) for variety. */
export function startSession(seed = 1): TutorState {
  return nextPrompt(makeTutorState({ seed: seed >>> 0 || 1 }));
}

/**
 * Replace the current prompt with a freshly generated one (also used to
 * skip). Every FOX_INTERVAL-th prompt is the fox challenge, counting from
 * the learner's first prompt (counters 0, FOX_INTERVAL, 2*FOX_INTERVAL, …),
 * so a fresh learner meets the challenge immediately.
 * Consumes state.seed and stores a fresh one.
 */
export function nextPrompt(state: TutorState): TutorState {
  const rng = mulberry32(state.seed);
  let prompt: Prompt;
  if (state.promptCounter % FOX_INTERVAL === 0) {
    prompt = makePrompt({ text: FOX_SENTENCE, isFox: true });
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
function promptUnits(p: Prompt): readonly TranslationUnit[] {
  return tryTranslate(p.text)?.units ?? [];
}

/**
 * The unit a mistake at `caret` is charged to: the skill-bearing unit
 * containing the caret, else the next one after it (a caret on a space
 * charges the word ahead, matching what the hint shows), else the last one
 * (typed past the end of the text). Null when no unit carries skills.
 */
function mistakeUnitIndex(units: readonly TranslationUnit[], caret: number): number | null {
  let last: number | null = null;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.skillIds.length === 0) continue;
    if (caret < u.end) return i;
    last = i;
  }
  return last;
}

/**
 * Identity of a translation unit for award bookkeeping: its print start and
 * the skills it carries. Stable where a positional index is not — an
 * attributed unit list changes shape when chords are backspaced and the same
 * print is respelled differently, and the award must follow the sign, not
 * the slot it happened to occupy.
 */
function unitAwardKey(u: TranslationUnit): string {
  return `${u.start}:${u.skillIds.join('+')}`;
}

/**
 * Score every unit the correct prefix (length `caret`) has newly finished:
 * each of the unit's skills gains CLEAN_AWARD if the occurrence was typed
 * with no mistakes and before *its own* hint was revealed, BASE_AWARD
 * otherwise. Cleanliness is per occurrence, not per prompt — a sign typed
 * promptly keeps its clean award however much of the rest of the prompt
 * had to be hinted.
 *
 * `fixedAward` overrides that for the fox challenge, where every finished
 * occurrence is worth FOX_AWARD (no hints exist there, and the run is over
 * at the first mistake, so anything finished was typed cold).
 */
function awardFinishedUnits(
  state: TutorState,
  p: Prompt,
  units: readonly TranslationUnit[],
  caret: number,
  fixedAward?: number,
): { state: TutorState; prompt: Prompt } {
  let next = state;
  let awarded = p.awardedUnits;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.end > caret) break;
    if (u.skillIds.length === 0) continue;
    const key = unitAwardKey(u);
    if (awarded.has(key)) continue;
    const delta = fixedAward ?? (unitTypedClean(p, i) ? CLEAN_AWARD : BASE_AWARD);
    for (const id of u.skillIds) next = addScore(next, id, delta);
    awarded = awarded.add(key);
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
 *   learnt threshold) and reveals that occurrence's hint. On a fox prompt any
 *   mistake fails the challenge immediately and completes the prompt, and
 *   every occurrence finished before that scores FOX_AWARD per skill.
 *
 * `typedUnits`, when given, replaces the canonical translation as the award
 * attribution for a fox run: the state layer passes the signs the learner
 * *actually chorded* (backTranslateBufferAttributed), so spelling a word out
 * letter by letter credits the letters, not the contraction of the shortest
 * solution. Without it (VoiceOver input hands us print, not cells) the
 * canonical units remain the only attribution available. Non-fox prompts
 * ignore it: their mistake/hint bookkeeping is tied to canonical units.
 *
 * Once the prompt is completed, further keystrokes are ignored; the state
 * layer should call nextPrompt().
 */
export function keystroke(
  state: TutorState,
  typed: string,
  typedUnits?: readonly TranslationUnit[],
): TutorState {
  const p = state.prompt;
  if (!p || p.completed || typed === p.typed) return state;

  if (p.isFox) {
    // Occurrences finished by the correct prefix score FOX_AWARD each, even
    // on the keystroke that ends the run — what was typed correctly counts.
    const scored = awardFinishedUnits(
      state,
      p,
      typedUnits ?? promptUnits(p),
      commonPrefixLength(p.text, typed),
      FOX_AWARD,
    );
    const next = scored.state;
    const prompt = scored.prompt;
    if (typed === p.text) {
      return next
        .set('prompt', prompt.merge({ typed, diverged: false, completed: true }))
        .set('promptCounter', state.promptCounter + 1);
    }
    if (p.text.startsWith(typed)) return next.set('prompt', prompt.set('typed', typed));
    return next
      .set('prompt', prompt.merge({ typed, diverged: true, failed: true, completed: true }))
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
      for (const id of (units[idx]!).skillIds) {
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
 * clean chance. No-op on fox prompts (never hinted) and completed/absent
 * prompts.
 */
export function revealHint(state: TutorState, unitIndex: number): TutorState {
  const p = state.prompt;
  if (!p || p.completed || p.isFox || p.hintedUnits.has(unitIndex)) return state;
  return state.set('prompt', p.set('hintedUnits', p.hintedUnits.add(unitIndex)));
}

/** Whether the current prompt is finished (correct, or fox failed). */
export function isPromptComplete(state: TutorState): boolean {
  return state.prompt?.completed ?? false;
}

// --- Serialisation ----------------------------------------------------------

/** Plain-JSON shape of a TutorState (localStorage-safe). */
export interface SerializedTutorState {
  version: 1;
  seed: number;
  promptCounter: number;
  scores: Record<string, number>;
  prompt: {
    text: string;
    targetSkillId: string | null;
    /** Wire name predates the "fox challenge" naming; kept for stored data. */
    isQbf: boolean;
    typed: string;
    unitMistakes: Record<string, number>;
    /** Award keys; entries from older saves are positional unit indexes,
     * migrated onto the canonical translation on read. */
    awardedUnits: (string | number)[];
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
            isQbf: p.isFox,
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

/**
 * Persisted award keys, garbage filtered out. Older saves stored positional
 * unit indexes; those are migrated by mapping them onto the canonical
 * translation of the prompt text (the only attribution old saves could have
 * used), so an in-flight prompt does not re-award on resume.
 */
function awardKeysFrom(value: unknown, text: string): Set<string> {
  let keys = Set<string>();
  if (!Array.isArray(value)) return keys;
  let units: readonly TranslationUnit[] | undefined;
  for (const entry of value) {
    if (typeof entry === 'string') {
      keys = keys.add(entry);
    } else if (Number.isInteger(entry) && (entry as number) >= 0) {
      units ??= tryTranslate(text)?.units ?? [];
      const u = units[entry as number];
      if (u !== undefined && u.skillIds.length > 0) keys = keys.add(unitAwardKey(u));
    }
  }
  return keys;
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
          isFox: bool(p.isQbf),
          typed: str(p.typed, ''),
          unitMistakes: unitMistakesFrom(p.unitMistakes),
          awardedUnits: awardKeysFrom(p.awardedUnits, str(p.text, '')),
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
