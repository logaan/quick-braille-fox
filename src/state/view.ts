// View models: plain-data snapshots of the store for the UI to render, plus
// the handler interface the UI wires to DOM events. UI components are pure
// render functions of these props; the dependency direction is ui -> state.

// Immutable's Map, aliased so the native Map stays available below.
import type { Map as ScoreMap } from 'immutable';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { Cell, FoxResult, TutorState } from '../core';
import {
  LEARNT_THRESHOLD,
  FOX_AWARD,
  FOX_INTERVAL,
  FOX_MIN_CELLS,
  activeSkills,
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
} from '../core';
import type { SkillGroup } from '../data/skills';
import { skills } from '../data/skills';
import type { InputMode, Verbosity } from './modes';
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
  /**
   * How many leading characters of the *prompt text* count as accepted
   * progress; the UI paints them correct and renders `divergedText` red
   * after them. On a print-judged round this is the common prefix of prompt
   * and typed. On a cell-judged (emulated, non-fox) round it stops at the
   * last unit whose *cells* were chorded: derived print past that (a valid
   * alternate spelling of the sign being drilled) must read as wrong, not
   * as progress, or the prompt would show all-correct text while the round
   * is diverged.
   */
  readonly matchedPrint: number;
  /**
   * What the learner has produced beyond the accepted prefix, rendered red
   * at the caret while diverged: the diverged typed print on a print-judged
   * round, the unaccepted chorded cells (U+2800 glyphs) on a cell-judged
   * one. '' while typing is in step.
   */
  readonly divergedText: string;
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
  readonly activeSkills: readonly ActiveSkillView[];
  readonly learntCount: number;
  readonly totalSkills: number;
  readonly promptsCompleted: number;
  readonly groups: readonly GroupProgressView[];
  readonly confirmingReset: boolean;
  /** What the user has typed into the reset confirmation field so far. */
  readonly resetConfirmText: string;
  /** True once resetConfirmText matches RESET_CONFIRM_WORD; gates the erase. */
  readonly canConfirmReset: boolean;
  /** Which input mode the drill is in; see InputMode. */
  readonly inputMode: InputMode;
  /** True when announcements are in terse mode; see Verbosity. */
  readonly terse: boolean;
  /**
   * Identity of the current prompt instance. The UI keys the uncontrolled
   * drill input on it, so the field clears (remounts) only at a prompt
   * change — never mid-typing, which would fight VoiceOver.
   */
  readonly promptKey: number;
}

/**
 * Event handlers the store exposes for the UI to attach to DOM events.
 * Function properties, not methods: the store implements them as arrows,
 * and the UI passes them around detached (`this` never matters).
 */
export interface AppHandlers {
  /** Wire to the drill input's change/input event. */
  readonly onInput: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Wire to the drill input's keydown (chord press / backspace / swallow). */
  readonly onDrillKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** Wire to the drill input's keyup (chord commit). */
  readonly onDrillKeyUp: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** Choose the input mode: emulated (QWERTY chording) or VoiceOver. */
  readonly onInputModeSelect: (mode: InputMode) => void;
  /** Switch terse announcements on or off (see Verbosity). */
  readonly onTerseToggle: (terse: boolean) => void;
  /** Dismiss the fox result screen and move to the next prompt. */
  readonly onFoxContinue: () => void;
  readonly onResetRequest: () => void;
  readonly onResetConfirm: () => void;
  readonly onResetCancel: () => void;
  /** Wire to the reset confirmation field's change event. */
  readonly onResetTextChange: (value: string) => void;
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
  /** Raw text typed into the reset confirmation field (store-owned). */
  readonly resetConfirmText: string;
  readonly inputMode: InputMode;
  /** How much the announcements say; see Verbosity. */
  readonly verbosity: Verbosity;
  /** Identity of the current prompt instance (store-owned epoch). */
  readonly promptKey: number;
  /** Cells committed by chording this prompt (empty in VoiceOver mode). */
  readonly cellBuffer: readonly Cell[];
}

/**
 * The uncovered part of the caret word's hint: its leading run of units that
 * are revealed or already typed. Units the learner typed cleanly count as
 * uncovered for display (they are never *revealed* — that would cost their
 * clean award — but hiding a revealed sign behind them left a stuck learner
 * with a hint the system had charged for and never showed). Stopping at the
 * first still-covered unit keeps a sign hinted by the two-mistake rule from
 * dragging later, still-earnable signs of the word on screen with it, and
 * nothing shows until at least one sign has actually been revealed.
 */
function hintText(src: ViewSources): string | null {
  const p = src.tutor.prompt;
  if (p === null || p.isFox) return null;
  const word = hintWordForPrompt(src.tutor);
  if (word === null) return null;
  // The judged caret in print, so a cell-judged round counts a unit as
  // "typed" only once its cells are chorded — derived print is not enough.
  const caret = judgedPrintCaret(p);
  let text = '';
  let anyRevealed = false;
  for (const unit of word.units) {
    const revealed = p.hintedUnits.has(unit.index);
    if (!revealed && unit.end > caret) break; // neither revealed nor typed
    if (revealed) anyRevealed = true;
    text += unit.unicode;
  }
  return anyRevealed ? text : null;
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
  const typed =
    src.inputMode === 'voiceover' ? '' : dotsToUnicode(divergentCells(src.cellBuffer, p.text));
  return {
    expected: expected.unicode,
    expectedPrint: expected.print,
    typed: typed === '' ? null : typed,
  };
}

export function buildViewModel(src: ViewSources): AppViewModel {
  const { tutor } = src;
  const p = tutor.prompt;
  // Everything the learner sees moves with the round in flight; which
  // skills are *shown* as active still comes from the committed scores, so
  // the window does not churn mid-prompt.
  const shown = derivedScores(tutor);
  return {
    promptText: p?.text ?? '',
    typed: p?.typed ?? '',
    // While in step, everything typed is accepted (on a cell-judged round a
    // half-chorded multi-cell sign may already derive print — still correct,
    // just unfinished). Once diverged, acceptance stops at the judged caret.
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
    terse: src.verbosity === 'terse',
    promptKey: src.promptKey,
  };
}
