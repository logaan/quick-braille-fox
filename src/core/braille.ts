// Greedy grade-2 braille translation, driven entirely by src/data/skills.json.
//
// This is NOT a full liblouis reimplementation (see docs/ARCHITECTURE.md,
// "Table-parsing caveats"): it applies the canonical patterns from the skill
// records with a small set of positional usage rules. It is used for
//   - rendering hints/answers as braille cells,
//   - computing the minimum cell count of the qbf challenge sentence,
//   - deciding which prompts only contain cells the learner knows
//     (a prompt text is usable iff its translation uses only known skills).
//
// Usage rules applied (approximations of the real UEB rules):
//   - wordsigns and shortforms: standalone whole words only
//   - strong contractions (and/for/of/the/with) and initial-letter
//     contractions: anywhere in a word
//   - strong groupsigns: anywhere, except "ing" never starts a word
//   - final-letter groupsigns: never at the start of a word
//   - lower signs: ea/bb/cc/ff/gg strictly inside a word; be/con/dis only at
//     the start of a word with at least three letters following (syllable
//     heuristic); en/in anywhere; be/enough/his/in/was/were also standalone
//   - capital letter -> the capital-letter-indicator skill's cell (dot 6)
//     before the letter/sign; an ALL-CAPS word (>= 2 letters) -> the
//     capital-word-indicator (dots 6, 6) once, before the word
//   - digit run -> number sign cell, then the digit cells
//   - space -> one blank cell (so spaces count toward cell totals)
//
// Capitalisation and the number sign are skills, so capitalised words and
// digits only pass known-skill gating once those indicators are learnt.

import type { Skill } from '../data/skills';
import { skills } from '../data/skills';

/** One braille cell: ascending dot numbers 1-6. Empty array = blank cell. */
export type Cell = ReadonlyArray<number>;

/**
 * One indivisible chunk of a translation: the cells for one print span (a
 * whole-word sign, an in-word contraction, a single letter/digit/mark, a
 * space). Indicator cells attach to the unit they precede: a capital
 * indicator to its letter/sign, the number sign to the first digit of a
 * run, the capital word indicator to the word's first unit.
 */
export interface TranslationUnit {
  /** Print span [start, end) this unit covers, as indexes into the text. */
  readonly start: number;
  readonly end: number;
  readonly cells: ReadonlyArray<Cell>;
}

/** Result of translating a print string to braille cells. */
export interface Translation {
  /** The cells, in order (includes capital/number indicators and blanks). */
  readonly cells: ReadonlyArray<Cell>;
  /** Ids of every skill used, in order of use (repeats possible). Only the
   * blank space cell has no skill; capital indicators and the number sign
   * are skills and do appear. */
  readonly skillIds: ReadonlyArray<string>;
  /** The same cells grouped by print span, tiling the text left to right. */
  readonly units: ReadonlyArray<TranslationUnit>;
}

/** The capital letter indicator cell (dot 6). */
export const CAPITAL_INDICATOR: Cell = [6];

/** Convert cells (arrays of dot numbers) to a U+2800-block string. */
export function dotsToUnicode(cells: ReadonlyArray<Cell>): string {
  return cells
    .map((cell) => {
      let bits = 0;
      for (const dot of cell) bits |= 1 << (dot - 1);
      return String.fromCodePoint(0x2800 + bits);
    })
    .join('');
}

// --- Lookup structures, built once from the skills data -------------------

const charSkills = new Map<string, Skill>(); // letters, digits, punctuation
const wholeWordSkills = new Map<string, Skill>(); // print -> standalone sign
const inWordSkills: Skill[] = []; // signs usable inside a word, longest first
let numberSignSkill: Skill | undefined;
let capLetterSkill: Skill | undefined;
let capWordSkill: Skill | undefined;

const STANDALONE_LOWER = new Set(['be', 'enough', 'his', 'in', 'was', 'were']);
const INTERIOR_LOWER = new Set(['ea', 'bb', 'cc', 'ff', 'gg']);
const BEGWORD_LOWER = new Set(['be', 'con', 'dis']);
const ANYWHERE_LOWER = new Set(['en', 'in']);

for (const skill of skills) {
  switch (skill.kind) {
    case 'letter':
    case 'number':
    case 'punctuation':
      charSkills.set(skill.print, skill);
      break;
    case 'number-sign':
      numberSignSkill = skill;
      break;
    case 'capital':
      if (skill.id === 'capital-letter-indicator') capLetterSkill = skill;
      if (skill.id === 'capital-word-indicator') capWordSkill = skill;
      break;
    case 'wordsign':
    case 'shortform':
      wholeWordSkills.set(skill.print, skill);
      break;
    case 'contraction':
    case 'initial-letter':
      wholeWordSkills.set(skill.print, skill);
      inWordSkills.push(skill);
      break;
    case 'groupsign':
    case 'final-letter':
      inWordSkills.push(skill);
      break;
    case 'lowersign':
      if (STANDALONE_LOWER.has(skill.print)) wholeWordSkills.set(skill.print, skill);
      if (
        INTERIOR_LOWER.has(skill.print) ||
        BEGWORD_LOWER.has(skill.print) ||
        ANYWHERE_LOWER.has(skill.print)
      ) {
        inWordSkills.push(skill);
      }
      break;
  }
}
inWordSkills.sort((a, b) => b.print.length - a.print.length);
if (!numberSignSkill) throw new Error('skills data has no number-sign skill');
if (!capLetterSkill || !capWordSkill) {
  throw new Error('skills data has no capital indicator skills');
}
const numberSign: Skill = numberSignSkill;
const capLetter: Skill = capLetterSkill;
const capWord: Skill = capWordSkill;

/** May `skill` be used inside a word at [start, end) of a word of `len`? */
function allowedInWord(skill: Skill, start: number, end: number, len: number): boolean {
  switch (skill.kind) {
    case 'contraction':
    case 'initial-letter':
      return true;
    case 'groupsign':
      return skill.print === 'ing' ? start > 0 : true;
    case 'final-letter':
      return start > 0;
    case 'lowersign':
      if (INTERIOR_LOWER.has(skill.print)) return start > 0 && end < len;
      if (BEGWORD_LOWER.has(skill.print)) {
        // Syllable heuristic: begword only, with >= 3 letters following.
        return start === 0 && end < len && len - end >= 3;
      }
      return ANYWHERE_LOWER.has(skill.print); // en, in
    default:
      return false;
  }
}

interface MutableTranslation {
  cells: Cell[];
  skillIds: string[];
  units: TranslationUnit[];
}

function emitUnit(
  out: MutableTranslation,
  start: number,
  end: number,
  cells: Cell[],
  skillIds: string[],
): void {
  out.cells.push(...cells);
  out.skillIds.push(...skillIds);
  out.units.push({ start, end, cells });
}

function translateLetterRun(word: string, base: number, out: MutableTranslation): void {
  const lower = word.toLowerCase();

  // An ALL-CAPS word gets one capital word indicator up front, carried by
  // the word's first unit.
  let rest = word;
  const leadCells: Cell[] = [];
  const leadSkillIds: string[] = [];
  if (word.length >= 2 && word !== lower && word === word.toUpperCase()) {
    leadCells.push(...capWord.dots);
    leadSkillIds.push(capWord.id);
    rest = lower;
  }

  // Standalone whole-word sign (wordsign/shortform/contraction/...), with an
  // optional leading capital ("The" -> capital letter indicator + ⠮).
  const whole = wholeWordSkills.get(lower);
  const isTitleCase = rest === (rest[0] ?? '').toUpperCase() + lower.slice(1) && rest !== lower;
  if (whole && (rest === lower || isTitleCase)) {
    if (isTitleCase) {
      leadCells.push(...capLetter.dots);
      leadSkillIds.push(capLetter.id);
    }
    leadCells.push(...whole.dots);
    leadSkillIds.push(whole.id);
    emitUnit(out, base, base + word.length, leadCells, leadSkillIds);
    return;
  }

  // Greedy longest-match, left to right.
  let i = 0;
  while (i < lower.length) {
    let matched: Skill | undefined;
    for (const s of inWordSkills) {
      if (lower.startsWith(s.print, i) && allowedInWord(s, i, i + s.print.length, lower.length)) {
        matched = s;
        break; // inWordSkills is sorted longest-first
      }
    }
    if (!matched) {
      const ch = lower[i] as string;
      matched = charSkills.get(ch);
      if (!matched) throw new Error(`untranslatable character: ${JSON.stringify(ch)}`);
    }
    const end = i + matched.print.length;
    const cells: Cell[] = i === 0 ? leadCells : [];
    const skillIds: string[] = i === 0 ? leadSkillIds : [];
    for (let j = i; j < end; j++) {
      if (rest[j] !== lower[j]) {
        cells.push(...capLetter.dots);
        skillIds.push(capLetter.id);
      }
    }
    cells.push(...matched.dots);
    skillIds.push(matched.id);
    emitUnit(out, base + i, base + end, cells, skillIds);
    i = end;
  }
}

function translateDigitRun(run: string, base: number, out: MutableTranslation): void {
  let i = 0;
  for (const ch of run) {
    const skill = charSkills.get(ch);
    if (!skill) throw new Error(`untranslatable digit: ${JSON.stringify(ch)}`);
    const cells: Cell[] = i === 0 ? [...numberSign.dots] : [];
    const skillIds: string[] = i === 0 ? [numberSign.id] : [];
    cells.push(...skill.dots);
    skillIds.push(skill.id);
    emitUnit(out, base + i, base + i + 1, cells, skillIds);
    i += 1;
  }
}

/**
 * Translate a print string to grade-2 braille cells (greedy longest-match).
 * Throws on characters the curriculum does not cover.
 */
export function translate(text: string): Translation {
  const out: MutableTranslation = { cells: [], skillIds: [], units: [] };
  const tokens = text.match(/[a-zA-Z]+|[0-9]+|./gs) ?? [];
  let offset = 0;
  for (const token of tokens) {
    if (/^[a-zA-Z]/.test(token)) {
      translateLetterRun(token, offset, out);
    } else if (/^[0-9]/.test(token)) {
      translateDigitRun(token, offset, out);
    } else if (token === ' ') {
      // Blank cell; spaces count toward cell totals but carry no skill.
      emitUnit(out, offset, offset + 1, [[]], []);
    } else {
      const skill = charSkills.get(token);
      if (!skill) throw new Error(`untranslatable character: ${JSON.stringify(token)}`);
      emitUnit(out, offset, offset + token.length, [...skill.dots], [skill.id]);
    }
    offset += token.length;
  }
  return out;
}

/** The braille cells for a print string (hint display). */
export function textToCells(text: string): ReadonlyArray<Cell> {
  return translate(text).cells;
}

/** The braille form of a print string as a U+2800-block string. */
export function textToUnicode(text: string): string {
  return dotsToUnicode(translate(text).cells);
}

/** Number of braille cells in the greedy grade-2 form of `text`. */
export function cellCount(text: string): number {
  return translate(text).cells.length;
}
