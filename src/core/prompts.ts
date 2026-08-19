import type { Skill } from '../data/skills';
import { skills } from '../data/skills';
import { translate } from './braille';
import { WORDS } from './corpus';
import { STANDALONE_LOWER } from './lower-signs';
import { policyFor } from './policy';
import {
  activeSkills,
  knownSkillIds,
  learntSkills,
  revisableSkills,
  scoreFor,
} from './progress';
import { capitalizeFirst } from './text';
import type { Rng } from './rng';
import { choice, mulberry32 } from './rng';
import type { TutorState } from './types';
import { REVISION_PROBABILITY } from './types';

export interface GeneratedPrompt {
  readonly text: string;
  readonly targetSkillId: string;
}

const MIN_SEQUENCE_WORDS = 3;
const MAX_SEQUENCE_WORDS = 5;
const LEARNT_PER_EXTRA_WORD = 15;
const LOWEST_SCORE_POOL = 5;
const STANDALONE_LETTER_WORDS = new Set(['a', 'o']);

function usable(text: string, known: ReadonlySet<string>, requiredId?: string): boolean {
  let translation;
  try {
    translation = translate(text);
  } catch {
    return false;
  }
  if (!translation.skillIds.every((id) => known.has(id))) return false;
  return requiredId === undefined || translation.skillIds.includes(requiredId);
}

function skillIdsOf(text: string): ReadonlySet<string> | null {
  try {
    return new Set(translate(text).skillIds);
  } catch {
    return null;
  }
}

function intersects(ids: ReadonlySet<string>, other: ReadonlySet<string>): boolean {
  for (const id of ids) if (other.has(id)) return true;
  return false;
}

export function pickTarget(state: TutorState, rng: Rng): Skill {
  const active = activeSkills(state);
  const learnt = revisableSkills(state);
  if (active.length === 0) return pickRevision(state, learnt, rng);
  if (learnt.length > 0 && rng() < REVISION_PROBABILITY) {
    return pickRevision(state, learnt, rng);
  }
  return choice(active, rng)!;
}

function pickRevision(state: TutorState, learnt: readonly Skill[], rng: Rng): Skill {
  if (learnt.length === 0) {
    return skills.find((s) => policyFor(state, s.id) !== 'block') ?? skills[0]!;
  }
  if (rng() < 0.5) return choice(learnt, rng)!;
  const lowest = [...learnt]
    .sort((a, b) => scoreFor(state, a.id) - scoreFor(state, b.id))
    .slice(0, LOWEST_SCORE_POOL);
  return choice(lowest, rng)!;
}

interface UsableWord {
  readonly word: string;
  readonly skillIds: ReadonlySet<string>;
}

function usableWords(known: ReadonlySet<string>): UsableWord[] {
  const out: UsableWord[] = [];
  for (const word of [...WORDS, 'I']) {
    const skillIds = skillIdsOf(word);
    if (skillIds === null) continue;
    let allKnown = true;
    for (const id of skillIds) {
      if (!known.has(id)) {
        allKnown = false;
        break;
      }
    }
    if (allKnown) out.push({ word, skillIds });
  }
  return out;
}

function fillerWords(pool: readonly UsableWord[], focus: ReadonlySet<string>): string[] {
  const focused = pool.filter((w) => intersects(w.skillIds, focus));
  if (focused.length > 0) return focused.map((w) => w.word);
  return recentWords(pool);
}

const SKILL_ORDER = new Map(skills.map((s) => [s.id, s.order] as const));

const RECENT_FILLER_WORDS = 24;

function recentWords(pool: readonly UsableWord[]): string[] {
  const latest = (w: UsableWord) => {
    let max = -1;
    for (const id of w.skillIds) max = Math.max(max, SKILL_ORDER.get(id) ?? -1);
    return max;
  };
  return [...pool]
    .sort((a, b) => latest(b) - latest(a))
    .slice(0, RECENT_FILLER_WORDS)
    .map((w) => w.word);
}

function targetWords(pool: readonly UsableWord[], requiredId: string): string[] {
  return pool.filter((w) => w.skillIds.has(requiredId)).map((w) => w.word);
}

function maxSequenceLength(state: TutorState): number {
  const learnt = learntSkills(state).length;
  return Math.min(
    MAX_SEQUENCE_WORDS,
    MIN_SEQUENCE_WORDS + Math.floor(learnt / LEARNT_PER_EXTRA_WORD),
  );
}

function sequenceLength(rng: Rng, max: number): number {
  const min = Math.min(MIN_SEQUENCE_WORDS, max);
  return min + Math.floor(rng() * (max - min + 1));
}

function wordSequence(
  targetWord: string,
  filler: readonly string[],
  rng: Rng,
  max: number,
): string {
  const n = sequenceLength(rng, max);
  if (n <= 1 || filler.length === 0) return targetWord;
  const words = Array.from({ length: n }, () => choice(filler, rng)!);
  words[Math.floor(rng() * n)] = targetWord;
  return words.join(' ');
}

function fillerSequence(filler: readonly string[], rng: Rng, max: number): string | null {
  if (filler.length === 0) return null;
  const n = sequenceLength(rng, max);
  return Array.from({ length: n }, () => choice(filler, rng)!).join(' ');
}

export function generatePrompt(state: TutorState, targetSkill: Skill): GeneratedPrompt {
  const rng = mulberry32(state.seed);
  return {
    text: generatePromptText(state, targetSkill, rng),
    targetSkillId: targetSkill.id,
  };
}

interface PromptContext {
  readonly known: ReadonlySet<string>;
  readonly pool: readonly UsableWord[];
  readonly filler: readonly string[];
  readonly max: number;
}

export function generatePromptText(state: TutorState, target: Skill, rng: Rng): string {
  const known = new Set(knownSkillIds(state));
  known.add(target.id);
  const focus = new Set(activeSkills(state).map((s) => s.id));
  focus.add(target.id);
  const pool = usableWords(known);
  const ctx: PromptContext = {
    known,
    pool,
    filler: fillerWords(pool, focus),
    max: maxSequenceLength(state),
  };
  switch (target.kind) {
    case 'number':
      return digitPrompt(target, known, rng);
    case 'number-sign':
      return numberSignPrompt(ctx, rng);
    case 'punctuation':
      return punctuationPrompt(target, ctx, rng);
    case 'capital':
      return capitalPrompt(target, ctx, rng);
    default:
      return wordPrompt(target, ctx, rng);
  }
}

function printIsRealWord(target: Skill): boolean {
  switch (target.kind) {
    case 'wordsign':
    case 'shortform':
    case 'initial-letter':
    case 'contraction':
      return true;
    case 'lowersign':
      return STANDALONE_LOWER.has(target.print);
    case 'letter':
      return STANDALONE_LETTER_WORDS.has(target.print);
    default:
      return false;
  }
}

function wordPrompt(target: Skill, ctx: PromptContext, rng: Rng): string {
  const targets = targetWords(ctx.pool, target.id);
  if (targets.length > 0) {
    return wordSequence(choice(targets, rng)!, ctx.filler, rng, ctx.max);
  }
  if (printIsRealWord(target) && usable(target.print, ctx.known)) return target.print;
  return fillerSequence(ctx.filler, rng, ctx.max) ?? 'a';
}

function knownDigitPrints(known: ReadonlySet<string>): string[] {
  return skills.filter((s) => s.kind === 'number' && known.has(s.id)).map((s) => s.print);
}

function digitPrompt(target: Skill, known: ReadonlySet<string>, rng: Rng): string {
  const digits = knownDigitPrints(known);
  const len = 1 + Math.floor(rng() * Math.min(3, Math.max(1, digits.length - 1)));
  if (len > 1) {
    const chars = Array.from({ length: len }, () => choice(digits, rng)!);
    chars[Math.floor(rng() * len)] = target.print;
    const text = chars.join('');
    if (usable(text, known, target.id)) return text;
  }
  return target.print;
}

function numberSignPrompt(ctx: PromptContext, rng: Rng): string {
  const digit = choice(knownDigitPrints(ctx.known), rng);
  if (digit !== undefined) return digit;
  return fillerSequence(ctx.filler, rng, ctx.max) ?? 'a';
}

function capitalPrompt(target: Skill, ctx: PromptContext, rng: Rng): string {
  const filler = ctx.filler.filter((w) => /^[a-z]+$/.test(w));
  const isWordIndicator = target.id === 'capital-word-indicator';
  const transform = isWordIndicator ? (w: string) => w.toUpperCase() : capitalizeFirst;
  const candidates = filler
    .filter((w) => (isWordIndicator ? w.length >= 2 : true))
    .map(transform)
    .filter((w) => usable(w, ctx.known, target.id));
  if (!isWordIndicator && usable('I', ctx.known, target.id)) candidates.push('I');
  if (candidates.length === 0) {
    return fillerSequence(filler, rng, ctx.max) ?? 'a';
  }
  return fillerSequence(candidates, rng, ctx.max)!;
}

type PunctShape =
  | 'terminator'
  | 'separator'
  | 'possessive'
  | 'tight-join'
  | 'spaced-join'
  | 'op'
  | 'prefix'
  | 'suffix';

const PUNCT_SHAPES: ReadonlyMap<string, PunctShape> = new Map([
  ...(['.', '!', '?', '…'] as const).map((p) => [p, 'terminator'] as const),
  ...([',', ';', ':'] as const).map((p) => [p, 'separator'] as const),
  ["'", 'possessive'] as const,
  ...(['-', '–', '/', '\\', '_', '|', '@'] as const).map((p) => [p, 'tight-join'] as const),
  ...(['—', '&'] as const).map((p) => [p, 'spaced-join'] as const),
  ...(['+', '=', '<', '>', '^'] as const).map((p) => [p, 'op'] as const),
  ...(['~', '#', '$'] as const).map((p) => [p, 'prefix'] as const),
  ['%', 'suffix'] as const,
]);

const ENCLOSURE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['‘', '’'],
  ['“', '”'],
  ['`', '`'],
];
const ENCLOSURES: ReadonlyMap<string, readonly [string, string]> = new Map(
  ENCLOSURE_PAIRS.flatMap((pair) => [
    [pair[0], pair] as const,
    [pair[1], pair] as const,
  ]),
);

function punctuationPrompt(target: Skill, ctx: PromptContext, rng: Rng): string {
  const { known, filler, max } = ctx;
  const digits = knownDigitPrints(known);
  const w = () => choice(filler, rng)!;
  const d = () => choice(digits, rng)!;
  const haveWords = filler.length > 0;
  const haveDigits = digits.length > 0;
  const p = target.print;

  let text: string | null = null;
  const pair = ENCLOSURES.get(p);
  if (pair !== undefined) {
    text = haveWords ? `${pair[0]}${w()}${pair[1]}` : null;
  } else {
    switch (PUNCT_SHAPES.get(p)) {
      case 'terminator':
        text = haveWords ? `${fillerSequence(filler, rng, max)!}${p}` : null;
        break;
      case 'separator':
        text = haveWords ? `${w()}${p} ${w()}` : null;
        break;
      case 'possessive':
        text = haveWords ? `${w()}${p}s` : null;
        break;
      case 'tight-join':
        text = haveWords ? `${w()}${p}${w()}` : null;
        break;
      case 'spaced-join':
        text = haveWords ? `${w()} ${p} ${w()}` : null;
        break;
      case 'op':
        text = haveDigits ? `${d()}${p}${d()}` : null;
        break;
      case 'prefix':
        text = haveDigits ? `${p}${d()}` : null;
        break;
      case 'suffix':
        text = haveDigits ? `${d()}${p}` : null;
        break;
      default:
        text = haveWords ? `${w()}${p}` : null;
    }
  }
  if (text !== null && usable(text, known, target.id)) return text;
  // The mark alone is still real, typeable print.
  return target.print;
}
