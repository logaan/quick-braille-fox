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
import { hintDelayForSkills } from './progress';
import { judgedPrintCaret } from './scoring';
import type { TutorState } from './types';

/** One reveal unit of a hinted word. */
export interface HintUnit {
  /** Index of this unit in the whole prompt's translation units. */
  readonly index: number;
  /** Print index just past the unit's span (where typing it lands the caret). */
  readonly end: number;
  /** The unit's cells as a U+2800 string (a unit may be several cells). */
  readonly unicode: string;
}

/** The hintable word for the current prompt, split into reveal units. */
export interface HintWord {
  /** Print index where the word starts (keys the reveal progress). */
  readonly wordStart: number;
  /** The word's translation units, in order. */
  readonly units: readonly HintUnit[];
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
 * The hint for the current prompt: the braille of the word at the caret —
 * the judged caret mapped into print, so on a cell-judged round the hint
 * stays on the word whose *cells* are owed even when a derived print prefix
 * has run ahead of them. One string per reveal unit. Null when there is
 * nothing to hint — no prompt, the fox challenge (never hinted), or nothing
 * left after the caret. Which of the units are actually *uncovered* is
 * prompt.hintedUnits; callers gate each unit on that.
 */
export function hintWordForPrompt(state: TutorState): HintWord | null {
  const p = state.prompt;
  if (!p || p.isFox) return null;
  const caret = judgedPrintCaret(p);
  const span = wordSpanAt(p.text, caret);
  if (span === null) return null;
  // A persisted prompt can stop translating when the curriculum changes
  // between releases; an untranslatable prompt simply has nothing to hint.
  const translation = tryTranslate(p.text);
  if (translation === null) return null;
  const units: HintUnit[] = [];
  translation.units.forEach((u, index) => {
    if (u.start >= span.start && u.start < span.end) {
      units.push({ index, end: u.end, unicode: dotsToUnicode(u.cells) });
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
 * The wait is per sign, gated on *that sign's own* skills
 * (hintDelayForSkills): a sign whose skills are all learnt never goes on
 * the clock — its hint appears only via the two-mistake rule — and a sign
 * still being learned waits hintDelayMs of its weakest unlearnt skill, so
 * the wait stretches as the learner's score on that skill grows. Earlier
 * signs being hinted has no bearing on later ones.
 */
export function nextHintFor(state: TutorState): PendingHint | null {
  const p = state.prompt;
  if (!p || p.completed || p.isFox) return null;
  const caret = judgedPrintCaret(p);
  const units = tryTranslate(p.text)?.units;
  if (units === undefined) return null; // untranslatable: nothing to hint
  const unitIndex = units.findIndex((u) => u.start <= caret && caret < u.end);
  if (unitIndex === -1) return null; // typed past the end of the text
  const unit = units[unitIndex]!;
  if (p.hintedUnits.has(unitIndex)) return null; // already revealed
  // A space bears no skill, so it also gets no countdown (null here), which
  // is what makes the first sign of a word start its clock only once the
  // space before it has been typed.
  const delayMs = hintDelayForSkills(state, unit.skillIds);
  return delayMs === null ? null : { unitIndex, delayMs };
}
