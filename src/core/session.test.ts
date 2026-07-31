import { Map, is } from 'immutable';
import { describe, expect, it } from 'vitest';
import { skills } from '../data/skills';
import { activeSkills, hintDelayFor, isSkillLearnt, learntSkills, scoreFor } from './progress';
import { FOX_SENTENCE } from './fox';
import {
  deserialize,
  isPromptComplete,
  keystroke,
  nextPrompt,
  revealHint,
  serialize,
  startSession,
} from './session';
import { translate } from './braille';
import type { TutorState } from './types';
import { FOX_AWARD, FOX_INTERVAL, hintDelayMs, makePrompt, makeTutorState } from './types';

/** A state showing a hand-built prompt (bypasses generation). */
function withPrompt(
  base: TutorState,
  text: string,
  targetSkillId: string | null,
  isFox = false,
): TutorState {
  return base.set('prompt', makePrompt({ text, targetSkillId, isFox }));
}

/** Reveal every sign's hint, as a fully hinted prompt would end up. */
function revealWholePrompt(state: TutorState): TutorState {
  const text = state.prompt?.text ?? '';
  return translate(text).units.reduce((s, _u, i) => revealHint(s, i), state);
}

const allLetterIds = skills.filter((s) => s.kind === 'letter').map((s) => s.id);

describe('startSession and active skills', () => {
  it('activates the first five letters of the curriculum', () => {
    const state = startSession(42);
    expect(activeSkills(state).map((s) => s.id)).toEqual([
      'letter-a',
      'letter-b',
      'letter-c',
      'letter-d',
      'letter-e',
    ]);
    expect(learntSkills(state)).toEqual([]);
    expect(state.prompt).not.toBeNull();
  });

  it('slides the active window as skills are learnt', () => {
    let state = makeTutorState({ seed: 7 });
    state = state.set('scores', Map({ 'letter-a': 11, 'letter-c': 12 }));
    expect(activeSkills(state).map((s) => s.id)).toEqual([
      'letter-b',
      'letter-d',
      'letter-e',
      'letter-f',
      'letter-g',
    ]);
    expect(learntSkills(state).map((s) => s.id)).toEqual(['letter-a', 'letter-c']);
    expect(isSkillLearnt(state, 'letter-a')).toBe(true);
    expect(isSkillLearnt(state, 'letter-b')).toBe(false);
  });

  it('reaching the threshold (10) makes a skill learnt; 9 is not enough', () => {
    const at10 = makeTutorState().set('scores', Map({ 'letter-a': 10 }));
    expect(isSkillLearnt(at10, 'letter-a')).toBe(true);
    const at9 = makeTutorState().set('scores', Map({ 'letter-a': 9 }));
    expect(isSkillLearnt(at9, 'letter-a')).toBe(false);
  });
});

describe('hint timing', () => {
  it('hintDelayMs is 400 + 300 * score', () => {
    expect(hintDelayMs(0)).toBe(400);
    expect(hintDelayMs(4)).toBe(1600);
    expect(hintDelayMs(10)).toBe(3400);
  });

  it('unlearnt-skill prompts get a time-based hint delay', () => {
    let state = makeTutorState().set('scores', Map({ 'letter-a': 4 }));
    state = withPrompt(state, 'a', 'letter-a');
    expect(hintDelayFor(state)).toBe(1600);
  });

  it('learnt-skill and fox prompts get no time-based hint', () => {
    let state = makeTutorState().set('scores', Map({ 'letter-a': 11 }));
    state = withPrompt(state, 'a', 'letter-a');
    expect(hintDelayFor(state)).toBeNull();
    const fox = withPrompt(makeTutorState(), FOX_SENTENCE, null, true);
    expect(hintDelayFor(fox)).toBeNull();
  });
});

describe('keystroke', () => {
  it('scores each skill occurrence immediately as it is typed', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = keystroke(state, 'c');
    expect(scoreFor(state, 'letter-c')).toBe(2); // lands before the prompt completes
    expect(isPromptComplete(state)).toBe(false);
    state = keystroke(state, 'ca');
    expect(scoreFor(state, 'letter-a')).toBe(2);
    state = keystroke(state, 'cat');
    expect(isPromptComplete(state)).toBe(true);
    expect(scoreFor(state, 'letter-t')).toBe(2);
    expect(state.promptCounter).toBe(1);
  });

  it('scores every occurrence, hinted (the "a cad ebb" example)', () => {
    let state = withPrompt(makeTutorState(), 'a cad ebb', 'letter-a');
    state = revealWholePrompt(state);
    state = keystroke(state, 'a cad ebb');
    expect(isPromptComplete(state)).toBe(true);
    expect(scoreFor(state, 'letter-a')).toBe(2); // two occurrences, 1 each
    expect(scoreFor(state, 'letter-c')).toBe(1);
    expect(scoreFor(state, 'letter-d')).toBe(1);
    expect(scoreFor(state, 'letter-e')).toBe(1);
    expect(scoreFor(state, 'letter-b')).toBe(2); // two occurrences, 1 each
  });

  it('occurrences typed before their hint appears keep their extra point', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = keystroke(state, 'ca');
    state = revealHint(state, 2); // the 't' the caret is now waiting on
    state = keystroke(state, 'cat');
    expect(scoreFor(state, 'letter-c')).toBe(2);
    expect(scoreFor(state, 'letter-a')).toBe(2);
    expect(scoreFor(state, 'letter-t')).toBe(1); // typed after its hint showed
  });

  it('hinting one sign leaves the rest of the prompt still worth two points', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = revealHint(state, 0); // dawdled on the 'c', so it was hinted
    state = keystroke(state, 'cat'); // ...then typed the rest straight off
    expect(scoreFor(state, 'letter-c')).toBe(1);
    expect(scoreFor(state, 'letter-a')).toBe(2);
    expect(scoreFor(state, 'letter-t')).toBe(2);
  });

  it('a single corrected mistake drops that occurrence to one point', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = keystroke(state, 'x'); // mistake on the c occurrence
    expect(state.prompt?.hintedUnits.isEmpty()).toBe(true);
    expect(scoreFor(state, 'letter-c')).toBe(0);
    state = keystroke(state, ''); // backspace to a valid prefix
    state = keystroke(state, 'cat');
    expect(scoreFor(state, 'letter-c')).toBe(1); // mistyped once, then correct
    expect(scoreFor(state, 'letter-a')).toBe(2); // clean occurrences unaffected
    expect(scoreFor(state, 'letter-t')).toBe(2);
  });

  it("two mistakes on the same occurrence cost a point and reveal that sign's hint", () => {
    let state = makeTutorState().set('scores', Map({ 'letter-c': 5 }));
    state = withPrompt(state, 'cat', 'letter-c');
    state = keystroke(state, 'x'); // mistake 1 on c
    state = keystroke(state, ''); // corrected
    state = keystroke(state, 'k'); // mistake 2 on c
    expect(state.prompt?.hintedUnits.toArray()).toEqual([0]); // only the 'c'
    expect(scoreFor(state, 'letter-c')).toBe(4);
    // typing it correctly still earns the base point
    state = keystroke(state, '');
    state = keystroke(state, 'cat');
    expect(scoreFor(state, 'letter-c')).toBe(5);
  });

  it('mistakes on different occurrences neither penalise nor force the hint', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = keystroke(state, 'x'); // mistake on c
    state = keystroke(state, 'c'); // corrected
    expect(scoreFor(state, 'letter-c')).toBe(1);
    state = keystroke(state, 'cx'); // mistake on a
    expect(state.prompt?.hintedUnits.isEmpty()).toBe(true);
    expect(scoreFor(state, 'letter-a')).toBe(0);
    state = keystroke(state, 'ca');
    state = keystroke(state, 'cat');
    expect(scoreFor(state, 'letter-a')).toBe(1);
    expect(scoreFor(state, 'letter-t')).toBe(2);
  });

  it('typing further while diverged is still one mistake', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = keystroke(state, 'x');
    state = keystroke(state, 'xy');
    state = keystroke(state, 'xyz');
    expect(state.prompt?.unitMistakes.get(0)).toBe(1);
    expect(state.prompt?.hintedUnits.isEmpty()).toBe(true);
    expect(scoreFor(state, 'letter-c')).toBe(0);
  });

  it('an occurrence never scores twice, even after backspacing over it', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = keystroke(state, 'ca');
    state = keystroke(state, 'c'); // backspace
    state = keystroke(state, 'ca'); // retype
    expect(scoreFor(state, 'letter-a')).toBe(2);
    state = keystroke(state, 'cat');
    expect(scoreFor(state, 'letter-a')).toBe(2);
  });

  it('indicator skills score together with their unit', () => {
    let state = withPrompt(makeTutorState(), 'Cab', 'capital-letter-indicator');
    state = keystroke(state, 'C');
    expect(scoreFor(state, 'capital-letter-indicator')).toBe(2);
    expect(scoreFor(state, 'letter-c')).toBe(2);
  });

  it('scores floor at zero', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = keystroke(state, 'x');
    state = keystroke(state, '');
    state = keystroke(state, 'k');
    state = keystroke(state, '');
    state = keystroke(state, 'q');
    expect(scoreFor(state, 'letter-c')).toBe(0);
  });

  it('mistakes can drop a learnt skill back below the threshold', () => {
    let state = makeTutorState().set('scores', Map({ 'letter-a': 10 }));
    expect(isSkillLearnt(state, 'letter-a')).toBe(true);
    state = withPrompt(state, 'a', 'letter-a');
    state = keystroke(state, 'x');
    state = keystroke(state, '');
    state = keystroke(state, 'y');
    expect(scoreFor(state, 'letter-a')).toBe(9);
    expect(isSkillLearnt(state, 'letter-a')).toBe(false);
    expect(activeSkills(state).map((s) => s.id)).toContain('letter-a');
  });

  it('ignores keystrokes after completion', () => {
    let state = withPrompt(makeTutorState(), 'a', 'letter-a');
    state = keystroke(state, 'a');
    const done = state;
    state = keystroke(state, 'ab');
    expect(is(state, done)).toBe(true);
  });
});

describe('fox flow', () => {
  it('serves the fox sentence on the first prompt and every FOX_INTERVAL-th after', () => {
    const learnt = Map(allLetterIds.map((id) => [id, 20] as [string, number]));
    // The learner's very first prompt, before anything is completed.
    const first = nextPrompt(makeTutorState({ seed: 3 }));
    expect(first.prompt?.isFox).toBe(true);
    expect(first.prompt?.text).toBe(FOX_SENTENCE);
    expect(first.prompt?.targetSkillId).toBeNull();

    let state = makeTutorState({ seed: 3, promptCounter: FOX_INTERVAL }).set('scores', learnt);
    state = nextPrompt(state);
    expect(state.prompt?.isFox).toBe(true);
    // ...and the one after that is a normal prompt again
    const after = nextPrompt(state.set('promptCounter', FOX_INTERVAL + 1));
    expect(after.prompt?.isFox).toBe(false);
  });

  it('fails instantly on the first wrong character', () => {
    let state = withPrompt(makeTutorState({ promptCounter: 99 }), FOX_SENTENCE, null, true);
    state = keystroke(state, 'T');
    state = keystroke(state, 'Th');
    state = keystroke(state, 'Tx');
    expect(state.prompt?.failed).toBe(true);
    expect(state.prompt?.completed).toBe(true);
    expect(state.promptCounter).toBe(100);
  });

  it('completes flawlessly, scoring FOX_AWARD for every skill in the sentence', () => {
    let state = withPrompt(makeTutorState({ promptCounter: 99 }), FOX_SENTENCE, null, true);
    state = keystroke(state, FOX_SENTENCE);
    expect(state.prompt?.completed).toBe(true);
    expect(state.prompt?.failed).toBe(false);
    expect(state.promptCounter).toBe(100);
    expect(state.scores.size).toBeGreaterThan(0);
    // One FOX_AWARD per occurrence — 'o' appears three times, so it scores thrice.
    for (const [, score] of state.scores) expect(score % FOX_AWARD).toBe(0);
    expect(scoreFor(state, 'letter-o')).toBe(FOX_AWARD * 3);
    expect(scoreFor(state, 'contraction-the')).toBe(FOX_AWARD * 2); // "The" and "the"
    // A single flawless occurrence learns the skill outright.
    expect(isSkillLearnt(state, 'contraction-the')).toBe(true);
  });

  it('scores the occurrences typed before a run fails, and no more', () => {
    let state = withPrompt(makeTutorState(), FOX_SENTENCE, null, true);
    // "The quick" typed correctly, then a wrong character.
    state = keystroke(state, 'The quick');
    state = keystroke(state, 'The quickx');
    expect(state.prompt?.failed).toBe(true);
    expect(scoreFor(state, 'contraction-the')).toBe(FOX_AWARD);
    // "brown" comes after the mistake and never scored.
    expect(scoreFor(state, 'groupsign-ow')).toBe(0);
  });

  it('never reveals a hint, by mistake or by timer', () => {
    let state = withPrompt(makeTutorState(), FOX_SENTENCE, null, true);
    state = keystroke(state, 'x');
    expect(state.prompt?.hintedUnits.isEmpty()).toBe(true);
    expect(revealHint(state, 0).prompt?.hintedUnits.isEmpty()).toBe(true);
  });
});

describe('progress views', () => {
  it('report the learnt count and the active window', () => {
    let state = makeTutorState({ promptCounter: 12 });
    state = state.set('scores', Map({ 'letter-a': 11, 'letter-b': 3 }));
    expect(learntSkills(state).length).toBe(1);
    expect(activeSkills(state).map((s) => s.id)).toEqual([
      'letter-b',
      'letter-c',
      'letter-d',
      'letter-e',
      'letter-f',
    ]);
    expect(scoreFor(state, 'letter-b')).toBe(3);
  });
});

describe('serialization', () => {
  it('round-trips through JSON', () => {
    let state = startSession(1234);
    state = keystroke(state, 'x'); // some prompt progress
    const json = JSON.stringify(serialize(state));
    const revived = deserialize(JSON.parse(json));
    expect(is(revived, state)).toBe(true);
  });

  it('round-trips mid-prompt unit tracking', () => {
    let state = withPrompt(makeTutorState({ seed: 5 }), 'cat', 'letter-c');
    state = keystroke(state, 'c'); // awarded unit
    state = keystroke(state, 'cx'); // mistake on the a occurrence
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(is(revived, state)).toBe(true);
    expect(revived.prompt?.unitMistakes.get(1)).toBe(1);
    expect(revived.prompt?.awardedUnits.has('0:letter-c')).toBe(true);
  });

  it('migrates legacy numeric awardedUnits onto canonical award keys', () => {
    let state = withPrompt(makeTutorState({ seed: 5 }), 'cat', 'letter-c');
    state = keystroke(state, 'c');
    const json = JSON.parse(JSON.stringify(serialize(state))) as {
      prompt: { awardedUnits: unknown[] };
    };
    json.prompt.awardedUnits = [0]; // as an old save would have stored it
    const revived = deserialize(json);
    expect(revived.prompt?.awardedUnits.has('0:letter-c')).toBe(true);
    // Resuming and finishing must not re-award the migrated unit.
    const done = keystroke(revived, 'cat');
    expect(scoreFor(done, 'letter-c')).toBe(scoreFor(state, 'letter-c'));
  });

  it('round-trips a state with no prompt and with scores', () => {
    const state = makeTutorState({ seed: 9, promptCounter: 205 }).set(
      'scores',
      Map({ 'letter-a': 12, 'groupsign-ing': 4 }),
    );
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(is(revived, state)).toBe(true);
  });

  it('rejects garbage', () => {
    expect(() => deserialize(null)).toThrow(TypeError);
    expect(() => deserialize('nope')).toThrow(TypeError);
    expect(() => deserialize({ version: 2 })).toThrow(TypeError);
  });
});
