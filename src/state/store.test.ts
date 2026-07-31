import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent, KeyboardEvent } from 'react';
import {
  HINT_REVEAL_COOLDOWN_MS,
  FOX_INTERVAL,
  FOX_MIN_CELLS,
  FOX_SENTENCE,
  makePrompt,
  makeTutorState,
  serialize,
  textToCells,
} from '../core';
import { skills } from '../data/skills';
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
function chordCell(store: TutorStore, dots: readonly number[]): void {
  const codes = dots.map((d) => DOT_CODE[d]!);
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
    JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null }),
  );
  return storage;
}

/**
 * Storage whose saved session is one completed prompt into the curriculum,
 * so the store serves an ordinary drill — prompt 0 is the fox challenge.
 */
function drillReadyStorage(): MemoryStorage {
  const storage = memoryStorage();
  const state = makeTutorState({
    seed: 7,
    promptCounter: 1,
    prompt: makePrompt({ text: 'done', typed: 'done', completed: true }),
  });
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null }),
  );
  return storage;
}

/** Storage whose saved session lands the next prompt on the fox challenge. */
function foxReadyStorage(): MemoryStorage {
  const storage = memoryStorage();
  const state = makeTutorState({
    seed: 7,
    promptCounter: FOX_INTERVAL,
    prompt: makePrompt({ text: 'done', typed: 'done', completed: true }),
  });
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null }),
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
  it('starts a fresh session on the fox challenge with five active skills', () => {
    const store = createTutorStore({ seed: 1 });
    const vm = store.viewModel();
    expect(vm.promptText).toBe(FOX_SENTENCE);
    expect(vm.activeSkills).toHaveLength(5);
    expect(vm.promptsCompleted).toBe(0);
    expect(vm.hint).toBeNull();
    expect(vm.isFox).toBe(true);
    expect(vm.nextFoxIn).toBe(1);
    expect(vm.groups[0]).toEqual({ group: 'letters', learnt: 0, total: 26 });
    expect(vm.totalSkills).toBe(skills.length);
  });

  it('serves an ordinary drill once the opening fox is behind the learner', () => {
    const store = createTutorStore({ storage: drillReadyStorage(), seed: 1 });
    const vm = store.viewModel();
    expect(vm.promptText.length).toBeGreaterThan(0);
    expect(vm.isFox).toBe(false);
    expect(vm.nextFoxIn).toBe(FOX_INTERVAL);
  });

  it('completing a prompt scores the target and advances to a new prompt', () => {
    const store = createTutorStore({ storage: drillReadyStorage(), seed: 1 });
    const text = store.viewModel().promptText;
    typeText(store, text);
    const vm = store.viewModel();
    expect(vm.promptsCompleted).toBe(2);
    expect(vm.typed).toBe('');
    expect(vm.activeSkills.some((s) => s.score >= 2)).toBe(true);
  });
});

describe('hint timer', () => {
  it('reveals the hint after the core-provided delay', () => {
    const store = createTutorStore({ storage: drillReadyStorage(), seed: 1 });
    vi.advanceTimersByTime(399);
    expect(store.viewModel().hint).toBeNull();
    vi.advanceTimersByTime(1); // score 0 => 400ms
    expect(store.viewModel().hint).not.toBeNull();
  });

  it('does not restart the countdown for a sign already on the clock', () => {
    const store = createTutorStore({ storage: drillReadyStorage(), seed: 1 });
    const text = store.viewModel().promptText;
    vi.advanceTimersByTime(200);
    // A wrong first character (a mistake, but the first one is free) —
    // guaranteed not to complete even a one-character prompt. The caret has
    // not moved off the first sign, so its clock keeps running.
    insert(store, text.startsWith('x') ? 'y' : 'x');
    vi.advanceTimersByTime(200); // 400ms since the sign was reached
    expect(store.viewModel().hint).not.toBeNull();
  });
});

describe('a sign’s countdown starts when the caret reaches it', () => {
  it('does not start the next sign’s clock when a hint is revealed', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    vi.advanceTimersByTime(400); // "the" is hinted after the 400ms delay
    expect(store.viewModel().hint).toBe('⠮');
    // Go and make a cup of tea. Nothing else uncovers, because the caret is
    // still sitting on "the" — the rest of the prompt is untouched.
    vi.advanceTimersByTime(600_000);
    expect(store.viewModel().hint).toBe('⠮');
  });

  it('holds the next word’s clock until the space before it is typed', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    typeText(store, 'the');
    vi.advanceTimersByTime(600_000); // dawdle with the caret on the space
    expect(store.viewModel().hint).toBeNull();
    // Only now does "d" start counting — and it gets its full time (the
    // prompt delay, since nothing has been hinted yet).
    insert(store, 'the ');
    vi.advanceTimersByTime(399);
    expect(store.viewModel().hint).toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.viewModel().hint).toBe('⠙');
  });

  it('still awards a sign typed promptly after a long pause on the one before', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    const scoreOf = (id: string): number =>
      store.viewModel().activeSkills.find((s) => s.id === id)?.score ?? 0;

    vi.advanceTimersByTime(600_000); // ten minutes on "the"; it gets hinted
    typeText(store, 'the d'); // then "d" typed straight away
    expect(scoreOf('letter-d')).toBe(2); // full marks, hint or no hint
  });
});

describe('progressive hint reveal', () => {
  it('uncovers the caret word one sign at a time, as each is reached', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    expect(store.viewModel().hint).toBeNull();
    vi.advanceTimersByTime(400); // score 0 => auto-hint after 400ms
    expect(store.viewModel().hint).toBe('⠮'); // "the" is a single sign

    typeText(store, 'the ');
    expect(store.viewModel().hint).toBeNull(); // the next word starts covered
    vi.advanceTimersByTime(HINT_REVEAL_COOLDOWN_MS);
    expect(store.viewModel().hint).toBe('⠙');

    // Each further sign waits its own cooldown, and only from the moment
    // the sign before it is typed.
    typeText(store, 'the d');
    vi.advanceTimersByTime(HINT_REVEAL_COOLDOWN_MS);
    expect(store.viewModel().hint).toBe('⠙⠕');
    typeText(store, 'the do');
    vi.advanceTimersByTime(HINT_REVEAL_COOLDOWN_MS);
    expect(store.viewModel().hint).toBe('⠙⠕⠛');
  });

  it('never uncovers more than the sign at the caret', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    vi.advanceTimersByTime(60_000);
    expect(store.viewModel().hint).toBe('⠮');
  });

  it('shows a hint revealed mid-word after a clean start', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    typeText(store, 'the d'); // typed promptly: nothing revealed yet
    expect(store.viewModel().hint).toBeNull();
    // Stall on "o" until its hint fires: the cleanly-typed "d" must not
    // hide it (the sign is charged as hinted, so it has to actually show).
    vi.advanceTimersByTime(600_000);
    expect(store.viewModel().hint).toBe('⠙⠕');
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
    store.handlers.onResetTextChange('reset');
    store.handlers.onResetConfirm();
    const vm = store.viewModel();
    expect(vm.confirmingReset).toBe(false);
    expect(vm.promptsCompleted).toBe(0);
  });

  it('will not erase until the word "reset" is typed', () => {
    const store = createTutorStore({ storage: memoryStorage(), seed: 1 });
    typeText(store, store.viewModel().promptText);
    store.handlers.onResetRequest();

    expect(store.viewModel().canConfirmReset).toBe(false);
    store.handlers.onResetConfirm(); // no-op while the field is empty
    expect(store.viewModel().promptsCompleted).toBe(1);

    store.handlers.onResetTextChange('res');
    expect(store.viewModel().canConfirmReset).toBe(false);
    store.handlers.onResetConfirm();
    expect(store.viewModel().promptsCompleted).toBe(1);

    // Case and surrounding whitespace do not matter.
    store.handlers.onResetTextChange('  RESET ');
    expect(store.viewModel().canConfirmReset).toBe(true);
    store.handlers.onResetConfirm();
    expect(store.viewModel().promptsCompleted).toBe(0);
  });

  it('clears the typed word when the confirm step is dismissed or reopened', () => {
    const store = createTutorStore({ storage: memoryStorage(), seed: 1 });
    store.handlers.onResetRequest();
    store.handlers.onResetTextChange('reset');
    store.handlers.onResetCancel();
    expect(store.viewModel().resetConfirmText).toBe('');

    store.handlers.onResetRequest();
    expect(store.viewModel().resetConfirmText).toBe('');
    expect(store.viewModel().canConfirmReset).toBe(false);
  });
});

describe('fox challenge', () => {
  it('serves the pangram on the fox slot with no hints ever', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    const vm = store.viewModel();
    expect(vm.isFox).toBe(true);
    expect(vm.promptText).toBe(FOX_SENTENCE);
    expect(vm.nextFoxIn).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(store.viewModel().hint).toBeNull();
  });

  it('counts one cell per insertion event and awards a badge', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    typeText(store, FOX_SENTENCE); // 45 single-char insertions
    const vm = store.viewModel();
    const expectedPercent = ((FOX_SENTENCE.length - FOX_MIN_CELLS) / FOX_MIN_CELLS) * 100;
    expect(vm.foxResult).toEqual({ kind: 'badge', percentAbove: expectedPercent });
    expect(vm.bestFox).toEqual({ kind: 'badge', percentAbove: expectedPercent });

    store.handlers.onFoxContinue();
    const next = store.viewModel();
    expect(next.isFox).toBe(false);
    expect(next.foxResult).toBeNull();
    expect(next.promptsCompleted).toBe(FOX_INTERVAL + 1);
  });

  it('awards the crown for a minimum-cell run (contraction-sized insertions)', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    typeInChunks(store, FOX_SENTENCE, FOX_MIN_CELLS); // 36 insertions
    expect(store.viewModel().foxResult).toEqual({ kind: 'crown' });
    expect(store.viewModel().bestFox).toEqual({ kind: 'crown' });
  });

  it('does not decrement the cell count on deletions', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    insert(store, 'T');
    insert(store, 'Th');
    del(store, 'T'); // backspace: count stays at 2
    for (let i = 2; i <= FOX_SENTENCE.length; i += 1) insert(store, FOX_SENTENCE.slice(0, i));
    const result = store.viewModel().foxResult;
    expect(result?.kind).toBe('badge');
    // 2 insertions before the backspace + 44 finishing ('Th' -> full text).
    const cells = FOX_SENTENCE.length + 1;
    if (result?.kind === 'badge') {
      expect(result.percentAbove).toBeCloseTo(((cells - FOX_MIN_CELLS) / FOX_MIN_CELLS) * 100, 6);
    }
  });

  it('fails instantly on a wrong character and does not record a best', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    insert(store, 'X'); // expected 'T'
    const vm = store.viewModel();
    expect(vm.foxResult).toEqual({ kind: 'failed' });
    expect(vm.bestFox).toBeNull();
    expect(vm.promptsCompleted).toBe(FOX_INTERVAL + 1); // a failed fox still counts

    store.handlers.onFoxContinue();
    expect(store.viewModel().isFox).toBe(false);
  });

  it('explains a failure with the sign that was due', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    typeText(store, 'The quick brot'); // "ow" was due
    expect(store.viewModel().foxFailure).toEqual({
      expected: '⠪',
      expectedPrint: 'ow',
      typed: null, // VoiceOver input hands us print, not the cells behind it
    });
  });

  it('offers no failure detail while a run is still going', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    typeText(store, 'The qu');
    expect(store.viewModel().foxFailure).toBeNull();
  });

  it('offers no failure detail after a clean run', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    typeInChunks(store, FOX_SENTENCE, FOX_MIN_CELLS);
    expect(store.viewModel().foxResult).toEqual({ kind: 'crown' });
    expect(store.viewModel().foxFailure).toBeNull();
  });

  it('clears the failure detail on continuing to the next prompt', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    insert(store, 'X');
    expect(store.viewModel().foxFailure).not.toBeNull();
    store.handlers.onFoxContinue();
    expect(store.viewModel().foxFailure).toBeNull();
  });

  it('never replaces a better best result with a worse one', () => {
    const storage = foxReadyStorage();
    const store = createTutorStore({ storage, seed: 1 });
    typeInChunks(store, FOX_SENTENCE, FOX_MIN_CELLS);
    expect(store.viewModel().bestFox).toEqual({ kind: 'crown' });
    store.flushSave();

    // Wind the persisted session forward to the next fox and fumble it.
    const next = createTutorStore({ storage, seed: 1 });
    expect(next.viewModel().bestFox).toEqual({ kind: 'crown' });
  });
});

describe('drill input field sync', () => {
  it('resumes an in-flight prompt without a phantom mistake on the next word', () => {
    const storage = midPromptStorage();
    const first = createTutorStore({ storage, seed: 1 });
    insert(first, 'the ');
    first.flushSave();

    // Reload: the remounted field starts from the persisted typed text (the
    // UI mounts it with defaultValue vm.typed), so the next VoiceOver commit
    // reports the whole value, not just the fresh word.
    const store = createTutorStore({ storage, seed: 1 });
    expect(store.viewModel().typed).toBe('the ');
    insert(store, 'the d');
    const vm = store.viewModel();
    expect(vm.typed).toBe('the d');
    expect(vm.diverged).toBe(false);
  });

  it('bumps promptKey when a mode toggle clears diverged typing', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    insert(store, 'z');
    expect(store.viewModel().diverged).toBe(true);
    const before = store.viewModel().promptKey;
    store.handlers.onInputModeToggle(); // chord mode: typing starts over
    const vm = store.viewModel();
    expect(vm.typed).toBe('');
    expect(vm.promptKey).not.toBe(before);
  });

  it('keeps promptKey (and the buffer) when toggling with a clean prefix', () => {
    const store = createTutorStore({ storage: midPromptStorage(), seed: 1 });
    insert(store, 'the');
    const before = store.viewModel().promptKey;
    store.handlers.onInputModeToggle();
    const vm = store.viewModel();
    expect(vm.typed).toBe('the');
    expect(vm.promptKey).toBe(before);
  });
});

describe('VoiceOver trailing spaces', () => {
  /** Storage whose saved session resumes on an in-flight prompt of `text`. */
  function promptStorage(text: string): MemoryStorage {
    const storage = memoryStorage();
    const state = makeTutorState({ seed: 7, promptCounter: 1, prompt: makePrompt({ text }) });
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null }),
    );
    return storage;
  }

  it('completes the prompt when the final word commit carries a trailing space', () => {
    const store = createTutorStore({ storage: drillReadyStorage(), seed: 1 });
    const text = store.viewModel().promptText;
    insert(store, `${text} `);
    const vm = store.viewModel();
    expect(vm.promptsCompleted).toBe(2);
    expect(vm.typed).toBe('');
  });

  it('ignores a stray space landing on a fresh prompt', () => {
    const store = createTutorStore({ storage: drillReadyStorage(), seed: 1 });
    insert(store, `${store.viewModel().promptText} `);
    expect(store.viewModel().promptsCompleted).toBe(2);
    insert(store, ' '); // the space arriving as its own event, after advancing
    expect(store.viewModel().typed).toBe('');
    expect(store.viewModel().promptsCompleted).toBe(2);
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

  it('does not fail a fox run on the final trailing space', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    for (let i = 1; i < FOX_SENTENCE.length; i += 1) insert(store, FOX_SENTENCE.slice(0, i));
    insert(store, `${FOX_SENTENCE} `);
    const expectedPercent = ((FOX_SENTENCE.length - FOX_MIN_CELLS) / FOX_MIN_CELLS) * 100;
    expect(store.viewModel().foxResult).toEqual({ kind: 'badge', percentAbove: expectedPercent });
  });

  it('does not fail a flawless run when predictive text commits a whole word', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    const upTo = FOX_SENTENCE.indexOf('jumps');
    for (let i = 1; i <= upTo; i += 1) insert(store, FOX_SENTENCE.slice(0, i));
    // One insertReplacementText event commits all of "jumps" — it counts as
    // its five characters, not as a single cell.
    store.handlers.onInput(
      fakeEvent(FOX_SENTENCE.slice(0, upTo + 'jumps'.length), 'insertReplacementText'),
    );
    for (let i = upTo + 'jumps'.length + 1; i <= FOX_SENTENCE.length; i += 1) {
      insert(store, FOX_SENTENCE.slice(0, i));
    }
    const expectedPercent = ((FOX_SENTENCE.length - FOX_MIN_CELLS) / FOX_MIN_CELLS) * 100;
    expect(store.viewModel().foxResult).toEqual({ kind: 'badge', percentAbove: expectedPercent });
  });

  it('does not count a stripped stray space as a fox cell', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    insert(store, 'T');
    insert(store, 'Th');
    insert(store, 'Th '); // stray: expected next char is 'e', space is stripped
    expect(store.viewModel().typed).toBe('Th');
    for (let i = 3; i <= FOX_SENTENCE.length; i += 1) insert(store, FOX_SENTENCE.slice(0, i));
    // The stripped space must not have counted: still one cell per character.
    const expectedPercent = ((FOX_SENTENCE.length - FOX_MIN_CELLS) / FOX_MIN_CELLS) * 100;
    expect(store.viewModel().foxResult).toEqual({ kind: 'badge', percentAbove: expectedPercent });
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
      JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null }),
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
    store.handlers.onResetTextChange('reset');
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
      JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null }),
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

  /** Storage resuming a chord-mode session with `typed` of `text` in flight. */
  function chordResumeStorage(text: string, typed: string): MemoryStorage {
    const storage = memoryStorage();
    const state = makeTutorState({
      seed: 7,
      promptCounter: 1,
      prompt: makePrompt({ text, targetSkillId: 'letter-d', typed }),
    });
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tutor: serialize(state),
        bestQbf: null,
        voiceOverInput: false,
      }),
    );
    return storage;
  }

  it('resumes a mid-word prefix and accepts the next letter chord', () => {
    // Typed "st" of "still": the canonical cells for "st" are the st
    // groupsign, which is also the "still" wordsign — a canonical buffer
    // made the next correct letter chord decode as divergent print.
    const store = createTutorStore({ storage: chordResumeStorage('still', 'st'), seed: 1 });
    expect(store.viewModel().typed).toBe('st');
    chordCell(store, [2, 4]); // i
    const vm = store.viewModel();
    expect(vm.typed).toBe('sti');
    expect(vm.diverged).toBe(false);
  });

  it('resumes a wordsign-stem prefix and continues to completion', () => {
    // Typed "can" of "can't": the ⠉ cell is both letter c and the "can"
    // wordsign, so the two candidate buffers collide. Whichever spelling the
    // resume settles on must round-trip and accept the next correct chords.
    const store = createTutorStore({ storage: chordResumeStorage("can't", 'can'), seed: 1 });
    expect(store.viewModel().typed).toBe('can');
    chordCell(store, [3]); // '
    chordCell(store, [2, 3, 4, 5]); // t
    expect(store.viewModel().promptsCompleted).toBe(2);
  });

  it('accepts a wordsign word spelled letter by letter (can)', () => {
    const store = createTutorStore({ storage: promptStorage('can top'), seed: 1 });
    chordMode(store);
    chordCell(store, [1, 4]); // c — also the "can" wordsign cell
    expect(store.viewModel().diverged).toBe(false);
    chordCell(store, [1]); // a — used to decode as "can"+"a", a phantom mistake
    expect(store.viewModel().typed).toBe('ca');
    expect(store.viewModel().diverged).toBe(false);
    chordCell(store, [1, 3, 4, 5]); // n
    expect(store.viewModel().typed).toBe('can');
    expect(store.viewModel().diverged).toBe(false);
    chordSpace(store);
    chordText(store, 'top');
    expect(store.viewModel().promptsCompleted).toBe(2);
  });

  it("accepts an apostrophe word with a wordsign stem letter by letter (can't)", () => {
    const store = createTutorStore({ storage: promptStorage("can't top"), seed: 1 });
    chordMode(store);
    const spelled = [[1, 4], [1], [1, 3, 4, 5], [3], [2, 3, 4, 5]]; // c,a,n,',t
    for (const cell of spelled) {
      chordCell(store, cell);
      expect(store.viewModel().diverged).toBe(false);
    }
    expect(store.viewModel().typed).toBe("can't");
    chordSpace(store);
    chordText(store, 'top');
    expect(store.viewModel().promptsCompleted).toBe(2);
  });

  it("accepts a plain apostrophe word letter by letter (don't)", () => {
    const store = createTutorStore({ storage: promptStorage("don't top"), seed: 1 });
    chordMode(store);
    const spelled = [[1, 4, 5], [1, 3, 5], [1, 3, 4, 5], [3], [2, 3, 4, 5]]; // d,o,n,',t
    for (const cell of spelled) {
      chordCell(store, cell);
      expect(store.viewModel().diverged).toBe(false);
    }
    expect(store.viewModel().typed).toBe("don't");
    chordSpace(store);
    chordText(store, 'top');
    expect(store.viewModel().promptsCompleted).toBe(2);
  });

  it('still completes on the chorded wordsign itself (⠉ for can)', () => {
    const store = createTutorStore({ storage: promptStorage('can top'), seed: 1 });
    chordMode(store);
    chordCell(store, [1, 4]); // the "can" wordsign
    expect(store.viewModel().diverged).toBe(false);
    chordSpace(store);
    chordText(store, 'top');
    expect(store.viewModel().promptsCompleted).toBe(2);
  });

  it("still completes on the canonical can't cells (wordsign + ' + t)", () => {
    const store = createTutorStore({ storage: promptStorage("can't top"), seed: 1 });
    chordMode(store);
    chordText(store, "can't top");
    expect(store.viewModel().promptsCompleted).toBe(2);
  });

  it('continues letter-by-letter after toggling modes mid-word', () => {
    const store = createTutorStore({ storage: promptStorage('still top'), seed: 1 });
    insert(store, 'st'); // typed via VoiceOver
    chordMode(store);
    chordCell(store, [2, 4]); // i
    const vm = store.viewModel();
    expect(vm.typed).toBe('sti');
    expect(vm.diverged).toBe(false);
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

  it('awards the crown for a minimum-cell chorded fox run', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    chordMode(store);
    chordText(store, FOX_SENTENCE); // canonical: exactly FOX_MIN_CELLS commits
    expect(store.viewModel().foxResult).toEqual({ kind: 'crown' });
  });

  it('awards a badge when a shortform is chorded uncontracted', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    chordMode(store);
    chordText(store, 'The '); // caps + the + space
    for (const d of [[1, 2, 3, 4, 5], [1, 3, 6], [2, 4], [1, 4], [1, 3]]) chordCell(store, d); // q u i c k
    chordText(store, ' brown fox jumps over the lazy dog.');
    // "quick" is a 2-cell shortform; spelling it out adds 3 cells -> 39 total.
    const cells = FOX_MIN_CELLS + 3;
    const result = store.viewModel().foxResult;
    expect(result?.kind).toBe('badge');
    if (result?.kind === 'badge') {
      expect(result.percentAbove).toBeCloseTo(((cells - FOX_MIN_CELLS) / FOX_MIN_CELLS) * 100, 6);
    }
  });

  it('awards a sign respelled differently after backspacing in a fox run', () => {
    const storage = foxReadyStorage();
    const store = createTutorStore({ storage, seed: 1 });
    chordMode(store);
    chordText(store, 'The ');
    chordCell(store, [1, 2, 3, 4, 5]); // q — awarded as letter-q
    chordCell(store, [1, 3, 6]); // u — awarded as letter-u
    keyDown(store, 'Backspace');
    keyDown(store, 'Backspace');
    chordCell(store, [1, 2, 3, 4, 5]); // ⠟
    chordCell(store, [1, 3]); // ⠅ — the "quick" shortform this time
    chordText(store, ' brown fox jumps over the lazy dog.');
    expect(store.viewModel().foxResult?.kind).toBe('badge');
    // The shortform occupies the print span the letters q/u were awarded at;
    // a positional dedup would swallow its award entirely.
    store.flushSave();
    const raw = JSON.parse(storage.data.get(STORAGE_KEY)!) as {
      tutor: { scores: Record<string, number> };
    };
    expect(raw.tutor.scores['shortform-quick']).toBe(10);
    expect(raw.tutor.scores['letter-q']).toBe(10);
  });

  it('accepts "The" spelled letter by letter, not reading ⠠⠞ as "That"', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    chordMode(store);
    chordCell(store, [6]); // capital indicator
    chordCell(store, [2, 3, 4, 5]); // t — standalone this would be "that", but the word is open
    expect(store.viewModel().foxResult).toBeNull();
    expect(store.viewModel().diverged).toBe(false);
    chordCell(store, [1, 2, 5]); // h
    chordCell(store, [1, 5]); // e
    chordText(store, ' quick brown fox jumps over the lazy dog.');
    // "The" is 2 cells contracted; t-h-e behind the capital adds 2 more.
    const cells = FOX_MIN_CELLS + 2;
    const result = store.viewModel().foxResult;
    expect(result?.kind).toBe('badge');
    if (result?.kind === 'badge') {
      expect(result.percentAbove).toBeCloseTo(((cells - FOX_MIN_CELLS) / FOX_MIN_CELLS) * 100, 6);
    }
  });

  it('credits the skills actually chorded, not the canonical solution', () => {
    const storage = foxReadyStorage();
    const store = createTutorStore({ storage, seed: 1 });
    chordMode(store);
    // The whole pangram in grade 1: capital indicator plus plain letters.
    for (const [i, word] of FOX_SENTENCE.split(' ').entries()) {
      if (i > 0) chordSpace(store);
      for (const ch of word) {
        const lower = ch.toLowerCase();
        if (ch !== lower) chordCell(store, [6]);
        chordCell(store, [...(textToCells(lower)[0] as readonly number[])]);
      }
    }
    expect(store.viewModel().foxResult?.kind).toBe('badge');

    store.flushSave();
    const saved = JSON.parse(storage.data.get(STORAGE_KEY)!) as {
      tutor: { scores: Record<string, number> };
    };
    const scores = saved.tutor.scores;
    // Spelling the pangram out exercises the whole alphabet...
    const letters = new Set(FOX_SENTENCE.toLowerCase().replace(/[^a-z]/g, ''));
    expect(letters.size).toBe(26);
    for (const c of letters) {
      expect(scores[`letter-${c}`] ?? 0).toBeGreaterThan(0);
    }
    // ...and none of the contractions of the hypothetical shortest solution.
    for (const id of ['contraction-the', 'shortform-quick', 'groupsign-ow', 'groupsign-ed', 'groupsign-er']) {
      expect(scores[id] ?? 0).toBe(0);
    }
  });

  it('does not decrement the fox cell count on backspace', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    chordMode(store);
    chordCell(store, [6]); // a stray capital-indicator cell
    keyDown(store, 'Backspace'); // removed, but the cell already counted
    chordText(store, FOX_SENTENCE);
    const cells = FOX_MIN_CELLS + 1;
    const result = store.viewModel().foxResult;
    expect(result?.kind).toBe('badge');
    if (result?.kind === 'badge') {
      expect(result.percentAbove).toBeCloseTo(((cells - FOX_MIN_CELLS) / FOX_MIN_CELLS) * 100, 6);
    }
  });

  it('fails a fox run instantly on a wrong chord', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    chordMode(store);
    chordCell(store, [1, 3, 5]); // ⠕ = "o", expected the capital "T"
    expect(store.viewModel().foxResult).toEqual({ kind: 'failed' });
  });

  it('shows both the sign that was due and the cell actually chorded', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    chordMode(store);
    chordCell(store, [1, 3, 5]); // ⠕ = "o", expected ⠠⠮ for "The"
    expect(store.viewModel().foxFailure).toEqual({
      expected: '⠠⠮',
      expectedPrint: 'The',
      typed: '⠕',
    });
  });

  it('blames only the chord that broke a run, not the cells before it', () => {
    const store = createTutorStore({ storage: foxReadyStorage(), seed: 1 });
    chordMode(store);
    chordText(store, 'The quick ');
    // Spell "brown" out: correct print, more cells, no failure yet.
    for (const d of [[1, 2], [1, 2, 3, 5], [1, 3, 5]]) chordCell(store, d); // b r o
    expect(store.viewModel().foxFailure).toBeNull();
    chordCell(store, [2, 3, 4, 5]); // ⠞ — "brot", diverged at last
    expect(store.viewModel().foxFailure).toEqual({
      expected: '⠪',
      expectedPrint: 'ow',
      typed: '⠞',
    });
  });
});
