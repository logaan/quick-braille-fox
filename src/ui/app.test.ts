// Render-path smoke tests: the full App renders from real store view-models
// (fresh session, hint showing, qbf challenge, qbf result) without throwing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement as e } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QBF_SENTENCE, makePrompt, makeTutorState, serialize } from '../core';
import type { AppHandlers, StorageLike, TutorStore } from '../state';
import { STORAGE_KEY, createTutorStore } from '../state';
import { App } from './index';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function render(store: TutorStore): string {
  return renderToStaticMarkup(e(App, { vm: store.viewModel(), on: store.handlers }));
}

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function qbfReadyStore(): TutorStore {
  const storage = memoryStorage();
  const state = makeTutorState({
    seed: 7,
    promptCounter: 99,
    prompt: makePrompt({ text: 'done', typed: 'done', completed: true }),
  });
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null }),
  );
  return createTutorStore({ storage, seed: 1 });
}

function type(store: TutorStore, value: string): void {
  (store.handlers as AppHandlers).onInput({
    currentTarget: { value },
    nativeEvent: { inputType: 'insertText' },
  } as unknown as Parameters<AppHandlers['onInput']>[0]);
}

describe('App rendering', () => {
  it('renders the fresh-session drill view', () => {
    const store = createTutorStore({ seed: 1 });
    const html = render(store);
    expect(html).toContain('⠟'); // brand cell
    expect(html).toContain('aria-label="qbf"');
    expect(html).toContain('id="drill-input"');
    expect(html).toContain('Learning now');
    expect(html).toContain('of 258 skills learnt');
  });

  it('renders the hint as braille cells once the timer fires', () => {
    const store = createTutorStore({ seed: 1 });
    vi.advanceTimersByTime(400);
    const vm = store.viewModel();
    expect(vm.hint).not.toBeNull();
    const html = render(store);
    const firstHintCell = [...(vm.hint ?? '')][0] ?? '';
    expect(html).toContain(firstHintCell);
  });

  it('shows the actually-typed character where typing diverged', () => {
    const store = createTutorStore({ seed: 1 });
    const text = store.viewModel().promptText;
    const wrong = text.startsWith('z') ? 'q' : 'z';
    type(store, wrong);
    const html = render(store);
    expect(html).toContain(`class="char-wrong">${wrong}</span>`);
    expect(html).not.toContain(`class="char-wrong">${text[0] ?? ''}</span>`);
  });

  it('renders the input-mode switch, checked by default', () => {
    const store = createTutorStore({ seed: 1 });
    const html = render(store);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('VoiceOver input');
  });

  it('unchecks the switch after toggling, keeping the drill input mounted', () => {
    const store = createTutorStore({ seed: 1 });
    store.handlers.onInputModeToggle();
    const html = render(store);
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('id="drill-input"');
  });

  it('renders the qbf challenge and its result screen', () => {
    const store = qbfReadyStore();
    let html = render(store);
    expect(html).toContain('qbf challenge');
    expect(html).toContain(QBF_SENTENCE.slice(0, 9));
    expect(html).not.toContain('hint-area');

    type(store, 'X'); // instant fail
    html = render(store);
    expect(html).toContain('Run failed');
    expect(html).toContain('Continue');
    expect(html).not.toContain('id="drill-input"');
  });
});
