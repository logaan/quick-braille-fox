import { describe, expect, it } from 'vitest';
import { cellCount, dotsToUnicode, textToUnicode, translate } from './braille';

describe('dotsToUnicode', () => {
  it('maps dot numbers to the U+2800 block', () => {
    expect(dotsToUnicode([[1]])).toBe('⠁'); // ⠁ a
    expect(dotsToUnicode([[2, 3, 4, 6]])).toBe('⠮'); // ⠮ the
    expect(dotsToUnicode([[1], [1, 2]])).toBe('⠁⠃'); // ⠁⠃ about
    expect(dotsToUnicode([[]])).toBe('⠀'); // blank cell
    expect(dotsToUnicode([[6]])).toBe('⠠'); // capital indicator
  });
});

describe('translate', () => {
  it('translates single letters', () => {
    const t = translate('a');
    expect(t.cells).toEqual([[1]]);
    expect(t.skillIds).toEqual(['letter-a']);
  });

  it('uses standalone signs for whole words', () => {
    expect(translate('the').skillIds).toEqual(['contraction-the']);
    expect(translate('the').cells).toEqual([[2, 3, 4, 6]]);
    expect(translate('but').skillIds).toEqual(['wordsign-but']);
    expect(translate('about').skillIds).toEqual(['shortform-about']);
    expect(translate('about').cells.length).toBe(2);
    expect(translate('was').skillIds).toEqual(['lower-was']);
    expect(translate('there').skillIds).toEqual(['initial-there']);
  });

  it('adds the capital letter indicator skill for a leading capital', () => {
    const t = translate('The');
    expect(t.cells).toEqual([[6], [2, 3, 4, 6]]);
    expect(t.skillIds).toEqual(['capital-letter-indicator', 'contraction-the']);
    const cat = translate('Cat');
    expect(cat.cells).toEqual([[6], [1, 4], [1], [2, 3, 4, 5]]);
    expect(cat.skillIds).toEqual([
      'capital-letter-indicator',
      'letter-c',
      'letter-a',
      'letter-t',
    ]);
    expect(translate('I').skillIds).toEqual(['capital-letter-indicator', 'letter-i']);
  });

  it('uses the capital word indicator for ALL-CAPS words', () => {
    const t = translate('THE');
    expect(t.cells).toEqual([[6], [6], [2, 3, 4, 6]]);
    expect(t.skillIds).toEqual(['capital-word-indicator', 'contraction-the']);
    expect(translate('CAB').skillIds).toEqual([
      'capital-word-indicator',
      'letter-c',
      'letter-a',
      'letter-b',
    ]);
  });

  it('greedily contracts inside words', () => {
    expect(translate('brown').skillIds).toEqual([
      'letter-b',
      'letter-r',
      'groupsign-ow',
      'letter-n',
    ]);
    expect(translate('sand').skillIds).toEqual(['letter-s', 'contraction-and']);
    expect(translate('then').skillIds).toEqual(['contraction-the', 'letter-n']);
    expect(translate('jumped').skillIds).toEqual([
      'letter-j',
      'letter-u',
      'letter-m',
      'letter-p',
      'groupsign-ed',
    ]);
    expect(translate('over').skillIds).toEqual(['letter-o', 'letter-v', 'groupsign-er']);
    expect(translate('money').skillIds).toEqual(['letter-m', 'initial-one', 'letter-y']);
  });

  it('applies positional rules for lower signs and ing', () => {
    // "ing" may not begin a word
    expect(translate('ingot').skillIds).not.toContain('groupsign-ing');
    expect(translate('king').skillIds).toContain('groupsign-ing');
    // gg is midword-only: "egg" spells out
    expect(translate('egg').skillIds).toEqual(['letter-e', 'letter-g', 'letter-g']);
    expect(translate('buggy').skillIds).toContain('lower-gg');
    // be- needs at least 3 letters after it: "bed" is b + ed
    expect(translate('bed').skillIds).toEqual(['letter-b', 'groupsign-ed']);
    expect(translate('begun').skillIds).toContain('lower-be');
    // city uses the ity final-letter groupsign
    expect(translate('city').skillIds).toEqual(['letter-c', 'final-ity']);
  });

  it('prefixes digit runs with the number sign', () => {
    const t = translate('42');
    expect(t.skillIds).toEqual(['number-sign', 'digit-4', 'digit-2']);
    expect(t.cells.length).toBe(3);
    expect(t.cells[0]).toEqual([3, 4, 5, 6]);
  });

  it('counts spaces as blank cells and translates punctuation', () => {
    const t = translate('a b.');
    expect(t.cells).toEqual([[1], [], [1, 2], [2, 5, 6]]);
    expect(cellCount('a b.')).toBe(4);
  });

  it('translates extended symbols from the symbols group', () => {
    expect(translate('a/b').skillIds).toEqual(['letter-a', 'punct-slash', 'letter-b']);
    expect(translate('$5').skillIds).toEqual(['punct-dollar', 'number-sign', 'digit-5']);
    expect(translate('…').cells).toEqual([
      [2, 5, 6],
      [2, 5, 6],
      [2, 5, 6],
    ]);
  });

  it('throws on characters outside the curriculum', () => {
    expect(() => translate('a•b')).toThrow(/untranslatable/);
  });

  it('renders unicode braille for hint display', () => {
    expect(textToUnicode('the')).toBe('⠮');
    expect(textToUnicode('The cat')).toBe('⠠⠮⠀⠉⠁⠞');
  });
});
