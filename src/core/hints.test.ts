import { Set } from 'immutable';
import { describe, expect, it } from 'vitest';
import { hintWordForPrompt, nextHintFor } from './hints';
import type { TutorState } from './types';
import { HINT_REVEAL_COOLDOWN_MS, hintDelayMs, makePrompt, makeTutorState } from './types';

function state(text: string, typed: string, isQbf = false): TutorState {
  return makeTutorState({
    prompt: makePrompt({ text, typed, isQbf, targetSkillId: isQbf ? null : 'letter-d' }),
  });
}

/** The hint word's units as plain braille strings, for readability. */
function unicode(state: TutorState): string[] | undefined {
  return hintWordForPrompt(state)?.units.map((u) => u.unicode);
}

describe('hintWordForPrompt', () => {
  it('is null without a prompt and for the qbf challenge', () => {
    expect(hintWordForPrompt(makeTutorState())).toBeNull();
    expect(hintWordForPrompt(state('the dog', '', true))).toBeNull();
  });

  it('hints only the word at the caret, one sign per unit', () => {
    const hint = hintWordForPrompt(state('the dog', ''));
    expect(hint?.wordStart).toBe(0);
    expect(hint?.units).toEqual([{ index: 0, unicode: '⠮' }]);
  });

  it('moves to the next word once the current one is typed', () => {
    for (const typed of ['the', 'the ']) {
      const hint = hintWordForPrompt(state('the dog', typed));
      expect(hint?.wordStart).toBe(4);
      // Unit 1 is the space, so "dog" is units 2..4 of the whole prompt.
      expect(hint?.units).toEqual([
        { index: 2, unicode: '⠙' },
        { index: 3, unicode: '⠕' },
        { index: 4, unicode: '⠛' },
      ]);
    }
  });

  it('keeps hinting the word the typing diverged in', () => {
    const hint = hintWordForPrompt(state('the dog', 'thx'));
    expect(hint?.wordStart).toBe(0);
    expect(hint?.units).toEqual([{ index: 0, unicode: '⠮' }]);
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
  /** "the dog" with `typed` typed and `hinted` unit indexes already shown. */
  function drill(typed: string, hinted: number[] = []): TutorState {
    return makeTutorState({
      prompt: makePrompt({
        text: 'the dog',
        typed,
        targetSkillId: 'letter-d',
        hintedUnits: Set(hinted),
      }),
    });
  }

  it('puts the sign at the caret on the clock, at the prompt delay', () => {
    expect(nextHintFor(drill(''))).toEqual({ unitIndex: 0, delayMs: hintDelayMs(0) });
  });

  it('stops the clock once that sign has been revealed', () => {
    // Nothing is waiting: the next sign's clock starts when the caret gets
    // there, which is the whole point — see the space case below.
    expect(nextHintFor(drill('', [0]))).toBeNull();
  });

  it('runs no clock while the caret sits on a space', () => {
    expect(nextHintFor(drill('the', [0]))).toBeNull();
  });

  it('starts the next sign\u2019s clock only once the space is typed', () => {
    expect(nextHintFor(drill('the ', [0]))).toEqual({
      unitIndex: 2,
      delayMs: HINT_REVEAL_COOLDOWN_MS,
    });
  });

  it('charges later signs the shorter cooldown, once one has been hinted', () => {
    expect(nextHintFor(drill('the d', [0, 2]))).toEqual({
      unitIndex: 3,
      delayMs: HINT_REVEAL_COOLDOWN_MS,
    });
  });

  it('keeps the caret sign on the clock while the typing has diverged', () => {
    expect(nextHintFor(drill('thx'))).toEqual({ unitIndex: 0, delayMs: hintDelayMs(0) });
  });

  it('is null for qbf, completed, and finished-text prompts', () => {
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
