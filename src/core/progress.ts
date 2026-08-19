import type { Map } from 'immutable';
import type { Skill } from '../data/skills';
import { skills } from '../data/skills';
import { policyFor } from './policy';
import type { TutorState } from './types';
import { ACTIVE_SKILL_COUNT, hintDelayMs, isLearntScore } from './types';

export function scoreFor(state: TutorState, skillId: string): number {
  return state.scores.get(skillId, 0);
}

export function isLearntIn(scores: Map<string, number>, skillId: string): boolean {
  return isLearntScore(scores.get(skillId, 0));
}

export function isSkillLearnt(state: TutorState, skillId: string): boolean {
  return isLearntIn(state.scores, skillId);
}

export function learntSkillsIn(scores: Map<string, number>): readonly Skill[] {
  return skills.filter((s) => isLearntIn(scores, s.id));
}

export function learntSkills(state: TutorState): readonly Skill[] {
  return learntSkillsIn(state.scores);
}

export function forcedSkills(state: TutorState): readonly Skill[] {
  if (state.policies.isEmpty()) return [];
  return skills.filter((s) => policyFor(state, s.id) === 'force');
}

export function revisableSkills(state: TutorState): readonly Skill[] {
  const learnt = learntSkills(state);
  if (state.policies.isEmpty()) return learnt;
  return learnt.filter((s) => policyFor(state, s.id) !== 'block');
}

export function activeSkills(state: TutorState): readonly Skill[] {
  const chosen: Skill[] = [];
  for (const s of skills) {
    if (policyFor(state, s.id) !== 'allow') continue;
    if (isSkillLearnt(state, s.id)) continue;
    chosen.push(s);
    if (chosen.length === ACTIVE_SKILL_COUNT) break;
  }
  const forced = forcedSkills(state);
  if (forced.length === 0) return chosen;
  const ids = new Set(chosen.map((s) => s.id));
  for (const s of forced) ids.add(s.id);
  return skills.filter((s) => ids.has(s.id));
}

export function knownSkillIds(state: TutorState): ReadonlySet<string> {
  const known = new Set<string>();
  for (const s of learntSkills(state)) {
    if (policyFor(state, s.id) !== 'block') known.add(s.id);
  }
  for (const s of activeSkills(state)) known.add(s.id);
  return known;
}

export function hintDelayForSkills(
  state: TutorState,
  skillIds: readonly string[],
): number | null {
  let weakest: number | null = null;
  for (const id of skillIds) {
    const score = scoreFor(state, id);
    if (isLearntScore(score)) continue;
    if (weakest === null || score < weakest) weakest = score;
  }
  return weakest === null ? null : hintDelayMs(weakest);
}
