import { Map, Set } from 'immutable';
import { describe, expect, it } from 'vitest';
import { hintWordForPrompt, nextHintFor } from './hints';
import type { TutorState } from './types';
import { LEARNT_THRESHOLD, hintDelayMs, makePrompt, makeTutorState } from './types';

function state(text: string, typed: string, isFox = false): TutorState {
  return makeTutorState({
    prompt: makePrompt({ text, typed, isFox, targetSkillId: isFox ? null : 'letter-d' }),
  });
}

/** The hint word's units as plain braille strings, for readability. */
function unicode(state: TutorState): string[] | undefined {
  return hintWordForPrompt(state)?.units.map((u) => u.unicode);
}

describe('hintWordForPrompt', () => {
  it('is null without a prompt and for the fox challenge', () => {
    expect(hintWordForPrompt(makeTutorState())).toBeNull();
    expect(hintWordForPrompt(state('the dog', '', true))).toBeNull();
  });

  it('hints only the word at the caret, one sign per unit', () => {
    const hint = hintWordForPrompt(state('the dog', ''));
    expect(hint?.wordStart).toBe(0);
    expect(hint?.units).toEqual([{ index: 0, end: 3, unicode: '⠮' }]);
  });

  it('moves to the next word once the current one is typed', () => {
    for (const typed of ['the', 'the ']) {
      const hint = hintWordForPrompt(state('the dog', typed));
      expect(hint?.wordStart).toBe(4);
      // Unit 1 is the space, so "dog" is units 2..4 of the whole prompt.
      expect(hint?.units).toEqual([
        { index: 2, end: 5, unicode: '⠙' },
        { index: 3, end: 6, unicode: '⠕' },
        { index: 4, end: 7, unicode: '⠛' },
      ]);
    }
  });

  it('keeps hinting the word the typing diverged in', () => {
    const hint = hintWordForPrompt(state('the dog', 'thx'));
    expect(hint?.wordStart).toBe(0);
    expect(hint?.units).toEqual([{ index: 0, end: 3, unicode: '⠮' }]);
  });

  it('bundles indicators into their sign’s unit', () => {
    expect(unicode(state('The', ''))).toEqual(['⠠⠮']);
    expect(unicode(state('12', ''))).toEqual(['⠼⠁', '⠃']);
  });

  it('is null when nothing remains after the caret', () => {
    expect(hintWordForPrompt(state('a', 'ab'))).toBeNull();
  });
});

describe('nextHintFor', () => {
  /**
   * "the dog" with `typed` typed, `hinted` unit indexes already shown, and
   * the given committed skill scores (unlisted skills score 0).
   */
  function drill(
    typed: string,
    hinted: number[] = [],
    scores: Record<string, number> = {},
  ): TutorState {
    return makeTutorState({
      scores: Map(scores),
      prompt: makePrompt({
        text: 'the dog',
        typed,
        targetSkillId: 'letter-d',
        hintedUnits: Set(hinted),
      }),
    });
  }

  it('puts the sign at the caret on the clock, at its own skill’s delay', () => {
    expect(nextHintFor(drill(''))).toEqual({ unitIndex: 0, delayMs: hintDelayMs(0) });
    expect(nextHintFor(drill('', [], { 'contraction-the': 4 }))).toEqual({
      unitIndex: 0,
      delayMs: hintDelayMs(4),
    });
  });

  it('runs no clock at all for a learnt sign', () => {
    // Its hint appears only via the two-mistake rule (keystroke), never a
    // timer — even after an earlier sign of the prompt was hinted.
    const learnt = { 'contraction-the': LEARNT_THRESHOLD };
    expect(nextHintFor(drill('', [], learnt))).toBeNull();
    expect(
      nextHintFor(drill('the ', [0], { ...learnt, 'letter-d': LEARNT_THRESHOLD })),
    ).toBeNull();
  });

  it('stops the clock once that sign has been revealed', () => {
    // Nothing is waiting: the next sign's clock starts when the caret gets
    // there, which is the whole point — see the space case below.
    expect(nextHintFor(drill('', [0]))).toBeNull();
  });

  it('runs no clock while the caret sits on a space', () => {
    expect(nextHintFor(drill('the', [0]))).toBeNull();
  });

  it('starts the next sign\u2019s clock, at its own skill\u2019s delay, once the space is typed', () => {
    expect(nextHintFor(drill('the ', [0], { 'letter-d': 6 }))).toEqual({
      unitIndex: 2,
      delayMs: hintDelayMs(6),
    });
  });

  it('waits on the weakest unlearnt skill of a multi-skill sign', () => {
    const st = makeTutorState({
      scores: Map({ 'contraction-the': LEARNT_THRESHOLD, 'capital-letter-indicator': 4 }),
      prompt: makePrompt({ text: 'The', targetSkillId: 'capital-letter-indicator' }),
    });
    expect(nextHintFor(st)).toEqual({ unitIndex: 0, delayMs: hintDelayMs(4) });
  });

  it('keeps the caret sign on the clock while the typing has diverged', () => {
    expect(nextHintFor(drill('thx'))).toEqual({ unitIndex: 0, delayMs: hintDelayMs(0) });
  });

  it('runs no clock at all while the reveal timer is switched off', () => {
    expect(nextHintFor(drill('').set('revealTimer', false))).toBeNull();
    // The two-mistake rule still reveals; it is only the clock that stops.
    expect(nextHintFor(drill('the ').set('revealTimer', false))).toBeNull();
  });

  it('is null for fox, completed, and finished-text prompts', () => {
    expect(nextHintFor(makeTutorState())).toBeNull();
    expect(nextHintFor(state('the dog', '', true))).toBeNull();
    expect(
      nextHintFor(
        makeTutorState({
          prompt: makePrompt({ text: 'the dog', typed: 'the dog', completed: true }),
        }),
      ),
    ).toBeNull();
    expect(nextHintFor(drill('the dog'))).toBeNull();
  });
});
