// Every valid way of chording the qbf sentence — grade 1 (letter by letter),
// grade 2 (fully contracted), and every mixture in between — must be accepted:
// no chord along the way may fail the run, and the finished run must score by
// cell count alone (crown at the minimum, badge above it).
//
// The renderings are enumerated from the skills data itself, mirroring
// translate()'s legality rules (braille.ts allowedInWord), so a new
// contraction in the data automatically widens this suite; the per-word
// variant counts below are asserted to keep the enumeration honest.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent } from 'react';
import type { Cell } from '../core';
import {
  QBF_INTERVAL,
  QBF_MIN_CELLS,
  QBF_SENTENCE,
  dotsToUnicode,
  makePrompt,
  makeTutorState,
  serialize,
} from '../core';
import type { Skill } from '../data/skills';
import { skills } from '../data/skills';
import type { StorageLike, TutorStore } from './index';
import { STORAGE_KEY, createTutorStore } from './index';

// --- store harness (mirrors store.test.ts chord helpers) --------------------

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

/** Storage whose saved session lands the next prompt on the qbf challenge. */
function qbfReadyStorage(): MemoryStorage {
  const storage = memoryStorage();
  const state = makeTutorState({
    seed: 7,
    promptCounter: QBF_INTERVAL,
    prompt: makePrompt({ text: 'done', typed: 'done', completed: true }),
  });
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, tutor: serialize(state), bestQbf: null }),
  );
  return storage;
}

const DOT_CODE: Record<number, string> = { 1: 'KeyF', 2: 'KeyD', 3: 'KeyS', 4: 'KeyJ', 5: 'KeyK', 6: 'KeyL' };

function keyEvent(code: string): KeyboardEvent<HTMLInputElement> {
  return {
    code,
    key: '',
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: () => {},
  } as unknown as KeyboardEvent<HTMLInputElement>;
}

function chordCell(store: TutorStore, dots: Cell): void {
  const codes = dots.map((d) => DOT_CODE[d] as string);
  for (const c of codes) store.handlers.onDrillKeyDown(keyEvent(c));
  for (const c of codes) store.handlers.onDrillKeyUp(keyEvent(c));
}

function chordSpace(store: TutorStore): void {
  store.handlers.onDrillKeyDown(keyEvent('Space'));
  store.handlers.onDrillKeyUp(keyEvent('Space'));
}

function chordMode(store: TutorStore): void {
  if (store.viewModel().voiceOverInput) store.handlers.onInputModeToggle();
}

// --- rendering enumeration ---------------------------------------------------
//
// Rebuilt from the skills data with the same legality rules as braille.ts,
// but exhaustively instead of greedily: at every position, every applicable
// sign AND the plain letter are both taken, yielding every legal tiling.

const STANDALONE_LOWER = new Set(['be', 'enough', 'his', 'in', 'was', 'were']);
const INTERIOR_LOWER = new Set(['ea', 'bb', 'cc', 'ff', 'gg']);
const BEGWORD_LOWER = new Set(['be', 'con', 'dis']);
const ANYWHERE_LOWER = new Set(['en', 'in']);
const CAP: Cell = [6];

const charCells = new Map<string, ReadonlyArray<Cell>>(); // letters + punctuation
const wholeWordCells = new Map<string, ReadonlyArray<Cell>>();
const inWordSigns: Skill[] = [];

for (const skill of skills) {
  switch (skill.kind) {
    case 'letter':
    case 'punctuation':
      charCells.set(skill.print, skill.dots);
      break;
    case 'wordsign':
    case 'shortform':
      wholeWordCells.set(skill.print, skill.dots);
      break;
    case 'contraction':
    case 'initial-letter':
      wholeWordCells.set(skill.print, skill.dots);
      inWordSigns.push(skill);
      break;
    case 'groupsign':
    case 'final-letter':
      inWordSigns.push(skill);
      break;
    case 'lowersign':
      if (STANDALONE_LOWER.has(skill.print)) wholeWordCells.set(skill.print, skill.dots);
      if (
        INTERIOR_LOWER.has(skill.print) ||
        BEGWORD_LOWER.has(skill.print) ||
        ANYWHERE_LOWER.has(skill.print)
      ) {
        inWordSigns.push(skill);
      }
      break;
  }
}

/** braille.ts allowedInWord, restated for the enumerator. */
function allowedInWord(skill: Skill, start: number, end: number, len: number): boolean {
  switch (skill.kind) {
    case 'contraction':
    case 'initial-letter':
      return true;
    case 'groupsign':
      return skill.print === 'ing' ? start > 0 : true;
    case 'final-letter':
      return start > 0;
    case 'lowersign':
      if (INTERIOR_LOWER.has(skill.print)) return start > 0 && end < len;
      if (BEGWORD_LOWER.has(skill.print)) return start === 0 && end < len && len - end >= 3;
      return ANYWHERE_LOWER.has(skill.print);
    default:
      return false;
  }
}

/** One capital indicator per uppercase char in the span, as translate() emits. */
function capsFor(original: string, start: number, end: number): Cell[] {
  const caps: Cell[] = [];
  for (let j = start; j < end; j += 1) {
    if (original[j] !== original[j]?.toLowerCase()) caps.push(CAP);
  }
  return caps;
}

/** Every legal in-word tiling of `original` (letters and permitted signs). */
function tilings(original: string): Cell[][] {
  const lower = original.toLowerCase();
  const len = lower.length;
  const memo = new Map<number, Cell[][]>();
  const from = (i: number): Cell[][] => {
    if (i === len) return [[]];
    const hit = memo.get(i);
    if (hit !== undefined) return hit;
    const results: Cell[][] = [];
    for (const sign of inWordSigns) {
      const end = i + sign.print.length;
      if (lower.startsWith(sign.print, i) && allowedInWord(sign, i, end, len)) {
        const head = [...capsFor(original, i, end), ...sign.dots];
        for (const tail of from(end)) results.push([...head, ...tail]);
      }
    }
    const letter = charCells.get(lower[i] as string);
    if (letter !== undefined) {
      const head = [...capsFor(original, i, i + 1), ...letter];
      for (const tail of from(i + 1)) results.push([...head, ...tail]);
    }
    memo.set(i, results);
    return results;
  };
  return from(0);
}

/** Every legal rendering of one space-delimited word (may carry punctuation). */
function wordRenderings(word: string): Cell[][] {
  const alpha = (word.match(/^[a-zA-Z]+/) ?? [''])[0];
  const punct = word.slice(alpha.length);
  const punctCells: Cell[] = [...punct].flatMap((ch) => {
    const cells = charCells.get(ch);
    if (cells === undefined) throw new Error(`unrenderable punctuation: ${JSON.stringify(ch)}`);
    return [...cells];
  });

  const variants: Cell[][] = tilings(alpha).map((t) => [...t, ...punctCells]);
  // Whole-word standalone sign, lowercase or Title-case (only for words with
  // no trailing punctuation: the decoder reads standalone signs against the
  // whole word group).
  const whole = wholeWordCells.get(alpha.toLowerCase());
  if (whole !== undefined && punct === '') {
    const lower = alpha.toLowerCase();
    if (alpha === lower) variants.push([...whole]);
    else if (alpha === (alpha[0] as string).toUpperCase() + lower.slice(1)) {
      variants.push([CAP, ...whole]);
    }
  }

  // Dedupe (a whole-word contraction also appears as a one-sign tiling).
  const seen = new Set<string>();
  return variants.filter((cells) => {
    const key = cells.map((c) => c.join('')).join('-');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const words = QBF_SENTENCE.split(' ');
const perWord = words.map(wordRenderings);

/** Cross product of per-word variants -> every full-sentence rendering. */
function crossProduct(lists: ReadonlyArray<Cell[][]>): Cell[][][] {
  let combos: Cell[][][] = [[]];
  for (const list of lists) {
    combos = combos.flatMap((combo) => list.map((variant) => [...combo, variant]));
  }
  return combos;
}

const sentences = crossProduct(perWord);

interface Case {
  readonly label: string;
  readonly rendering: ReadonlyArray<Cell[]>;
  readonly cellsTyped: number;
}

const cases: Case[] = sentences.map((rendering) => {
  const cells = rendering.reduce((n, word) => n + word.length, 0) + (rendering.length - 1);
  return {
    label: `${rendering.map((word) => dotsToUnicode(word)).join(' ')} (${cells} cells)`,
    rendering,
    cellsTyped: cells,
  };
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('qbf accepts every grade-1/grade-2 spelling', () => {
  it('enumerates the expected variants per word', () => {
    // The/the render three ways (⠮, ⠹e, the); quick/brown/jumped/over each
    // have one optional contraction; fox, lazy and "dog." have none.
    // 3 * 2 * 2 * 1 * 2 * 2 * 3 * 1 * 1 = 144 sentences.
    expect(words).toEqual(['The', 'quick', 'brown', 'fox', 'jumped', 'over', 'the', 'lazy', 'dog.']);
    expect(perWord.map((v) => v.length)).toEqual([3, 2, 2, 1, 2, 2, 3, 1, 1]);
    expect(sentences).toHaveLength(144);
    // The fully-contracted rendering is among them, at the known minimum.
    expect(cases.some((c) => c.cellsTyped === QBF_MIN_CELLS)).toBe(true);
  });

  it.each(cases)('$label', ({ rendering, cellsTyped }) => {
    const store = createTutorStore({ storage: qbfReadyStorage(), seed: 1 });
    chordMode(store);
    expect(store.viewModel().isQbf).toBe(true);

    let chords = 0;
    for (let w = 0; w < rendering.length; w += 1) {
      if (w > 0) {
        chordSpace(store);
        chords += 1;
      }
      for (const cell of rendering[w] as Cell[]) {
        chordCell(store, cell);
        chords += 1;
        if (chords < cellsTyped) {
          // Mid-run: no chord of a valid spelling may register as a mistake.
          const vm = store.viewModel();
          expect(vm.qbfResult).toBeNull();
          expect(vm.diverged).toBe(false);
        }
      }
    }

    const result = store.viewModel().qbfResult;
    expect(result).not.toBeNull();
    expect(result?.kind).not.toBe('failed');
    if (cellsTyped === QBF_MIN_CELLS) {
      expect(result).toEqual({ kind: 'crown' });
    } else {
      expect(result?.kind).toBe('badge');
      if (result?.kind === 'badge') {
        expect(result.percentAbove).toBeCloseTo(
          ((cellsTyped - QBF_MIN_CELLS) / QBF_MIN_CELLS) * 100,
          6,
        );
      }
    }
  });
});
