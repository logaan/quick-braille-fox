// What the current prompt is worth, derived from what is on screen right
// now. Scores in TutorState are a *baseline*, fixed for the whole round;
// the round's own contribution is recomputed from the prompt on every read
// and only folded into the baseline when the prompt completes (see
// session.ts). So a word typed correctly and then backspaced away — or
// rewritten by VoiceOver into something wrong — takes its points back
// with it.
//
// This lives apart from progress.ts and session.ts because both need it:
// session.ts commits it, progress.ts and the view layer display it.

import { Map } from 'immutable';
import type { TranslationUnit } from './braille';
import { tryTranslate } from './braille';
import { commonPrefixLength } from './text';
import type { Prompt, TutorState } from './types';
import {
  BASE_AWARD,
  CLEAN_AWARD,
  FOX_AWARD,
  MISTAKE_PENALTY,
  MISTAKES_BEFORE_PENALTY,
  unitTypedClean,
} from './types';

/** The prompt text's translation units ([] if it is not translatable). */
export function promptUnits(p: Prompt): readonly TranslationUnit[] {
  return tryTranslate(p.text)?.units ?? [];
}

/**
 * The units the round's awards are attributed to. Normally the canonical
 * translation of the prompt text; on a fox run the state layer passes the
 * signs the learner *actually chorded* (backTranslateBufferAttributed) into
 * keystroke(), so spelling a word out letter by letter credits the letters,
 * not the contraction of the shortest solution. Without them (VoiceOver
 * input hands us print, not cells) the canonical units remain the only
 * attribution available.
 */
function attributionUnits(p: Prompt): readonly TranslationUnit[] {
  return p.typedUnits ?? promptUnits(p);
}

/**
 * The score change the prompt on screen would contribute if it completed
 * as it stands, per skill id.
 *
 * - Every occurrence (translation unit) covered by the correctly typed
 *   prefix earns its skills CLEAN_AWARD when nothing has spoiled that
 *   occurrence (no mistake on it, its own hint not revealed), else
 *   BASE_AWARD. Cleanliness is per occurrence, not per prompt.
 * - Every occurrence that has reached MISTAKES_BEFORE_PENALTY mistakes
 *   costs its skills MISTAKE_PENALTY — once, however many mistakes follow.
 *   Mistakes are history, so this stands even after the mistake has been
 *   backspaced away, and applies whether or not the occurrence is now
 *   typed (a mistyped-then-corrected sign nets BASE_AWARD - MISTAKE_PENALTY).
 * - The fox challenge pays a flat FOX_AWARD per covered occurrence (no
 *   hints exist there and the run ends at the first mistake, so anything
 *   finished was typed cold).
 */
export function pendingScoreDeltas(state: TutorState): Map<string, number> {
  const p = state.prompt;
  let deltas = Map<string, number>();
  if (p === null) return deltas;
  const units = attributionUnits(p);
  const caret = commonPrefixLength(p.text, p.typed);
  const add = (skillId: string, delta: number): void => {
    deltas = deltas.set(skillId, deltas.get(skillId, 0) + delta);
  };
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.skillIds.length === 0) continue;
    if (u.end <= caret) {
      const award = p.isFox ? FOX_AWARD : unitTypedClean(p, i) ? CLEAN_AWARD : BASE_AWARD;
      for (const id of u.skillIds) add(id, award);
    }
    // Penalties can land on an occurrence the caret has not reached, so
    // this loop runs the whole text rather than stopping at the caret.
    if (p.unitMistakes.get(i, 0) >= MISTAKES_BEFORE_PENALTY) {
      for (const id of u.skillIds) add(id, -MISTAKE_PENALTY);
    }
  }
  return deltas;
}

/**
 * Scores as the learner should see them *now*: the committed baseline plus
 * what the prompt in flight is currently worth, floored at 0 per skill.
 */
export function derivedScores(state: TutorState): Map<string, number> {
  let scores = state.scores;
  for (const [skillId, delta] of pendingScoreDeltas(state)) {
    scores = scores.set(skillId, Math.max(0, scores.get(skillId, 0) + delta));
  }
  return scores;
}
