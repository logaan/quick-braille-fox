import type { ChangeEvent, KeyboardEvent } from 'react';
import type { Cell, FoxResult, KeystrokeInput, Prompt, SkillPolicy, TutorState } from '../core';
import {
  backTranslateBuffer,
  commonPrefixLength,
  dotsToUnicode,
  keystroke,
  nextHintFor,
  nextPrompt,
  foxResult,
  promptUnicode,
  revealHint,
  setAllPolicies,
  setGroupPolicy,
  setRevealTimer,
  setSkillPolicy,
  spellOutCells,
  startSession,
  textToCells,
  tryTranslate,
  unicodeToDots,
} from '../core';
import type { ChordState } from './chords';
import { EMPTY_CHORD_STATE, chordKeyDown, chordKeyUp, isChordCode } from './chords';
import type { InputMode } from './modes';
import { DEFAULT_INPUT_MODE } from './modes';
import type { BestFox, StorageLike } from './persistence';
import { clearProgress, loadProgress, saveProgress } from './persistence';
import type { SkillGroup } from '../data/skills';
import type { AppHandlers, AppPage, AppViewModel } from './view';
import { buildViewModel, matchesResetWord } from './view';

export interface TutorStoreOptions {
  storage?: StorageLike | null;
  seed?: number;
  saveDebounceMs?: number;
}

export class TutorStore {
  private tutor: TutorState;
  private bestFox: BestFox | null = null;
  private lastFox: FoxResult | null = null;
  private foxCellsTyped = 0;
  private promptEpoch = 0;
  private confirmingReset = false;
  private resetConfirmText = '';

  private page: AppPage = 'drill';
  private policiesChanged = false;

  private inputMode: InputMode = DEFAULT_INPUT_MODE;
  private chordState: ChordState = EMPTY_CHORD_STATE;
  private cellBuffer: Cell[] = [];

  private readonly storage: StorageLike | null;
  private readonly saveDebounceMs: number;
  private readonly seedOption: number | undefined;

  private readonly listeners = new Set<() => void>();
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimerKey: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  readonly handlers: AppHandlers;

  constructor(options: TutorStoreOptions = {}) {
    this.storage = options.storage ?? null;
    this.saveDebounceMs = options.saveDebounceMs ?? 250;
    this.seedOption = options.seed;

    const persisted = this.storage === null ? null : loadProgress(this.storage);
    if (persisted === null) {
      this.tutor = startSession(this.freshSeed());
    } else {
      this.bestFox = persisted.bestFox;
      this.inputMode = persisted.inputMode;
      const p = persisted.tutor.prompt;
      this.tutor =
        p === null || p.completed || (p.isFox && p.typed !== '') || tryTranslate(p.text) === null
          ? nextPrompt(persisted.tutor)
          : persisted.tutor;
    }
    if (this.inputMode === 'emulated') this.reconstructBuffer();

    this.handlers = {
      onInput: (event) => this.handleInput(event),
      onDrillKeyDown: (event) => this.handleKeyDown(event),
      onDrillKeyUp: (event) => this.handleKeyUp(event),
      onInputModeSelect: (mode) => this.selectInputMode(mode),
      onRevealTimerToggle: (enabled) => this.toggleRevealTimer(enabled),
      onFoxContinue: () => this.continueAfterFox(),
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
      onNavigate: (page) => this.navigate(page),
      onSkillPolicyChange: (skillId, policy) => {
        this.applyPolicies(setSkillPolicy(this.tutor, skillId, policy));
      },
      onGroupPolicyChange: (group: SkillGroup, policy: SkillPolicy) => {
        this.applyPolicies(setGroupPolicy(this.tutor, group, policy));
      },
      onAllPolicyChange: (policy: SkillPolicy) => {
        this.applyPolicies(setAllPolicies(this.tutor, policy));
      },
      onResetConfirm: () => {
        if (!matchesResetWord(this.resetConfirmText)) return;
        this.resetProgress();
      },
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushSave());
      window.addEventListener('blur', () => {
        this.chordState = EMPTY_CHORD_STATE;
      });
    }
    this.syncHintTimer();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  viewModel(): AppViewModel {
    return buildViewModel({
      tutor: this.tutor,
      bestFox: this.bestFox,
      lastFox: this.lastFox,
      confirmingReset: this.confirmingReset,
      resetConfirmText: this.resetConfirmText,
      inputMode: this.inputMode,
      promptKey: this.promptEpoch,
      cellBuffer: this.cellBuffer,
      page: this.page,
    });
  }

  flushSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
  }

  private freshSeed(): number {
    return this.seedOption ?? Date.now();
  }

  private navigate(page: AppPage): void {
    if (page === this.page) return;
    this.page = page;
    if (page === 'drill') this.restartPrompt();
    this.changed();
  }

  private applyPolicies(next: TutorState): void {
    if (next.policies.equals(this.tutor.policies)) return;
    this.tutor = next;
    this.policiesChanged = true;
    this.changed();
  }

  private restartPrompt(): void {
    const prompt = this.tutor.prompt;
    if (prompt !== null && !prompt.completed) {
      if (this.policiesChanged) {
        this.tutor = nextPrompt(this.tutor);
      } else if (prompt.typed !== '' || prompt.typedUnicode !== '') {
        this.tutor = keystroke(this.tutor, { kind: 'print', typed: '' });
      }
      this.foxCellsTyped = 0;
    }
    this.policiesChanged = false;
    this.cellBuffer = [];
    this.chordState = EMPTY_CHORD_STATE;
    this.promptEpoch += 1;
    if (this.inputMode === 'emulated') this.reconstructBuffer();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private changed(): void {
    this.syncHintTimer();
    this.scheduleSave();
    this.notify();
  }

  private handleInput(event: ChangeEvent<HTMLInputElement>): void {
    if (this.inputMode !== 'voiceover') return;
    const prompt = this.tutor.prompt;
    if (prompt === null || prompt.completed) return;
    const value = normalizeTypedValue(event.currentTarget.value, prompt.text);
    const native = event.nativeEvent as Partial<InputEvent>;
    const inserted =
      typeof native.inputType === 'string'
        ? native.inputType.startsWith('insert')
        : value.length > prompt.typed.length;

    if (prompt.isFox && inserted && value !== prompt.typed) {
      this.foxCellsTyped += bulkInsert(native.inputType)
        ? Math.max(1, value.length - commonPrefixLength(value, prompt.typed))
        : 1;
    }

    this.tutor = keystroke(this.tutor, { kind: 'print', typed: value });
    this.afterKeystroke();
    this.changed();
  }

  private handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (this.inputMode !== 'emulated') return;
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
      if (event.repeat) return;
      this.chordState = chordKeyDown(this.chordState, code);
      return;
    }
    if (event.key.length === 1) event.preventDefault();
  }

  private handleKeyUp(event: KeyboardEvent<HTMLInputElement>): void {
    if (this.inputMode !== 'emulated') return;
    const code = event.code;
    if (!isChordCode(code)) return;
    const { state, action } = chordKeyUp(this.chordState, code);
    this.chordState = state;
    if (action.kind === 'none') return;
    const prompt = this.tutor.prompt;
    if (prompt === null || prompt.completed) return;

    if (action.kind === 'cell') {
      this.cellBuffer = [...this.cellBuffer, action.cell];
      if (prompt.isFox) this.foxCellsTyped += 1;
      this.commitBuffer();
      return;
    }
    if (this.cellBuffer.length === 0) return;
    const candidate: Cell[] = [...this.cellBuffer, []];
    const derived = backTranslateBuffer(candidate, prompt.text);
    const stripped = stripUnexpectedTrailingSpaces(derived, prompt.text);
    if (stripped !== derived) {
      if (!(prompt.isFox && stripped === prompt.text)) return;
      this.cellBuffer = candidate;
      this.commitBuffer();
      return;
    }
    this.cellBuffer = candidate;
    if (prompt.isFox) this.foxCellsTyped += 1;
    this.commitBuffer();
  }

  private bufferInput(prompt: Prompt): KeystrokeInput {
    const cells = this.cellBuffer;
    if (!prompt.isFox) return { kind: 'cells', cells };
    const typed = stripUnexpectedTrailingSpaces(
      backTranslateBuffer(cells, prompt.text),
      prompt.text,
    );
    return { kind: 'print', typed, cells };
  }

  private commitBuffer(): void {
    const prompt = this.tutor.prompt;
    if (prompt === null || prompt.completed) return;
    this.tutor = keystroke(this.tutor, this.bufferInput(prompt));
    this.afterKeystroke();
    this.changed();
  }

  private reconstructBuffer(): void {
    const prompt = this.tutor.prompt;
    if (prompt === null || prompt.completed) {
      this.cellBuffer = [];
      return;
    }
    const canonical = prompt.isFox ? '' : promptUnicode(prompt);
    const onCanon = (cells: readonly Cell[]): boolean =>
      canonical === '' || canonical.startsWith(dotsToUnicode(cells));
    if (prompt.typedUnicode !== '') {
      const cells = unicodeToDots(prompt.typedUnicode);
      if (onCanon(cells)) {
        this.cellBuffer = cells;
        return;
      }
    } else if (prompt.typed === '') {
      this.cellBuffer = [];
      return;
    } else if (prompt.text.startsWith(prompt.typed)) {
      for (const spelling of [spellOutCells, textToCells]) {
        try {
          const cells = spelling(prompt.typed).map((c): Cell => [...c]);
          const canonComplete = canonical !== '' && dotsToUnicode(cells) === canonical;
          if (
            !canonComplete &&
            backTranslateBuffer(cells, prompt.text) === prompt.typed &&
            onCanon(cells)
          ) {
            this.cellBuffer = cells;
            return;
          }
        } catch {
        }
      }
    }
    this.tutor = keystroke(this.tutor, { kind: 'print', typed: '' });
    this.cellBuffer = [];
    this.promptEpoch += 1;
  }

  private selectInputMode(mode: InputMode): void {
    if (mode === this.inputMode) return;
    this.inputMode = mode;
    this.chordState = EMPTY_CHORD_STATE;
    if (mode === 'voiceover') {
      this.cellBuffer = [];
      this.dropChordedCells();
    } else {
      this.reconstructBuffer();
    }
    this.changed();
  }

  /**
   * Switch the reveal timer on or off. changed() re-syncs the hint timer,
   * which cancels the sign currently on the clock when it goes off and
   * starts the caret sign's clock when it comes back on.
   */
  private toggleRevealTimer(enabled: boolean): void {
    if (enabled === this.tutor.revealTimer) return;
    this.tutor = setRevealTimer(this.tutor, enabled);
    this.changed();
  }

  private dropChordedCells(): void {
    const prompt = this.tutor.prompt;
    if (prompt === null || prompt.completed || prompt.typedUnicode === '') return;
    this.tutor = keystroke(this.tutor, { kind: 'print', typed: prompt.typed });
  }

  private afterKeystroke(): void {
    const after = this.tutor.prompt;
    if (!after?.completed) return;
    if (after.isFox) {
      const result: FoxResult = after.failed ? { kind: 'failed' } : foxResult(this.foxCellsTyped);
      this.lastFox = result;
      if (result.kind !== 'failed' && this.isNewBest(result)) this.bestFox = result;
    } else {
      this.advance();
    }
  }

  private continueAfterFox(): void {
    if (this.lastFox === null) return;
    this.advance();
    this.changed();
  }

  private advance(): void {
    this.tutor = nextPrompt(this.tutor);
    this.foxCellsTyped = 0;
    this.lastFox = null;
    this.cellBuffer = [];
    this.chordState = EMPTY_CHORD_STATE;
    this.promptEpoch += 1;
  }

  private isNewBest(result: BestFox): boolean {
    const best = this.bestFox;
    if (best === null) return true;
    if (best.kind === 'crown') return false;
    if (result.kind === 'crown') return true;
    return result.percentAbove < best.percentAbove;
  }

  private resetProgress(): void {
    if (this.storage !== null) clearProgress(this.storage);
    // Erasing progress leaves the settings alone: policies and the reveal
    // timer are preferences, not progress.
    this.tutor = setRevealTimer(
      startSession(this.freshSeed(), this.tutor.policies),
      this.tutor.revealTimer,
    );
    this.bestFox = null;
    this.lastFox = null;
    this.foxCellsTyped = 0;
    this.confirmingReset = false;
    this.resetConfirmText = '';
    this.cellBuffer = [];
    this.chordState = EMPTY_CHORD_STATE;
    this.promptEpoch += 1;
    this.changed();
  }

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
      bestFox: this.bestFox,
      inputMode: this.inputMode,
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
  return stripUnexpectedTrailingSpaces(collapsed, text);
}

/**
 * Insertion inputTypes whose text was not brailled in gesture by gesture:
 * paste, predictive-text/autocorrect commits, drag-and-drop, kill-ring yank.
 */
const BULK_INSERT_TYPES = new Set([
  'insertFromPaste',
  'insertFromPasteAsQuotation',
  'insertReplacementText',
  'insertFromDrop',
  'insertFromYank',
]);

function bulkInsert(inputType: unknown): boolean {
  return typeof inputType === 'string' && BULK_INSERT_TYPES.has(inputType);
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
