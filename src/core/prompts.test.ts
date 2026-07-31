import { Map } from 'immutable';
import { describe, expect, it } from 'vitest';
import type { Skill } from '../data/skills';
import { skills } from '../data/skills';
import { translate } from './braille';
import { WORDS } from './corpus';
import { activeSkills, knownSkillIds } from './progress';
import { generatePrompt, pickTarget } from './prompts';
import { mulberry32 } from './rng';
import { keystroke, nextPrompt, startSession } from './session';
import type { TutorState } from './types';
import { makeTutorState } from './types';

function skill(id: string): Skill {
  const s = skills.find((x) => x.id === id);
  if (!s) throw new Error(`no skill ${id}`);
  return s;
}

/** All skills strictly before `id` in curriculum order marked learnt. */
function learntUpTo(id: string, seed = 5): TutorState {
  const target = skill(id);
  const learnt = skills.filter((s) => s.order < target.order);
  return makeTutorState({ seed }).set(
    'scores',
    Map(learnt.map((s) => [s.id, 20] as [string, number])),
  );
}

function assertUsesOnlyKnown(state: TutorState, text: string, targetId: string): void {
  const known = new Set(knownSkillIds(state));
  known.add(targetId);
  const t = translate(text);
  for (const id of t.skillIds) {
    expect(known.has(id), `${JSON.stringify(text)} uses unknown skill ${id}`).toBe(true);
  }
}

// Real-word oracle: the corpus plus every skill print that is itself a real
// English word (wordsigns, contractions, shortforms, initial-letter words,
// whole-word lower signs) — prompt generation may fall back to those.
const CORPUS = new Set(WORDS);
for (const s of skills) {
  if (
    s.kind === 'wordsign' ||
    s.kind === 'contraction' ||
    s.kind === 'shortform' ||
    s.kind === 'initial-letter' ||
    (s.kind === 'lowersign' && ['be', 'enough', 'his', 'in', 'was', 'were'].includes(s.print))
  ) {
    CORPUS.add(s.print);
  }
}
/**
 * Every letter run in the text (words may be joined by punctuation like
 * "hat-a" or "cat's") must be a real corpus word or "I".
 */
function assertRealWords(text: string): void {
  const stripped = text.replace(/'s(?![a-z])/g, ''); // possessives
  for (const run of stripped.match(/[a-zA-Z]+/g) ?? []) {
    if (run === 'I') continue;
    expect(
      CORPUS.has(run.toLowerCase()),
      `${JSON.stringify(text)} contains non-word ${JSON.stringify(run)}`,
    ).toBe(true);
  }
}

/** Skills a prompt is teaching: the active window plus its own target. */
function taughtSkillIds(state: TutorState, targetId: string): Set<string> {
  const taught = new Set(activeSkills(state).map((s) => s.id));
  taught.add(targetId);
  return taught;
}

/** Can any usable word exercise one of these skills? (Digits and the */
/* capital indicators cannot appear in a plain lowercase word.) */
function anyWordTeaches(state: TutorState, taught: ReadonlySet<string>): boolean {
  const known = new Set(knownSkillIds(state));
  for (const id of taught) known.add(id);
  return WORDS.some((w) => {
    let ids: readonly string[];
    try {
      ids = translate(w).skillIds;
    } catch {
      return false;
    }
    return ids.every((id) => known.has(id)) && ids.some((id) => taught.has(id));
  });
}

/**
 * Every word of a prompt must exercise at least one skill currently being
 * taught — unless no word can, which happens for windows made only of
 * digits, capital indicators or punctuation.
 */
function assertEveryWordTaught(state: TutorState, text: string, targetId: string): void {
  const taught = taughtSkillIds(state, targetId);
  if (!anyWordTeaches(state, taught)) return;
  for (const token of text.split(' ')) {
    const ids = translate(token).skillIds;
    expect(
      ids.some((id) => taught.has(id)),
      `${JSON.stringify(token)} in ${JSON.stringify(text)} teaches nothing being taught`,
    ).toBe(true);
  }
}

/** Letters whose single cell doubles as a grade-2 wordsign (b=but, ...). */
const WORDSIGN_LETTERS = new Set(
  skills
    .filter((s) => s.kind === 'wordsign' && s.dots.length === 1)
    .flatMap((ws) => {
      const letter = skills.find((l) => l.kind === 'letter' && l.unicode === ws.unicode);
      return letter ? [letter.print] : [];
    }),
);

describe('generatePrompt', () => {
  it('is deterministic for a given state', () => {
    const state = learntUpTo('groupsign-ed');
    const target = skill('groupsign-ed');
    expect(generatePrompt(state, target)).toEqual(generatePrompt(state, target));
  });

  it('emits only real words, gated to known skills, in the fresh session', () => {
    const state = makeTutorState({ seed: 11 }); // only a-e active
    for (const id of ['letter-a', 'letter-b', 'letter-c', 'letter-d', 'letter-e']) {
      for (let seed = 1; seed <= 20; seed++) {
        const s = state.set('seed', seed);
        const { text, targetSkillId } = generatePrompt(s, skill(id));
        expect(targetSkillId).toBe(id);
        expect(text).toMatch(/^[a-e]+( [a-e]+)*$/);
        assertRealWords(text);
        assertUsesOnlyKnown(s, text, id);
        expect(translate(text).skillIds).toContain(id);
      }
    }
  });

  it('prompts a few words at a time from the very first window', () => {
    const state = makeTutorState({ seed: 11 }); // only a-e active
    for (const id of ['letter-a', 'letter-b', 'letter-c', 'letter-d', 'letter-e']) {
      for (let seed = 1; seed <= 20; seed++) {
        const { text } = generatePrompt(state.set('seed', seed), skill(id));
        expect(
          text.split(' ').length,
          `expected a multi-word prompt for ${id}, got ${JSON.stringify(text)}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('never prompts a wordsign letter as a standalone word', () => {
    expect(WORDSIGN_LETTERS.size).toBeGreaterThan(20); // b=but, c=can, ...
    const states = [
      makeTutorState({ seed: 1 }),
      learntUpTo('letter-m'),
      learntUpTo('number-sign'),
      learntUpTo('wordsign-but'),
    ];
    for (const base of states) {
      for (const letter of skills.filter((s) => s.kind === 'letter')) {
        for (let seed = 1; seed <= 5; seed++) {
          const { text } = generatePrompt(base.set('seed', seed), letter);
          for (const token of text.split(' ')) {
            expect(
              WORDSIGN_LETTERS.has(token),
              `bare wordsign letter ${JSON.stringify(token)} in ${JSON.stringify(text)}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('drills digits with the number sign available', () => {
    const state = learntUpTo('digit-3');
    for (let seed = 1; seed <= 10; seed++) {
      const { text } = generatePrompt(state.set('seed', seed), skill('digit-3'));
      expect(text).toMatch(/^[0-9]+$/);
      expect(text).toContain('3');
      assertUsesOnlyKnown(state.set('seed', seed), text, 'digit-3');
    }
  });

  it('drills capitals as capitalised real words', () => {
    const state = learntUpTo('capital-letter-indicator');
    for (let seed = 1; seed <= 10; seed++) {
      const { text } = generatePrompt(state.set('seed', seed), skill('capital-letter-indicator'));
      assertRealWords(text);
      assertUsesOnlyKnown(state.set('seed', seed), text, 'capital-letter-indicator');
      expect(translate(text).skillIds).toContain('capital-letter-indicator');
    }
    const wordState = learntUpTo('capital-word-indicator');
    const { text } = generatePrompt(wordState, skill('capital-word-indicator'));
    expect(text).toMatch(/[A-Z]{2,}/);
    expect(translate(text).skillIds).toContain('capital-word-indicator');
  });

  it('drills punctuation in word context once words are available', () => {
    const state = learntUpTo('punct-period');
    for (let seed = 1; seed <= 20; seed++) {
      const { text } = generatePrompt(state.set('seed', seed), skill('punct-period'));
      expect(text.endsWith('.')).toBe(true);
      assertRealWords(text);
      assertUsesOnlyKnown(state.set('seed', seed), text, 'punct-period');
    }
  });

  it('scales prompts up to multi-word sequences with progress', () => {
    const state = learntUpTo('shortform-about');
    let sawSequence = false;
    for (let seed = 1; seed <= 40; seed++) {
      const { text } = generatePrompt(state.set('seed', seed), skill('contraction-the'));
      assertRealWords(text);
      assertUsesOnlyKnown(state.set('seed', seed), text, 'contraction-the');
      expect(translate(text).skillIds).toContain('contraction-the');
      if (text.split(' ').length >= 3) sawSequence = true;
    }
    expect(sawSequence).toBe(true);
  });
});

describe('every word teaches something', () => {
  it('holds for every skill at the moment it becomes active', () => {
    for (const target of skills) {
      const state = learntUpTo(target.id);
      for (let seed = 1; seed <= 12; seed++) {
        const s = state.set('seed', seed);
        assertEveryWordTaught(s, generatePrompt(s, target).text, target.id);
      }
    }
  });

  it('holds when revising a long-learnt skill', () => {
    const state = learntUpTo('shortform-about');
    for (const id of ['letter-a', 'letter-m', 'contraction-the', 'punct-period']) {
      for (let seed = 1; seed <= 12; seed++) {
        const s = state.set('seed', seed);
        assertEveryWordTaught(s, generatePrompt(s, skill(id)).text, id);
      }
    }
  });
});

describe('reachability', () => {
  it('every skill has a generatable prompt the moment it becomes active', () => {
    for (const target of skills) {
      const state = learntUpTo(target.id);
      let exercised = false;
      for (let seed = 1; seed <= 12; seed++) {
        const s = state.set('seed', seed);
        const { text } = generatePrompt(s, target);
        assertUsesOnlyKnown(s, text, target.id);
        assertRealWords(text);
        if (translate(text).skillIds.includes(target.id)) exercised = true;
      }
      expect(exercised, `${target.id} has no prompt exercising it`).toBe(true);
    }
  });

  it('the five first-window letters are reachable in a fresh session', () => {
    const state = makeTutorState({ seed: 1 });
    for (const id of ['letter-a', 'letter-b', 'letter-c', 'letter-d', 'letter-e']) {
      const { text } = generatePrompt(state, skill(id));
      expect(translate(text).skillIds, `${id} not exercised by ${text}`).toContain(id);
    }
  });
});

describe('pickTarget', () => {
  it('picks only active skills when nothing is learnt', () => {
    const state = makeTutorState({ seed: 2 });
    const activeIds = ['letter-a', 'letter-b', 'letter-c', 'letter-d', 'letter-e'];
    for (let seed = 1; seed <= 40; seed++) {
      const target = pickTarget(state, mulberry32(seed));
      expect(activeIds).toContain(target.id);
    }
  });

  it('mixes revision of learnt skills in', () => {
    const state = learntUpTo('punct-period');
    const picked = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      picked.add(pickTarget(state, mulberry32(seed)).kind);
    }
    expect(picked.has('punctuation')).toBe(true); // active window
    expect(picked.size).toBeGreaterThan(1); // some revision too
  });

  it('revises lowest-scoring learnt skills preferentially', () => {
    // letters all learnt; letter-q has the lowest score
    let state = learntUpTo('capital-letter-indicator');
    state = state.set('scores', state.scores.set('letter-q', 11));
    let sawQ = false;
    for (let seed = 1; seed <= 200; seed++) {
      if (pickTarget(state, mulberry32(seed)).id === 'letter-q') sawQ = true;
    }
    expect(sawQ).toBe(true);
  });
});

describe('full-session smoke test', () => {
  it('always types-through cleanly for many generated prompts', () => {
    let state = startSession(99);
    for (let i = 0; i < 300; i++) {
      const p = state.prompt;
      expect(p).not.toBeNull();
      if (!p) break;
      if (!p.isFox) {
        expect(p.text.length).toBeGreaterThan(0);
        if (p.targetSkillId) {
          assertUsesOnlyKnown(state, p.text, p.targetSkillId);
          assertEveryWordTaught(state, p.text, p.targetSkillId);
        }
      }
      state = keystroke(state, { kind: 'print', typed: p.text }); // type it perfectly
      expect(state.promptCounter).toBe(i + 1);
      state = nextPrompt(state);
    }
    // by now several skills should be learnt
    expect(state.scores.filter((s) => s > 10).size).toBeGreaterThan(5);
  });
});
