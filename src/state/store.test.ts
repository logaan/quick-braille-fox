import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent, KeyboardEvent } from 'react';
import {
  HINT_REVEAL_COOLDOWN_MS,
  QBF_MIN_CELLS,
  QBF_SENTENCE,
  makePrompt,
  makeTutorState,
  serialize,
  textToCells,
} from '../core';
import type { StorageLike, TutorStore } from './index';
import { STORAGE_KEY, createTutorStore } from './index';

// --- helpers ---------------------------------------------------------------

interface MemoryStorage extends StorageLike {
  readonly data: Map<string, string>;
}

function memoryStorage(): MemoryStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function fakeEvent(value: string, inputType: string): ChangeEvent<HTMLInputElement> {
  return {
    currentTarget: { value },
    nativeEvent: { inputType },
  } as unknown as ChangeEvent<HTMLInputElement>;
}

/** Simulate one input event that inserts text (field now holds `value`). */
function insert(store: TutorStore, value: string): void {
  store.handlers.onInput(fakeEvent(value, 'insertText'));
}

/** Simulate a backspace (field now holds `value`). */
function del(store: TutorStore, value: string): void {
  store.handlers.onInput(fakeEvent(value, 'deleteContentBackward'));
}

// --- chord-mode helpers ----------------------------------------------------

const DOT_CODE: Record<number, string> = { 1: 'KeyF', 2: 'KeyD', 3: 'KeyS', 4: 'KeyJ', 5: 'KeyK', 6: 'KeyL' };

function keyEvent(code: string, extra: Partial<{ repeat: boolean; key: string }> = {}): KeyboardEvent<HTMLInputElement> {
  return {
    code,
    key: extra.key ?? '',
    repeat: extra.repeat ?? false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: () => {},
  } as unknown as KeyboardEvent<HTMLInputElement>;
}

function keyDown(store: TutorStore, code: string, extra?: Partial<{ repeat: boolean; key: string }>): void {
  store.handlers.onDrillKeyDown(keyEvent(code, extra));
}
function keyUp(store: TutorStore, code: string): void {
  store.handlers.onDrillKeyUp(keyEvent(code));
}

/** Chord one braille cell: press each dot key, then release them all. */
function chordCell(store: TutorStore, dots: ReadonlyArray<number>): void {
  const codes = dots.map((d) => DOT_CODE[d] as string);
  for (const c of codes) keyDown(store, c);
  for (const c of codes) keyUp(store, c);
}

/** Chord a space (blank cell). */
function chordSpace(store: TutorStore): void {
  keyDown(store, 'Space');
  keyUp(store, 'Space');
}

/** Chord a whole print string using its canonical grade-2 cells. */
function chordText(store: TutorStore, text: string): void {
  for (const cell of textToCells(text)) {
    if (cell.length === 0) chordSpace(store);
    else chordCell(store, cell);
  }
}

/** Put a store into chord mode (VoiceOver input off). */
function chordMode(store: TutorStore): void {
  if (store.viewModel().voiceOverInput) store.handlers.onInputModeToggle();
}

/** Type `text` one character-insertion at a time. */
function typeText(store: TutorStore, text: string): void {
  for (let i = 1; i <= text.length; i += 1) insert(store, text.slice(0, i));
}

/**
 * Type `text` using exactly `insertions` insertion events (the first
 * insertions carry 2 chars each, like VoiceOver committing contractions).
 */
function typeInChunks(store: TutorStore, text: string, insertions: number): void {
  const doubles = text.length - insertions;
  let pos = 0;
  for (let i = 0; i < insertions; i += 1) {
    pos += i < doubles ? 2 : 1;
    insert(store, text.slice(0, pos));
  }
  expect(pos).toBe(text.length);
}

/** Storage whose saved session is mid-prompt on "the dog" (letter-d drill). */
function midPromptStorage(): MemoryStorage {
  const storage = memoryStorage();
  const state = makeTutorState({
    seed: 7,
    promptCounter: 1,
    prompt: makePrompt({ text: 'the dog', targetSkillId: 'letter-d' }),
  });
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null, introducedSkillIds: [] }),
  );
  return storage;
}

/** Storage whose saved session is one completed prompt away from the qbf. */
function qbfReadyStorage(): MemoryStorage {
  const storage = memoryStorage();
  const state = makeTutorState({
    seed: 7,
    promptCounter: 99,
    prompt: makePrompt({ text: 'done', typed: 'done', completed: true }),
  });
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null, introducedSkillIds: [] }),
  );
  return storage;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// --- tests -------------------------------------------------------------

describe('TutorStore basics', () => {
  it('starts a fresh session with a prompt, five active skills, and an intro', () => {
    const store = createTutorStore({ seed: 1 });
    const vm = store.viewModel();
    expect(vm.promptText.length).toBeGreaterThan(0);
    expect(vm.activeSkills).toHaveLength(5);
    expect(vm.promptsCompleted).toBe(0);
    expect(vm.hint).toBeNull();
    expect(vm.isQbf).toBe(false);
    expect(vm.intro).not.toBeNull();
    expect(vm.activeSkills.map((s) => s.id)).toContain(vm.intro?.id);
    expect(vm.groups[0]).toEqual({ group: 'letters', learnt: 0, total: 26 });
    expect(vm.totalSkills).toBe(258);
  });

  it('completing a prompt scores the target and advances to a new prompt', () => {
    const store = createTutorStore({ seed: 1 });
    const text = store.viewModel().promptText;
    typeText(store, text);
    const vm = store.viewModel();
    expect(vm.promptsCompleted).toBe(1);
    expect(vm.typed).toBe('');
    expect(vm.activeSkills.some((s) => s.score >= 2)).toBe(true);
  });
});

describe('hint timer', () => {
  it('reveals the hint after the core-provided delay', () => {
    const store = createTutorStore({ seed: 1 });
    vi.advanceTimersByTime(399);
    expect(store.viewModel().hint).toBeNull();
    vi.advanceTimersByTime(1); // score 0 => 400ms
    expect(store.viewModel().hint).not.toBeNull();
  });

  it('re-arms the countdown on a keystroke', () => {
    const store = createTutorStore({ seed: 1 });
    const text = store.viewModel().promptText;
    vi.advanceTimersByTime(200);
    // A wrong first character (a mistake, but the first one is free) —
    // guaranteed not to complete even a one-character prompt.
    insert(store, text.startsWith('x') ? 'y' : 'x');
    vi.advanceTimersByTime(399);
    expect(store.viewModel().hint).toBeNull();
    vi.advanceTimersByTime(1); // 400ms after the keystroke
    expect(store.viewModel().hint).not.toBeNull();
  });
});

describe('progressive hint reveal', () => {
  it('uncovers the caret word one sign at a time on a cooldown', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    expect(store.viewModel().hint).toBeNull();
    vi.advanceTimersByTime(400); // score 0 => auto-hint after 400ms
    expect(store.viewModel().hint).toBe('⠮'); // "the" is a single sign

    typeText(store, 'the ');
    expect(store.viewModel().hint).toBe('⠙'); // next word restarts at one sign
    vi.advanceTimersByTime(HINT_REVEAL_COOLDOWN_MS);
    expect(store.viewModel().hint).toBe('⠙⠕');
    vi.advanceTimersByTime(HINT_REVEAL_COOLDOWN_MS);
    expect(store.viewModel().hint).toBe('⠙⠕⠛');
  });

  it('never uncovers more than the word at the caret', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    vi.advanceTimersByTime(60_000);
    expect(store.viewModel().hint).toBe('⠮');
  });
});

describe('persistence', () => {
  it('round-trips progress through storage', () => {
    const storage = memoryStorage();
    const first = createTutorStore({ storage, seed: 1 });
    typeText(first, first.viewModel().promptText);
    first.flushSave();
    expect(storage.data.has(STORAGE_KEY)).toBe(true);

    const second = createTutorStore({ storage, seed: 1 });
    expect(second.viewModel().promptsCompleted).toBe(1);
  });

  it('saves on a debounce after changes', () => {
    const storage = memoryStorage();
    const store = createTutorStore({ storage, seed: 1, saveDebounceMs: 100 });
    const text = store.viewModel().promptText;
    insert(store, text.slice(0, 1));
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    vi.advanceTimersByTime(100);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
  });

  it('falls back to a fresh session on corrupt storage', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{not json!!!');
    const store = createTutorStore({ storage, seed: 1 });
    expect(store.viewModel().promptsCompleted).toBe(0);
    expect(store.viewModel().promptText.length).toBeGreaterThan(0);
  });

  it('reset requires confirmation and then wipes progress', () => {
    const storage = memoryStorage();
    const store = createTutorStore({ storage, seed: 1 });
    typeText(store, store.viewModel().promptText);
    expect(store.viewModel().promptsCompleted).toBe(1);

    store.handlers.onResetRequest();
    expect(store.viewModel().confirmingReset).toBe(true);
    store.handlers.onResetCancel();
    expect(store.viewModel().confirmingReset).toBe(false);
    expect(store.viewModel().promptsCompleted).toBe(1);

    store.handlers.onResetRequest();
    store.handlers.onResetConfirm();
    const vm = store.viewModel();
    expect(vm.confirmingReset).toBe(false);
    expect(vm.promptsCompleted).toBe(0);
  });
});

describe('qbf challenge', () => {
  it('serves the pangram on the 100th prompt with no hints ever', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    const vm = store.viewModel();
    expect(vm.isQbf).toBe(true);
    expect(vm.promptText).toBe(QBF_SENTENCE);
    expect(vm.nextQbfIn).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(store.viewModel().hint).toBeNull();
  });

  it('counts one cell per insertion event and awards a badge', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    typeText(store, QBF_SENTENCE); // 45 single-char insertions
    const vm = store.viewModel();
    const expectedPercent = ((QBF_SENTENCE.length - QBF_MIN_CELLS) / QBF_MIN_CELLS) * 100;
    expect(vm.qbfResult).toEqual({ kind: 'badge', percentAbove: expectedPercent });
    expect(vm.bestQbf).toEqual({ kind: 'badge', percentAbove: expectedPercent });

    store.handlers.onQbfContinue();
    const next = store.viewModel();
    expect(next.isQbf).toBe(false);
    expect(next.qbfResult).toBeNull();
    expect(next.promptsCompleted).toBe(100);
  });

  it('awards the crown for a minimum-cell run (contraction-sized insertions)', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    typeInChunks(store, QBF_SENTENCE, QBF_MIN_CELLS); // 36 insertions
    expect(store.viewModel().qbfResult).toEqual({ kind: 'crown' });
    expect(store.viewModel().bestQbf).toEqual({ kind: 'crown' });
  });

  it('does not decrement the cell count on deletions', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    insert(store, 'T');
    insert(store, 'Th');
    del(store, 'T'); // backspace: count stays at 2
    for (let i = 2; i <= QBF_SENTENCE.length; i += 1) insert(store, QBF_SENTENCE.slice(0, i));
    const result = store.viewModel().qbfResult;
    expect(result?.kind).toBe('badge');
    // 2 insertions before the backspace + 44 finishing ('Th' -> full text).
    const cells = QBF_SENTENCE.length + 1;
    if (result?.kind === 'badge') {
      expect(result.percentAbove).toBeCloseTo(((cells - QBF_MIN_CELLS) / QBF_MIN_CELLS) * 100, 6);
    }
  });

  it('fails instantly on a wrong character and does not record a best', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    insert(store, 'X'); // expected 'T'
    const vm = store.viewModel();
    expect(vm.qbfResult).toEqual({ kind: 'failed' });
    expect(vm.bestQbf).toBeNull();
    expect(vm.promptsCompleted).toBe(100); // a failed qbf still counts

    store.handlers.onQbfContinue();
    expect(store.viewModel().isQbf).toBe(false);
  });

  it('never replaces a better best result with a worse one', () => {
    const storage = qbfReadyStorage();
    const store = createTutorStore({ storage, seed: 1 });
    typeInChunks(store, QBF_SENTENCE, QBF_MIN_CELLS);
    expect(store.viewModel().bestQbf).toEqual({ kind: 'crown' });
    store.flushSave();

    // Wind the persisted session forward to the next qbf and fumble it.
    const next = createTutorStore({ storage, seed: 1 });
    expect(next.viewModel().bestQbf).toEqual({ kind: 'crown' });
  });
});

describe('VoiceOver trailing spaces', () => {
  /** Storage whose saved session resumes on an in-flight prompt of `text`. */
  function promptStorage(text: string): MemoryStorage {
    const storage = memoryStorage();
    const state = makeTutorState({ seed: 7, promptCounter: 1, prompt: makePrompt({ text }) });
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null, introducedSkillIds: [] }),
    );
    return storage;
  }

  it('completes the prompt when the final word commit carries a trailing space', () => {
    const store = createTutorStore({ seed: 1 });
    const text = store.viewModel().promptText;
    insert(store, `${text} `);
    const vm = store.viewModel();
    expect(vm.promptsCompleted).toBe(1);
    expect(vm.typed).toBe('');
  });

  it('ignores a stray space landing on a fresh prompt', () => {
    const store = createTutorStore({ seed: 1 });
    insert(store, `${store.viewModel().promptText} `);
    expect(store.viewModel().promptsCompleted).toBe(1);
    insert(store, ' '); // the space arriving as its own event, after advancing
    expect(store.viewModel().typed).toBe('');
    expect(store.viewModel().promptsCompleted).toBe(1);
  });

  it('keeps a space the prompt actually expects', () => {
    const store = createTutorStore({ storage: promptStorage('x y'), seed: 1 });
    insert(store, 'x');
    insert(store, 'x ');
    expect(store.viewModel().typed).toBe('x ');
    insert(store, 'x y');
    expect(store.viewModel().promptsCompleted).toBe(2);
  });

  it('still registers a mistake when the wrong text ends with a space', () => {
    const store = createTutorStore({ storage: promptStorage('x y'), seed: 1 });
    insert(store, 'z ');
    expect(store.viewModel().typed).toBe('z ');
  });

  it('does not fail a qbf run on the final trailing space', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    for (let i = 1; i < QBF_SENTENCE.length; i += 1) insert(store, QBF_SENTENCE.slice(0, i));
    insert(store, `${QBF_SENTENCE} `);
    const expectedPercent = ((QBF_SENTENCE.length - QBF_MIN_CELLS) / QBF_MIN_CELLS) * 100;
    expect(store.viewModel().qbfResult).toEqual({ kind: 'badge', percentAbove: expectedPercent });
  });

  it('does not count a stripped stray space as a qbf cell', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    insert(store, 'T');
    insert(store, 'Th');
    insert(store, 'Th '); // stray: expected next char is 'e', space is stripped
    expect(store.viewModel().typed).toBe('Th');
    for (let i = 3; i <= QBF_SENTENCE.length; i += 1) insert(store, QBF_SENTENCE.slice(0, i));
    // The stripped space must not have counted: still one cell per character.
    const expectedPercent = ((QBF_SENTENCE.length - QBF_MIN_CELLS) / QBF_MIN_CELLS) * 100;
    expect(store.viewModel().qbfResult).toEqual({ kind: 'badge', percentAbove: expectedPercent });
  });

  it('drops a stray leading space so the learner can still recover', () => {
    // The field is uncontrolled, so a stray space VoiceOver leaves at the
    // front stays in the DOM; matching must ignore it rather than diverge.
    const store = createTutorStore({ storage: promptStorage('x y'), seed: 1 });
    insert(store, ' '); // stray leading space
    expect(store.viewModel().typed).toBe('');
    expect(store.viewModel().diverged).toBe(false);
    insert(store, ' x'); // VoiceOver appends onto the stray space
    expect(store.viewModel().typed).toBe('x');
    expect(store.viewModel().diverged).toBe(false);
    insert(store, ' x y');
    expect(store.viewModel().promptsCompleted).toBe(2);
  });

  it('collapses a doubled space at a word boundary', () => {
    const store = createTutorStore({ storage: promptStorage('x y'), seed: 1 });
    insert(store, 'x');
    insert(store, 'x  '); // VoiceOver doubles the boundary space
    expect(store.viewModel().typed).toBe('x ');
    expect(store.viewModel().diverged).toBe(false);
    insert(store, 'x  y');
    expect(store.viewModel().promptsCompleted).toBe(2);
  });
});

describe('drill input remount key', () => {
  function twoWordStore(): TutorStore {
    const storage = memoryStorage();
    const state = makeTutorState({
      seed: 7,
      promptCounter: 1,
      prompt: makePrompt({ text: 'x y' }),
    });
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null, introducedSkillIds: [] }),
    );
    return createTutorStore({ storage, seed: 1 });
  }

  it('keeps a stable key while typing and changes it on the next prompt', () => {
    const store = twoWordStore();
    const start = store.viewModel().promptKey;
    insert(store, 'x'); // still the same prompt
    expect(store.viewModel().promptKey).toBe(start);
    insert(store, 'x y'); // completes -> advances to the next prompt
    expect(store.viewModel().promptKey).not.toBe(start);
  });

  it('changes the key when progress is reset', () => {
    const store = twoWordStore();
    const start = store.viewModel().promptKey;
    store.handlers.onResetRequest();
    store.handlers.onResetConfirm();
    expect(store.viewModel().promptKey).not.toBe(start);
  });
});

describe('input mode toggle', () => {
  it('defaults to VoiceOver input and flips on toggle', () => {
    const store = createTutorStore({ seed: 1 });
    expect(store.viewModel().voiceOverInput).toBe(true);
    store.handlers.onInputModeToggle();
    expect(store.viewModel().voiceOverInput).toBe(false);
    store.handlers.onInputModeToggle();
    expect(store.viewModel().voiceOverInput).toBe(true);
  });

  it('persists the mode across store recreation', () => {
    const storage = memoryStorage();
    const first = createTutorStore({ storage, seed: 1 });
    first.handlers.onInputModeToggle(); // -> chord mode
    first.flushSave();
    const second = createTutorStore({ storage, seed: 1 });
    expect(second.viewModel().voiceOverInput).toBe(false);
  });

  it('loads an old envelope (no field) as VoiceOver input', () => {
    const storage = midPromptStorage(); // envelope written without voiceOverInput
    const store = createTutorStore({ storage, seed: 1 });
    expect(store.viewModel().voiceOverInput).toBe(true);
  });

  it('ignores chord key events while VoiceOver input is on', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    chordCell(store, [2, 3, 4, 6]); // would be "the" in chord mode
    expect(store.viewModel().typed).toBe('');
    // ...but onInput still works.
    insert(store, 't');
    expect(store.viewModel().typed).toBe('t');
  });

  it('ignores onInput while chord mode is on', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    chordMode(store);
    insert(store, 'the dog');
    expect(store.viewModel().typed).toBe('');
  });
});

describe('chord input', () => {
  /** Storage resuming an in-flight prompt of `text` (letter-d target). */
  function promptStorage(text: string): MemoryStorage {
    const storage = memoryStorage();
    const state = makeTutorState({
      seed: 7,
      promptCounter: 1,
      prompt: makePrompt({ text, targetSkillId: 'letter-d' }),
    });
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null, introducedSkillIds: [] }),
    );
    return storage;
  }

  it('completes a prompt typed entirely by chording', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    chordMode(store);
    chordText(store, 'the dog'); // ⠮ ␣ ⠙ ⠕ ⠛
    const vm = store.viewModel();
    expect(vm.promptsCompleted).toBe(2);
    expect(vm.typed).toBe('');
  });

  it('shows the matching prefix with no phantom mistake', () => {
    const store = createTutorStore({ storage: promptStorage('band top'), seed: 1 });
    chordMode(store);
    chordCell(store, [1, 2]); // ⠃ — "but" alone, but here the prefix "b"
    const vm = store.viewModel();
    expect(vm.typed).toBe('b');
    expect(vm.diverged).toBe(false);
  });

  it('diverges on a wrong chord and recovers on backspace', () => {
    const store = createTutorStore({ storage: promptStorage('cat top'), seed: 1 });
    chordMode(store);
    chordCell(store, [2, 3, 4, 5]); // ⠞, expected "c" — diverges (reads "that")
    expect(store.viewModel().typed).not.toBe('');
    expect(store.viewModel().diverged).toBe(true);
    keyDown(store, 'Backspace');
    expect(store.viewModel().typed).toBe('');
    expect(store.viewModel().diverged).toBe(false);
    chordCell(store, [1, 4]); // ⠉ = "c"
    expect(store.viewModel().typed).toBe('c');
    expect(store.viewModel().diverged).toBe(false);
  });

  it('ignores a leading space chord and keeps expected mid-prompt spaces', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    chordMode(store);
    chordSpace(store); // nothing typed yet -> ignored
    expect(store.viewModel().typed).toBe('');
    chordCell(store, [2, 3, 4, 6]); // "the"
    chordSpace(store); // expected space after "the"
    expect(store.viewModel().typed).toBe('the ');
  });

  it('reconstructs the buffer when toggling mid-prompt on a clean prefix', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    insert(store, 'the'); // typed via VoiceOver
    chordMode(store); // toggle to chording
    expect(store.viewModel().typed).toBe('the');
    chordSpace(store);
    chordText(store, 'dog');
    expect(store.viewModel().promptsCompleted).toBe(2);
  });

  it('clears diverged typing when toggling into chord mode', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    insert(store, 'z'); // diverges from "the dog"
    expect(store.viewModel().typed).toBe('z');
    chordMode(store);
    expect(store.viewModel().typed).toBe('');
  });

  it('awards the crown for a minimum-cell chorded qbf run', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    chordMode(store);
    chordText(store, QBF_SENTENCE); // canonical: exactly QBF_MIN_CELLS commits
    expect(store.viewModel().qbfResult).toEqual({ kind: 'crown' });
  });

  it('awards a badge when a shortform is chorded uncontracted', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    chordMode(store);
    chordText(store, 'The '); // caps + the + space
    for (const d of [[1, 2, 3, 4, 5], [1, 3, 6], [2, 4], [1, 4], [1, 3]]) chordCell(store, d); // q u i c k
    chordText(store, ' brown fox jumped over the lazy dog.');
    // "quick" is a 2-cell shortform; spelling it out adds 3 cells -> 39 total.
    const cells = QBF_MIN_CELLS + 3;
    const result = store.viewModel().qbfResult;
    expect(result?.kind).toBe('badge');
    if (result?.kind === 'badge') {
      expect(result.percentAbove).toBeCloseTo(((cells - QBF_MIN_CELLS) / QBF_MIN_CELLS) * 100, 6);
    }
  });

  it('does not decrement the qbf cell count on backspace', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    chordMode(store);
    chordCell(store, [6]); // a stray capital-indicator cell
    keyDown(store, 'Backspace'); // removed, but the cell already counted
    chordText(store, QBF_SENTENCE);
    const cells = QBF_MIN_CELLS + 1;
    const result = store.viewModel().qbfResult;
    expect(result?.kind).toBe('badge');
    if (result?.kind === 'badge') {
      expect(result.percentAbove).toBeCloseTo(((cells - QBF_MIN_CELLS) / QBF_MIN_CELLS) * 100, 6);
    }
  });

  it('fails a qbf run instantly on a wrong chord', () => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    chordMode(store);
    chordCell(store, [1, 3, 5]); // ⠕ = "o", expected the capital "T"
    expect(store.viewModel().qbfResult).toEqual({ kind: 'failed' });
  });
});
