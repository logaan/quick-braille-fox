// Session flow: pure transition functions over TutorState, plus JSON
// (de)serialisation for the persistence layer.

import { Map, Set } from 'immutable';
import { backTranslateBuffer } from './backtranslate';
import type { Cell, TranslationUnit } from './braille';
import { dotsToUnicode } from './braille';
import { generatePromptText, pickTarget } from './prompts';
import { FOX_SENTENCE } from './fox';
import { drawSeed, mulberry32 } from './rng';
import { commonPrefixLength } from './text';
import { derivedScores, promptUnicode, promptUnits, unitEnds } from './scoring';
import type { Prompt, TutorState } from './types';
import { MISTAKES_BEFORE_PENALTY, FOX_INTERVAL, makePrompt, makeTutorState } from './types';

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
 *
 * Scores are untouched: the new round starts from the committed baseline,
 * and a prompt replaced before it completed contributes nothing.
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

/**
 * Finish the round: put the completed prompt on the state, fold what it
 * earned into the committed scores, and count it. This is the *only* place
 * scores change — during a round they are derived, never stored.
 */
function completePrompt(state: TutorState, prompt: Prompt): TutorState {
  const done = state.set('prompt', prompt);
  return done.set('scores', derivedScores(done)).set('promptCounter', done.promptCounter + 1);
}

/**
 * The unit a mistake at `caret` is charged to, `ends` being the units' ends
 * in the same coordinate the caret is measured in (print offsets, or cells
 * on a cell-judged round): the skill-bearing unit containing the caret, else
 * the next one after it (a caret on a space charges the word ahead, matching
 * what the hint shows), else the last one (typed past the end). Null when no
 * unit carries skills.
 */
function mistakeUnitIndex(
  units: readonly TranslationUnit[],
  ends: readonly number[],
  caret: number,
): number | null {
  let last: number | null = null;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.skillIds.length === 0) continue;
    if (caret < ends[i]!) return i;
    last = i;
  }
  return last;
}

/**
 * Record one mistake event at `caret` on the occurrence it belongs to. The
 * second mistake on the same occurrence also reveals that occurrence's hint.
 */
function withMistake(prompt: Prompt, caret: number): Prompt {
  const units = promptUnits(prompt);
  const idx = mistakeUnitIndex(units, unitEnds(prompt, units), caret);
  if (idx === null) return prompt;
  const mistakes = prompt.unitMistakes.get(idx, 0) + 1;
  const next = prompt.set('unitMistakes', prompt.unitMistakes.set(idx, mistakes));
  return mistakes >= MISTAKES_BEFORE_PENALTY
    ? next.set('hintedUnits', next.hintedUnits.add(idx))
    : next;
}

/**
 * What an input event tells the core the learner has produced.
 *
 * - `print`: the resulting typed *text* (VoiceOver, and every fox run). The
 *   cells may come along for the ride — on a fox run they attribute the
 *   awards to the signs actually chorded (see scoring.ts), elsewhere they
 *   are display only.
 * - `cells`: the chorded cell buffer, which is then what the round is judged
 *   on. Emulated mode uses this for regular rounds: the point of the mode is
 *   to drill braille input, so typing a wordsign the long way must count as
 *   a mistake even though it spells the right print.
 */
export type KeystrokeInput =
  | { readonly kind: 'print'; readonly typed: string; readonly cells?: readonly Cell[] }
  | { readonly kind: 'cells'; readonly cells: readonly Cell[] };

/**
 * Feed the result of one input event (not a single key). Progressive
 * matching of what the learner has produced against what is expected —
 * their text against the prompt text, or their cells against the prompt's
 * cells, depending on the input:
 *
 * - a full match: prompt completed; what the round earned is committed to
 *   state.scores and promptCounter increments.
 * - a proper prefix: fine, no event.
 * - a divergence from that prefix: one mistake *event*, charged to the
 *   occurrence at the caret (further keystrokes while still diverged are
 *   the same mistake; the learner must backspace to the matching prefix,
 *   after which a new divergence counts again). The second mistake on the
 *   same occurrence reveals that occurrence's hint and, when the round is
 *   committed, costs its skills MISTAKE_PENALTY. On a fox prompt any
 *   mistake fails the challenge immediately and completes the prompt,
 *   committing the occurrences finished before it.
 *
 * Scores themselves are *not* touched here. What the prompt is currently
 * worth is derived from it on demand (see scoring.ts), so backspacing over
 * a word — or VoiceOver rewriting an earlier one — takes its points back.
 *
 * Once the prompt is completed, further keystrokes are ignored; the state
 * layer should call nextPrompt().
 */
export function keystroke(state: TutorState, input: KeystrokeInput): TutorState {
  const p = state.prompt;
  if (p === null || p.completed) return state;
  const cells = input.cells ?? [];
  if (input.kind === 'cells') {
    const expected = promptUnicode(p);
    // Untranslatable prompt text has no cells to compare against; judging
    // its back-translation is the best that can be done.
    if (expected !== '') return cellStroke(state, p, cells, expected);
    return printStroke(state, p, backTranslateBuffer(cells, p.text), cells);
  }
  return printStroke(state, p, input.typed, cells);
}

/** Judge the round on the print the learner has produced. */
function printStroke(
  state: TutorState,
  p: Prompt,
  typed: string,
  cells: readonly Cell[],
): TutorState {
  const typedUnicode = dotsToUnicode(cells);
  if (typed === p.typed && typedUnicode === p.typedUnicode && !p.judgedByCells) return state;
  const base = p.merge({ typed, typedUnicode, judgedByCells: false });

  if (typed === p.text) {
    return completePrompt(state, base.merge({ diverged: false, completed: true }));
  }
  if (p.text.startsWith(typed)) return state.set('prompt', base.set('diverged', false));
  if (p.isFox) {
    // The run is over, but the occurrences the correct prefix finished
    // before the mistake still count, and are committed with it.
    return completePrompt(state, base.merge({ diverged: true, failed: true, completed: true }));
  }
  if (p.diverged) return state.set('prompt', base);
  return state.set(
    'prompt',
    withMistake(base.set('diverged', true), commonPrefixLength(p.text, typed)),
  );
}

/**
 * Judge the round on the cells the learner chorded, `expected` being the
 * prompt's own cells. `typed` is still maintained (back-translated from the
 * buffer) so the target row and the text result row have something to show,
 * but it decides nothing here.
 */
function cellStroke(
  state: TutorState,
  p: Prompt,
  cells: readonly Cell[],
  expected: string,
): TutorState {
  const typedUnicode = dotsToUnicode(cells);
  const typed = backTranslateBuffer(cells, p.text);
  if (typed === p.typed && typedUnicode === p.typedUnicode && p.judgedByCells) return state;
  const base = p.merge({ typed, typedUnicode, judgedByCells: true });

  if (typedUnicode === expected) {
    return completePrompt(state, base.merge({ diverged: false, completed: true }));
  }
  if (expected.startsWith(typedUnicode)) return state.set('prompt', base.set('diverged', false));
  if (p.isFox) {
    return completePrompt(state, base.merge({ diverged: true, failed: true, completed: true }));
  }
  if (p.diverged) return state.set('prompt', base);
  return state.set(
    'prompt',
    withMistake(base.set('diverged', true), commonPrefixLength(expected, typedUnicode)),
  );
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
    typedUnicode: string;
    judgedByCells: boolean;
    unitMistakes: Record<string, number>;
    hintedUnits: number[];
    diverged: boolean;
    completed: boolean;
    failed: boolean;
  } | null;
}

/**
 * Convert state to a plain object that survives JSON.stringify/parse.
 *
 * The old `awardedUnits` field is gone — with derived scoring a resumed
 * round recomputes what it is worth from the prompt itself, so there is
 * nothing to remember (and stale entries in old saves are simply ignored
 * on read).
 */
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
            typedUnicode: p.typedUnicode,
            judgedByCells: p.judgedByCells,
            unitMistakes: p.unitMistakes.mapKeys(String).toObject(),
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
          isFox: bool(p.isQbf),
          typed: str(p.typed, ''),
          typedUnicode: str(p.typedUnicode, ''),
          judgedByCells: bool(p.judgedByCells),
          unitMistakes: unitMistakesFrom(p.unitMistakes),
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
