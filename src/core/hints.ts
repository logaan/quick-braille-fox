// Progressive hint content: which braille the hint area should be able to
// show for the current prompt. VoiceOver braille screen input commits whole
// words, so the hint covers exactly one word — the one at the caret — and
// is split into reveal units (one sign each) that the state layer shows one
// at a time on a cooldown, never the whole sentence at once.

import { dotsToUnicode, translate } from './braille';
import type { TutorState } from './types';

/** The hintable word for the current prompt, split into reveal units. */
export interface HintWord {
  /** Print index where the word starts (keys the reveal progress). */
  readonly wordStart: number;
  /**
   * One U+2800 string per translation unit of the word, in order. A unit
   * may be more than one cell (e.g. capital indicator + sign).
   */
  readonly units: ReadonlyArray<string>;
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/**
 * The maximal run of non-space characters containing `index`, or the next
 * such run after it (a caret on a space hints the upcoming word); null when
 * nothing but spaces remains.
 */
function wordSpanAt(text: string, index: number): { start: number; end: number } | null {
  let i = index;
  while (i < text.length && text[i] === ' ') i += 1;
  if (i >= text.length) return null;
  let start = i;
  while (start > 0 && text[start - 1] !== ' ') start -= 1;
  let end = i;
  while (end < text.length && text[end] !== ' ') end += 1;
  return { start, end };
}

/**
 * The hint for the current prompt: the braille of the word at the caret
 * (the first position where typed and expected text disagree), one string
 * per reveal unit. Null when there is nothing to hint — no prompt, the qbf
 * challenge (never hinted), or nothing left after the caret. Whether the
 * hint is *visible* is prompt.hintShown; callers gate on that.
 */
export function hintWordForPrompt(state: TutorState): HintWord | null {
  const p = state.prompt;
  if (!p || p.isQbf) return null;
  const caret = commonPrefixLength(p.text, p.typed);
  const span = wordSpanAt(p.text, caret);
  if (span === null) return null;
  const units = translate(p.text)
    .units.filter((u) => u.start >= span.start && u.start < span.end)
    .map((u) => dotsToUnicode(u.cells));
  return units.length === 0 ? null : { wordStart: span.start, units };
}
