import { describe, expect, it } from 'vitest';
import type { Cell } from './braille';
import { textToCells, translate } from './braille';
import { WORDS } from './corpus';
import { QBF_SENTENCE } from './qbf';
import { backTranslateBuffer, backTranslateWord } from './backtranslate';

/** Cells for a whole print string (blank cells included), for buffer tests. */
function cellsOf(text: string): Cell[] {
  return textToCells(text).map((c) => [...c]);
}

describe('backTranslateWord — context-free', () => {
  it('reads standalone signs without context', () => {
    expect(backTranslateWord([[1, 2]])).toBe('but');
    expect(backTranslateWord([[2, 3, 6]])).toBe('his');
    expect(backTranslateWord([[2, 3, 4, 6]])).toBe('the');
    expect(backTranslateWord([[1], [1, 2]])).toBe('about');
    expect(backTranslateWord([[2, 6]])).toBe('enough');
    expect(backTranslateWord([[3, 5]])).toBe('in');
  });

  it('reads letters, capitals, and digit runs', () => {
    expect(backTranslateWord(cellsOf('The'))).toBe('The');
    expect(backTranslateWord(cellsOf('Cat'))).toBe('Cat');
    expect(backTranslateWord(cellsOf('THE'))).toBe('THE');
    expect(backTranslateWord(cellsOf('BAd'))).toBe('BAd');
    expect(backTranslateWord(cellsOf('I'))).toBe('I');
    expect(backTranslateWord([[3, 4, 5, 6], [1], [1, 2]])).toBe('12'); // ⠼⠁⠃
  });

  it('reads in-word contractions and lower signs by position', () => {
    expect(backTranslateWord(cellsOf('brown'))).toBe('brown');
    expect(backTranslateWord(cellsOf('jumped'))).toBe('jumped');
    expect(backTranslateWord(cellsOf('money'))).toBe('money');
    expect(backTranslateWord(cellsOf('sand'))).toBe('sand');
    expect(backTranslateWord(cellsOf('read'))).toBe('read');
    expect(backTranslateWord(cellsOf('rabbit'))).toBe('rabbit');
    expect(backTranslateWord(cellsOf('contact'))).toBe('contact');
    expect(backTranslateWord(cellsOf('found'))).toBe('found');
    expect(backTranslateWord(cellsOf('city'))).toBe('city');
  });

  it('capitalises a standalone sign (His) and reveals the collision', () => {
    // ⠠⠓ (dot-6 + his) reads as "His"; the identical cells are also ‘.
    expect(backTranslateWord([[6], [2, 3, 6]])).toBe('His');
    expect(cellsOf('‘')).toEqual([[6], [2, 3, 6]]); // same cells as ⠠ + his
  });
});

describe('backTranslateWord — with expected context', () => {
  it('shows the matching print prefix, not a standalone reading', () => {
    // ⠃ alone is "but"; while typing "bad" it must read "b" (no phantom miss).
    expect(backTranslateWord([[1, 2]], { expected: 'bad', final: false })).toBe('b');
    expect(backTranslateWord([[1, 2]], { final: false })).toBe('but');
  });

  it('lets context resolve a genuine cell collision', () => {
    expect(backTranslateWord([[6], [2, 3, 6]], { expected: '‘cat’', final: false })).toBe('‘');
    expect(backTranslateWord([[6], [2, 3, 6]])).toBe('His');
  });

  it('progressively decodes a word as cells arrive (canonical cells)', () => {
    expect(backTranslateWord([[1, 2]], { expected: 'band', final: false })).toBe('b');
    expect(backTranslateWord([[1, 2], [1, 2, 3, 4, 6]], { expected: 'band', final: false })).toBe(
      'band',
    );
  });

  it('accepts uncontracted spelling permissively', () => {
    // b, a, n, d spelled out (⠃⠁⠝⠙) still reads "band" even though the
    // canonical form contracts "and".
    const uncontracted: Cell[] = [[1, 2], [1], [1, 3, 4, 5], [1, 4, 5]];
    expect(backTranslateWord(uncontracted, { expected: 'band', final: false })).toBe('band');
  });

  it('waives interior lower-sign lookahead while the word is open', () => {
    // ⠓⠂ (h + ea/comma cell). Open: "hea" (ea may still get a letter).
    const cells: Cell[] = [[1, 2, 5], [2]];
    expect(backTranslateWord(cells, { final: false })).toBe('hea');
    // Committed with no following letter: the cell reads as a comma.
    expect(backTranslateWord(cells, { final: true })).toBe('h,');
  });

  it('holds pending indicators until they resolve, glyphs them when final', () => {
    expect(backTranslateWord([[6]], { expected: 'The', final: false })).toBe('');
    expect(backTranslateWord([[6], [6]], { expected: 'THE', final: false })).toBe('');
    expect(backTranslateWord([[3, 4, 5, 6]], { expected: '12', final: false })).toBe('');
    expect(backTranslateWord([[6]], { final: true })).toBe('⠠');
  });

  it('never throws and glyphs cells it cannot read at a word start', () => {
    const result = backTranslateWord([[4, 6], [1, 5]]); // ance cells, word-initial
    expect(result).toContain('⠨'); // dots 4-6 has no word-initial reading
    expect(() => backTranslateWord([[7 as number]])).not.toThrow();
  });
});

describe('backTranslateBuffer — punctuation in context', () => {
  const cases: Array<[string]> = [
    ['cab.'], ['hat, top'], ["cat's"], ['"cat"'], ['(dog)'], ['[dog]'],
    ['‘cat’'], ['“cat”'], ['day/if'], ['cat — dog'], ['3+4'], ['$7'],
    ['5%'], ['cab…'], ['cab?'],
  ];
  for (const [text] of cases) {
    it(`round-trips ${JSON.stringify(text)}`, () => {
      expect(backTranslateBuffer(cellsOf(text), text)).toBe(text);
    });
  }

  it('does not misread a terminal ⠦ as the wordsign "his"', () => {
    expect(backTranslateBuffer(cellsOf('cab?'), 'cab?')).toBe('cab?');
  });
});

describe('backTranslateBuffer — round-trip over the promptable universe', () => {
  function titleCase(w: string): string {
    return (w[0] ?? '').toUpperCase() + w.slice(1);
  }

  const universe = new Set<string>();
  const lettersOnly = WORDS.filter((w) => /^[a-z]+$/.test(w));
  for (const w of WORDS) universe.add(w);
  universe.add('I');
  for (const w of lettersOnly) {
    universe.add(titleCase(w));
    universe.add(w.toUpperCase());
  }
  // digit strings
  for (let a = 0; a <= 9; a += 1) {
    universe.add(String(a));
    for (let b = 0; b <= 9; b += 1) universe.add(`${a}${b}`);
  }
  universe.add('317');
  universe.add('900');
  // punctuation templates over a few concrete fills
  const fills = ['cat', 'dog', 'bee'];
  const digits = ['3', '7'];
  for (const w of fills) {
    universe.add(`${w}.`); universe.add(`${w}!`); universe.add(`${w}?`); universe.add(`${w}…`);
    universe.add(`${w}, ${w}`); universe.add(`${w}; ${w}`); universe.add(`${w}: ${w}`);
    universe.add(`${w}'s`);
    universe.add(`"${w}"`); universe.add(`(${w})`); universe.add(`[${w}]`);
    universe.add(`{${w}}`); universe.add(`‘${w}’`); universe.add(`“${w}”`);
    universe.add(`\`${w}\``);
    universe.add(`${w}-${w}`); universe.add(`${w}–${w}`); universe.add(`${w}/${w}`);
    universe.add(`${w}\\${w}`); universe.add(`${w}_${w}`); universe.add(`${w}|${w}`);
    universe.add(`${w}@${w}`); universe.add(`${w} — ${w}`); universe.add(`${w} & ${w}`);
  }
  for (const d of digits) {
    universe.add(`${d}+${d}`); universe.add(`${d}=${d}`); universe.add(`${d}<${d}`);
    universe.add(`${d}>${d}`); universe.add(`${d}^${d}`);
    universe.add(`~${d}`); universe.add(`#${d}`); universe.add(`$${d}`); universe.add(`${d}%`);
  }
  // multi-word sequences and the qbf sentence
  universe.add('the quick brown fox');
  universe.add('big red dog');
  universe.add(QBF_SENTENCE);

  it('covers a broad universe', () => {
    expect(universe.size).toBeGreaterThan(300);
  });

  for (const text of universe) {
    it(`round-trips ${JSON.stringify(text)}`, () => {
      // only test texts the forward translator accepts
      let cells: Cell[];
      try {
        cells = cellsOf(text);
      } catch {
        return;
      }
      expect(backTranslateBuffer(cells, text)).toBe(text);
    });
  }
});

describe('backTranslate fuzz', () => {
  it('never throws on random cell sequences', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let n = 0; n < 500; n += 1) {
      const len = Math.floor(rand() * 6);
      const cells: Cell[] = [];
      for (let i = 0; i < len; i += 1) {
        const dots: number[] = [];
        for (let d = 1; d <= 6; d += 1) if (rand() < 0.4) dots.push(d);
        cells.push(dots);
      }
      expect(() => backTranslateWord(cells)).not.toThrow();
      expect(() => backTranslateWord(cells, { expected: 'cat', final: false })).not.toThrow();
      expect(() => backTranslateBuffer(cells, 'cat dog')).not.toThrow();
    }
  });
});
