import { Map, is } from 'immutable';
import { describe, expect, it } from 'vitest';
import { skills } from '../data/skills';
import {
  activeSkills,
  hintDelayForSkills,
  isSkillLearnt,
  learntSkills,
  learntSkillsIn,
  scoreFor,
} from './progress';
import { FOX_SENTENCE } from './fox';
import { derivedScores, judgedPrintCaret } from './scoring';
import {
  deserialize,
  isPromptComplete,
  keystroke,
  nextPrompt,
  revealHint,
  serialize,
  startSession,
} from './session';
import { textToCells, translate } from './braille';
import type { Cell } from './braille';
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

/** Feed one print input event (VoiceOver-style typing). */
function press(state: TutorState, typed: string): TutorState {
  return keystroke(state, { kind: 'print', typed });
}

/** Feed one chorded-cells input event (emulated-mode typing). */
function pressCells(state: TutorState, cells: readonly Cell[]): TutorState {
  return keystroke(state, { kind: 'cells', cells });
}

/** The score a skill shows *now*: committed baseline + the round in flight. */
function shown(state: TutorState, skillId: string): number {
  return derivedScores(state).get(skillId, 0);
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

  it('signs with an unlearnt skill get a time-based hint delay', () => {
    const state = makeTutorState().set('scores', Map({ 'letter-a': 4 }));
    expect(hintDelayForSkills(state, ['letter-a'])).toBe(1600);
  });

  it('waits on the weakest unlearnt skill, ignoring learnt ones', () => {
    const state = makeTutorState().set(
      'scores',
      Map({ 'letter-a': 11, 'capital-letter-indicator': 2, 'letter-b': 5 }),
    );
    expect(hintDelayForSkills(state, ['capital-letter-indicator', 'letter-a', 'letter-b'])).toBe(
      hintDelayMs(2),
    );
  });

  it('all-learnt signs and skill-less (space) signs get no time-based hint', () => {
    const state = makeTutorState().set('scores', Map({ 'letter-a': 11 }));
    expect(hintDelayForSkills(state, ['letter-a'])).toBeNull();
    expect(hintDelayForSkills(state, [])).toBeNull();
  });
});

describe('keystroke', () => {
  it('shows each occurrence scoring as it is typed, and commits at completion', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = press(state, 'c');
    expect(shown(state, 'letter-c')).toBe(2); // visible before the prompt completes
    expect(scoreFor(state, 'letter-c')).toBe(0); // ...but not banked yet
    expect(isPromptComplete(state)).toBe(false);
    state = press(state, 'ca');
    expect(shown(state, 'letter-a')).toBe(2);
    state = press(state, 'cat');
    expect(isPromptComplete(state)).toBe(true);
    expect(scoreFor(state, 'letter-c')).toBe(2);
    expect(scoreFor(state, 'letter-a')).toBe(2);
    expect(scoreFor(state, 'letter-t')).toBe(2);
    expect(state.promptCounter).toBe(1);
  });

  it('scores every occurrence, hinted (the "a cad ebb" example)', () => {
    let state = withPrompt(makeTutorState(), 'a cad ebb', 'letter-a');
    state = revealWholePrompt(state);
    state = press(state, 'a cad ebb');
    expect(isPromptComplete(state)).toBe(true);
    expect(scoreFor(state, 'letter-a')).toBe(2); // two occurrences, 1 each
    expect(scoreFor(state, 'letter-c')).toBe(1);
    expect(scoreFor(state, 'letter-d')).toBe(1);
    expect(scoreFor(state, 'letter-e')).toBe(1);
    expect(scoreFor(state, 'letter-b')).toBe(2); // two occurrences, 1 each
  });

  it('occurrences typed before their hint appears keep their extra point', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = press(state, 'ca');
    state = revealHint(state, 2); // the 't' the caret is now waiting on
    state = press(state, 'cat');
    expect(scoreFor(state, 'letter-c')).toBe(2);
    expect(scoreFor(state, 'letter-a')).toBe(2);
    expect(scoreFor(state, 'letter-t')).toBe(1); // typed after its hint showed
  });

  it('hinting one sign leaves the rest of the prompt still worth two points', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = revealHint(state, 0); // dawdled on the 'c', so it was hinted
    state = press(state, 'cat'); // ...then typed the rest straight off
    expect(scoreFor(state, 'letter-c')).toBe(1);
    expect(scoreFor(state, 'letter-a')).toBe(2);
    expect(scoreFor(state, 'letter-t')).toBe(2);
  });

  it('pays the base rate only while the reveal timer is switched off', () => {
    let state = makeTutorState().set('revealTimer', false);
    state = withPrompt(state, 'cat', 'letter-c');
    state = press(state, 'cat'); // typed cold: no hint shown, no mistake made
    expect(isPromptComplete(state)).toBe(true);
    // Nothing was on the clock, so there was no clock to beat: points still
    // accrue, but the extra one for beating it does not.
    expect(scoreFor(state, 'letter-c')).toBe(1);
    expect(scoreFor(state, 'letter-a')).toBe(1);
    expect(scoreFor(state, 'letter-t')).toBe(1);
  });

  it('still penalises two mistakes with the reveal timer switched off', () => {
    let state = makeTutorState().set('scores', Map({ 'letter-c': 5 })).set('revealTimer', false);
    state = withPrompt(state, 'cat', 'letter-c');
    state = press(state, 'x'); // mistake 1 on c
    state = press(state, ''); // corrected
    state = press(state, 'k'); // mistake 2 on c
    expect(state.prompt?.hintedUnits.toArray()).toEqual([0]); // the rule still reveals
    expect(shown(state, 'letter-c')).toBe(4);
  });

  it('a single corrected mistake drops that occurrence to one point', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = press(state, 'x'); // mistake on the c occurrence
    expect(state.prompt?.hintedUnits.isEmpty()).toBe(true);
    expect(shown(state, 'letter-c')).toBe(0);
    state = press(state, ''); // backspace to a valid prefix
    state = press(state, 'cat');
    expect(scoreFor(state, 'letter-c')).toBe(1); // mistyped once, then correct
    expect(scoreFor(state, 'letter-a')).toBe(2); // clean occurrences unaffected
    expect(scoreFor(state, 'letter-t')).toBe(2);
  });

  it("two mistakes on the same occurrence cost a point and reveal that sign's hint", () => {
    let state = makeTutorState().set('scores', Map({ 'letter-c': 5 }));
    state = withPrompt(state, 'cat', 'letter-c');
    state = press(state, 'x'); // mistake 1 on c
    state = press(state, ''); // corrected
    state = press(state, 'k'); // mistake 2 on c
    expect(state.prompt?.hintedUnits.toArray()).toEqual([0]); // only the 'c'
    expect(shown(state, 'letter-c')).toBe(4);
    // typing it correctly still earns the base point, so the round is a wash
    state = press(state, '');
    state = press(state, 'cat');
    expect(scoreFor(state, 'letter-c')).toBe(5);
  });

  it('penalises a second mistake even after it is backspaced away', () => {
    let state = makeTutorState().set('scores', Map({ 'letter-c': 5 }));
    state = withPrompt(state, 'cat', 'letter-c');
    state = press(state, 'x'); // mistake 1 on c
    state = press(state, ''); // corrected
    state = press(state, 'k'); // mistake 2 on c
    state = press(state, ''); // corrected again — the mistakes still happened
    expect(shown(state, 'letter-c')).toBe(4); // penalty stands, c not yet typed
    state = press(state, 'c');
    expect(shown(state, 'letter-c')).toBe(5); // BASE_AWARD back, no clean bonus
  });

  it('mistakes on different occurrences neither penalise nor force the hint', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = press(state, 'x'); // mistake on c
    state = press(state, 'c'); // corrected
    expect(shown(state, 'letter-c')).toBe(1);
    state = press(state, 'cx'); // mistake on a
    expect(state.prompt?.hintedUnits.isEmpty()).toBe(true);
    expect(shown(state, 'letter-a')).toBe(0);
    state = press(state, 'ca');
    state = press(state, 'cat');
    expect(scoreFor(state, 'letter-c')).toBe(1);
    expect(scoreFor(state, 'letter-a')).toBe(1);
    expect(scoreFor(state, 'letter-t')).toBe(2);
  });

  it('typing further while diverged is still one mistake', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = press(state, 'x');
    state = press(state, 'xy');
    state = press(state, 'xyz');
    expect(state.prompt?.unitMistakes.get(0)).toBe(1);
    expect(state.prompt?.hintedUnits.isEmpty()).toBe(true);
    expect(shown(state, 'letter-c')).toBe(0);
  });

  it('takes an occurrence back when it is backspaced away', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = press(state, 'ca');
    expect(shown(state, 'letter-a')).toBe(2);
    state = press(state, 'c'); // backspace over the 'a'
    expect(shown(state, 'letter-a')).toBe(0); // back to baseline
    expect(scoreFor(state, 'letter-a')).toBe(0); // and nothing was committed
  });

  it('commits an occurrence once, however often it is retyped', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = press(state, 'ca');
    state = press(state, 'c'); // backspace
    state = press(state, 'ca'); // retype
    expect(shown(state, 'letter-a')).toBe(2);
    state = press(state, 'cat');
    expect(scoreFor(state, 'letter-a')).toBe(2);
  });

  it('un-earns earlier occurrences when an earlier word is rewritten wrong', () => {
    // VoiceOver commits whole words, so a correction can rewrite a word
    // typed several signs back.
    let state = withPrompt(makeTutorState(), 'cab dad', 'letter-c');
    state = press(state, 'cab da');
    expect(shown(state, 'letter-c')).toBe(2);
    expect(shown(state, 'letter-a')).toBe(4); // both occurrences
    state = press(state, 'cxb da'); // the first word comes back wrong
    expect(shown(state, 'letter-c')).toBe(2); // the 'c' still stands
    expect(shown(state, 'letter-a')).toBe(0); // everything after it does not
    expect(shown(state, 'letter-d')).toBe(0);
    expect(scoreFor(state, 'letter-a')).toBe(0);
    state = press(state, 'cab dad'); // typed out correctly, prompt done
    expect(scoreFor(state, 'letter-c')).toBe(2);
    expect(scoreFor(state, 'letter-a')).toBe(3); // the mistyped 'a' is worth 1
    expect(scoreFor(state, 'letter-d')).toBe(4);
  });

  it('commits nothing when a prompt is abandoned before completing', () => {
    let state = withPrompt(makeTutorState({ seed: 3, promptCounter: 4 }), 'cat', 'letter-c');
    state = press(state, 'ca');
    state = nextPrompt(state);
    expect(state.scores.isEmpty()).toBe(true);
    expect(state.promptCounter).toBe(4);
  });

  it('indicator skills score together with their unit', () => {
    let state = withPrompt(makeTutorState(), 'Cab', 'capital-letter-indicator');
    state = press(state, 'C');
    expect(shown(state, 'capital-letter-indicator')).toBe(2);
    expect(shown(state, 'letter-c')).toBe(2);
    state = press(state, 'Cab');
    expect(scoreFor(state, 'capital-letter-indicator')).toBe(2);
  });

  it('scores floor at zero', () => {
    let state = withPrompt(makeTutorState(), 'cat', 'letter-c');
    state = press(state, 'x');
    state = press(state, '');
    state = press(state, 'k');
    state = press(state, '');
    state = press(state, 'q');
    expect(shown(state, 'letter-c')).toBe(0);
    state = press(state, '');
    state = press(state, 'cat');
    expect(scoreFor(state, 'letter-c')).toBe(0); // +1 typed, -1 penalty
  });

  it('mistakes drop a learnt skill below the threshold while the round runs', () => {
    let state = makeTutorState().set('scores', Map({ 'letter-a': 10 }));
    expect(isSkillLearnt(state, 'letter-a')).toBe(true);
    state = withPrompt(state, 'a', 'letter-a');
    state = press(state, 'x');
    state = press(state, '');
    state = press(state, 'y');
    expect(shown(state, 'letter-a')).toBe(9);
    // The active window is chosen by the committed scores, so it holds
    // still until the round is over.
    expect(activeSkills(state).map((s) => s.id)).not.toContain('letter-a');
    state = press(state, '');
    state = press(state, 'a');
    expect(scoreFor(state, 'letter-a')).toBe(10); // penalty and award cancel
  });

  it('ignores keystrokes after completion', () => {
    let state = withPrompt(makeTutorState(), 'a', 'letter-a');
    state = press(state, 'a');
    const done = state;
    state = press(state, 'ab');
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
    state = press(state, 'T');
    state = press(state, 'Th');
    state = press(state, 'Tx');
    expect(state.prompt?.failed).toBe(true);
    expect(state.prompt?.completed).toBe(true);
    expect(state.promptCounter).toBe(100);
  });

  it('completes flawlessly, scoring FOX_AWARD for every skill in the sentence', () => {
    let state = withPrompt(makeTutorState({ promptCounter: 99 }), FOX_SENTENCE, null, true);
    state = press(state, FOX_SENTENCE);
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
    state = press(state, 'The quick');
    state = press(state, 'The quickx');
    expect(state.prompt?.failed).toBe(true);
    expect(scoreFor(state, 'contraction-the')).toBe(FOX_AWARD);
    // "brown" comes after the mistake and never scored.
    expect(scoreFor(state, 'groupsign-ow')).toBe(0);
  });

  it('commits the run even when it fails on the last word', () => {
    let state = withPrompt(makeTutorState({ promptCounter: 7 }), FOX_SENTENCE, null, true);
    const upToLastWord = FOX_SENTENCE.slice(0, FOX_SENTENCE.lastIndexOf(' ') + 1);
    state = press(state, upToLastWord);
    const earned = derivedScores(state);
    expect(earned.get('contraction-the')).toBe(FOX_AWARD * 2);
    state = press(state, `${upToLastWord}#`);
    expect(state.prompt?.failed).toBe(true);
    expect(state.promptCounter).toBe(8);
    expect(is(state.scores, earned)).toBe(true);
  });

  it('never reveals a hint, by mistake or by timer', () => {
    let state = withPrompt(makeTutorState(), FOX_SENTENCE, null, true);
    state = press(state, 'x');
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

  it('derive the round in flight, and take it back when it is undone', () => {
    let state = makeTutorState().set('scores', Map({ 'letter-a': 9 }));
    state = withPrompt(state, 'cat', 'letter-c');
    state = press(state, 'ca');
    // The 'a' just typed is enough to show letter-a as learnt...
    expect(learntSkillsIn(derivedScores(state)).map((s) => s.id)).toContain('letter-a');
    expect(shown(state, 'letter-a')).toBe(11);
    // ...but the active window still comes from the committed scores, so
    // letter-a keeps its slot until the round is over.
    expect(activeSkills(state).map((s) => s.id)).toContain('letter-a');

    const undone = press(state, 'c');
    expect(learntSkillsIn(derivedScores(undone))).toEqual([]);
    expect(shown(undone, 'letter-a')).toBe(9);
  });
});

describe('cell-judged rounds', () => {
  /** The canonical cells of `text`, as mutable Cell[]s. */
  function canonicalCells(text: string): Cell[] {
    return textToCells(text).map((c) => [...c]);
  }

  it('completes a prompt whose canonical cells are chorded exactly', () => {
    let state = withPrompt(makeTutorState(), 'the dog', 'letter-d');
    const cells = canonicalCells('the dog');
    for (let i = 1; i <= cells.length; i += 1) {
      state = pressCells(state, cells.slice(0, i));
    }
    expect(isPromptComplete(state)).toBe(true);
    expect(scoreFor(state, 'contraction-the')).toBe(2);
    expect(scoreFor(state, 'letter-d')).toBe(2);
  });

  it('counts a wordsign spelled the long way as a mistake, right print or not', () => {
    // "still" is the st wordsign ⠌; chording s-t-i-l-l letter by letter
    // produces the right print but is not the braille being drilled.
    let state = withPrompt(makeTutorState(), 'still', 'wordsign-still');
    state = pressCells(state, [[2, 3, 4]]); // ⠎ = s — already off the wordsign
    expect(state.prompt?.diverged).toBe(true);
    expect(state.prompt?.unitMistakes.isEmpty()).toBe(false);
    // Backspacing to empty and chording the wordsign completes the round.
    state = pressCells(state, []);
    expect(state.prompt?.diverged).toBe(false);
    state = pressCells(state, canonicalCells('still'));
    expect(isPromptComplete(state)).toBe(true);
  });

  it('keeps typed as the back-translation of the buffer, for display', () => {
    let state = withPrompt(makeTutorState(), 'the dog', 'letter-d');
    state = pressCells(state, canonicalCells('the'));
    expect(state.prompt?.typed).toBe('the');
    expect(state.prompt?.judgedByCells).toBe(true);
  });

  it('never completes on a full valid-print spelling whose cells are off canon', () => {
    // s,t,i,l,l derives the whole prompt text — the print-derivation
    // guarantee still holds for display — but the round stays diverged and
    // unfinished: the cells are what is being drilled.
    let state = withPrompt(makeTutorState(), 'still', 'wordsign-still');
    const spelled: Cell[] = [];
    for (const cell of [[2, 3, 4], [2, 3, 4, 5], [2, 4], [1, 2, 3], [1, 2, 3]] as const) {
      spelled.push([...cell]);
      state = pressCells(state, spelled);
    }
    expect(state.prompt?.typed).toBe('still');
    expect(state.prompt?.diverged).toBe(true);
    expect(isPromptComplete(state)).toBe(false);
    // Still one mistake event: the learner never returned to the canon.
    expect(state.prompt?.unitMistakes.get(0)).toBe(1);
  });

  it('maps the judged caret to print at the last fully-chorded unit', () => {
    let state = withPrompt(makeTutorState(), 'still', 'wordsign-still');
    state = pressCells(state, [[2, 3, 4]]); // ⠎ derives "s", but no unit is chorded
    expect(state.prompt?.typed).toBe('s');
    expect(judgedPrintCaret(state.prompt!)).toBe(0);
    state = pressCells(state, []);
    state = pressCells(state, canonicalCells('still')); // ⠌ — the whole word
    expect(judgedPrintCaret(state.prompt!)).toBe('still'.length);
  });

  it('round-trips a cell-judged prompt through JSON', () => {
    let state = withPrompt(makeTutorState({ seed: 5 }), 'the dog', 'letter-d');
    state = pressCells(state, canonicalCells('the'));
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(is(revived, state)).toBe(true);
    expect(revived.prompt?.typedUnicode).toBe(state.prompt?.typedUnicode);
  });
});

describe('serialization', () => {
  it('round-trips through JSON', () => {
    let state = startSession(1234);
    state = press(state, 'x'); // some prompt progress
    const json = JSON.stringify(serialize(state));
    const revived = deserialize(JSON.parse(json));
    expect(is(revived, state)).toBe(true);
  });

  it('round-trips mid-prompt unit tracking', () => {
    let state = withPrompt(makeTutorState({ seed: 5 }), 'cat', 'letter-c');
    state = press(state, 'c'); // one unit typed
    state = press(state, 'cx'); // mistake on the a occurrence
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(is(revived, state)).toBe(true);
    expect(revived.prompt?.unitMistakes.get(1)).toBe(1);
    expect(shown(revived, 'letter-c')).toBe(2); // the round in flight survives
  });

  it('round-trips a state with no prompt and with scores', () => {
    const state = makeTutorState({ seed: 9, promptCounter: 205 }).set(
      'scores',
      Map({ 'letter-a': 12, 'groupsign-ing': 4 }),
    );
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(is(revived, state)).toBe(true);
  });

  it('round-trips the reveal timer, and loads an envelope written before it', () => {
    const off = makeTutorState({ seed: 3 }).set('revealTimer', false);
    expect(deserialize(JSON.parse(JSON.stringify(serialize(off)))).revealTimer).toBe(false);
    const raw = serialize(startSession(7)) as unknown as Record<string, unknown>;
    delete raw.revealTimer;
    expect(deserialize(raw).revealTimer).toBe(true);
  });

  it('rejects garbage', () => {
    expect(() => deserialize(null)).toThrow(TypeError);
    expect(() => deserialize('nope')).toThrow(TypeError);
    expect(() => deserialize({ version: 2 })).toThrow(TypeError);
  });
});
