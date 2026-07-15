import { describe, expect, it } from 'vitest';
import { hintWordForPrompt } from './hints';
import type { TutorState } from './types';
import { makePrompt, makeTutorState } from './types';

function state(text: string, typed: string, isQbf = false): TutorState {
  return makeTutorState({
    prompt: makePrompt({ text, typed, isQbf, targetSkillId: isQbf ? null : 'letter-d' }),
  });
}

describe('hintWordForPrompt', () => {
  it('is null without a prompt and for the qbf challenge', () => {
    expect(hintWordForPrompt(makeTutorState())).toBeNull();
    expect(hintWordForPrompt(state('the dog', '', true))).toBeNull();
  });

  it('hints only the word at the caret, one sign per unit', () => {
    const hint = hintWordForPrompt(state('the dog', ''));
    expect(hint?.wordStart).toBe(0);
    expect(hint?.units).toEqual(['⠮']);
  });

  it('moves to the next word once the current one is typed', () => {
    for (const typed of ['the', 'the ']) {
      const hint = hintWordForPrompt(state('the dog', typed));
      expect(hint?.wordStart).toBe(4);
      expect(hint?.units).toEqual(['⠙', '⠕', '⠛']);
    }
  });

  it('keeps hinting the word the typing diverged in', () => {
    const hint = hintWordForPrompt(state('the dog', 'thx'));
    expect(hint?.wordStart).toBe(0);
    expect(hint?.units).toEqual(['⠮']);
  });

  it('bundles indicators into their sign’s unit', () => {
    expect(hintWordForPrompt(state('The', ''))?.units).toEqual(['⠠⠮']);
    expect(hintWordForPrompt(state('12', ''))?.units).toEqual(['⠼⠁', '⠃']);
  });

  it('is null when nothing remains after the caret', () => {
    expect(hintWordForPrompt(state('a', 'ab'))).toBeNull();
  });
});
