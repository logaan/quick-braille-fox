// View models: plain-data snapshots of the store for the UI to render, plus
// the handler interface the UI wires to DOM events. UI components are pure
// render functions of these props; the dependency direction is ui -> state.

import type { ChangeEvent, KeyboardEvent } from 'react';
import type { Cell, FoxResult, TutorState } from '../core';
import {
  LEARNT_THRESHOLD,
  FOX_AWARD,
  FOX_INTERVAL,
  FOX_MIN_CELLS,
  activeSkills,
  divergentCells,
  dotsToUnicode,
  expectedSignAt,
  hintWordForPrompt,
  isSkillLearnt,
  learntSkills,
  scoreFor,
} from '../core';
import type { SkillGroup } from '../data/skills';
import { skills } from '../data/skills';
import type { BestFox } from './persistence';

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

/**
 * Why a fox run ended, in braille. Shown on the failure screen: "I was sure I
 * typed that right" is the usual reaction, and the print prompt alone does not
 * settle it.
 */
export interface FoxFailureView {
  /** Cells the learner owed where the run broke (U+2800). */
  readonly expected: string;
  /** The print those cells stand for: "ow", "The", " " for a space. */
  readonly expectedPrint: string;
  /**
   * Cells the learner actually entered there (U+2800), or null when there is
   * nothing honest to show. VoiceOver braille screen input hands us print, not
   * the cells behind it, so in that mode showing "what you typed" as braille
   * would only be echoing our own translation back as if it were their input.
   */
  readonly typed: string | null;
}

/** Everything the UI needs to render, as plain data. */
export interface AppViewModel {
  readonly promptText: string;
  readonly typed: string;
  readonly diverged: boolean;
  readonly isFox: boolean;
  /** Non-null while the fox result screen should be shown. */
  readonly foxResult: FoxResult | null;
  /** Non-null when that result screen is a failure it can explain. */
  readonly foxFailure: FoxFailureView | null;
  readonly bestFox: BestFox | null;
  readonly foxMinCells: number;
  /** Prompts between fox challenges, for the on-screen rules. */
  readonly foxInterval: number;
  /** Points a skill scores per occurrence typed during a fox run. */
  readonly foxAward: number;
  /** How many completed prompts until the next fox challenge (1 = this one). */
  readonly nextFoxIn: number;
  /**
   * The hint as U+2800 braille: the caret word's cells, limited to the
   * signs uncovered so far (one is uncovered per elapsed countdown, and
   * each sign's countdown only starts once the caret reaches it).
   */
  readonly hint: string | null;
  readonly activeSkills: ReadonlyArray<ActiveSkillView>;
  readonly learntCount: number;
  readonly totalSkills: number;
  readonly promptsCompleted: number;
  readonly groups: ReadonlyArray<GroupProgressView>;
  readonly confirmingReset: boolean;
  /** What the user has typed into the reset confirmation field so far. */
  readonly resetConfirmText: string;
  /** True once resetConfirmText matches RESET_CONFIRM_WORD; gates the erase. */
  readonly canConfirmReset: boolean;
  /** True: input via VoiceOver braille screen input. False: QWERTY chording. */
  readonly voiceOverInput: boolean;
  /**
   * Identity of the current prompt instance. The UI keys the uncontrolled
   * drill input on it, so the field clears (remounts) only at a prompt
   * change — never mid-typing, which would fight VoiceOver.
   */
  readonly promptKey: number;
}

/** Event handlers the store exposes for the UI to attach to DOM events. */
export interface AppHandlers {
  /** Wire to the drill input's change/input event. */
  onInput(event: ChangeEvent<HTMLInputElement>): void;
  /** Wire to the drill input's keydown (chord press / backspace / swallow). */
  onDrillKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
  /** Wire to the drill input's keyup (chord commit). */
  onDrillKeyUp(event: KeyboardEvent<HTMLInputElement>): void;
  /** Toggle between VoiceOver braille screen input and QWERTY chording. */
  onInputModeToggle(): void;
  /** Dismiss the fox result screen and move to the next prompt. */
  onFoxContinue(): void;
  onResetRequest(): void;
  onResetConfirm(): void;
  onResetCancel(): void;
  /** Wire to the reset confirmation field's change event. */
  onResetTextChange(value: string): void;
}

/** Typing this word (case/space insensitive) unlocks the erase button. */
export const RESET_CONFIRM_WORD = 'reset';

/** Does what the user typed unlock the erase button? */
export function matchesResetWord(value: string): boolean {
  return value.trim().toLowerCase() === RESET_CONFIRM_WORD;
}

/**
 * Prompts until the next fox challenge, counting the current one (1 = the
 * prompt on screen *is* the challenge). fox lands whenever the counter is a
 * multiple of FOX_INTERVAL.
 */
function nextFoxIn(promptCounter: number): number {
  const since = promptCounter % FOX_INTERVAL;
  return since === 0 ? 1 : FOX_INTERVAL - since + 1;
}

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
  readonly bestFox: BestFox | null;
  readonly lastFox: FoxResult | null;
  readonly confirmingReset: boolean;
  /** Raw text typed into the reset confirmation field (store-owned). */
  readonly resetConfirmText: string;
  readonly voiceOverInput: boolean;
  /** Identity of the current prompt instance (store-owned epoch). */
  readonly promptKey: number;
  /** Cells committed by chording this prompt (empty in VoiceOver mode). */
  readonly cellBuffer: ReadonlyArray<Cell>;
}

/**
 * The uncovered part of the caret word's hint: its leading run of revealed
 * units. Signs are revealed in order as the learner reaches them, so a
 * leading run is all there ever is — and stopping at the first unrevealed
 * unit keeps a sign hinted by the two-mistake rule from dragging later,
 * still-earnable signs of the word on screen with it.
 */
function hintText(src: ViewSources): string | null {
  const p = src.tutor.prompt;
  if (p === null || p.isFox) return null;
  const word = hintWordForPrompt(src.tutor);
  if (word === null) return null;
  let text = '';
  for (const unit of word.units) {
    if (!p.hintedUnits.has(unit.index)) break;
    text += unit.unicode;
  }
  return text === '' ? null : text;
}

/**
 * The braille behind a failed run, or null when there is none to give: any
 * prompt but a fox one, a run still in progress, or a "failure" recorded for
 * an impossible cell count rather than a mistake (nothing diverged, so there
 * is no sign to point at).
 */
function foxFailureView(src: ViewSources): FoxFailureView | null {
  const p = src.tutor.prompt;
  if (p === null || !p.isFox || !p.completed || !p.failed) return null;
  const expected = expectedSignAt(p.text, p.typed);
  if (expected === null) return null;
  const typed = src.voiceOverInput
    ? ''
    : dotsToUnicode(divergentCells(src.cellBuffer, p.text));
  return {
    expected: expected.unicode,
    expectedPrint: expected.print,
    typed: typed === '' ? null : typed,
  };
}

export function buildViewModel(src: ViewSources): AppViewModel {
  const { tutor } = src;
  const p = tutor.prompt;
  return {
    promptText: p?.text ?? '',
    typed: p?.typed ?? '',
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
    resetConfirmText: src.resetConfirmText,
    canConfirmReset: matchesResetWord(src.resetConfirmText),
    voiceOverInput: src.voiceOverInput,
    promptKey: src.promptKey,
  };
}
