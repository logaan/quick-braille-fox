// Contextual grade-2 back-translation: braille cells -> print text.
//
// This is the inverse of translate() in braille.ts, used when the learner
// chords braille directly on a QWERTY keyboard (VoiceOver mode off). A cell's
// meaning depends on its neighbours (⠃ standalone is "but", inside "bad" it is
// "b"; cells after ⠼ are digits; ⠠ capitalises), so decoding is word-buffered
// and progressive: the whole current word is re-decoded after every cell.
//
// Two strategies combine:
//   - Against the expected prompt word (the normal case), we match the buffer
//     cell-by-cell to translate(expected).cells and emit the corresponding
//     print span. This makes backTranslateBuffer(translate(text).cells, text)
//     === text hold for every promptable text (the round-trip property), and
//     a correctly-typed prefix shows the matching print prefix — no phantom
//     mistakes.
//   - The diverged tail (a wrong chord), text with no expected context, and
//     extra words are decoded by a greedy context-free decoder that mirrors
//     translate()'s rules well enough for error display. It never throws;
//     cells it cannot read become their U+2800 glyph (which never matches
//     prompt text, so the mistake stays visible).

import type { Cell } from './braille';
import { dotsToUnicode, translate } from './braille';
import type { Skill } from '../data/skills';
import { skills } from '../data/skills';

export interface BackTranslateOptions {
  /** The expected print for this word position (the prompt word). */
  readonly expected?: string;
  /** True once the word is committed (a space was typed, or an earlier word). */
  readonly final?: boolean;
}

// --- cell helpers ----------------------------------------------------------

function cellsEqual(a: Cell, b: Cell): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Signature of a single cell, e.g. [1,2] -> "12". Dots are 1-6, so safe. */
function cellKey(cell: Cell): string {
  return cell.join('');
}

/** Signature of a cell sequence, e.g. [[1],[1,2]] -> "1-12". */
function cellsKey(cells: ReadonlyArray<Cell>): string {
  return cells.map(cellKey).join('-');
}

function matchAt(cells: ReadonlyArray<Cell>, pos: number, sign: ReadonlyArray<Cell>): boolean {
  if (pos + sign.length > cells.length) return false;
  for (let i = 0; i < sign.length; i += 1) {
    if (!cellsEqual(cells[pos + i] as Cell, sign[i] as Cell)) return false;
  }
  return true;
}

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : (s[0] as string).toUpperCase() + s.slice(1);
}

// --- reverse lookup tables, built once from the skills data ----------------

const letterByKey = new Map<string, string>();
const digitByKey = new Map<string, string>();
const standaloneByKey = new Map<string, string>(); // whole-word signs
/** Signs usable inside a word, longest cell-sequence first. */
const inWordSigns: Skill[] = [];
/** Punctuation/symbol signs, longest cell-sequence first (multi-cell exist). */
const punctSigns: Skill[] = [];
let numberSignCell: Cell = [3, 4, 5, 6];
const CAP_LETTER: Cell = [6];
const CAP_WORD: ReadonlyArray<Cell> = [[6], [6]];

const STANDALONE_LOWER = new Set(['be', 'enough', 'his', 'in', 'was', 'were']);
const INTERIOR_LOWER = new Set(['ea', 'bb', 'cc', 'ff', 'gg']);
const BEGWORD_LOWER = new Set(['be', 'con', 'dis']);

for (const skill of skills) {
  const dots = skill.dots.map((c) => [...c]);
  switch (skill.kind) {
    case 'letter':
      if (dots.length === 1) letterByKey.set(cellKey(dots[0] as Cell), skill.print);
      break;
    case 'number':
      if (dots.length === 1) digitByKey.set(cellKey(dots[0] as Cell), skill.print);
      break;
    case 'number-sign':
      numberSignCell = dots[0] as Cell;
      break;
    case 'punctuation':
      punctSigns.push(skill);
      break;
    case 'wordsign':
    case 'shortform':
      standaloneByKey.set(cellsKey(dots), skill.print);
      break;
    case 'contraction':
    case 'initial-letter':
      standaloneByKey.set(cellsKey(dots), skill.print);
      inWordSigns.push(skill);
      break;
    case 'groupsign':
    case 'final-letter':
      inWordSigns.push(skill);
      break;
    case 'lowersign':
      if (STANDALONE_LOWER.has(skill.print)) standaloneByKey.set(cellsKey(dots), skill.print);
      if (INTERIOR_LOWER.has(skill.print) || BEGWORD_LOWER.has(skill.print) ||
          skill.print === 'en' || skill.print === 'in') {
        inWordSigns.push(skill);
      }
      break;
  }
}
inWordSigns.sort((a, b) => b.dots.length - a.dots.length);
punctSigns.sort((a, b) => b.dots.length - a.dots.length);

// --- context-free (canonical) decoding -------------------------------------

/** Is the cell at `pos` a plain letter cell? (for lower-sign lookahead) */
function letterFollows(cells: ReadonlyArray<Cell>, pos: number): boolean {
  return pos < cells.length && letterByKey.has(cellKey(cells[pos] as Cell));
}

function countLetterCellsFrom(cells: ReadonlyArray<Cell>, pos: number): number {
  let n = 0;
  while (pos + n < cells.length && letterByKey.has(cellKey(cells[pos + n] as Cell))) n += 1;
  return n;
}

/** Decode-time analogue of braille.ts allowedInWord, with an open-word waiver. */
function allowedInWord(sign: Skill, atStart: boolean, cells: ReadonlyArray<Cell>, pos: number, final: boolean): boolean {
  const end = pos + sign.dots.length;
  switch (sign.kind) {
    case 'contraction':
    case 'initial-letter':
      return true;
    case 'groupsign':
      return sign.print === 'ing' ? !atStart : true;
    case 'final-letter':
      return !atStart;
    case 'lowersign':
      if (sign.print === 'en' || sign.print === 'in') return true;
      if (INTERIOR_LOWER.has(sign.print)) {
        if (atStart) return false;
        if (!final && end >= cells.length) return true; // more cells may come
        return letterFollows(cells, end);
      }
      // begword: be/con/dis
      if (!atStart) return false;
      if (!final && end >= cells.length) return true;
      return countLetterCellsFrom(cells, end) >= 3;
    default:
      return false;
  }
}

/** Longest punctuation sign matching at `pos`, or null. */
function matchPunct(cells: ReadonlyArray<Cell>, pos: number): { print: string; len: number } | null {
  for (const sign of punctSigns) {
    if (matchAt(cells, pos, sign.dots as ReadonlyArray<Cell>)) {
      return { print: sign.print, len: sign.dots.length };
    }
  }
  return null;
}

/** Greedy left-to-right decode of a cell run as letters/in-word signs/marks. */
function greedyDecode(cells: ReadonlyArray<Cell>, final: boolean, startAtWordStart: boolean): string {
  let result = '';
  let i = 0;
  let pendingCap = false;
  let atStart = startAtWordStart;
  while (i < cells.length) {
    const cell = cells[i] as Cell;
    if (cellsEqual(cell, CAP_LETTER)) {
      pendingCap = true;
      i += 1;
      continue;
    }
    let piece: string;
    let sign: Skill | undefined;
    for (const s of inWordSigns) {
      if (matchAt(cells, i, s.dots as ReadonlyArray<Cell>) && allowedInWord(s, atStart, cells, i, final)) {
        sign = s;
        break;
      }
    }
    if (sign !== undefined) {
      piece = sign.print;
      i += sign.dots.length;
    } else {
      const punct = matchPunct(cells, i);
      if (punct !== null) {
        piece = punct.print;
        i += punct.len;
      } else {
        const letter = letterByKey.get(cellKey(cell));
        piece = letter ?? dotsToUnicode([cell]);
        i += 1;
      }
    }
    if (pendingCap) {
      piece = capitalizeFirst(piece);
      pendingCap = false;
    }
    result += piece;
    atStart = false;
  }
  if (pendingCap) result += dotsToUnicode([CAP_LETTER]); // trailing indicator
  return result;
}

/** Decode a run known to start in digit mode (after the number sign). */
function decodeDigits(cells: ReadonlyArray<Cell>, final: boolean): string {
  let result = '';
  let i = 0;
  while (i < cells.length) {
    const digit = digitByKey.get(cellKey(cells[i] as Cell));
    if (digit === undefined) break;
    result += digit;
    i += 1;
  }
  if (i < cells.length) result += greedyDecode(cells.slice(i), final, false);
  return result;
}

/** Word-start decode: capitals, whole-word standalone sign, number sign. */
function decodeWordStart(cells: ReadonlyArray<Cell>, final: boolean): string {
  if (cells.length >= 3 && cellsEqual(cells[0] as Cell, CAP_WORD[0] as Cell) &&
      cellsEqual(cells[1] as Cell, CAP_WORD[1] as Cell)) {
    return decodeAfterCaps(cells.slice(2), final).toUpperCase();
  }
  if (cells.length >= 2 && cellsEqual(cells[0] as Cell, CAP_LETTER) &&
      !cellsEqual(cells[1] as Cell, CAP_LETTER)) {
    return capitalizeFirst(decodeAfterCaps(cells.slice(1), final));
  }
  return decodeAfterCaps(cells, final);
}

function decodeAfterCaps(cells: ReadonlyArray<Cell>, final: boolean): string {
  const standalone = standaloneByKey.get(cellsKey(cells));
  if (standalone !== undefined) return standalone;
  if (cells.length >= 1 && cellsEqual(cells[0] as Cell, numberSignCell)) {
    if (cells.length === 1) return dotsToUnicode([numberSignCell]); // lone number sign
    const digits = decodeDigits(cells.slice(1), final);
    if (digits !== '') return digits;
    return dotsToUnicode([numberSignCell]) + greedyDecode(cells.slice(1), final, true);
  }
  return greedyDecode(cells, final, true);
}

// --- public API ------------------------------------------------------------

/**
 * Decode one word's cells (no blank cells) to print. Always returns a string.
 * With `expected`, matches the buffer against translate(expected) so a correct
 * prefix shows the matching print prefix and a full match round-trips exactly;
 * a diverged tail is decoded canonically. Without `expected`, decodes purely
 * from the cells.
 */
export function backTranslateWord(cells: ReadonlyArray<Cell>, opts: BackTranslateOptions = {}): string {
  const final = opts.final ?? true;
  const expected = opts.expected;
  if (expected === undefined || expected === '') {
    return decodeWordStart(cells, final);
  }

  let exp;
  try {
    exp = translate(expected);
  } catch {
    return decodeWordStart(cells, final);
  }
  const expCells = exp.cells;

  // Longest common prefix of matched cells.
  let m = 0;
  while (m < cells.length && m < expCells.length && cellsEqual(cells[m] as Cell, expCells[m] as Cell)) {
    m += 1;
  }
  // Map the matched cells onto whole expected units to get the print prefix.
  let consumed = 0;
  let textEnd = 0;
  for (const unit of exp.units) {
    if (consumed + unit.cells.length <= m) {
      consumed += unit.cells.length;
      textEnd = unit.end;
    } else {
      break;
    }
  }
  const textPrefix = expected.slice(0, textEnd);
  const tail = cells.slice(consumed);
  if (tail.length === 0) return textPrefix;
  // The buffer still matches the expected prefix but ends mid-sign: pending,
  // emit nothing extra while the word is open (avoids a phantom mistake).
  if (!final && m === cells.length) return textPrefix;
  // Decode the diverged (or committed-but-incomplete) tail.
  const tailText =
    textPrefix.length > 0 ? greedyDecode(tail, final, false) : decodeWordStart(tail, final);
  return textPrefix + tailText;
}

/**
 * Decode a whole prompt buffer (blank cells mark spaces) against the prompt
 * text. Splits the buffer on blank cells and the text on spaces, pairs them up
 * positionally, decodes committed words as final and the last (open) word as
 * non-final, and joins with spaces.
 */
export function backTranslateBuffer(cells: ReadonlyArray<Cell>, expectedText: string): string {
  const groups: Cell[][] = [[]];
  for (const cell of cells) {
    if (cell.length === 0) groups.push([]);
    else (groups[groups.length - 1] as Cell[]).push(cell);
  }
  const words = expectedText.split(' ');
  return groups
    .map((group, i) => {
      const final = i < groups.length - 1;
      return backTranslateWord(group, { expected: words[i], final });
    })
    .join(' ');
}
