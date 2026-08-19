import type { Map } from 'immutable';
import { List } from 'immutable';
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
  return withPolicies(
    state,
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
  return withPolicies(
    state,
    state.policies.withMutations((map) => {
      for (const s of affected) {
        if (policy === DEFAULT_SKILL_POLICY) map.remove(s.id);
        else map.set(s.id, policy);
      }
    }),
  );
}

/**
 * Store a policy map. Changing the policies changes which skills are being
 * taught, which makes the round already dealt stale (see
 * TutorStateProps.rotation), so it is dropped and the next prompt deals a
 * fresh one from the new configuration.
 */
function withPolicies(state: TutorState, policies: Map<string, SkillPolicy>): TutorState {
  if (policies.equals(state.policies)) return state;
  return state.set('policies', policies).set('rotation', List<string>());
}
