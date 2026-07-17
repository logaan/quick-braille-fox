// View models: plain-data snapshots of the store for the UI to render, plus
// the handler interface the UI wires to DOM events. UI components are pure
// render functions of these props; the dependency direction is ui -> state.

import type { ChangeEvent } from 'react';
import type { QbfResult, TutorState } from '../core';
import {
  LEARNT_THRESHOLD,
  QBF_INTERVAL,
  QBF_MIN_CELLS,
  activeSkills,
  hintWordForPrompt,
  isSkillLearnt,
  learntSkills,
  scoreFor,
} from '../core';
import type { SkillGroup } from '../data/skills';
import { skills } from '../data/skills';
import type { BestQbf } from './persistence';

/** One of the (up to) 5 skills currently being taught. */
export interface ActiveSkillView {
  readonly id: string;
  readonly print: string;
  readonly unicode: string;
  readonly score: number;
  /** Score as a 0..1 fraction of the learnt threshold, for progress bars. */
  readonly progress: number;
}

export interface GroupProgressView {
  readonly group: SkillGroup;
  readonly learnt: number;
  readonly total: number;
}

/** A skill whose introduction should be shown with the current prompt. */
export interface IntroView {
  readonly id: string;
  readonly print: string;
  readonly unicode: string;
  readonly group: SkillGroup;
}

/** Everything the UI needs to render, as plain data. */
export interface AppViewModel {
  readonly promptText: string;
  readonly typed: string;
  readonly diverged: boolean;
  readonly isQbf: boolean;
  /** Non-null while the qbf result screen should be shown. */
  readonly qbfResult: QbfResult | null;
  readonly bestQbf: BestQbf | null;
  readonly qbfMinCells: number;
  /** How many completed prompts until the next qbf challenge (1 = this one). */
  readonly nextQbfIn: number;
  /**
   * The hint as U+2800 braille, once it is showing: the caret word's cells,
   * limited to the reveal units uncovered so far (the store uncovers one
   * more per cooldown tick).
   */
  readonly hint: string | null;
  readonly intro: IntroView | null;
  readonly activeSkills: ReadonlyArray<ActiveSkillView>;
  readonly learntCount: number;
  readonly totalSkills: number;
  readonly promptsCompleted: number;
  readonly groups: ReadonlyArray<GroupProgressView>;
  readonly confirmingReset: boolean;
  /**
   * Identity of the current prompt instance. The UI keys the uncontrolled
   * drill input on it, so the field clears (remounts) only at a prompt change,
   * never mid-typing (which would fight VoiceOver).
   */
  readonly promptKey: number;
}

/** Event handlers the store exposes for the UI to attach to DOM events. */
export interface AppHandlers {
  /** Wire to the drill input's change/input event. */
  onInput(event: ChangeEvent<HTMLInputElement>): void;
  /** Dismiss the qbf result screen and move to the next prompt. */
  onQbfContinue(): void;
  onResetRequest(): void;
  onResetConfirm(): void;
  onResetCancel(): void;
}

const skillById = new Map(skills.map((s) => [s.id, s]));

function groupProgress(state: TutorState): GroupProgressView[] {
  const byGroup = new Map<SkillGroup, { learnt: number; total: number }>();
  for (const s of skills) {
    let entry = byGroup.get(s.group);
    if (entry === undefined) {
      entry = { learnt: 0, total: 0 };
      byGroup.set(s.group, entry);
    }
    entry.total += 1;
    if (isSkillLearnt(state, s.id)) entry.learnt += 1;
  }
  return [...byGroup.entries()].map(([group, { learnt, total }]) => ({ group, learnt, total }));
}

export interface ViewSources {
  readonly tutor: TutorState;
  readonly bestQbf: BestQbf | null;
  readonly lastQbf: QbfResult | null;
  readonly introducingSkillId: string | null;
  readonly confirmingReset: boolean;
  /** How many reveal units of the hinted word are uncovered (store-owned). */
  readonly hintUnitsRevealed: number;
  /** Identity of the current prompt instance (store-owned epoch). */
  readonly promptKey: number;
}

function hintText(src: ViewSources): string | null {
  const p = src.tutor.prompt;
  if (p === null || !p.hintShown || p.isQbf || src.hintUnitsRevealed <= 0) return null;
  const word = hintWordForPrompt(src.tutor);
  if (word === null) return null;
  return word.units.slice(0, src.hintUnitsRevealed).join('');
}

export function buildViewModel(src: ViewSources): AppViewModel {
  const { tutor } = src;
  const p = tutor.prompt;
  const introSkill =
    src.introducingSkillId === null ? undefined : skillById.get(src.introducingSkillId);
  return {
    promptText: p?.text ?? '',
    typed: p?.typed ?? '',
    diverged: p?.diverged ?? false,
    isQbf: p?.isQbf ?? false,
    qbfResult: p !== null && p.isQbf && p.completed ? src.lastQbf : null,
    bestQbf: src.bestQbf,
    qbfMinCells: QBF_MIN_CELLS,
    nextQbfIn: QBF_INTERVAL - (tutor.promptCounter % QBF_INTERVAL),
    hint: hintText(src),
    intro:
      introSkill === undefined
        ? null
        : {
            id: introSkill.id,
            print: introSkill.print,
            unicode: introSkill.unicode,
            group: introSkill.group,
          },
    activeSkills: activeSkills(tutor).map((s) => {
      const score = scoreFor(tutor, s.id);
      return {
        id: s.id,
        print: s.print,
        unicode: s.unicode,
        score,
        progress: Math.min(1, score / LEARNT_THRESHOLD),
      };
    }),
    learntCount: learntSkills(tutor).length,
    totalSkills: skills.length,
    promptsCompleted: tutor.promptCounter,
    groups: groupProgress(tutor),
    confirmingReset: src.confirmingReset,
    promptKey: src.promptKey,
  };
}
