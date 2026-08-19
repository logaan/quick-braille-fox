import type { Skill } from '../data/skills';
import { skills } from '../data/skills';
import {
  ANYWHERE_LOWER,
  BEGWORD_LOWER,
  INTERIOR_LOWER,
  MIN_BEGWORD_TAIL,
  STANDALONE_LOWER,
} from './lower-signs';

export type Cell = readonly number[];

export interface TranslationUnit {
  readonly start: number;
  readonly end: number;
  readonly cells: readonly Cell[];
  readonly skillIds: readonly string[];
}

export interface Translation {
  readonly cells: readonly Cell[];
  readonly skillIds: readonly string[];
  readonly units: readonly TranslationUnit[];
}

export function dotsToUnicode(cells: readonly Cell[]): string {
  return cells
    .map((cell) => {
      let bits = 0;
      for (const dot of cell) bits |= 1 << (dot - 1);
      return String.fromCodePoint(0x2800 + bits);
    })
    .join('');
}

export function unicodeToDots(unicode: string): Cell[] {
  const cells: Cell[] = [];
  for (const ch of unicode) {
    const bits = (ch.codePointAt(0) ?? 0x2800) - 0x2800;
    const cell: number[] = [];
    for (let dot = 1; dot <= 6; dot += 1) {
      if (bits >= 0 && (bits & (1 << (dot - 1))) !== 0) cell.push(dot);
    }
    cells.push(cell);
  }
  return cells;
}

const charSkills = new Map<string, Skill>();
const wholeWordSkills = new Map<string, Skill>();
const inWordSkills: Skill[] = [];
let foundNumberSign: Skill | undefined;
let foundCapLetter: Skill | undefined;
let foundCapWord: Skill | undefined;

for (const skill of skills) {
  switch (skill.kind) {
    case 'letter':
    case 'number':
    case 'punctuation':
      charSkills.set(skill.print, skill);
      break;
    case 'number-sign':
      foundNumberSign = skill;
      break;
    case 'capital':
      if (skill.id === 'capital-letter-indicator') foundCapLetter = skill;
      if (skill.id === 'capital-word-indicator') foundCapWord = skill;
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
if (!foundNumberSign) throw new Error('skills data has no number-sign skill');
if (!foundCapLetter || !foundCapWord) {
  throw new Error('skills data has no capital indicator skills');
}
export const numberSignSkill: Skill = foundNumberSign;
export const capitalLetterSkill: Skill = foundCapLetter;
export const capitalWordSkill: Skill = foundCapWord;
const numberSign: Skill = numberSignSkill;
const capLetter: Skill = capitalLetterSkill;
const capWord: Skill = capitalWordSkill;

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
        return start === 0 && end < len && len - end >= MIN_BEGWORD_TAIL;
      }
      return ANYWHERE_LOWER.has(skill.print);
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
  out.units.push({ start, end, cells, skillIds });
}

function translateLetterRun(word: string, base: number, out: MutableTranslation): void {
  const lower = word.toLowerCase();

  let rest = word;
  const leadCells: Cell[] = [];
  const leadSkillIds: string[] = [];
  if (word.length >= 2 && word !== lower && word === word.toUpperCase()) {
    leadCells.push(...capWord.dots);
    leadSkillIds.push(capWord.id);
    rest = lower;
  }

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

  let i = 0;
  while (i < lower.length) {
    let matched: Skill | undefined;
    for (const s of inWordSkills) {
      if (lower.startsWith(s.print, i) && allowedInWord(s, i, i + s.print.length, lower.length)) {
        matched = s;
        break;
      }
    }
    if (!matched) {
      const ch = lower[i]!;
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

function computeTranslation(text: string): Translation {
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

/**
 * Translation is pure and gets asked for the same texts over and over (every
 * keystroke re-derives the prompt's units; prompt generation weighs the same
 * corpus words each time), so results are memoized. Bounded so a long
 * session's one-off prompt texts cannot grow it without limit; eviction is
 * oldest-inserted, which is as good as LRU for this access pattern.
 */
const translationCache = new Map<string, Translation>();
const TRANSLATION_CACHE_MAX = 1024;

/**
 * Translate a print string to grade-2 braille cells (greedy longest-match).
 * Throws on characters the curriculum does not cover.
 */
export function translate(text: string): Translation {
  const hit = translationCache.get(text);
  if (hit !== undefined) return hit;
  const out = computeTranslation(text);
  if (translationCache.size >= TRANSLATION_CACHE_MAX) {
    const oldest = translationCache.keys().next().value!;
    translationCache.delete(oldest);
  }
  translationCache.set(text, out);
  return out;
}

/** translate(), with untranslatable text as null instead of a throw. */
export function tryTranslate(text: string): Translation | null {
  try {
    return translate(text);
  } catch {
    return null;
  }
}

/** The braille cells for a print string (hint display). */
export function textToCells(text: string): readonly Cell[] {
  return translate(text).cells;
}

/**
 * The cells for `text` spelled out at the finest grain: every letter as its
 * own letter cell (capital indicator per capitalised letter), digit runs and
 * punctuation canonically — no contractions or groupsigns. This is the
 * maximally-explicit grade-1 spelling, one valid way any prefix could have
 * been chorded; the canonical grade-2 cells are another (textToCells).
 * Throws on characters the curriculum does not cover.
 */
export function spellOutCells(text: string): readonly Cell[] {
  const out: MutableTranslation = { cells: [], skillIds: [], units: [] };
  const tokens = text.match(/[0-9]+|./gs) ?? [];
  let offset = 0;
  for (const token of tokens) {
    if (/^[0-9]/.test(token)) {
      translateDigitRun(token, offset, out);
    } else if (/^[a-zA-Z]$/.test(token)) {
      translateLetterRun(token, offset, out);
    } else if (token === ' ') {
      emitUnit(out, offset, offset + 1, [[]], []);
    } else {
      const skill = charSkills.get(token);
      if (!skill) throw new Error(`untranslatable character: ${JSON.stringify(token)}`);
      emitUnit(out, offset, offset + token.length, [...skill.dots], [skill.id]);
    }
    offset += token.length;
  }
  return out.cells;
}

/** The braille form of a print string as a U+2800-block string. */
export function textToUnicode(text: string): string {
  return dotsToUnicode(translate(text).cells);
}

/** Number of braille cells in the greedy grade-2 form of `text`. */
export function cellCount(text: string): number {
  return translate(text).cells.length;
}
