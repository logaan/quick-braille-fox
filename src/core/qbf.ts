// The "qbf" challenge: every 100th prompt is the fixed pangram sentence,
// typed with no hints; any mistake fails it instantly. A flawless run earns
// a badge (how far above the minimum possible grade-2 cell count the
// learner's cell usage was) or a crown (exactly the minimum).

import { translate } from './braille';

/** The challenge sentence, verbatim (capitalisation and full stop matter). */
export const QBF_SENTENCE = 'The quick brown fox jumped over the lazy dog.';

/**
 * Minimum possible grade-2 cell count for QBF_SENTENCE, derived from the
 * skills data at module load.
 *
 * Breakdown (36 cells): The=2 (capital indicator + "the" contraction),
 * quick=2 (the UEB shortform "qk" — the task brief estimated 5, but the
 * skills data defines shortform-quick ⠟⠅, so 2 is correct), brown=4 ("ow"),
 * fox=3, jumped=5 ("ed"), over=3 ("er"), the=1, lazy=4, dog=3, period=1,
 * spaces=8.
 */
export const QBF_MIN_CELLS = translate(QBF_SENTENCE).cells.length;

/** Outcome of a flawless (or not) qbf run. */
export type QbfResult =
  | { readonly kind: 'crown' }
  | { readonly kind: 'badge'; readonly percentAbove: number }
  | { readonly kind: 'failed' };

/**
 * Score a completed qbf challenge from the number of cells the learner
 * typed (the state layer counts input insertion events). Only call this for
 * a flawlessly typed run; a run that already failed on a mistake is
 * 'failed' without consulting this. `cellsTyped` below the theoretical
 * minimum (or non-finite) is treated as invalid -> 'failed'.
 */
export function qbfResult(cellsTyped: number): QbfResult {
  if (!Number.isFinite(cellsTyped) || cellsTyped < QBF_MIN_CELLS) {
    return { kind: 'failed' };
  }
  if (cellsTyped === QBF_MIN_CELLS) return { kind: 'crown' };
  return {
    kind: 'badge',
    percentAbove: ((cellsTyped - QBF_MIN_CELLS) / QBF_MIN_CELLS) * 100,
  };
}
