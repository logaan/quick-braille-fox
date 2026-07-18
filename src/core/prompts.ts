// Prompt generation: choose which skill to drill and produce a print text
// for it that only uses cells the learner has learnt or is actively
// learning.
//
// Prompts are monkeytype-style: sequences of a few real English words —
// 3..N, where N grows with progress — so the learner types several words
// at a time from the very first prompt. Nonsense letter clusters are never
// emitted, and a
// single letter is only ever prompted alone if it is a real standalone word
// ("a", "I") — letters that are grade-2 wordsigns (b=but, c=can, ...) are
// drilled inside real words instead, because typed standalone they would
// translate to the contraction word.
//
// A text is *usable* iff its greedy grade-2 translation (braille.ts) both
// succeeds and uses only known skills — so "bed" is off-limits until the
// "ed" groupsign is known (a braille display would render it ⠃⠫), and a
// capitalised word is off-limits until the capital indicator is known.
//
// Every word of a prompt — not just the one exercising the target — must
// also exercise at least one skill that is *currently being taught* (the
// active window, plus the target when it is a revision item). Otherwise
// the earliest-learnt words would go on filling prompts forever, and a
// prompt would spend most of its keystrokes on nothing being taught.

import type { Skill } from '../data/skills';
import { skills } from '../data/skills';
import { translate } from './braille';
import { WORDS } from './corpus';
import { learntSkills, activeSkills, knownSkillIds, scoreFor } from './progress';
import type { Rng } from './rng';
import { choice, mulberry32 } from './rng';
import type { TutorState } from './types';
import { REVISION_PROBABILITY } from './types';

/** A generated drill prompt. */
export interface GeneratedPrompt {
  readonly text: string;
  readonly targetSkillId: string;
}

/** Shortest word sequence a prompt aims for (a few words from the start). */
const MIN_SEQUENCE_WORDS = 3;
/** Longest word sequence a prompt will ever grow to. */
const MAX_SEQUENCE_WORDS = 5;
/** One more word of maximum sequence length per this many learnt skills. */
const LEARNT_PER_EXTRA_WORD = 15;
/** How many of the lowest-scoring learnt skills the revision picker uses. */
const LOWEST_SCORE_POOL = 5;
/** Single letters that are real standalone English words in lowercase. */
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

/** The skills a text exercises, or null if it does not translate. */
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

// --- Target selection -------------------------------------------------------

/**
 * Pick the skill the next prompt should drill: usually one of the (up to) 5
 * active skills; with probability REVISION_PROBABILITY (when anything is
 * learnt) a revision item — half chosen uniformly from all learnt skills,
 * half from the LOWEST_SCORE_POOL learnt skills with the lowest scores.
 */
export function pickTarget(state: TutorState, rng: Rng): Skill {
  const active = activeSkills(state);
  const learnt = learntSkills(state);
  if (active.length === 0) return pickRevision(state, learnt, rng);
  if (learnt.length > 0 && rng() < REVISION_PROBABILITY) {
    return pickRevision(state, learnt, rng);
  }
  return choice(active, rng) as Skill;
}

function pickRevision(state: TutorState, learnt: ReadonlyArray<Skill>, rng: Rng): Skill {
  if (learnt.length === 0) {
    // Degenerate (can't happen with a full curriculum); keep total anyway.
    return skills[0] as Skill;
  }
  if (rng() < 0.5) return choice(learnt, rng) as Skill;
  const lowest = [...learnt]
    .sort((a, b) => scoreFor(state, a.id) - scoreFor(state, b.id))
    .slice(0, LOWEST_SCORE_POOL);
  return choice(lowest, rng) as Skill;
}

// --- Word pools --------------------------------------------------------------

/** A corpus word that translates using only known skills. */
interface UsableWord {
  readonly word: string;
  readonly skillIds: ReadonlySet<string>;
}

/** Every corpus word (plus "I") usable with the given known set. */
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

/**
 * Words to pad a prompt with: usable words that each exercise at least one
 * skill currently being taught.
 *
 * A window can hold nothing a plain word shows — all digits, the capital
 * indicators, a run of punctuation — and then no word qualifies. Rather
 * than reopening the whole corpus (which would put "bad cab" in prompts
 * forever), fall back to the words built from the most recently learnt
 * skills, so the filler is at least fresh revision.
 */
function fillerWords(pool: ReadonlyArray<UsableWord>, focus: ReadonlySet<string>): string[] {
  const focused = pool.filter((w) => intersects(w.skillIds, focus));
  if (focused.length > 0) return focused.map((w) => w.word);
  return recentWords(pool);
}

/** Curriculum order of a skill id (-1 for ids outside the curriculum). */
const SKILL_ORDER = new Map(skills.map((s) => [s.id, s.order] as const));

/** How many words the recent-material fallback keeps. */
const RECENT_FILLER_WORDS = 24;

/** The usable words drawing on the latest curriculum material. */
function recentWords(pool: ReadonlyArray<UsableWord>): string[] {
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

/** Usable words whose translation exercises the required skill. */
function targetWords(pool: ReadonlyArray<UsableWord>, requiredId: string): string[] {
  return pool.filter((w) => w.skillIds.has(requiredId)).map((w) => w.word);
}

function maxSequenceLength(state: TutorState): number {
  const learnt = learntSkills(state).length;
  return Math.min(
    MAX_SEQUENCE_WORDS,
    MIN_SEQUENCE_WORDS + Math.floor(learnt / LEARNT_PER_EXTRA_WORD),
  );
}

/** A sequence length drawn uniformly from MIN_SEQUENCE_WORDS..max. */
function sequenceLength(rng: Rng, max: number): number {
  const min = Math.min(MIN_SEQUENCE_WORDS, max);
  return min + Math.floor(rng() * (max - min + 1));
}

/** A min..max word sequence containing `targetWord` at a random position. */
function wordSequence(
  targetWord: string,
  filler: ReadonlyArray<string>,
  rng: Rng,
  max: number,
): string {
  const n = sequenceLength(rng, max);
  if (n <= 1 || filler.length === 0) return targetWord;
  const words = Array.from({ length: n }, () => choice(filler, rng) as string);
  words[Math.floor(rng() * n)] = targetWord;
  return words.join(' ');
}

/** A min..max word sequence of filler words only. */
function fillerSequence(filler: ReadonlyArray<string>, rng: Rng, max: number): string | null {
  if (filler.length === 0) return null;
  const n = sequenceLength(rng, max);
  return Array.from({ length: n }, () => choice(filler, rng) as string).join(' ');
}

// --- Text generation --------------------------------------------------------

/**
 * Generate a prompt text for a target skill, deterministically from
 * state.seed. Letters and every contraction kind are drilled inside real
 * words; digits as digit strings; punctuation/symbols in word or number
 * context; capitals as capitalised (or ALL-CAPS) words. Sequence length
 * scales with the number of learnt skills.
 */
export function generatePrompt(state: TutorState, targetSkill: Skill): GeneratedPrompt {
  const rng = mulberry32(state.seed);
  return {
    text: generatePromptText(state, targetSkill, rng),
    targetSkillId: targetSkill.id,
  };
}

/** Everything the per-kind generators need besides the target and the Rng. */
interface PromptContext {
  /** Skills the prompt may use at all (learnt ∪ active ∪ the target). */
  readonly known: ReadonlySet<string>;
  /** Usable corpus words with the skills each exercises. */
  readonly pool: ReadonlyArray<UsableWord>;
  /** Words every prompt word is drawn from — each exercises a taught skill. */
  readonly filler: ReadonlyArray<string>;
  /** Longest word sequence to emit. */
  readonly max: number;
}

/** Internal variant sharing the caller's Rng (used by nextPrompt). */
export function generatePromptText(state: TutorState, target: Skill, rng: Rng): string {
  const known = new Set(knownSkillIds(state));
  known.add(target.id); // always allowed to use the skill being drilled
  // Skills "currently being taught": the active window, plus the target
  // itself, which is a learnt skill when this prompt is a revision item.
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
      // letters and all word/contraction kinds
      return wordPrompt(target, ctx, rng);
  }
}

/** Is the skill's own print form a real standalone English word? */
function printIsRealWord(target: Skill): boolean {
  switch (target.kind) {
    case 'wordsign':
    case 'shortform':
    case 'initial-letter':
    case 'contraction':
      return true;
    case 'lowersign':
      return ['be', 'enough', 'his', 'in', 'was', 'were'].includes(target.print);
    case 'letter':
      return STANDALONE_LETTER_WORDS.has(target.print);
    default:
      return false;
  }
}

function wordPrompt(target: Skill, ctx: PromptContext, rng: Rng): string {
  const targets = targetWords(ctx.pool, target.id);
  if (targets.length > 0) {
    return wordSequence(choice(targets, rng) as string, ctx.filler, rng, ctx.max);
  }
  // No corpus word exercises the target. If the print form is itself a real
  // word ("and", "about", "a") use it; otherwise emit *some* real-word
  // prompt rather than nonsense (the reachability tests guarantee this
  // branch is never needed for real curriculum states).
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
    const chars = Array.from({ length: len }, () => choice(digits, rng) as string);
    chars[Math.floor(rng() * len)] = target.print;
    const text = chars.join('');
    if (usable(text, known, target.id)) return text;
  }
  return target.print;
}

function numberSignPrompt(ctx: PromptContext, rng: Rng): string {
  // Typing any digit exercises the number sign (braille input needs ⠼).
  const digit = choice(knownDigitPrints(ctx.known), rng);
  if (digit !== undefined) return digit;
  // The number sign can become active before any digit is (the 5-skill
  // window may still be full of letters/capitals). A digit prompt would
  // need an unknown digit skill, so emit an ordinary gated word prompt;
  // the sign gets drilled as soon as the first digit activates.
  return fillerSequence(ctx.filler, rng, ctx.max) ?? 'a';
}

function capitalPrompt(target: Skill, ctx: PromptContext, rng: Rng): string {
  const filler = ctx.filler.filter((w) => /^[a-z]+$/.test(w));
  const isWordIndicator = target.id === 'capital-word-indicator';
  const transform = isWordIndicator
    ? (w: string) => w.toUpperCase()
    : (w: string) => (w[0] ?? '').toUpperCase() + w.slice(1);
  const candidates = filler
    .filter((w) => (isWordIndicator ? w.length >= 2 : true))
    .map(transform)
    .filter((w) => usable(w, ctx.known, target.id));
  if (!isWordIndicator && usable('I', ctx.known, target.id)) candidates.push('I');
  if (candidates.length === 0) {
    return fillerSequence(filler, rng, ctx.max) ?? 'a';
  }
  // Every word is capitalised, not just one: no plain word exercises a
  // capital indicator, so mixing lowercase filler in would spend most of
  // the prompt on skills that are not being taught.
  return fillerSequence(candidates, rng, ctx.max) as string;
}

function punctuationPrompt(target: Skill, ctx: PromptContext, rng: Rng): string {
  const { known, filler, max } = ctx;
  const digits = knownDigitPrints(known);
  const w = () => choice(filler, rng) as string;
  const d = () => choice(digits, rng) as string;
  const haveWords = filler.length > 0;
  const haveDigits = digits.length > 0;
  const p = target.print;

  let text: string | null = null;
  switch (p) {
    // sentence-final marks: a word sequence, terminated
    case '.':
    case '!':
    case '?':
    case '…':
      text = haveWords ? `${fillerSequence(filler, rng, max) as string}${p}` : null;
      break;
    // separators between two words
    case ',':
    case ';':
    case ':':
      text = haveWords ? `${w()}${p} ${w()}` : null;
      break;
    case "'":
      text = haveWords ? `${w()}'s` : null;
      break;
    // paired enclosures around a word
    case '"':
      text = haveWords ? `"${w()}"` : null;
      break;
    case '(':
    case ')':
      text = haveWords ? `(${w()})` : null;
      break;
    case '[':
    case ']':
      text = haveWords ? `[${w()}]` : null;
      break;
    case '{':
    case '}':
      text = haveWords ? `{${w()}}` : null;
      break;
    case '‘':
    case '’':
      text = haveWords ? `‘${w()}’` : null;
      break;
    case '“':
    case '”':
      text = haveWords ? `“${w()}”` : null;
      break;
    case '`':
      text = haveWords ? `\`${w()}\`` : null;
      break;
    // joiners between two words
    case '-':
    case '–':
    case '/':
    case '\\':
    case '_':
    case '|':
    case '@':
      text = haveWords ? `${w()}${p}${w()}` : null;
      break;
    case '—':
    case '&':
      text = haveWords ? `${w()} ${p} ${w()}` : null;
      break;
    // number context
    case '+':
    case '=':
    case '<':
    case '>':
    case '^':
      text = haveDigits ? `${d()}${p}${d()}` : null;
      break;
    case '~':
    case '#':
    case '$':
      text = haveDigits ? `${p}${d()}` : null;
      break;
    case '%':
      text = haveDigits ? `${d()}%` : null;
      break;
    default:
      text = haveWords ? `${w()}${p}` : null;
  }
  if (text !== null && usable(text, known, target.id)) return text;
  // The mark alone is still real, typeable print.
  return target.print;
}
