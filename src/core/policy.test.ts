import { Map } from 'immutable';
import { describe, expect, it } from 'vitest';
import { skills } from '../data/skills';
import { translate } from './braille';
import {
  DEFAULT_SKILL_POLICY,
  policyFor,
  setAllPolicies,
  setGroupPolicy,
  setSkillPolicy,
} from './policy';
import type { SkillPolicy } from './policy';
import { activeSkills, forcedSkills, knownSkillIds, revisableSkills } from './progress';
import { pickTarget } from './prompts';
import { mulberry32 } from './rng';
import { deserialize, nextPrompt, serialize, startSession } from './session';
import type { TutorState } from './types';
import { ACTIVE_SKILL_COUNT, LEARNT_THRESHOLD, makeTutorState } from './types';

function ids(list: readonly { readonly id: string }[]): string[] {
  return list.map((s) => s.id);
}

function learnt(state: TutorState, count: number): TutorState {
  let scores = state.scores;
  for (const s of skills.slice(0, count)) scores = scores.set(s.id, LEARNT_THRESHOLD);
  return state.set('scores', scores);
}

const base = makeTutorState();

describe('policyFor / setters', () => {
  it('defaults to allow', () => {
    expect(policyFor(base, 'letter-a')).toBe(DEFAULT_SKILL_POLICY);
    expect(DEFAULT_SKILL_POLICY).toBe('allow');
  });

  it('stores non-default rulings only', () => {
    const forced = setSkillPolicy(base, 'letter-a', 'force');
    expect(policyFor(forced, 'letter-a')).toBe('force');
    expect(forced.policies.toObject()).toEqual({ 'letter-a': 'force' });

    const back = setSkillPolicy(forced, 'letter-a', 'allow');
    expect(policyFor(back, 'letter-a')).toBe('allow');
    expect(back.policies.isEmpty()).toBe(true);
  });

  it('sets a whole group', () => {
    const state = setGroupPolicy(base, 'numbers', 'block');
    const numbers = skills.filter((s) => s.group === 'numbers');
    expect(numbers.length).toBeGreaterThan(0);
    for (const s of numbers) expect(policyFor(state, s.id)).toBe('block');
    expect(policyFor(state, 'letter-a')).toBe('allow');
  });

  it('sets every skill, and clears back to nothing stored', () => {
    const blocked = setAllPolicies(base, 'block');
    expect(blocked.policies.size).toBe(skills.length);
    expect(setAllPolicies(blocked, 'allow').policies.isEmpty()).toBe(true);
  });
});

describe('activeSkills under policies', () => {
  it('is the first five unlearnt skills when everything is allowed', () => {
    expect(ids(activeSkills(base))).toEqual(ids(skills.slice(0, ACTIVE_SKILL_COUNT)));
  });

  it('skips blocked skills when choosing the window', () => {
    const state = setSkillPolicy(setSkillPolicy(base, 'letter-a', 'block'), 'letter-c', 'block');
    const chosen = ids(activeSkills(state));
    expect(chosen).not.toContain('letter-a');
    expect(chosen).not.toContain('letter-c');
    expect(chosen).toHaveLength(ACTIVE_SKILL_COUNT);
    expect(chosen).toEqual(['letter-b', 'letter-d', 'letter-e', 'letter-f', 'letter-g']);
  });

  it('adds forced skills on top of the algorithm’s five', () => {
    const state = setSkillPolicy(base, 'shortform-about', 'force');
    const chosen = ids(activeSkills(state));
    expect(chosen).toHaveLength(ACTIVE_SKILL_COUNT + 1);
    expect(chosen).toContain('shortform-about');
    expect(chosen.slice(0, ACTIVE_SKILL_COUNT)).toEqual(
      ids(skills.slice(0, ACTIVE_SKILL_COUNT)),
    );
    expect(ids(forcedSkills(state))).toEqual(['shortform-about']);
  });

  it('does not let a forced skill take one of the algorithm’s slots', () => {
    const state = setSkillPolicy(base, 'letter-b', 'force');
    const chosen = ids(activeSkills(state));
    expect(chosen).toContain('letter-b');
    expect(chosen).toHaveLength(ACTIVE_SKILL_COUNT + 1);
    expect(chosen).toContain('letter-f');
  });

  it('keeps a forced skill active even once it is learnt', () => {
    const state = setSkillPolicy(learnt(base, 3), 'letter-a', 'force');
    expect(ids(activeSkills(state))).toContain('letter-a');
  });

  it('returns the window in curriculum order', () => {
    const state = setSkillPolicy(base, 'shortform-about', 'force');
    const orders = activeSkills(state).map((s) => s.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('is empty when every skill is blocked', () => {
    expect(activeSkills(setAllPolicies(base, 'block'))).toEqual([]);
  });
});

describe('knownSkillIds under policies', () => {
  it('drops a blocked skill even when it is learnt', () => {
    const state = setSkillPolicy(learnt(base, 5), 'letter-a', 'block');
    expect(knownSkillIds(state).has('letter-a')).toBe(false);
    expect(knownSkillIds(state).has('letter-b')).toBe(true);
  });

  it('includes forced skills', () => {
    const state = setSkillPolicy(base, 'shortform-about', 'force');
    expect(knownSkillIds(state).has('shortform-about')).toBe(true);
  });
});

describe('target selection under policies', () => {
  const rngs = Array.from({ length: 200 }, (_, i) => mulberry32(i + 1));

  it('never picks a blocked skill', () => {
    const state = setGroupPolicy(learnt(base, 30), 'letters', 'block');
    for (const rng of rngs) {
      expect(policyFor(state, pickTarget(state, rng).id)).not.toBe('block');
    }
  });

  it('leaves blocked skills out of the revision pool', () => {
    const state = setSkillPolicy(learnt(base, 5), 'letter-a', 'block');
    expect(ids(revisableSkills(state))).not.toContain('letter-a');
    expect(ids(revisableSkills(state))).toContain('letter-b');
  });

  it('still yields a prompt when the whole curriculum is blocked', () => {
    const state = nextPrompt(setAllPolicies(base, 'block').set('promptCounter', 1));
    expect(state.prompt?.isFox).toBe(false);
    expect(state.prompt?.text.length).toBeGreaterThan(0);
  });
});

describe('generated prompts respect policies', () => {
  it('never uses a blocked skill in prompt text', () => {
    let state = learnt(base, 40).set('promptCounter', 1);
    state = setSkillPolicy(state, 'strong-groupsign-ed', 'block');
    state = setSkillPolicy(state, 'letter-q', 'block');
    let seen = 0;
    for (let i = 0; i < 200; i += 1) {
      state = nextPrompt(state);
      const prompt = state.prompt!;
      expect(prompt.isFox).toBe(false);
      const used = translate(prompt.text).skillIds;
      expect(used).not.toContain('strong-groupsign-ed');
      expect(used).not.toContain('letter-q');
      seen += 1;
    }
    expect(seen).toBe(200);
  });

  it('drills a forced skill within a handful of prompts', () => {
    let state = setSkillPolicy(base.set('promptCounter', 1), 'shortform-about', 'force');
    const targets = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      state = nextPrompt(state);
      const id = state.prompt?.targetSkillId;
      if (id !== null && id !== undefined) targets.add(id);
    }
    expect(targets).toContain('shortform-about');
  });
});

describe('serialisation', () => {
  it('round-trips policies', () => {
    let state = setSkillPolicy(base, 'letter-a', 'force');
    state = setSkillPolicy(state, 'letter-b', 'block');
    const back = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(back.policies.toObject()).toEqual({ 'letter-a': 'force', 'letter-b': 'block' });
  });

  it('loads an envelope written before policies existed', () => {
    const raw = serialize(startSession(7)) as unknown as Record<string, unknown>;
    delete raw.policies;
    expect(deserialize(raw).policies.isEmpty()).toBe(true);
  });

  it('drops garbage and redundant allow entries', () => {
    const raw = serialize(base) as unknown as Record<string, unknown>;
    raw.policies = { 'letter-a': 'allow', 'letter-b': 'sideways', 'letter-c': 'force' };
    expect(deserialize(raw).policies.toObject()).toEqual({ 'letter-c': 'force' });
  });
});

describe('startSession', () => {
  it('carries the policies it is given into the session', () => {
    const policies = Map<string, SkillPolicy>({ 'letter-a': 'block', 'letter-b': 'block' });
    const state = startSession(1, policies);
    expect(state.policies).toEqual(policies);
    expect(ids(activeSkills(state))).not.toContain('letter-a');

    const drill = nextPrompt(state.set('promptCounter', 1));
    const used = translate(drill.prompt!.text).skillIds;
    expect(used).not.toContain('letter-a');
    expect(used).not.toContain('letter-b');
  });
});
