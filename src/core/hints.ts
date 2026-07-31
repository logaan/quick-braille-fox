// Progressive hint content: which braille the hint area should be able to
// show for the current prompt. VoiceOver braille screen input commits whole
// words, so the hint covers exactly one word — the one at the caret — and
// is split into reveal units (one sign each), uncovered one at a time as
// the learner reaches them, never the whole sentence at once.
//
// nextHintFor() also lives here: it says which sign's hint is on the clock
// and for how long. The state layer runs that as a timer and dispatches
// revealHint().

import { dotsToUnicode, tryTranslate } from './braille';
import { hintDelayFor } from './progress';
import { commonPrefixLength } from './text';
import type { TutorState } from './types';
import { HINT_REVEAL_COOLDOWN_MS } from './types';

/** One reveal unit of a hinted word. */
export interface HintUnit {
  /** Index of this unit in the whole prompt's translation units. */
  readonly index: number;
  /** The unit's cells as a U+2800 string (a unit may be several cells). */
  readonly unicode: string;
}

/** The hintable word for the current prompt, split into reveal units. */
export interface HintWord {
  /** Print index where the word starts (keys the reveal progress). */
  readonly wordStart: number;
  /** The word's translation units, in order. */
  readonly units: ReadonlyArray<HintUnit>;
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
 * per reveal unit. Null when there is nothing to hint — no prompt, the fox
 * challenge (never hinted), or nothing left after the caret. Which of the
 * units are actually *uncovered* is prompt.hintedUnits; callers gate each
 * unit on that.
 */
export function hintWordForPrompt(state: TutorState): HintWord | null {
  const p = state.prompt;
  if (!p || p.isFox) return null;
  const caret = commonPrefixLength(p.text, p.typed);
  const span = wordSpanAt(p.text, caret);
  if (span === null) return null;
  // A persisted prompt can stop translating when the curriculum changes
  // between releases; an untranslatable prompt simply has nothing to hint.
  const translation = tryTranslate(p.text);
  if (translation === null) return null;
  const units: HintUnit[] = [];
  translation.units.forEach((u, index) => {
    if (u.start >= span.start && u.start < span.end) {
      units.push({ index, unicode: dotsToUnicode(u.cells) });
    }
  });
  return units.length === 0 ? null : { wordStart: span.start, units };
}

/** A sign whose hint is due to be revealed after a wait. */
export interface PendingHint {
  /** Translation-unit index the hint is for. */
  readonly unitIndex: number;
  /**
   * How long to wait, measured from the moment the caret *reached* this
   * unit — i.e. from when the sign before it was typed.
   */
  readonly delayMs: number;
}

/**
 * The sign whose hint is currently on the clock, and how long it waits, or
 * null when nothing is waiting.
 *
 * Only ever the sign *at the caret*: a sign's countdown starts when the
 * caret arrives at it and is not running before then, so dawdling over one
 * sign never spends the next one's time. A caret on a space has no
 * countdown either (a space unit bears no skill), which is what makes the
 * first sign of a word start its clock only once the space before it has
 * been typed.
 *
 * The wait is the prompt's hintDelayFor() for the first sign hinted in a
 * prompt, and HINT_REVEAL_COOLDOWN_MS for each sign after that — once the
 * learner is leaning on the hint, the rest of the word comes at the faster
 * cadence, but still a sign at a time and still only as they type.
 */
export function nextHintFor(state: TutorState): PendingHint | null {
  const p = state.prompt;
  if (!p || p.completed || p.isFox) return null;
  const caret = commonPrefixLength(p.text, p.typed);
  const units = tryTranslate(p.text)?.units;
  if (units === undefined) return null; // untranslatable: nothing to hint
  const unitIndex = units.findIndex((u) => u.start <= caret && caret < u.end);
  if (unitIndex === -1) return null; // typed past the end of the text
  const unit = units[unitIndex] as (typeof units)[number];
  if (unit.skillIds.length === 0) return null; // a space: no sign to hint
  if (p.hintedUnits.has(unitIndex)) return null; // already revealed
  if (!p.hintedUnits.isEmpty()) return { unitIndex, delayMs: HINT_REVEAL_COOLDOWN_MS };
  const delayMs = hintDelayFor(state);
  return delayMs === null ? null : { unitIndex, delayMs };
}
