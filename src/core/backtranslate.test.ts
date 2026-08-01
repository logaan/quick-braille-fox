import { describe, expect, it } from 'vitest';
import type { Cell } from './braille';
import { textToCells, translate } from './braille';
import { WORDS } from './corpus';
import { FOX_SENTENCE } from './fox';
import {
  backTranslateBuffer,
  backTranslateBufferAttributed,
  backTranslateWord,
} from './backtranslate';

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
    // Even with no expected word, "but" needs a closing space to exist: an
    // open ⠃ may be the first letter of a spelled-out word.
    expect(backTranslateWord([[1, 2]], { final: false })).toBe('b');
    expect(backTranslateWord([[1, 2]], { final: true })).toBe('but');
  });

  it('never reads an open word as a standalone sign (letter-by-letter The)', () => {
    // Spelling "The" as ⠠⠞... : after ⠠⠞ the diverged-from-canonical buffer
    // must read "T", not the wordsign "That" — t-h-e is still on its way.
    expect(backTranslateWord([[6], [2, 3, 4, 5]], { expected: 'The', final: false })).toBe('T');
    const the: Cell[] = [[6], [2, 3, 4, 5], [1, 2, 5], [1, 5]];
    expect(backTranslateWord(the, { expected: 'The', final: false })).toBe('The');
    expect(backTranslateWord(the, { expected: 'The', final: true })).toBe('The');
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

  it('spells a wordsign word out letter by letter without a phantom tail', () => {
    // The "can" wordsign is the letter-c cell, so canonical "can" is [⠉] and
    // a spelled-out c,a used to decode as the whole "can" unit plus a
    // diverged "a" — "cana", a phantom mistake mid-way through a valid
    // grade-1 spelling.
    const c: Cell = [1, 4];
    const a: Cell = [1];
    const n: Cell = [1, 3, 4, 5];
    expect(backTranslateWord([c, a], { expected: 'can', final: false })).toBe('ca');
    expect(backTranslateWord([c, a, n], { expected: 'can', final: false })).toBe('can');
    expect(backTranslateWord([c, a, n], { expected: 'can', final: true })).toBe('can');
  });

  it("spells an apostrophe word whose stem is a wordsign (can't)", () => {
    const spelled: Cell[] = [[1, 4], [1], [1, 3, 4, 5], [3], [2, 3, 4, 5]]; // c,a,n,',t
    for (let len = 1; len <= spelled.length; len += 1) {
      const out = backTranslateWord(spelled.slice(0, len), { expected: "can't", final: false });
      expect("can't".startsWith(out), out).toBe(true);
    }
    expect(backTranslateWord(spelled, { expected: "can't", final: false })).toBe("can't");
    expect(backTranslateWord(spelled, { expected: "can't", final: true })).toBe("can't");
  });

  it("spells that's out letter by letter (wordsign-that stem)", () => {
    const spelled: Cell[] = [[2, 3, 4, 5], [1, 2, 5], [1], [2, 3, 4, 5], [3], [2, 3, 4]];
    for (let len = 1; len <= spelled.length; len += 1) {
      const out = backTranslateWord(spelled.slice(0, len), { expected: "that's", final: false });
      expect("that's".startsWith(out), out).toBe(true);
    }
    expect(backTranslateWord(spelled, { expected: "that's", final: true })).toBe("that's");
  });

  it('keeps a whole-word sign at its letter reading while the word is open', () => {
    // ⠉ toward exactly "can": the learner may be mid-way through spelling
    // c,a,n — the standalone reading would jump ahead of them (and complete
    // a print-judged prompt early, landing their remaining chords on the
    // next prompt). While a longer spelling could still reach the expected
    // print, the open reading stays the prefix actually chorded.
    expect(backTranslateWord([[1, 4]], { expected: 'can', final: false })).toBe('c');
    expect(backTranslateWord([[3, 4]], { expected: 'still', final: false })).toBe('st');
    expect(backTranslateWord([[6], [1, 4]], { expected: 'Can', final: false })).toBe('C');
  });

  it('reads a whole-word sign with no spelling reading straight away', () => {
    // ⠯ ("and") is no letter — nothing longer could still reach the word.
    expect(backTranslateWord([[1, 2, 3, 4, 6]], { expected: 'and', final: false })).toBe('and');
    // ⠭ is the "it" wordsign but reads as the letter x, not a prefix of "it".
    expect(backTranslateWord([[1, 3, 4, 6]], { expected: 'it', final: false })).toBe('it');
  });

  it('closes the last word of a buffer only when the buffer is closed', () => {
    const cells = cellsOf('the can');
    expect(backTranslateBuffer(cells, 'the can')).toBe('the c');
    expect(backTranslateBuffer(cells, 'the can', true)).toBe('the can');
  });

  it('still reads the wordsign itself when it was chorded', () => {
    // Buffer [⠉] alone, committed final: the standalone reading must win.
    expect(backTranslateWord([[1, 4]], { expected: 'can', final: true })).toBe('can');
    expect(backTranslateWord([[1, 4]], { expected: "can't", final: false })).toBe('can');
    expect(backTranslateWord([[1, 4], [3], [2, 3, 4, 5]], { expected: "can't", final: true })).toBe(
      "can't",
    );
  });

  it('keeps a genuinely wrong chord visible after a colliding start', () => {
    // c then b towards "can't": no valid spelling reads this, so the decode
    // must still surface diverged print, not hide the mistake.
    const out = backTranslateWord([[1, 4], [1, 2]], { expected: "can't", final: false });
    expect("can't".startsWith(out)).toBe(false);
    expect(out.length).toBeGreaterThan(0);
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
    expect(() => backTranslateWord([[7]])).not.toThrow();
  });
});

describe('backTranslateBuffer — punctuation in context', () => {
  const cases: [string][] = [
    ['cab.'], ['hat, top'], ["cat's"], ['"cat"'], ['(dog)'], ['[dog]'],
    ['‘cat’'], ['“cat”'], ['day/if'], ['cat — dog'], ['3+4'], ['$7'],
    ['5%'], ['cab…'], ['cab?'],
  ];
  for (const [text] of cases) {
    it(`round-trips ${JSON.stringify(text)}`, () => {
      expect(backTranslateBuffer(cellsOf(text), text, true)).toBe(text);
    });
  }

  it('does not misread a terminal ⠦ as the wordsign "his"', () => {
    expect(backTranslateBuffer(cellsOf('cab?'), 'cab?', true)).toBe('cab?');
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
  // multi-word sequences and the fox sentence
  universe.add('the quick brown fox');
  universe.add('big red dog');
  universe.add(FOX_SENTENCE);

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
      // Closed: a committed buffer round-trips exactly. Open, a trailing
      // whole-word sign keeps its spelling-prefix reading (see the open-word
      // deferral tests), so the property is stated over closed buffers.
      expect(backTranslateBuffer(cells, text, true)).toBe(text);
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

describe('backTranslateBufferAttributed — signs actually chorded', () => {
  it('matches translate() attribution when the buffer is canonical', () => {
    const { text, units } = backTranslateBufferAttributed(cellsOf(FOX_SENTENCE), FOX_SENTENCE);
    expect(text).toBe(FOX_SENTENCE);
    expect(units).toEqual(translate(FOX_SENTENCE).units);
  });

  it('credits the letters actually chorded, not the canonical contraction', () => {
    // ⠠⠞⠓⠑␣ — "The" spelled out. The canonical translation would say
    // contraction-the; the learner typed the letters.
    const { text, units } = backTranslateBufferAttributed(
      [[6], [2, 3, 4, 5], [1, 2, 5], [1, 5], []],
      FOX_SENTENCE,
    );
    expect(text).toBe('The ');
    expect(units.map((u) => u.skillIds)).toEqual([
      ['capital-letter-indicator', 'letter-t'],
      ['letter-h'],
      ['letter-e'],
      [],
    ]);
  });

  it('credits the contraction when the learner chorded it', () => {
    const { units } = backTranslateBufferAttributed([[6], [2, 3, 4, 6], []], FOX_SENTENCE);
    expect(units.map((u) => u.skillIds)).toEqual([
      ['capital-letter-indicator', 'contraction-the'],
      [],
    ]);
  });

  it('credits the letters of a spelled-out wordsign word, not the wordsign', () => {
    // c,a,n,␣ towards "can it": the learner typed three letters, and the ⠉
    // colliding with the "can" wordsign cell must not steal the credit.
    const { text, units } = backTranslateBufferAttributed(
      [[1, 4], [1], [1, 3, 4, 5], []],
      'can it',
    );
    expect(text).toBe('can ');
    expect(units.map((u) => u.skillIds)).toEqual([
      ['letter-c'],
      ['letter-a'],
      ['letter-n'],
      [],
    ]);
  });

  it('credits the wordsign when the learner chorded it', () => {
    const { text, units } = backTranslateBufferAttributed([[1, 4], []], 'can it');
    expect(text).toBe('can ');
    expect(units.map((u) => u.skillIds)).toEqual([['wordsign-can'], []]);
  });

  it('credits the th groupsign in the mixed spelling', () => {
    const { text, units } = backTranslateBufferAttributed(
      [[6], [1, 4, 5, 6], [1, 5], []],
      FOX_SENTENCE,
    );
    expect(text).toBe('The ');
    expect(units.map((u) => u.skillIds)).toEqual([
      ['capital-letter-indicator', 'groupsign-th'],
      ['letter-e'],
      [],
    ]);
  });
});
