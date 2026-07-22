// Read-only views over TutorState: scores (committed and derived),
// learnt/active skills, hints.

import type { Map } from 'immutable';
import type { Skill } from '../data/skills';
import { skills } from '../data/skills';
import type { TutorState } from './types';
import { ACTIVE_SKILL_COUNT, hintDelayMs, isLearntScore } from './types';

/** The committed score for a skill (0 if never touched). */
export function scoreFor(state: TutorState, skillId: string): number {
  return state.scores.get(skillId, 0);
}

/** Whether a score map counts a skill as learnt. */
export function isLearntIn(scores: Map<string, number>, skillId: string): boolean {
  return isLearntScore(scores.get(skillId, 0));
}

/**
 * Whether a skill currently counts as learnt by its *committed* score.
 * Selection (which skills are active, which are learnt) deliberately
 * ignores the round in flight so the active window does not churn
 * mid-prompt; for what the learner is shown, use derivedScores().
 */
export function isSkillLearnt(state: TutorState, skillId: string): boolean {
  return isLearntIn(state.scores, skillId);
}

/** All skills a score map counts as learnt, in curriculum order. */
export function learntSkillsIn(scores: Map<string, number>): readonly Skill[] {
  return skills.filter((s) => isLearntIn(scores, s.id));
}

/** All learnt skills by committed score, in curriculum order. */
export function learntSkills(state: TutorState): readonly Skill[] {
  return learntSkillsIn(state.scores);
}

/**
 * The (up to) 5 unlearnt skills earliest in curriculum order — the skills
 * currently being taught. A learnt skill that drops back below the
 * threshold rejoins this pool automatically. Committed scores only: the
 * window holds still for the length of a prompt.
 */
export function activeSkills(state: TutorState): readonly Skill[] {
  const active: Skill[] = [];
  for (const s of skills) {
    if (!isSkillLearnt(state, s.id)) {
      active.push(s);
      if (active.length === ACTIVE_SKILL_COUNT) break;
    }
  }
  return active;
}

/** Ids of every skill the learner has learnt or is actively learning. */
export function knownSkillIds(state: TutorState): ReadonlySet<string> {
  const known = new Set<string>();
  for (const s of learntSkills(state)) known.add(s.id);
  for (const s of activeSkills(state)) known.add(s.id);
  return known;
}

/**
 * How long (ms) a sign waits before the *first* hint of the current prompt
 * shows, or null if no time-based hint applies: no/finished prompt, the fox
 * challenge (never hinted), or a learnt-skill revision (hint only after two
 * consecutive mistakes, which keystroke() handles internally). Later signs
 * of the same prompt wait HINT_REVEAL_COOLDOWN_MS instead — see
 * nextHintFor() in hints.ts, which decides *which* sign is waiting and is
 * what the state layer actually runs its timer from.
 */
export function hintDelayFor(state: TutorState): number | null {
  const p = state.prompt;
  if (!p || p.completed || p.isFox) return null;
  if (p.targetSkillId === null) return null;
  if (isSkillLearnt(state, p.targetSkillId)) return null;
  return hintDelayMs(scoreFor(state, p.targetSkillId));
}
