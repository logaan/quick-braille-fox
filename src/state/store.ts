// The interaction store: wraps the core's pure TutorState with event
// handling, the hint timer, qbf cell counting, and localStorage persistence.
// The UI renders viewModel() snapshots and wires `handlers` to DOM events;
// it never calls core transitions itself.

import type { ChangeEvent, KeyboardEvent } from 'react';
import type { Cell, QbfResult, TutorState } from '../core';
import {
  backTranslateBuffer,
  keystroke,
  nextHintFor,
  nextPrompt,
  qbfResult,
  revealHint,
  startSession,
  textToCells,
} from '../core';
import type { ChordState } from './chords';
import { EMPTY_CHORD_STATE, chordKeyDown, chordKeyUp, isChordCode } from './chords';
import type { BestQbf, StorageLike } from './persistence';
import { clearProgress, loadProgress, saveProgress } from './persistence';
import type { AppHandlers, AppViewModel } from './view';
import { buildViewModel, matchesResetWord } from './view';

export interface TutorStoreOptions {
  /** Where to persist progress; omit/null to disable persistence. */
  storage?: StorageLike | null;
  /** Seed for fresh sessions (defaults to Date.now() at session start). */
  seed?: number;
  /** Debounce for persistence writes, in ms. */
  saveDebounceMs?: number;
}

export class TutorStore {
  private tutor: TutorState;
  private bestQbf: BestQbf | null = null;
  /** Result of the most recently completed qbf run (shown until Continue). */
  private lastQbf: QbfResult | null = null;
  /** Insertion events during the current qbf prompt (1 event = 1 cell). */
  private qbfCellsTyped = 0;
  /**
   * Bumped every time a new prompt is shown (advance/reset). The UI keys the
   * uncontrolled drill input on it so the field clears (remounts) exactly at
   * a prompt change and never mid-typing — see handleInput.
   */
  private promptEpoch = 0;
  private confirmingReset = false;
  /** What the user has typed into the reset confirmation field. */
  private resetConfirmText = '';

  /** True: input via VoiceOver braille screen input. False: QWERTY chording. */
  private voiceOverInput = true;
  /** Chord key state (chord mode only); not persisted. */
  private chordState: ChordState = EMPTY_CHORD_STATE;
  /** Committed braille cells for the current prompt (chord mode; blank = space). */
  private cellBuffer: Cell[] = [];

  private readonly storage: StorageLike | null;
  private readonly saveDebounceMs: number;
  private readonly seedOption: number | undefined;

  private readonly listeners = new Set<() => void>();
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Which sign the running hint timer is counting down for, as
   * `promptEpoch|unitIndex` — the epoch included so a new prompt never
   * inherits the previous one's running clock for the same unit index.
   */
  private hintTimerKey: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Stable event-handler object for the UI to attach to DOM events. */
  readonly handlers: AppHandlers;

  constructor(options: TutorStoreOptions = {}) {
    this.storage = options.storage ?? null;
    this.saveDebounceMs = options.saveDebounceMs ?? 250;
    this.seedOption = options.seed;

    const persisted = this.storage === null ? null : loadProgress(this.storage);
    if (persisted === null) {
      this.tutor = startSession(this.freshSeed());
    } else {
      this.bestQbf = persisted.bestQbf;
      this.voiceOverInput = persisted.voiceOverInput;
      const p = persisted.tutor.prompt;
      // Resume an in-flight prompt as-is. Move on from a prompt saved after
      // completion (e.g. mid result screen). A half-typed qbf restarts
      // cleanly (its cell count was not persisted), which nextPrompt does
      // automatically because promptCounter still selects the qbf slot.
      this.tutor =
        p === null || p.completed || (p.isQbf && p.typed !== '')
          ? nextPrompt(persisted.tutor)
          : persisted.tutor;
    }
    if (!this.voiceOverInput) this.reconstructBuffer();

    this.handlers = {
      onInput: (event) => this.handleInput(event),
      onDrillKeyDown: (event) => this.handleKeyDown(event),
      onDrillKeyUp: (event) => this.handleKeyUp(event),
      onInputModeToggle: () => this.toggleInputMode(),
      onQbfContinue: () => this.continueAfterQbf(),
      onResetRequest: () => {
        this.confirmingReset = true;
        this.resetConfirmText = '';
        this.notify();
      },
      onResetCancel: () => {
        this.confirmingReset = false;
        this.resetConfirmText = '';
        this.notify();
      },
      onResetTextChange: (value) => {
        this.resetConfirmText = value;
        this.notify();
      },
      // Erasing everything is unrecoverable, so it needs the word typed out —
      // the UI disables the button too, but the guard lives here as well so
      // the rule holds however the handler is reached.
      onResetConfirm: () => {
        if (!matchesResetWord(this.resetConfirmText)) return;
        this.resetProgress();
      },
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushSave());
      // Losing focus can strand a held chord key (its keyup never arrives);
      // clear the chord accumulator so the next chord starts clean.
      window.addEventListener('blur', () => {
        this.chordState = EMPTY_CHORD_STATE;
      });
    }
    this.syncHintTimer();
  }

  /** Subscribe to store changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A plain-data snapshot of everything the UI renders. */
  viewModel(): AppViewModel {
    return buildViewModel({
      tutor: this.tutor,
      bestQbf: this.bestQbf,
      lastQbf: this.lastQbf,
      confirmingReset: this.confirmingReset,
      resetConfirmText: this.resetConfirmText,
      voiceOverInput: this.voiceOverInput,
      promptKey: this.promptEpoch,
      cellBuffer: this.cellBuffer,
    });
  }

  /** Write state to storage immediately (e.g. on pagehide). */
  flushSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
  }

  // --- internals -------------------------------------------------------

  private freshSeed(): number {
    return this.seedOption ?? Date.now();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** After every tutor-state transition: re-arm timers, persist, re-render. */
  private changed(): void {
    this.syncHintTimer();
    this.scheduleSave();
    this.notify();
  }

  private handleInput(event: ChangeEvent<HTMLInputElement>): void {
    if (!this.voiceOverInput) return; // chord mode drives typing via key events
    const prompt = this.tutor.prompt;
    if (prompt === null || prompt.completed) return;
    const value = normalizeTypedValue(event.currentTarget.value, prompt.text);
    const native = event.nativeEvent as Partial<InputEvent>;
    const inserted =
      typeof native.inputType === 'string'
        ? native.inputType.startsWith('insert')
        : value.length > prompt.typed.length;

    // qbf cell counting: one cell per insertion event — VoiceOver braille
    // screen input commits a whole contraction as a single insertion, a
    // regular keypress inserts one char. Deletions never decrement. An
    // event whose value was normalised back to what was already typed (a
    // stripped VoiceOver space) is not a cell.
    if (prompt.isQbf && inserted && value !== prompt.typed) this.qbfCellsTyped += 1;

    this.tutor = keystroke(this.tutor, value);
    this.afterKeystroke();
    this.changed();
  }

  // --- chord input (VoiceOver mode off) --------------------------------

  private handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (this.voiceOverInput) return;
    // Let editing/navigation shortcuts (⌘, Ctrl, Alt combos) through.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const code = event.code;
    if (code === 'Backspace') {
      event.preventDefault();
      if (this.chordState.held.size > 0 || this.cellBuffer.length === 0) return;
      this.cellBuffer = this.cellBuffer.slice(0, -1);
      this.commitBuffer();
      return;
    }
    if (code === 'Enter') {
      event.preventDefault();
      return;
    }
    if (isChordCode(code)) {
      event.preventDefault();
      if (event.repeat) return; // auto-repeat is not a new key press
      this.chordState = chordKeyDown(this.chordState, code);
      return;
    }
    // Swallow stray printable keys so they never reach the text field.
    if (event.key.length === 1) event.preventDefault();
  }

  private handleKeyUp(event: KeyboardEvent<HTMLInputElement>): void {
    if (this.voiceOverInput) return;
    const code = event.code;
    if (!isChordCode(code)) return;
    const { state, action } = chordKeyUp(this.chordState, code);
    this.chordState = state;
    if (action.kind === 'none') return;
    const prompt = this.tutor.prompt;
    if (prompt === null || prompt.completed) return;

    if (action.kind === 'cell') {
      this.cellBuffer = [...this.cellBuffer, action.cell];
      if (prompt.isQbf) this.qbfCellsTyped += 1;
      this.commitBuffer();
      return;
    }
    // Space: a blank cell, unless it is a leading or artifact trailing space.
    if (this.cellBuffer.length === 0) return; // ignore a leading space
    const candidate: Cell[] = [...this.cellBuffer, []];
    const derived = backTranslateBuffer(candidate, prompt.text);
    if (stripUnexpectedTrailingSpaces(derived, prompt.text) !== derived) return; // artifact
    this.cellBuffer = candidate;
    if (prompt.isQbf) this.qbfCellsTyped += 1;
    this.commitBuffer();
  }

  /** Re-derive typed text from the cell buffer and feed it to the core. */
  private commitBuffer(): void {
    const prompt = this.tutor.prompt;
    if (prompt === null || prompt.completed) return;
    this.tutor = keystroke(this.tutor, backTranslateBuffer(this.cellBuffer, prompt.text));
    this.afterKeystroke();
    this.changed();
  }

  /**
   * Rebuild the cell buffer from the current prompt's typed text (on entering
   * chord mode or resuming a persisted chord-mode session). A clean, still-
   * translatable prefix is reconstructed so chording continues seamlessly;
   * otherwise the in-progress typing is cleared and the prompt starts over.
   */
  private reconstructBuffer(): void {
    const prompt = this.tutor.prompt;
    if (prompt === null || prompt.completed || prompt.typed === '') {
      this.cellBuffer = [];
      return;
    }
    if (prompt.text.startsWith(prompt.typed)) {
      try {
        this.cellBuffer = textToCells(prompt.typed).map((c) => [...c]);
        return;
      } catch {
        // fall through to a clean restart
      }
    }
    this.tutor = keystroke(this.tutor, '');
    this.cellBuffer = [];
  }

  private toggleInputMode(): void {
    this.voiceOverInput = !this.voiceOverInput;
    this.chordState = EMPTY_CHORD_STATE;
    if (this.voiceOverInput) {
      this.cellBuffer = [];
    } else {
      this.reconstructBuffer();
    }
    this.changed();
  }

  /** Shared post-keystroke handling: qbf scoring/result, or advance. */
  private afterKeystroke(): void {
    const after = this.tutor.prompt;
    if (after === null || !after.completed) return;
    if (after.isQbf) {
      const result: QbfResult = after.failed ? { kind: 'failed' } : qbfResult(this.qbfCellsTyped);
      this.lastQbf = result;
      if (result.kind !== 'failed' && this.isNewBest(result)) this.bestQbf = result;
      // Stay on the result screen until onQbfContinue().
    } else {
      this.advance();
    }
  }

  private continueAfterQbf(): void {
    if (this.lastQbf === null) return;
    this.advance();
    this.changed();
  }

  /** Move to the next prompt and reset per-prompt bookkeeping. */
  private advance(): void {
    this.tutor = nextPrompt(this.tutor);
    this.qbfCellsTyped = 0;
    this.lastQbf = null;
    this.cellBuffer = [];
    this.chordState = EMPTY_CHORD_STATE;
    this.promptEpoch += 1;
  }

  private isNewBest(result: BestQbf): boolean {
    const best = this.bestQbf;
    if (best === null) return true;
    if (best.kind === 'crown') return false;
    if (result.kind === 'crown') return true;
    return result.percentAbove < best.percentAbove;
  }

  private resetProgress(): void {
    if (this.storage !== null) clearProgress(this.storage);
    this.tutor = startSession(this.freshSeed());
    this.bestQbf = null;
    this.lastQbf = null;
    this.qbfCellsTyped = 0;
    this.confirmingReset = false;
    this.resetConfirmText = '';
    this.cellBuffer = [];
    this.chordState = EMPTY_CHORD_STATE;
    this.promptEpoch += 1;
    this.changed();
  }

  /**
   * Keep the hint countdown in sync with the tutor state. Core
   * nextHintFor() names the sign whose hint is due next — always the one at
   * the caret — and how long it waits.
   *
   * The timer is (re)started only when that sign *changes*, i.e. when the
   * caret moves to a new sign. That is the whole point: the countdown for a
   * sign begins when the learner arrives at it, so a long pause on one sign
   * costs the next one nothing, and revealing one sign's hint does not
   * start the clock on the sign after it — typing does. Once the caret's
   * sign has been revealed, nextHintFor() returns null and no timer runs
   * until the caret moves on.
   */
  private syncHintTimer(): void {
    const pending = nextHintFor(this.tutor);
    const key = pending === null ? null : `${this.promptEpoch}|${pending.unitIndex}`;
    if (key === this.hintTimerKey) return; // same sign: leave its clock alone
    this.clearHintTimer();
    this.hintTimerKey = key;
    if (pending === null) return;
    const unitIndex = pending.unitIndex;
    this.hintTimer = setTimeout(() => {
      this.hintTimer = null;
      this.tutor = revealHint(this.tutor, unitIndex);
      this.changed();
    }, pending.delayMs);
  }

  private clearHintTimer(): void {
    if (this.hintTimer !== null) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
  }

  private scheduleSave(): void {
    if (this.storage === null) return;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, this.saveDebounceMs);
  }

  private saveNow(): void {
    if (this.storage === null) return;
    saveProgress(this.storage, {
      tutor: this.tutor,
      bestQbf: this.bestQbf,
      voiceOverInput: this.voiceOverInput,
    });
  }
}

/**
 * Absorb VoiceOver braille-screen-input's spacing artifacts in the value we
 * compare against the expected text. The drill input is uncontrolled —
 * VoiceOver owns the field and we never write back to it — so this only
 * shapes what we match/score, never what VoiceOver sees (rewriting the field
 * mid-word is exactly what desyncs its word buffer and makes a mistake
 * unrecoverable).
 *
 * VoiceOver commits a trailing space after every word (including the last of
 * a prompt), occasionally lands a stray leading space on a fresh prompt, and
 * now and then doubles a space. None of those are mistakes. So: drop leading
 * spaces, collapse internal runs to one, and keep a trailing space only while
 * it leaves the value a prefix of the expected text — dropping it when that
 * makes the value match (so the final word's commit completes the prompt).
 * Expected mid-prompt spaces and genuine mistakes pass through untouched.
 */
function normalizeTypedValue(value: string, text: string): string {
  const collapsed = value.replace(/^ +/u, '').replace(/ {2,}/gu, ' ');
  if (text.startsWith(collapsed)) return collapsed;
  const trimmed = collapsed.replace(/ +$/u, '');
  return trimmed !== collapsed && text.startsWith(trimmed) ? trimmed : collapsed;
}

/**
 * Drop a trailing space only when it makes `value` stop being a prefix of the
 * expected text — used by chord mode to reject an artifact space cell while
 * leaving genuine mid-prompt spaces (and real mistakes) untouched.
 */
function stripUnexpectedTrailingSpaces(value: string, text: string): string {
  if (text.startsWith(value)) return value;
  const trimmed = value.replace(/ +$/u, '');
  return trimmed !== value && text.startsWith(trimmed) ? trimmed : value;
}

export function createTutorStore(options: TutorStoreOptions = {}): TutorStore {
  return new TutorStore(options);
}
