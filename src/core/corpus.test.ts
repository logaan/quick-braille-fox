import { describe, expect, it } from 'vitest';
import { translate } from './braille';
import { WORDS } from './corpus';

describe('corpus', () => {
  it('contains only lowercase letter words', () => {
    for (const word of WORDS) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });

  it('has no duplicate words', () => {
    const seen = new Set<string>();
    for (const word of WORDS) {
      expect(seen.has(word), `duplicate: ${word}`).toBe(false);
      seen.add(word);
    }
  });

  it('every word translates to braille cells', () => {
    for (const word of WORDS) {
      expect(() => translate(word), word).not.toThrow();
    }
  });

  it('single-letter entries are real standalone words, not wordsign letters', () => {
    for (const word of WORDS) {
      if (word.length === 1) {
        expect(['a', 'o'], `bare letter in corpus: ${word}`).toContain(word);
      }
    }
  });
});
