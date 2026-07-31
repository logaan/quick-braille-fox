import { describe, expect, it } from 'vitest';
import type { Cell } from './braille';
import { dotsToUnicode, textToCells, translate } from './braille';
import {
  QBF_MIN_CELLS,
  QBF_SENTENCE,
  divergentCells,
  expectedSignAt,
  qbfResult,
} from './qbf';

describe('QBF_MIN_CELLS', () => {
  it('derives the minimum from the skills data, word by word', () => {
    // The task brief estimated quick=5 (39 total), but the skills data
    // includes the UEB shortform "quick" ⠟⠅ (2 cells), giving 36. Trust the
    // skills data.
    expect(translate('The').cells.length).toBe(2); // cap + "the"
    expect(translate('quick').cells.length).toBe(2); // shortform qk
    expect(translate('quick').skillIds).toEqual(['shortform-quick']);
    expect(translate('brown').cells.length).toBe(4); // "ow"
    expect(translate('fox').cells.length).toBe(3);
    expect(translate('jumped').cells.length).toBe(5); // "ed"
    expect(translate('over').cells.length).toBe(3); // "er"
    expect(translate('the').cells.length).toBe(1);
    expect(translate('lazy').cells.length).toBe(4);
    expect(translate('dog').cells.length).toBe(3);
    // words 27 + period 1 + 8 spaces = 36
    expect(QBF_MIN_CELLS).toBe(36);
  });

  it('matches a direct translation of the sentence', () => {
    expect(translate(QBF_SENTENCE).cells.length).toBe(QBF_MIN_CELLS);
  });
});

describe('qbfResult', () => {
  it('awards a crown at exactly the minimum cell count', () => {
    expect(qbfResult(QBF_MIN_CELLS)).toEqual({ kind: 'crown' });
  });

  it('awards a badge with percent above minimum otherwise', () => {
    expect(qbfResult(45)).toEqual({ kind: 'badge', percentAbove: 25 });
    expect(qbfResult(72)).toEqual({ kind: 'badge', percentAbove: 100 });
  });

  it('treats impossible counts as failed', () => {
    expect(qbfResult(QBF_MIN_CELLS - 1)).toEqual({ kind: 'failed' });
    expect(qbfResult(0)).toEqual({ kind: 'failed' });
    expect(qbfResult(Number.NaN)).toEqual({ kind: 'failed' });
  });
});

describe('expectedSignAt', () => {
  it('names the whole sign due at the divergence, not its first letter', () => {
    // "brown" is b r ow n: failing where "ow" was due should show ⠪, the
    // contraction the learner owed — not ⠕ for the letter o.
    expect(expectedSignAt(QBF_SENTENCE, 'The quick brot')).toEqual({
      unicode: '⠪',
      print: 'ow',
    });
  });

  it('carries the capital indicator with the sign it belongs to', () => {
    expect(expectedSignAt(QBF_SENTENCE, 'X')).toEqual({ unicode: '⠠⠮', print: 'The' });
    expect(expectedSignAt(QBF_SENTENCE, '')).toEqual({ unicode: '⠠⠮', print: 'The' });
  });

  it('points at a shortform as one sign', () => {
    expect(expectedSignAt(QBF_SENTENCE, 'The k')).toEqual({ unicode: '⠟⠅', print: 'quick' });
  });

  it('reports a missed space as the blank cell, not the word after it', () => {
    expect(expectedSignAt(QBF_SENTENCE, 'Thequick')).toEqual({ unicode: '⠀', print: ' ' });
  });

  it('charges the final sign when typing runs past the end', () => {
    expect(expectedSignAt(QBF_SENTENCE, `${QBF_SENTENCE}x`)).toEqual({
      unicode: '⠲',
      print: '.',
    });
  });

  it('returns null for text it cannot translate', () => {
    expect(expectedSignAt('☃', '')).toBeNull();
    expect(expectedSignAt('', '')).toBeNull();
  });
});

describe('divergentCells', () => {
  const cellsOf = (text: string): Cell[] => textToCells(text).map((c) => [...c]);
  const T = [2, 3, 4, 5]; // ⠞ — "t" / "that"

  it('returns the cells that made the print diverge', () => {
    const buffer = [...cellsOf('The quick '), T];
    expect(divergentCells(buffer, QBF_SENTENCE)).toEqual([T]);
    expect(dotsToUnicode(divergentCells(buffer, QBF_SENTENCE))).toBe('⠞');
  });

  it('blames only the offending cell, not the whole word', () => {
    expect(divergentCells([T], QBF_SENTENCE)).toEqual([T]);
  });

  it('treats a contraction spelled out letter by letter as correct', () => {
    // b r o — "bro" is still a prefix of "brown", just costlier in cells than
    // the "ow" sign. Costlier is graded by cell count, not failed.
    const spelled = [...cellsOf('The quick '), [1, 2], [1, 2, 3, 5], [1, 3, 5]];
    expect(divergentCells(spelled, QBF_SENTENCE)).toEqual([]);
    // ...and a wrong cell after it is still blamed on its own.
    expect(divergentCells([...spelled, T], QBF_SENTENCE)).toEqual([T]);
  });

  it('is empty for a buffer that never diverged', () => {
    expect(divergentCells(cellsOf(QBF_SENTENCE), QBF_SENTENCE)).toEqual([]);
    expect(divergentCells([], QBF_SENTENCE)).toEqual([]);
  });
});
