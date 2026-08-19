import type { Map as ScoreMap } from 'immutable';
import { Set as ImmutableSet } from 'immutable';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { Cell, FoxResult, RowModel, SkillPolicy, TutorState } from '../core';
import {
  LEARNT_THRESHOLD,
  FOX_AWARD,
  FOX_INTERVAL,
  FOX_MIN_CELLS,
  activeSkills,
  buildRowModel,
  commonPrefixLength,
  derivedScores,
  divergedTail,
  divergentCells,
  dotsToUnicode,
  expectedSignAt,
  hintWordForPrompt,
  isLearntIn,
  judgedPrintCaret,
  learntSkillsIn,
  policyFor,
} from '../core';
import type { Skill, SkillGroup, SkillKind } from '../data/skills';
import { skills } from '../data/skills';
import type { InputMode } from './modes';
import type { BestFox } from './persistence';

export interface ActiveSkillView {
  readonly id: string;
  readonly print: string;
  readonly unicode: string;
  readonly score: number;
  readonly progress: number;
}

export interface GroupProgressView {
  readonly group: SkillGroup;
  readonly learnt: number;
  readonly total: number;
}

export type AppPage = 'drill' | 'curriculum';

export interface CurriculumSkillView {
  readonly id: string;
  readonly kind: SkillKind;
  readonly group: SkillGroup;
  readonly order: number;
  readonly print: string;
  readonly unicode: string;
  readonly dots: string;
  readonly score: number;
  readonly progress: number;
  readonly learnt: boolean;
  readonly active: boolean;
  readonly policy: SkillPolicy;
}

export interface CurriculumGroupView {
  readonly group: SkillGroup;
  readonly learnt: number;
  readonly total: number;
  readonly policy: SkillPolicy | null;
  readonly counts: PolicyCounts;
  readonly skills: readonly CurriculumSkillView[];
}

export type PolicyCounts = Readonly<Record<SkillPolicy, number>>;

export interface CurriculumView {
  readonly groups: readonly CurriculumGroupView[];
  readonly policy: SkillPolicy | null;
  readonly counts: PolicyCounts;
  readonly activeCount: number;
}

export interface FoxFailureView {
  readonly expected: string;
  readonly expectedPrint: string;
  readonly typed: string | null;
}

export interface AppViewModel {
  readonly promptText: string;
  readonly typed: string;
  readonly matchedPrint: number;
  readonly divergedText: string;
  readonly diverged: boolean;
  readonly isFox: boolean;
  readonly foxResult: FoxResult | null;
  readonly foxFailure: FoxFailureView | null;
  readonly bestFox: BestFox | null;
  readonly foxMinCells: number;
  readonly foxInterval: number;
  readonly foxAward: number;
  readonly nextFoxIn: number;
  readonly hint: string | null;
  readonly rows: RowModel;
  readonly activeSkills: readonly ActiveSkillView[];
  readonly learntCount: number;
  readonly totalSkills: number;
  readonly promptsCompleted: number;
  readonly groups: readonly GroupProgressView[];
  readonly confirmingReset: boolean;
  readonly resetConfirmText: string;
  readonly canConfirmReset: boolean;
  readonly inputMode: InputMode;
  readonly promptKey: number;
  readonly page: AppPage;
  readonly curriculum: CurriculumView | null;
}

export interface AppHandlers {
  readonly onInput: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onDrillKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onDrillKeyUp: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onInputModeSelect: (mode: InputMode) => void;
  readonly onFoxContinue: () => void;
  readonly onResetRequest: () => void;
  readonly onResetConfirm: () => void;
  readonly onResetCancel: () => void;
  readonly onResetTextChange: (value: string) => void;
  readonly onNavigate: (page: AppPage) => void;
  readonly onSkillPolicyChange: (skillId: string, policy: SkillPolicy) => void;
  readonly onGroupPolicyChange: (group: SkillGroup, policy: SkillPolicy) => void;
  readonly onAllPolicyChange: (policy: SkillPolicy) => void;
}

export const RESET_CONFIRM_WORD = 'reset';

export function matchesResetWord(value: string): boolean {
  return value.trim().toLowerCase() === RESET_CONFIRM_WORD;
}

function nextFoxIn(promptCounter: number): number {
  const since = promptCounter % FOX_INTERVAL;
  return since === 0 ? 1 : FOX_INTERVAL - since + 1;
}

function groupProgress(scores: ScoreMap<string, number>): GroupProgressView[] {
  const byGroup = new Map<SkillGroup, { learnt: number; total: number }>();
  for (const s of skills) {
    let entry = byGroup.get(s.group);
    if (entry === undefined) {
      entry = { learnt: 0, total: 0 };
      byGroup.set(s.group, entry);
    }
    entry.total += 1;
    if (isLearntIn(scores, s.id)) entry.learnt += 1;
  }
  return [...byGroup.entries()].map(([group, { learnt, total }]) => ({ group, learnt, total }));
}

export interface ViewSources {
  readonly tutor: TutorState;
  readonly bestFox: BestFox | null;
  readonly lastFox: FoxResult | null;
  readonly confirmingReset: boolean;
  readonly resetConfirmText: string;
  readonly inputMode: InputMode;
  readonly promptKey: number;
  readonly cellBuffer: readonly Cell[];
  readonly page: AppPage;
}

function hintText(src: ViewSources): string | null {
  const p = src.tutor.prompt;
  if (p === null || p.isFox) return null;
  const word = hintWordForPrompt(src.tutor);
  if (word === null) return null;
  const caret = judgedPrintCaret(p);
  let text = '';
  let anyRevealed = false;
  for (const unit of word.units) {
    const revealed = p.hintedUnits.has(unit.index);
    if (!revealed && unit.end > caret) break;
    if (revealed) anyRevealed = true;
    text += unit.unicode;
  }
  return anyRevealed ? text : null;
}

function foxFailureView(src: ViewSources): FoxFailureView | null {
  const p = src.tutor.prompt;
  if (p === null || !p.isFox || !p.completed || !p.failed) return null;
  const expected = expectedSignAt(p.text, p.typed);
  if (expected === null) return null;
  const typed =
    src.inputMode === 'voiceover' ? '' : dotsToUnicode(divergentCells(src.cellBuffer, p.text));
  return {
    expected: expected.unicode,
    expectedPrint: expected.print,
    typed: typed === '' ? null : typed,
  };
}

function emptyCounts(): Record<SkillPolicy, number> {
  return { force: 0, allow: 0, block: 0 };
}

function uniformPolicy(counts: PolicyCounts, total: number): SkillPolicy | null {
  if (counts.force === total) return 'force';
  if (counts.allow === total) return 'allow';
  if (counts.block === total) return 'block';
  return null;
}

function dotsLabel(skill: Skill): string {
  return skill.dots.map((cell) => cell.join('')).join('-');
}

function curriculumView(
  tutor: TutorState,
  scores: ScoreMap<string, number>,
): CurriculumView {
  const active = new Set(activeSkills(tutor).map((s) => s.id));
  const totals = emptyCounts();
  const order: SkillGroup[] = [];
  const byGroup = new Map<
    SkillGroup,
    { learnt: number; counts: Record<SkillPolicy, number>; skills: CurriculumSkillView[] }
  >();
  for (const s of skills) {
    let entry = byGroup.get(s.group);
    if (entry === undefined) {
      entry = { learnt: 0, counts: emptyCounts(), skills: [] };
      byGroup.set(s.group, entry);
      order.push(s.group);
    }
    const score = scores.get(s.id, 0);
    const learnt = isLearntIn(scores, s.id);
    const policy = policyFor(tutor, s.id);
    if (learnt) entry.learnt += 1;
    entry.counts[policy] += 1;
    totals[policy] += 1;
    entry.skills.push({
      id: s.id,
      kind: s.kind,
      group: s.group,
      order: s.order,
      print: s.print,
      unicode: s.unicode,
      dots: dotsLabel(s),
      score,
      progress: Math.min(1, score / LEARNT_THRESHOLD),
      learnt,
      active: active.has(s.id),
      policy,
    });
  }
  const groups = order.map((group) => {
    const entry = byGroup.get(group)!;
    return {
      group,
      learnt: entry.learnt,
      total: entry.skills.length,
      policy: uniformPolicy(entry.counts, entry.skills.length),
      counts: entry.counts,
      skills: entry.skills,
    };
  });
  return {
    groups,
    policy: uniformPolicy(totals, skills.length),
    counts: totals,
    activeCount: active.size,
  };
}

export function buildViewModel(src: ViewSources): AppViewModel {
  const { tutor } = src;
  const p = tutor.prompt;
  const shown = derivedScores(tutor);
  return {
    promptText: p?.text ?? '',
    typed: p?.typed ?? '',
    matchedPrint:
      p === null ? 0 : p.diverged ? judgedPrintCaret(p) : commonPrefixLength(p.text, p.typed),
    divergedText: p === null ? '' : divergedTail(p),
    diverged: p?.diverged ?? false,
    isFox: p?.isFox ?? false,
    foxResult: p !== null && p.isFox && p.completed ? src.lastFox : null,
    foxFailure: foxFailureView(src),
    bestFox: src.bestFox,
    foxMinCells: FOX_MIN_CELLS,
    foxInterval: FOX_INTERVAL,
    foxAward: FOX_AWARD,
    nextFoxIn: nextFoxIn(tutor.promptCounter),
    hint: hintText(src),
    rows: buildRowModel({
      text: p?.text ?? '',
      typed: p?.typed ?? '',
      cells: src.inputMode === 'emulated' ? src.cellBuffer : [],
      hintedUnits: p?.hintedUnits ?? ImmutableSet<number>(),
    }),
    activeSkills: activeSkills(tutor).map((s) => {
      const score = shown.get(s.id, 0);
      return {
        id: s.id,
        print: s.print,
        unicode: s.unicode,
        score,
        progress: Math.min(1, score / LEARNT_THRESHOLD),
      };
    }),
    learntCount: learntSkillsIn(shown).length,
    totalSkills: skills.length,
    promptsCompleted: tutor.promptCounter,
    groups: groupProgress(shown),
    confirmingReset: src.confirmingReset,
    resetConfirmText: src.resetConfirmText,
    canConfirmReset: matchesResetWord(src.resetConfirmText),
    inputMode: src.inputMode,
    promptKey: src.promptKey,
    page: src.page,
    curriculum: src.page === 'curriculum' ? curriculumView(tutor, shown) : null,
  };
}
