// The "fox" challenge: every 100th prompt is the fixed pangram sentence,
// typed with no hints; any mistake fails it instantly. A flawless run earns
// a badge (how far above the minimum possible grade-2 cell count the
// learner's cell usage was) or a crown (exactly the minimum).

import { backTranslateBuffer } from './backtranslate';
import type { Cell, TranslationUnit } from './braille';
import { dotsToUnicode, translate } from './braille';

/**
 * The challenge sentence, verbatim (capitalisation and full stop matter).
 * "jumps", not "jumped": the -ed form has no s, and a perfect pangram lets an
 * uncontracted run exercise the whole alphabet.
 */
export const FOX_SENTENCE = 'The quick brown fox jumps over the lazy dog.';

/**
 * Minimum possible grade-2 cell count for FOX_SENTENCE, derived from the
 * skills data at module load.
 *
 * Breakdown (36 cells): The=2 (capital indicator + "the" contraction),
 * quick=2 (the UEB shortform "qk" — the task brief estimated 5, but the
 * skills data defines shortform-quick ⠟⠅, so 2 is correct), brown=4 ("ow"),
 * fox=3, jumps=5 (no contraction), over=3 ("er"), the=1, lazy=4, dog=3,
 * period=1, spaces=8.
 */
export const FOX_MIN_CELLS = translate(FOX_SENTENCE).cells.length;

/** Outcome of a flawless (or not) fox run. */
export type FoxResult =
  | { readonly kind: 'crown' }
  | { readonly kind: 'badge'; readonly percentAbove: number }
  | { readonly kind: 'failed' };

/**
 * Score a completed fox challenge from the number of cells the learner
 * typed (the state layer counts input insertion events). Only call this for
 * a flawlessly typed run; a run that already failed on a mistake is
 * 'failed' without consulting this. `cellsTyped` below the theoretical
 * minimum (or non-finite) is treated as invalid -> 'failed'.
 */
export function foxResult(cellsTyped: number): FoxResult {
  if (!Number.isFinite(cellsTyped) || cellsTyped < FOX_MIN_CELLS) {
    return { kind: 'failed' };
  }
  if (cellsTyped === FOX_MIN_CELLS) return { kind: 'crown' };
  return {
    kind: 'badge',
    percentAbove: ((cellsTyped - FOX_MIN_CELLS) / FOX_MIN_CELLS) * 100,
  };
}

// --- Failure diagnosis ------------------------------------------------------
//
// A failed run ends on a single wrong character, and print alone rarely
// explains why: a learner who is sure they typed the right word wants to see
// the *braille* they owed at that point, and — when they chorded it
// themselves — the braille they actually entered.

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/** A sign of the challenge sentence, ready to show as cells. */
export interface FoxSign {
  /** The sign's cells as a U+2800 string (a sign may be several cells). */
  readonly unicode: string;
  /** The print it stands for: "ow", "The", "." — or " " for a space. */
  readonly print: string;
}

/**
 * The sign that was due where `typed` stopped agreeing with `text` — the one
 * the learner should have entered. Whole translation units, so a contraction
 * is named as itself ("ow" ⠪, not "o" then "w") — which is exactly the part
 * a learner who "typed the right word" got wrong.
 *
 * A caret sitting on a space yields the blank cell rather than the word
 * after it: an omitted space is a real mistake and worth showing as one.
 * Null when the text does not translate or is empty.
 */
export function expectedSignAt(text: string, typed: string): FoxSign | null {
  let units: ReadonlyArray<TranslationUnit>;
  try {
    units = translate(text).units;
  } catch {
    return null;
  }
  const last = units[units.length - 1];
  if (last === undefined) return null;
  const caret = commonPrefixLength(text, typed);
  // Typed past the end of the text: charge the final sign.
  const unit = units.find((u) => caret < u.end) ?? last;
  return { unicode: dotsToUnicode(unit.cells), print: text.slice(unit.start, unit.end) };
}

/**
 * The tail of a chord-mode cell buffer that `text` no longer accepts: the
 * cells the learner actually chorded where the run broke.
 *
 * Found by re-deriving print from growing prefixes of the buffer rather than
 * by comparing cells against the canonical translation, because chording a
 * word out letter by letter is not a mistake — it produces correct print at a
 * higher cell cost, which the challenge grades separately. Only cells that
 * make the print itself diverge are the mistake.
 */
export function divergentCells(
  buffer: ReadonlyArray<Cell>,
  text: string,
): ReadonlyArray<Cell> {
  let good = 0;
  for (let k = 1; k <= buffer.length; k += 1) {
    if (!text.startsWith(backTranslateBuffer(buffer.slice(0, k), text))) break;
    good = k;
  }
  return buffer.slice(good);
}
