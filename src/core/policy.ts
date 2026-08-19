import type { Skill, SkillGroup } from '../data/skills';
import { skills } from '../data/skills';
import type { TutorState } from './types';

export type SkillPolicy = 'force' | 'allow' | 'block';

export const DEFAULT_SKILL_POLICY: SkillPolicy = 'allow';

export const SKILL_POLICIES: readonly SkillPolicy[] = ['force', 'allow', 'block'];

export function isSkillPolicy(value: unknown): value is SkillPolicy {
  return value === 'force' || value === 'allow' || value === 'block';
}

export function policyFor(state: TutorState, skillId: string): SkillPolicy {
  return state.policies.get(skillId, DEFAULT_SKILL_POLICY);
}

export function setSkillPolicy(
  state: TutorState,
  skillId: string,
  policy: SkillPolicy,
): TutorState {
  return state.set(
    'policies',
    policy === DEFAULT_SKILL_POLICY
      ? state.policies.remove(skillId)
      : state.policies.set(skillId, policy),
  );
}

export function setGroupPolicy(
  state: TutorState,
  group: SkillGroup,
  policy: SkillPolicy,
): TutorState {
  return setManyPolicies(
    state,
    skills.filter((s) => s.group === group),
    policy,
  );
}

export function setAllPolicies(state: TutorState, policy: SkillPolicy): TutorState {
  return setManyPolicies(state, skills, policy);
}

function setManyPolicies(
  state: TutorState,
  affected: readonly Skill[],
  policy: SkillPolicy,
): TutorState {
  return state.set(
    'policies',
    state.policies.withMutations((map) => {
      for (const s of affected) {
        if (policy === DEFAULT_SKILL_POLICY) map.remove(s.id);
        else map.set(s.id, policy);
      }
    }),
  );
}
