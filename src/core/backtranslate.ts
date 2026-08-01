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
//     print span. This makes backTranslateBuffer(translate(text).cells, text,
//     true) === text hold for every promptable text (the round-trip property,
//     stated over closed buffers — a trailing whole-word sign only reads as
//     the word once the word is closed), and a correctly-typed prefix shows
//     the matching print prefix — no phantom mistakes.
//   - The diverged tail (a wrong chord), text with no expected context, and
//     extra words are decoded by a greedy context-free decoder that mirrors
//     translate()'s rules well enough for error display. It never throws;
//     cells it cannot read become their U+2800 glyph (which never matches
//     prompt text, so the mistake stays visible).
//
// Decoding works in attributed pieces — (print, skill ids, cells) — so the
// same pass that derives the text also reports which signs the learner
// *actually* chorded. backTranslateBufferAttributed() exposes that as
// translation units; the fox challenge scores those instead of the canonical
// translation, so spelling a word out letter by letter credits the letters,
// not the contraction the learner never typed.

import type { Cell, TranslationUnit } from './braille';
import {
  capitalLetterSkill,
  capitalWordSkill,
  dotsToUnicode,
  numberSignSkill,
  translate,
} from './braille';
import {
  ANYWHERE_LOWER,
  BEGWORD_LOWER,
  INTERIOR_LOWER,
  MIN_BEGWORD_TAIL,
  STANDALONE_LOWER,
} from './lower-signs';
import { capitalizeFirst } from './text';
import type { Skill } from '../data/skills';
import { skills } from '../data/skills';

export interface BackTranslateOptions {
  /** The expected print for this word position (the prompt word). */
  readonly expected?: string;
  /** True once the word is committed (a space was typed, or an earlier word). */
  readonly final?: boolean;
}

/** One decoded sign: its print, the skills it exercises, the cells it used. */
interface Piece {
  readonly text: string;
  readonly skillIds: readonly string[];
  readonly cells: readonly Cell[];
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
function cellsKey(cells: readonly Cell[]): string {
  return cells.map(cellKey).join('-');
}

function matchAt(cells: readonly Cell[], pos: number, sign: readonly Cell[]): boolean {
  if (pos + sign.length > cells.length) return false;
  for (let i = 0; i < sign.length; i += 1) {
    if (!cellsEqual(cells[pos + i]!, sign[i]!)) return false;
  }
  return true;
}

// --- reverse lookup tables, built once from the skills data ----------------

const letterByKey = new Map<string, Skill>();
const digitByKey = new Map<string, Skill>();
const standaloneByKey = new Map<string, Skill>(); // whole-word signs
/** Signs usable inside a word, longest cell-sequence first. */
const inWordSigns: Skill[] = [];
/** Punctuation/symbol signs, longest cell-sequence first (multi-cell exist). */
const punctSigns: Skill[] = [];
// The indicator cells and ids, from the same skills data braille.ts derives
// its own from (no hard-coded fallbacks to drift out of sync).
const numberSignCell: Cell = numberSignSkill.dots[0] as Cell;
const numberSignId = numberSignSkill.id;
const capLetterId = capitalLetterSkill.id;
const capWordId = capitalWordSkill.id;
const CAP_LETTER: Cell = capitalLetterSkill.dots[0] as Cell;
const CAP_WORD: readonly Cell[] = capitalWordSkill.dots;

for (const skill of skills) {
  const dots = skill.dots.map((c) => [...c]);
  switch (skill.kind) {
    case 'letter':
      if (dots.length === 1) letterByKey.set(cellKey(dots[0] as Cell), skill);
      break;
    case 'number':
      if (dots.length === 1) digitByKey.set(cellKey(dots[0] as Cell), skill);
      break;
    case 'punctuation':
      punctSigns.push(skill);
      break;
    case 'wordsign':
    case 'shortform':
      standaloneByKey.set(cellsKey(dots), skill);
      break;
    case 'contraction':
    case 'initial-letter':
      standaloneByKey.set(cellsKey(dots), skill);
      inWordSigns.push(skill);
      break;
    case 'groupsign':
    case 'final-letter':
      inWordSigns.push(skill);
      break;
    case 'lowersign':
      if (STANDALONE_LOWER.has(skill.print)) standaloneByKey.set(cellsKey(dots), skill);
      if (
        INTERIOR_LOWER.has(skill.print) ||
        BEGWORD_LOWER.has(skill.print) ||
        ANYWHERE_LOWER.has(skill.print)
      ) {
        inWordSigns.push(skill);
      }
      break;
  }
}
inWordSigns.sort((a, b) => b.dots.length - a.dots.length);
punctSigns.sort((a, b) => b.dots.length - a.dots.length);

// --- context-free (canonical) decoding -------------------------------------

/** Is the cell at `pos` a plain letter cell? (for lower-sign lookahead) */
function letterFollows(cells: readonly Cell[], pos: number): boolean {
  return pos < cells.length && letterByKey.has(cellKey(cells[pos]!));
}

function countLetterCellsFrom(cells: readonly Cell[], pos: number): number {
  let n = 0;
  while (pos + n < cells.length && letterByKey.has(cellKey(cells[pos + n]!))) n += 1;
  return n;
}

/** Decode-time analogue of braille.ts allowedInWord, with an open-word waiver. */
function allowedInWord(sign: Skill, atStart: boolean, cells: readonly Cell[], pos: number, final: boolean): boolean {
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
      if (ANYWHERE_LOWER.has(sign.print)) return true;
      if (INTERIOR_LOWER.has(sign.print)) {
        if (atStart) return false;
        if (!final && end >= cells.length) return true; // more cells may come
        return letterFollows(cells, end);
      }
      // begword: be/con/dis
      if (!atStart) return false;
      if (!final && end >= cells.length) return true;
      return countLetterCellsFrom(cells, end) >= MIN_BEGWORD_TAIL;
    default:
      return false;
  }
}

/** Longest punctuation sign matching at `pos`, or null. */
function matchPunct(cells: readonly Cell[], pos: number): Skill | null {
  for (const sign of punctSigns) {
    if (matchAt(cells, pos, sign.dots)) return sign;
  }
  return null;
}

/** Greedy left-to-right decode of a cell run as letters/in-word signs/marks. */
function greedyPieces(cells: readonly Cell[], final: boolean, startAtWordStart: boolean): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  let pendingCaps: Cell[] = [];
  let atStart = startAtWordStart;
  while (i < cells.length) {
    const cell = cells[i]!;
    if (cellsEqual(cell, CAP_LETTER)) {
      pendingCaps.push(cell);
      i += 1;
      continue;
    }
    let text: string;
    let skillIds: string[];
    let used: Cell[];
    let sign: Skill | undefined;
    for (const s of inWordSigns) {
      if (matchAt(cells, i, s.dots) && allowedInWord(s, atStart, cells, i, final)) {
        sign = s;
        break;
      }
    }
    if (sign !== undefined) {
      text = sign.print;
      skillIds = [sign.id];
      used = cells.slice(i, i + sign.dots.length);
      i += sign.dots.length;
    } else {
      const punct = matchPunct(cells, i);
      if (punct !== null) {
        text = punct.print;
        skillIds = [punct.id];
        used = cells.slice(i, i + punct.dots.length);
        i += punct.dots.length;
      } else {
        const letter = letterByKey.get(cellKey(cell));
        text = letter?.print ?? dotsToUnicode([cell]);
        skillIds = letter !== undefined ? [letter.id] : [];
        used = [cell];
        i += 1;
      }
    }
    if (pendingCaps.length > 0) {
      text = capitalizeFirst(text);
      skillIds = [capLetterId, ...skillIds];
      used = [...pendingCaps, ...used];
      pendingCaps = [];
    }
    out.push({ text, skillIds, cells: used });
    atStart = false;
  }
  // Trailing indicator with nothing to capitalise: keep it visible.
  if (pendingCaps.length > 0) {
    out.push({ text: dotsToUnicode([CAP_LETTER]), skillIds: [], cells: pendingCaps });
  }
  return out;
}

/** Decode a run known to start in digit mode (after the number sign). */
function digitPieces(cells: readonly Cell[], final: boolean): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < cells.length) {
    const digit = digitByKey.get(cellKey(cells[i]!));
    if (digit === undefined) break;
    // The number sign rides with the first digit, as translate() has it.
    out.push(
      i === 0
        ? { text: digit.print, skillIds: [numberSignId, digit.id], cells: [numberSignCell, cells[i]!] }
        : { text: digit.print, skillIds: [digit.id], cells: [cells[i]!] },
    );
    i += 1;
  }
  if (i < cells.length) out.push(...greedyPieces(cells.slice(i), final, false));
  return out;
}

/** Word-start decode: capitals, whole-word standalone sign, number sign. */
function decodeWordStartPieces(cells: readonly Cell[], final: boolean): Piece[] {
  if (cells.length >= 3 && cellsEqual(cells[0]!, CAP_WORD[0]!) &&
      cellsEqual(cells[1]!, CAP_WORD[1]!)) {
    return decodeAfterCapsPieces(cells.slice(2), final).map((p, idx) =>
      idx === 0
        ? {
            text: p.text.toUpperCase(),
            skillIds: [capWordId, ...p.skillIds],
            cells: [...CAP_WORD, ...p.cells],
          }
        : { ...p, text: p.text.toUpperCase() },
    );
  }
  if (cells.length >= 2 && cellsEqual(cells[0]!, CAP_LETTER) &&
      !cellsEqual(cells[1]!, CAP_LETTER)) {
    return decodeAfterCapsPieces(cells.slice(1), final).map((p, idx) =>
      idx === 0
        ? {
            text: capitalizeFirst(p.text),
            skillIds: [capLetterId, ...p.skillIds],
            cells: [CAP_LETTER, ...p.cells],
          }
        : p,
    );
  }
  return decodeAfterCapsPieces(cells, final);
}

function decodeAfterCapsPieces(cells: readonly Cell[], final: boolean): Piece[] {
  // A standalone (whole-word) reading only exists once the word is closed by
  // a space: while the word is open, ⠞ may be "that" or the start of a word
  // spelled letter by letter ("the" as t-h-e). Judging it early fails runs
  // that were on their way to correct print.
  if (final) {
    const standalone = standaloneByKey.get(cellsKey(cells));
    if (standalone !== undefined) {
      return [{ text: standalone.print, skillIds: [standalone.id], cells: [...cells] }];
    }
  }
  if (cells.length >= 1 && cellsEqual(cells[0]!, numberSignCell)) {
    if (cells.length === 1) {
      // Lone number sign: nothing decodable yet, shown as its glyph.
      return [{ text: dotsToUnicode([numberSignCell]), skillIds: [], cells: [numberSignCell] }];
    }
    const digits = digitPieces(cells.slice(1), final);
    if (digits.map((p) => p.text).join('') !== '') return digits;
    return [
      { text: dotsToUnicode([numberSignCell]), skillIds: [], cells: [numberSignCell] },
      ...greedyPieces(cells.slice(1), final, true),
    ];
  }
  return greedyPieces(cells, final, true);
}

/** Decode one word's cells to attributed pieces (see backTranslateWord). */
function wordPieces(cells: readonly Cell[], opts: BackTranslateOptions = {}): Piece[] {
  const final = opts.final ?? true;
  const expected = opts.expected;
  if (expected === undefined || expected === '') {
    return decodeWordStartPieces(cells, final);
  }

  let exp;
  try {
    exp = translate(expected);
  } catch {
    return decodeWordStartPieces(cells, final);
  }
  const expCells = exp.cells;

  // Longest common prefix of matched cells.
  let m = 0;
  while (m < cells.length && m < expCells.length && cellsEqual(cells[m]!, expCells[m]!)) {
    m += 1;
  }
  // Map the matched cells onto whole expected units: the learner chorded
  // exactly those sign cells, so the canonical attribution is the true one.
  let consumed = 0;
  const matched: Piece[] = [];
  for (const unit of exp.units) {
    if (consumed + unit.cells.length <= m) {
      consumed += unit.cells.length;
      matched.push({
        text: expected.slice(unit.start, unit.end),
        skillIds: unit.skillIds,
        cells: unit.cells,
      });
    } else {
      break;
    }
  }
  const tail = cells.slice(consumed);
  if (tail.length === 0) {
    // The whole expected word matched while the word is still open. When the
    // buffer is a whole-word sign that doubles as ordinary spelling (the "can"
    // wordsign is the letter-c cell), reading it as the word jumps ahead of a
    // learner spelling it out: their next chords would land past the word — or,
    // at the end of a prompt, on the next prompt. Standalone readings only
    // exist once the word is closed (decodeAfterCapsPieces applies the same
    // rule), so while a longer spelling could still reach the expected print,
    // keep the context-free reading — a prefix. A sign with no such prefix
    // reading (⠯ "and" is no letter) still reads as the word straight away.
    if (!final && matched.length > 0 && pieceText(matched) === expected) {
      const contextFree = decodeWordStartPieces(cells, final);
      const text = pieceText(contextFree);
      if (text !== expected && expected.startsWith(text)) return contextFree;
    }
    return matched;
  }
  // The buffer still matches the expected prefix but ends mid-sign: pending,
  // emit nothing extra while the word is open (avoids a phantom mistake).
  if (!final && m === cells.length) return matched;
  // Decode the diverged (or committed-but-incomplete) tail.
  const tailPieces =
    matched.length > 0 ? greedyPieces(tail, final, false) : decodeWordStartPieces(tail, final);
  const result = [...matched, ...tailPieces];
  // A whole-word sign can share its cell with the first letter of the word it
  // stands for (the "can" wordsign is the letter-c cell), so a spelled-out
  // word can collide with its own canonical cells: chording c,a towards
  // "can't" makes the matched pass above consume the ⠉ as the whole "can"
  // unit and read the ⠁ as a diverged tail — "cana", a phantom mistake in the
  // middle of a perfectly valid grade-1 spelling. When the matched reading
  // has diverged from the expected print but the pure context-free reading of
  // the whole group has not, the learner is mid-way through such an alternate
  // spelling: prefer that reading (it also credits the signs actually
  // chorded). When both readings diverge the chord was genuinely wrong, and
  // the matched reading keeps the mistake visible exactly as before.
  if (matched.length > 0 && !expected.startsWith(pieceText(result))) {
    const contextFree = decodeWordStartPieces(cells, final);
    if (expected.startsWith(pieceText(contextFree))) return contextFree;
  }
  return result;
}

/** The print a piece list decodes to. */
function pieceText(pieces: readonly Piece[]): string {
  return pieces.map((p) => p.text).join('');
}

// --- public API ------------------------------------------------------------

/**
 * Decode one word's cells (no blank cells) to print. Always returns a string.
 * With `expected`, matches the buffer against translate(expected) so a correct
 * prefix shows the matching print prefix and a full match round-trips exactly;
 * a diverged tail is decoded canonically. Without `expected`, decodes purely
 * from the cells.
 */
export function backTranslateWord(cells: readonly Cell[], opts: BackTranslateOptions = {}): string {
  return pieceText(wordPieces(cells, opts));
}

/** A buffer decode that also reports which signs were actually chorded. */
export interface AttributedBackTranslation {
  /** The derived print text (identical to backTranslateBuffer's result). */
  readonly text: string;
  /**
   * The decoded signs as translation units over `text` (spaces included as
   * skill-less units, mirroring translate()). When the buffer follows the
   * canonical translation these match translate(text).units; when the learner
   * spells signs out, the units carry the letters actually chorded instead.
   */
  readonly units: readonly TranslationUnit[];
}

/**
 * Decode a whole prompt buffer (blank cells mark spaces) against the prompt
 * text, reporting the signs actually chorded alongside the derived print.
 * Splits the buffer on blank cells and the text on spaces, pairs them up
 * positionally, decodes committed words as final and the last word as
 * non-final (still open under the caret), and joins with spaces. Pass
 * `closed` when the buffer is known to be committed input — the last word
 * then decodes as final too, which is what gives a trailing whole-word sign
 * its standalone reading (the round-trip property is stated over closed
 * buffers: backTranslateBuffer(translate(text).cells, text, true) === text).
 */
export function backTranslateBufferAttributed(
  cells: readonly Cell[],
  expectedText: string,
  closed = false,
): AttributedBackTranslation {
  const groups: Cell[][] = [[]];
  for (const cell of cells) {
    if (cell.length === 0) groups.push([]);
    else (groups[groups.length - 1]!).push(cell);
  }
  const words = expectedText.split(' ');
  const units: TranslationUnit[] = [];
  const texts: string[] = [];
  let offset = 0;
  groups.forEach((group, i) => {
    if (i > 0) {
      // The blank cell between groups, mirroring translate()'s space units.
      units.push({ start: offset - 1, end: offset, cells: [[]], skillIds: [] });
    }
    const final = closed || i < groups.length - 1;
    const pieces = wordPieces(group, { expected: words[i], final });
    let pos = offset;
    for (const piece of pieces) {
      units.push({ start: pos, end: pos + piece.text.length, cells: piece.cells, skillIds: piece.skillIds });
      pos += piece.text.length;
    }
    const wordText = pieces.map((p) => p.text).join('');
    texts.push(wordText);
    offset += wordText.length + 1;
  });
  return { text: texts.join(' '), units };
}

/**
 * Decode a whole prompt buffer (blank cells mark spaces) against the prompt
 * text. Splits the buffer on blank cells and the text on spaces, pairs them up
 * positionally, decodes committed words as final and the last word per
 * `closed` (see backTranslateBufferAttributed), and joins with spaces.
 */
export function backTranslateBuffer(
  cells: readonly Cell[],
  expectedText: string,
  closed = false,
): string {
  return backTranslateBufferAttributed(cells, expectedText, closed).text;
}
