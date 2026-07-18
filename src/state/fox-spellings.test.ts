// Every valid way of chording the fox sentence — grade 1 (letter by letter),
// grade 2 (fully contracted), and every mixture in between — must be accepted:
// no chord along the way may fail the run, the finished run must score by
// cell count alone (crown at the minimum, badge above it), and the skills
// credited must be exactly the signs actually chorded — never the canonical
// solution's contractions.
//
// The renderings are enumerated from the skills data itself, mirroring
// translate()'s legality rules (braille.ts allowedInWord), so a new
// contraction in the data automatically widens this suite; the per-word
// variant counts below are asserted to keep the enumeration honest.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent } from 'react';
import type { Cell } from '../core';
import {
  FOX_AWARD,
  FOX_INTERVAL,
  FOX_MIN_CELLS,
  FOX_SENTENCE,
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
  const codes = dots.map((d) => DOT_CODE[d]!);
  for (const c of codes) store.handlers.onDrillKeyDown(keyEvent(c));
  for (const c of codes) store.handlers.onDrillKeyUp(keyEvent(c));
}

function chordSpace(store: TutorStore): void {
  store.handlers.onDrillKeyDown(keyEvent('Space'));
  store.handlers.onDrillKeyUp(keyEvent('Space'));
}

function chordMode(store: TutorStore): void {
  store.handlers.onInputModeSelect('emulated');
}

// --- rendering enumeration ---------------------------------------------------
//
// Rebuilt from the skills data with the same legality rules as braille.ts,
// but exhaustively instead of greedily: at every position, every applicable
// sign AND the plain letter are both taken, yielding every legal tiling.
// Each variant carries the ids of the skills its signs exercise, so the runs
// below can assert the challenge credited exactly what was chorded.

const STANDALONE_LOWER = new Set(['be', 'enough', 'his', 'in', 'was', 'were']);
const INTERIOR_LOWER = new Set(['ea', 'bb', 'cc', 'ff', 'gg']);
const BEGWORD_LOWER = new Set(['be', 'con', 'dis']);
const ANYWHERE_LOWER = new Set(['en', 'in']);
const CAP: Cell = [6];
const CAP_ID = 'capital-letter-indicator';

const charSkills = new Map<string, Skill>(); // letters + punctuation
const wholeWordSkills = new Map<string, Skill>();
const inWordSigns: Skill[] = [];

for (const skill of skills) {
  switch (skill.kind) {
    case 'letter':
    case 'punctuation':
      charSkills.set(skill.print, skill);
      break;
    case 'wordsign':
    case 'shortform':
      wholeWordSkills.set(skill.print, skill);
      break;
    case 'contraction':
    case 'initial-letter':
      wholeWordSkills.set(skill.print, skill);
      inWordSigns.push(skill);
      break;
    case 'groupsign':
    case 'final-letter':
      inWordSigns.push(skill);
      break;
    case 'lowersign':
      if (STANDALONE_LOWER.has(skill.print)) wholeWordSkills.set(skill.print, skill);
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

/** One legal rendering of a word: its cells and the skill ids they exercise. */
interface Variant {
  readonly cells: readonly Cell[];
  readonly ids: readonly string[];
}

function joinVariants(head: Variant, tail: Variant): Variant {
  return { cells: [...head.cells, ...tail.cells], ids: [...head.ids, ...tail.ids] };
}

/** Capital indicators for the uppercase chars in a span, as translate() emits. */
function capsFor(original: string, start: number, end: number): Variant {
  const caps: Cell[] = [];
  const ids: string[] = [];
  for (let j = start; j < end; j += 1) {
    if (original[j] !== original[j]?.toLowerCase()) {
      caps.push(CAP);
      ids.push(CAP_ID);
    }
  }
  return { cells: caps, ids };
}

/** Every legal in-word tiling of `original` (letters and permitted signs). */
function tilings(original: string): Variant[] {
  const lower = original.toLowerCase();
  const len = lower.length;
  const memo = new Map<number, Variant[]>();
  const from = (i: number): Variant[] => {
    if (i === len) return [{ cells: [], ids: [] }];
    const hit = memo.get(i);
    if (hit !== undefined) return hit;
    const results: Variant[] = [];
    for (const sign of inWordSigns) {
      const end = i + sign.print.length;
      if (lower.startsWith(sign.print, i) && allowedInWord(sign, i, end, len)) {
        const head = joinVariants(capsFor(original, i, end), {
          cells: sign.dots,
          ids: [sign.id],
        });
        for (const tail of from(end)) results.push(joinVariants(head, tail));
      }
    }
    const letter = charSkills.get(lower[i]!);
    if (letter !== undefined) {
      const head = joinVariants(capsFor(original, i, i + 1), {
        cells: letter.dots,
        ids: [letter.id],
      });
      for (const tail of from(i + 1)) results.push(joinVariants(head, tail));
    }
    memo.set(i, results);
    return results;
  };
  return from(0);
}

/** Every legal rendering of one space-delimited word (may carry punctuation). */
function wordRenderings(word: string): Variant[] {
  const alpha = ((/^[a-zA-Z]+/.exec(word)) ?? [''])[0];
  const punct = word.slice(alpha.length);
  const punctVariant: Variant = [...punct].reduce<Variant>(
    (acc, ch) => {
      const skill = charSkills.get(ch);
      if (skill === undefined) throw new Error(`unrenderable punctuation: ${JSON.stringify(ch)}`);
      return joinVariants(acc, { cells: skill.dots, ids: [skill.id] });
    },
    { cells: [], ids: [] },
  );

  const variants: Variant[] = tilings(alpha).map((t) => joinVariants(t, punctVariant));
  // Whole-word standalone sign, lowercase or Title-case (only for words with
  // no trailing punctuation: the decoder reads standalone signs against the
  // whole word group).
  const whole = wholeWordSkills.get(alpha.toLowerCase());
  if (whole !== undefined && punct === '') {
    const lower = alpha.toLowerCase();
    if (alpha === lower) variants.push({ cells: whole.dots, ids: [whole.id] });
    else if (alpha === (alpha[0]!).toUpperCase() + lower.slice(1)) {
      variants.push({ cells: [CAP, ...whole.dots], ids: [CAP_ID, whole.id] });
    }
  }

  // Dedupe (a whole-word contraction also appears as a one-sign tiling).
  const seen = new Set<string>();
  return variants.filter((v) => {
    const key = v.cells.map((c) => c.join('')).join('-');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const words = FOX_SENTENCE.split(' ');
const perWord = words.map(wordRenderings);

/** Cross product of per-word variants -> every full-sentence rendering. */
function crossProduct(lists: readonly Variant[][]): Variant[][] {
  let combos: Variant[][] = [[]];
  for (const list of lists) {
    combos = combos.flatMap((combo) => list.map((variant) => [...combo, variant]));
  }
  return combos;
}

const sentences = crossProduct(perWord);

/** Every skill id any rendering of any word can exercise. */
const idUniverse = new Set<string>(
  perWord.flatMap((variants) => variants.flatMap((v) => [...v.ids])),
);

interface Case {
  readonly label: string;
  readonly rendering: readonly Variant[];
  readonly cellsTyped: number;
  /** skill id -> times chorded across the sentence. */
  readonly expectedCounts: ReadonlyMap<string, number>;
}

const cases: Case[] = sentences.map((rendering) => {
  const cells = rendering.reduce((n, word) => n + word.cells.length, 0) + (rendering.length - 1);
  const expectedCounts = new Map<string, number>();
  for (const word of rendering) {
    for (const id of word.ids) expectedCounts.set(id, (expectedCounts.get(id) ?? 0) + 1);
  }
  return {
    label: `${rendering.map((word) => dotsToUnicode(word.cells)).join(' ')} (${cells} cells)`,
    rendering,
    cellsTyped: cells,
    expectedCounts,
  };
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fox accepts every grade-1/grade-2 spelling', () => {
  it('enumerates the expected variants per word', () => {
    // The/the render three ways (⠮, ⠹e, the); quick/brown/over each have one
    // optional contraction; fox, jumps, lazy and "dog." have none.
    // 3 * 2 * 2 * 1 * 1 * 2 * 3 * 1 * 1 = 72 sentences.
    expect(words).toEqual(['The', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog.']);
    expect(perWord.map((v) => v.length)).toEqual([3, 2, 2, 1, 1, 2, 3, 1, 1]);
    expect(sentences).toHaveLength(72);
    // The fully-contracted rendering is among them, at the known minimum.
    expect(cases.some((c) => c.cellsTyped === FOX_MIN_CELLS)).toBe(true);
  });

  it.each(cases)('$label', ({ rendering, cellsTyped, expectedCounts }) => {
    const storage = foxReadyStorage();
    const store = createTutorStore({ storage, seed: 1 });
    chordMode(store);
    expect(store.viewModel().isFox).toBe(true);

    let chords = 0;
    for (let w = 0; w < rendering.length; w += 1) {
      if (w > 0) {
        chordSpace(store);
        chords += 1;
      }
      for (const cell of (rendering[w]!).cells) {
        chordCell(store, cell);
        chords += 1;
        if (chords < cellsTyped) {
          // Mid-run: no chord of a valid spelling may register as a mistake.
          const vm = store.viewModel();
          expect(vm.foxResult).toBeNull();
          expect(vm.diverged).toBe(false);
        }
      }
    }

    const result = store.viewModel().foxResult;
    expect(result).not.toBeNull();
    expect(result?.kind).not.toBe('failed');
    if (cellsTyped === FOX_MIN_CELLS) {
      expect(result).toEqual({ kind: 'crown' });
    } else {
      expect(result?.kind).toBe('badge');
      if (result?.kind === 'badge') {
        expect(result.percentAbove).toBeCloseTo(
          ((cellsTyped - FOX_MIN_CELLS) / FOX_MIN_CELLS) * 100,
          6,
        );
      }
    }

    // The run must credit exactly the signs chorded: FOX_AWARD per occurrence
    // for each skill used, nothing for any skill of any unused rendering.
    store.flushSave();
    const saved = JSON.parse(storage.data.get(STORAGE_KEY)!) as {
      tutor: { scores: Record<string, number> };
    };
    const scores = saved.tutor.scores;
    for (const [id, count] of expectedCounts) {
      expect(scores[id] ?? 0, id).toBe(FOX_AWARD * count);
    }
    for (const id of idUniverse) {
      if (!expectedCounts.has(id)) expect(scores[id] ?? 0, id).toBe(0);
    }
  });
});
