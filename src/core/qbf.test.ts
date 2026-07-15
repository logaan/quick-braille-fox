import { describe, expect, it } from 'vitest';
import { translate } from './braille';
import { QBF_MIN_CELLS, QBF_SENTENCE, qbfResult } from './qbf';

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
