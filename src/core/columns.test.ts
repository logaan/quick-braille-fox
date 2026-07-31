import { Set } from 'immutable';
import { describe, expect, it } from 'vitest';
import type { Cell } from './braille';
import { textToCells } from './braille';
import type { RowModel } from './columns';
import { buildRowModel } from './columns';

function model(
  text: string,
  typed = '',
  cells: readonly Cell[] = [],
  hinted: number[] = [],
): RowModel {
  return buildRowModel({ text, typed, cells, hintedUnits: Set(hinted) });
}

/** The columns as "printTarget|expectedUnicode" pairs, for readability. */
function grid(m: RowModel): string[] {
  return m.columns.map((c) => `${c.printTarget}|${c.expectedUnicode}`);
}

function caretIndex(m: RowModel): number | null {
  const found = m.columns.find((c) => c.caret);
  return found ? found.index : null;
}

describe('buildRowModel columns', () => {
  it('gives one column per letter of a plain word', () => {
    const m = model('dog');
    expect(grid(m)).toEqual(['d|⠙', 'o|⠕', 'g|⠛']);
    expect(m.columns.map((c) => [c.start, c.end])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(m.columns.every((c) => c.printTyped === null && c.typedUnicode === null)).toBe(true);
    expect(m.extraPrint).toBe('');
    expect(m.extraUnicode).toBe('');
  });

  it('keeps a capitalised word’s indicator in its letter’s column', () => {
    // "The" is one unit: two cells, three characters of print.
    expect(grid(model('The'))).toEqual(['The|⠠⠮']);
  });

  it('gives a contraction one column spanning all its print', () => {
    expect(grid(model('the'))).toEqual(['the|⠮']);
  });

  it('folds the number sign into the first digit’s column', () => {
    expect(grid(model('12'))).toEqual(['1|⠼⠁', '2|⠃']);
  });

  it('gives a space its own column with one blank cell', () => {
    const m = model('the dog');
    expect(grid(m)).toEqual(['the|⠮', ' |⠀', 'd|⠙', 'o|⠕', 'g|⠛']);
  });

  it('marks the units whose hint has been revealed', () => {
    const m = model('the dog', '', [], [0, 2]);
    expect(m.columns.map((c) => c.hintRevealed)).toEqual([true, false, true, false, false]);
  });
});

describe('buildRowModel print', () => {
  it('fills covered columns and leaves the rest null', () => {
    const m = model('the dog', 'the d');
    expect(m.columns.map((c) => c.printTyped)).toEqual(['the', ' ', 'd', null, null]);
    expect(m.extraPrint).toBe('');
  });

  it('gives the caret’s column the part of it typed so far', () => {
    // Two of "the"'s three characters typed: one partial column, then nulls.
    const m = model('the dog', 'th');
    expect(m.columns.map((c) => c.printTyped)).toEqual(['th', null, null, null, null]);
  });

  it('puts a diverged tail in extraPrint', () => {
    const m = model('the dog', 'the dx');
    expect(m.columns.map((c) => c.printTyped)).toEqual(['the', ' ', 'd', null, null]);
    expect(m.extraPrint).toBe('x');
    expect(caretIndex(m)).toBe(3);
  });

  it('puts print typed past the end of the prompt in extraPrint', () => {
    const m = model('the', 'the dog');
    expect(m.columns.map((c) => c.printTyped)).toEqual(['the']);
    expect(m.extraPrint).toBe(' dog');
  });
});

describe('buildRowModel caret', () => {
  it('sits on the first column the correct prefix does not cover', () => {
    expect(caretIndex(model('the dog', ''))).toBe(0);
    expect(caretIndex(model('the dog', 'the'))).toBe(1);
    expect(caretIndex(model('the dog', 'the '))).toBe(2);
  });

  it('is nowhere once the prompt is fully typed', () => {
    expect(caretIndex(model('the dog', 'the dog'))).toBeNull();
    expect(caretIndex(model('the', 'the dog'))).toBeNull();
  });
});

describe('buildRowModel cells', () => {
  it('leaves every column unmatched with no cells (VoiceOver mode)', () => {
    const m = model('the dog', 'the');
    expect(m.columns.every((c) => c.typedUnicode === null)).toBe(true);
    expect(m.extraUnicode).toBe('');
  });

  it('fills the columns the cell buffer matches, in order', () => {
    // "do" on its own is a wordsign, so take the first two cells of "dog".
    const m = model('dog', 'do', textToCells('dog').slice(0, 2));
    expect(m.columns.map((c) => c.typedUnicode)).toEqual(['⠙', '⠕', null]);
    expect(m.extraUnicode).toBe('');
  });

  it('stops at the first mismatched cell and spills the rest', () => {
    const cells = [...textToCells('dog').slice(0, 2), ...textToCells('x')];
    const m = model('dog', 'do', cells);
    expect(m.columns.map((c) => c.typedUnicode)).toEqual(['⠙', '⠕', null]);
    expect(m.extraUnicode).toBe('⠭');
  });

  it('holds a half-finished multi-cell unit back as extra cells', () => {
    // The capital indicator alone does not complete "The"'s single column.
    const cells = textToCells('The').slice(0, 1);
    const m = model('The', '', cells);
    expect(m.columns.map((c) => c.typedUnicode)).toEqual([null]);
    expect(m.extraUnicode).toBe('⠠');
    // The whole unit chorded does fill it.
    expect(model('The', 'The', textToCells('The')).columns[0]?.typedUnicode).toBe('⠠⠮');
  });

  it('spills cells chorded past the end of the prompt', () => {
    const m = model('dog', 'dog', [...textToCells('dog'), ...textToCells('x')]);
    expect(m.columns.map((c) => c.typedUnicode)).toEqual(['⠙', '⠕', '⠛']);
    expect(m.extraUnicode).toBe('⠭');
  });
});

describe('buildRowModel with untranslatable text', () => {
  it('degrades to one column rather than throwing', () => {
    const m = model('café', 'caf', textToCells('ca'), [0]);
    expect(m.columns).toEqual([
      {
        index: 0,
        start: 0,
        end: 4,
        printTarget: 'café',
        expectedUnicode: '',
        hintRevealed: true,
        printTyped: 'caf',
        typedUnicode: null,
        caret: true,
      },
    ]);
    expect(m.extraPrint).toBe('');
    expect(m.extraUnicode).toBe('⠉⠁');
  });

  it('has no caret once the degenerate column is fully typed', () => {
    const m = model('café', 'café');
    expect(caretIndex(m)).toBeNull();
    expect(m.columns[0]?.printTyped).toBe('café');
  });
});
