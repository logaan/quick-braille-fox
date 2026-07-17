// The interaction store: wraps the core's pure TutorState with event
// handling, the hint timer, qbf cell counting, and localStorage persistence.
// The UI renders viewModel() snapshots and wires `handlers` to DOM events;
// it never calls core transitions itself.

import type { ChangeEvent, KeyboardEvent } from 'react';
import type { Cell, QbfResult, TutorState } from '../core';
import {
  HINT_REVEAL_COOLDOWN_MS,
  backTranslateBuffer,
  hintDelayFor,
  hintWordForPrompt,
  keystroke,
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
import { buildViewModel } from './view';

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
  private introduced = new Set<string>();
  private introducingSkillId: string | null = null;
  private confirmingReset = false;
  /** Reveal units of the hinted word currently uncovered (not persisted). */
  private hintUnitsRevealed = 0;
  /** Identifies the prompt+word the reveal progress belongs to. */
  private hintRevealKey: string | null = null;

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
  private hintRevealTimer: ReturnType<typeof setTimeout> | null = null;
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
      this.introduced = new Set(persisted.introducedSkillIds);
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
    this.markIntroduction();
    if (!this.voiceOverInput) this.reconstructBuffer();

    this.handlers = {
      onInput: (event) => this.handleInput(event),
      onDrillKeyDown: (event) => this.handleKeyDown(event),
      onDrillKeyUp: (event) => this.handleKeyUp(event),
      onInputModeToggle: () => this.toggleInputMode(),
      onQbfContinue: () => this.continueAfterQbf(),
      onResetRequest: () => {
        this.confirmingReset = true;
        this.notify();
      },
      onResetCancel: () => {
        this.confirmingReset = false;
        this.notify();
      },
      onResetConfirm: () => this.resetProgress(),
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
    this.syncHintReveal();
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
      introducingSkillId: this.introducingSkillId,
      confirmingReset: this.confirmingReset,
      hintUnitsRevealed: this.hintUnitsRevealed,
      voiceOverInput: this.voiceOverInput,
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
    this.syncHintReveal();
    this.scheduleSave();
    this.notify();
  }

  private handleInput(event: ChangeEvent<HTMLInputElement>): void {
    if (!this.voiceOverInput) return; // chord mode drives typing via key events
    const prompt = this.tutor.prompt;
    if (prompt === null || prompt.completed) return;
    const value = stripUnexpectedTrailingSpaces(event.currentTarget.value, prompt.text);
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
    this.markIntroduction();
  }

  /**
   * If the new prompt's target skill has never been prompted before, mark
   * it as being introduced (the UI shows its braille cells + print + group
   * prominently alongside this first prompt).
   */
  private markIntroduction(): void {
    const id = this.tutor.prompt?.targetSkillId ?? null;
    if (id !== null && !this.introduced.has(id)) {
      this.introduced.add(id);
      this.introducingSkillId = id;
    } else {
      this.introducingSkillId = null;
    }
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
    this.introduced = new Set();
    this.confirmingReset = false;
    this.cellBuffer = [];
    this.chordState = EMPTY_CHORD_STATE;
    this.markIntroduction();
    this.changed();
  }

  /**
   * Cancel and re-arm the auto-hint timer from the core's hintDelayFor():
   * called after every state change, so a new prompt, a keystroke, or a
   * mistake all restart the countdown; qbf prompts, learnt-skill revision,
   * and already-shown hints yield null (no timer).
   */
  private syncHintTimer(): void {
    if (this.hintTimer !== null) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    const delay = hintDelayFor(this.tutor);
    if (delay === null) return;
    this.hintTimer = setTimeout(() => {
      this.hintTimer = null;
      this.tutor = revealHint(this.tutor);
      this.changed();
    }, delay);
  }

  /**
   * Keep the hint's progressive reveal in sync with the tutor state: once
   * the hint is showing, one reveal unit of the caret word is uncovered
   * immediately and one more every HINT_REVEAL_COOLDOWN_MS until the word
   * is fully uncovered. A new prompt or the caret moving to another word
   * restarts the reveal at one unit; keystrokes within the word leave the
   * running cooldown alone.
   */
  private syncHintReveal(): void {
    const p = this.tutor.prompt;
    const word =
      p !== null && p.hintShown && !p.completed ? hintWordForPrompt(this.tutor) : null;
    if (word === null) {
      this.hintRevealKey = null;
      this.hintUnitsRevealed = 0;
      this.clearHintRevealTimer();
      return;
    }
    const key = `${this.tutor.promptCounter}|${word.wordStart}`;
    if (key !== this.hintRevealKey) {
      this.hintRevealKey = key;
      this.hintUnitsRevealed = 1;
      this.clearHintRevealTimer();
    }
    if (this.hintUnitsRevealed >= word.units.length) {
      this.hintUnitsRevealed = word.units.length;
      this.clearHintRevealTimer();
      return;
    }
    if (this.hintRevealTimer === null) {
      this.hintRevealTimer = setTimeout(() => {
        this.hintRevealTimer = null;
        this.hintUnitsRevealed += 1;
        this.syncHintReveal();
        this.notify();
      }, HINT_REVEAL_COOLDOWN_MS);
    }
  }

  private clearHintRevealTimer(): void {
    if (this.hintRevealTimer !== null) {
      clearTimeout(this.hintRevealTimer);
      this.hintRevealTimer = null;
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
      introducedSkillIds: this.introduced,
      voiceOverInput: this.voiceOverInput,
    });
  }
}

/**
 * VoiceOver braille screen input commits a trailing space after each word —
 * including the last word of a prompt, and sometimes as its own event that
 * lands on the next prompt. A space the expected text doesn't have coming is
 * an input-method artifact, not a mistake: strip trailing spaces whenever
 * doing so turns a non-matching value back into a prefix of (or all of) the
 * expected text. Expected mid-prompt spaces and real mistakes pass through.
 */
function stripUnexpectedTrailingSpaces(value: string, text: string): string {
  if (text.startsWith(value)) return value;
  const trimmed = value.replace(/ +$/u, '');
  return trimmed !== value && text.startsWith(trimmed) ? trimmed : value;
}

export function createTutorStore(options: TutorStoreOptions = {}): TutorStore {
  return new TutorStore(options);
}
