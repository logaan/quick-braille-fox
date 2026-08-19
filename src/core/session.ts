import { List, Map, Set } from 'immutable';
import { backTranslateBuffer } from './backtranslate';
import type { Cell, TranslationUnit } from './braille';
import { dotsToUnicode } from './braille';
import { generatePromptText, pickTarget } from './prompts';
import { FOX_SENTENCE } from './fox';
import type { SkillPolicy } from './policy';
import { DEFAULT_SKILL_POLICY, isSkillPolicy } from './policy';
import { drawSeed, mulberry32 } from './rng';
import { commonPrefixLength } from './text';
import { derivedScores, promptUnicode, promptUnits, unitEnds } from './scoring';
import type { Prompt, TutorState } from './types';
import { MISTAKES_BEFORE_PENALTY, FOX_INTERVAL, makePrompt, makeTutorState } from './types';

export function startSession(
  seed = 1,
  policies: Map<string, SkillPolicy> = Map<string, SkillPolicy>(),
): TutorState {
  return nextPrompt(makeTutorState({ seed: seed >>> 0 || 1, policies }));
}

export function nextPrompt(state: TutorState): TutorState {
  const rng = mulberry32(state.seed);
  let next = state;
  let prompt: Prompt;
  if (state.promptCounter % FOX_INTERVAL === 0) {
    prompt = makePrompt({ text: FOX_SENTENCE, isFox: true });
  } else {
    const { target, rotation } = pickTarget(state, rng);
    next = next.set('rotation', rotation);
    prompt = makePrompt({
      text: generatePromptText(state, target, rng),
      targetSkillId: target.id,
    });
  }
  return next.set('prompt', prompt).set('seed', drawSeed(rng));
}

function completePrompt(state: TutorState, prompt: Prompt): TutorState {
  const done = state.set('prompt', prompt);
  return done.set('scores', derivedScores(done)).set('promptCounter', done.promptCounter + 1);
}

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

export type KeystrokeInput =
  | { readonly kind: 'print'; readonly typed: string; readonly cells?: readonly Cell[] }
  | { readonly kind: 'cells'; readonly cells: readonly Cell[] };

export function keystroke(state: TutorState, input: KeystrokeInput): TutorState {
  const p = state.prompt;
  if (p === null || p.completed) return state;
  const cells = input.cells ?? [];
  if (input.kind === 'cells') {
    const expected = promptUnicode(p);
    if (expected !== '') return cellStroke(state, p, cells, expected);
    return printStroke(state, p, backTranslateBuffer(cells, p.text), cells);
  }
  return printStroke(state, p, input.typed, cells);
}

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
    return completePrompt(state, base.merge({ diverged: true, failed: true, completed: true }));
  }
  if (p.diverged) return state.set('prompt', base);
  return state.set(
    'prompt',
    withMistake(base.set('diverged', true), commonPrefixLength(p.text, typed)),
  );
}

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
 * Switch the reveal timer on or off (see TutorStateProps.revealTimer). A
 * preference rather than progress, but it lives in TutorState because
 * scoring reads it, and it is serialized with the rest so it persists.
 */
export function setRevealTimer(state: TutorState, enabled: boolean): TutorState {
  return state.set('revealTimer', enabled);
}

export function revealHint(state: TutorState, unitIndex: number): TutorState {
  const p = state.prompt;
  if (!p || p.completed || p.isFox || p.hintedUnits.has(unitIndex)) return state;
  return state.set('prompt', p.set('hintedUnits', p.hintedUnits.add(unitIndex)));
}

export function isPromptComplete(state: TutorState): boolean {
  return state.prompt?.completed ?? false;
}

export interface SerializedTutorState {
  version: 1;
  seed: number;
  promptCounter: number;
  scores: Record<string, number>;
  policies?: Record<string, SkillPolicy>;
  /** Optional (added later); absent deals a fresh round on the next prompt. */
  rotation?: string[];
  /** Optional (added later); absent loads as on, the original behaviour. */
  revealTimer?: boolean;
  prompt: {
    text: string;
    targetSkillId: string | null;
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

export function serialize(state: TutorState): SerializedTutorState {
  const p = state.prompt;
  return {
    version: 1,
    seed: state.seed,
    promptCounter: state.promptCounter,
    scores: state.scores.toObject(),
    policies: state.policies.toObject(),
    rotation: state.rotation.toArray(),
    revealTimer: state.revealTimer,
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

function unitIndexesFrom(value: unknown): Set<number> {
  let indexes = Set<number>();
  if (Array.isArray(value)) {
    for (const index of value) {
      if (Number.isInteger(index) && index >= 0) indexes = indexes.add(index as number);
    }
  }
  return indexes;
}

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
  let policies = Map<string, SkillPolicy>();
  if (typeof o.policies === 'object' && o.policies !== null) {
    for (const [id, policy] of Object.entries(o.policies)) {
      if (isSkillPolicy(policy) && policy !== DEFAULT_SKILL_POLICY) {
        policies = policies.set(id, policy);
      }
    }
  }
  const rotation = List(
    Array.isArray(o.rotation) ? o.rotation.filter((id) => typeof id === 'string') : [],
  );
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
    policies,
    rotation,
    // Only an explicit `false` switches it off: envelopes written before the
    // setting existed have no key and keep the timer running.
    revealTimer: o.revealTimer !== false,
    prompt,
  });
}
