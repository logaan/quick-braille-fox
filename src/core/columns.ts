// The aligned four-row column model: one grid shared by the prompt's print,
// its braille, the learner's braille and the learner's print.
//
// Every row of the drill is laid out against the *same* columns, one per
// translation unit, so a contraction's three letters of print sit over its
// single cell and a capital's two cells sit over its one letter. The
// alignment rules are fiddly enough — diverged tails, whole-word VoiceOver
// rewrites, multi-cell units — that they live here, pure and directly
// testable, rather than being rediscovered inside a render.
//
// Two independent walks fill a column in:
//   - print, by the common prefix of the target text and what was typed;
//   - cells, by matching the chorded buffer against the units' expected cells.
// Whatever either walk cannot attribute to a column (a diverged tail, an
// overflow past the end of the prompt, a half-finished multi-cell sign)
// becomes extraPrint/extraUnicode, shown past the last matched column.

import type { Set } from 'immutable';
import type { Cell } from './braille';
import { dotsToUnicode, translate } from './braille';

/** One column of the drill grid: a single translation unit of the prompt. */
export interface Column {
  /** Index in the prompt's translation units; parity drives the tint. */
  readonly index: number;
  /** Print span of the target text this column covers. */
  readonly start: number;
  readonly end: number;
  readonly printTarget: string;
  /** Expected cells, as U+2800 (may be several: capital + letter, etc). */
  readonly expectedUnicode: string;
  /** True once this unit's hint has been revealed. */
  readonly hintRevealed: boolean;
  /** Print the learner has actually produced for this column, if matched. */
  readonly printTyped: string | null;
  /** Cells the learner chorded for this column (emulated mode), if matched. */
  readonly typedUnicode: string | null;
  /** This column is where the caret currently sits. */
  readonly caret: boolean;
}

/** The whole grid: the columns, plus anything that fell outside them. */
export interface RowModel {
  readonly columns: ReadonlyArray<Column>;
  /** Diverged / overflowing print, past the last matched column. */
  readonly extraPrint: string;
  /** Diverged / overflowing cells, past the last matched column. */
  readonly extraUnicode: string;
}

export interface RowModelInput {
  readonly text: string;
  readonly typed: string;
  /** The chorded cell buffer; empty in VoiceOver mode. */
  readonly cells: ReadonlyArray<Cell>;
  readonly hintedUnits: Set<number>;
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

function cellsEqual(a: Cell, b: Cell): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * How many of `cells` the learner has typed that match the units' expected
 * cells, counting only *whole* units: the walk stops at the first cell that
 * differs, and a unit whose cells run out mid-way does not count either.
 * Returns the number of units matched and the number of cells they consumed.
 */
function matchCells(
  units: ReadonlyArray<{ readonly cells: ReadonlyArray<Cell> }>,
  cells: ReadonlyArray<Cell>,
): { units: number; cells: number } {
  let consumed = 0;
  let matched = 0;
  for (const unit of units) {
    if (consumed + unit.cells.length > cells.length) break;
    let ok = true;
    for (let i = 0; i < unit.cells.length; i += 1) {
      if (!cellsEqual(cells[consumed + i] as Cell, unit.cells[i] as Cell)) {
        ok = false;
        break;
      }
    }
    if (!ok) break;
    consumed += unit.cells.length;
    matched += 1;
  }
  return { units: matched, cells: consumed };
}

/**
 * Print the learner has produced for the column [start, end), given that the
 * first `prefix` characters of the target have been typed correctly: the
 * whole span once it is covered, the part typed so far while the caret is
 * inside it, and null before the caret reaches it.
 */
function printTypedFor(text: string, start: number, end: number, prefix: number): string | null {
  if (end <= prefix) return text.slice(start, end);
  if (start < prefix) return text.slice(start, prefix);
  return null;
}

/**
 * The model for text that translate() cannot handle: one column carrying the
 * whole text, no expected cells, everything typed treated as extra. Keeps
 * the drill renderable instead of propagating the throw.
 */
function degenerateModel(input: RowModelInput): RowModel {
  const { text, typed, cells, hintedUnits } = input;
  const prefix = commonPrefixLength(text, typed);
  return {
    columns: [
      {
        index: 0,
        start: 0,
        end: text.length,
        printTarget: text,
        expectedUnicode: '',
        hintRevealed: hintedUnits.has(0),
        printTyped: printTypedFor(text, 0, text.length, prefix),
        typedUnicode: null,
        caret: prefix < text.length,
      },
    ],
    extraPrint: typed.slice(prefix),
    extraUnicode: dotsToUnicode(cells),
  };
}

/**
 * Build the aligned column model for one prompt. Pure: the same inputs always
 * give the same grid, and nothing here knows about the DOM or the input mode
 * (VoiceOver simply passes an empty `cells`, leaving every typedUnicode null).
 */
export function buildRowModel(input: RowModelInput): RowModel {
  const { text, typed, cells, hintedUnits } = input;
  let units;
  try {
    units = translate(text).units;
  } catch {
    return degenerateModel(input);
  }

  const prefix = commonPrefixLength(text, typed);
  const cellMatch = matchCells(units, cells);
  // The caret sits on the first unit the correct prefix does not fully cover.
  const caretIndex = units.findIndex((unit) => unit.end > prefix);

  const columns: Column[] = units.map((unit, index) => ({
    index,
    start: unit.start,
    end: unit.end,
    printTarget: text.slice(unit.start, unit.end),
    expectedUnicode: dotsToUnicode(unit.cells),
    hintRevealed: hintedUnits.has(index),
    printTyped: printTypedFor(text, unit.start, unit.end, prefix),
    typedUnicode: index < cellMatch.units ? dotsToUnicode(unit.cells) : null,
    caret: index === caretIndex,
  }));

  return {
    columns,
    extraPrint: typed.slice(prefix),
    extraUnicode: dotsToUnicode(cells.slice(cellMatch.cells)),
  };
}
