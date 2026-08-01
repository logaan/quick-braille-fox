import { describe, expect, it } from 'vitest';
import type { ChordAction, ChordState } from './chords';
import { EMPTY_CHORD_STATE, chordKeyDown, chordKeyUp, isChordCode } from './chords';

/** Press and release the given codes in order; return the resolved actions. */
function play(codes: ['down' | 'up', string][]): { state: ChordState; actions: ChordAction[] } {
  let state = EMPTY_CHORD_STATE;
  const actions: ChordAction[] = [];
  for (const [kind, code] of codes) {
    if (kind === 'down') {
      state = chordKeyDown(state, code);
    } else {
      const r = chordKeyUp(state, code);
      state = r.state;
      if (r.action.kind !== 'none') actions.push(r.action);
    }
  }
  return { state, actions };
}

describe('isChordCode', () => {
  it('recognises the eight dot keys and space', () => {
    for (const code of ['KeyF', 'KeyD', 'KeyS', 'KeyA', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Space']) {
      expect(isChordCode(code)).toBe(true);
    }
    expect(isChordCode('KeyG')).toBe(false);
    expect(isChordCode('Enter')).toBe(false);
  });

  it('recognises the top-row dot keys', () => {
    for (const code of ['KeyR', 'KeyE', 'KeyW', 'KeyQ', 'KeyU', 'KeyI', 'KeyO', 'KeyP']) {
      expect(isChordCode(code)).toBe(true);
    }
    expect(isChordCode('KeyT')).toBe(false);
    expect(isChordCode('KeyY')).toBe(false);
  });
});

describe('chord resolution', () => {
  it('resolves f+j+k to dots 1,4,5 regardless of press/release order', () => {
    const orders: ['down' | 'up', string][][] = [
      [['down', 'KeyF'], ['down', 'KeyJ'], ['down', 'KeyK'], ['up', 'KeyF'], ['up', 'KeyJ'], ['up', 'KeyK']],
      [['down', 'KeyK'], ['down', 'KeyF'], ['down', 'KeyJ'], ['up', 'KeyJ'], ['up', 'KeyK'], ['up', 'KeyF']],
    ];
    for (const order of orders) {
      const { actions } = play(order);
      expect(actions).toEqual([{ kind: 'cell', cell: [1, 4, 5] }]);
    }
  });

  it('accumulates keys until all are released', () => {
    // Press f+j, release j, press k, release all -> one cell 1,4,5.
    const { actions } = play([
      ['down', 'KeyF'], ['down', 'KeyJ'], ['up', 'KeyJ'], ['down', 'KeyK'], ['up', 'KeyF'], ['up', 'KeyK'],
    ]);
    expect(actions).toEqual([{ kind: 'cell', cell: [1, 4, 5] }]);
  });

  it('commits a space for the space key alone', () => {
    const { actions } = play([['down', 'Space'], ['up', 'Space']]);
    expect(actions).toEqual([{ kind: 'space' }]);
  });

  it('discards a chord mixing space with dots', () => {
    const { actions } = play([['down', 'Space'], ['down', 'KeyF'], ['up', 'Space'], ['up', 'KeyF']]);
    expect(actions).toEqual([]);
  });

  it('discards a chord containing dot 7 or 8', () => {
    const withSeven = play([['down', 'KeyF'], ['down', 'KeyA'], ['up', 'KeyF'], ['up', 'KeyA']]);
    expect(withSeven.actions).toEqual([]);
    const withEight = play([['down', 'KeyL'], ['down', 'Semicolon'], ['up', 'KeyL'], ['up', 'Semicolon']]);
    expect(withEight.actions).toEqual([]);
  });

  it('ignores unmapped keys and repeated keydowns', () => {
    const { actions } = play([
      ['down', 'KeyF'], ['down', 'KeyG'], ['down', 'KeyF'], ['up', 'KeyF'],
    ]);
    expect(actions).toEqual([{ kind: 'cell', cell: [1] }]);
  });

  it('resolves top-row chords to the same dots as the home row', () => {
    const { actions } = play([
      ['down', 'KeyR'], ['down', 'KeyU'], ['down', 'KeyI'], ['up', 'KeyR'], ['up', 'KeyU'], ['up', 'KeyI'],
    ]);
    expect(actions).toEqual([{ kind: 'cell', cell: [1, 4, 5] }]);
  });

  it('lets the two rows mix within one chord', () => {
    // f (dot 1, home row) + i (dot 5, top row) -> dots 1,5.
    const { actions } = play([
      ['down', 'KeyF'], ['down', 'KeyI'], ['up', 'KeyF'], ['up', 'KeyI'],
    ]);
    expect(actions).toEqual([{ kind: 'cell', cell: [1, 5] }]);
  });

  it('counts a dot once when both rows press it', () => {
    // f and r are both dot 1: the cell is [1], not [1, 1].
    const { actions } = play([
      ['down', 'KeyF'], ['down', 'KeyR'], ['up', 'KeyF'], ['up', 'KeyR'],
    ]);
    expect(actions).toEqual([{ kind: 'cell', cell: [1] }]);
  });

  it('discards a chord containing a top-row dot 7 or 8', () => {
    const withSeven = play([['down', 'KeyR'], ['down', 'KeyQ'], ['up', 'KeyR'], ['up', 'KeyQ']]);
    expect(withSeven.actions).toEqual([]);
    const withEight = play([['down', 'KeyO'], ['down', 'KeyP'], ['up', 'KeyO'], ['up', 'KeyP']]);
    expect(withEight.actions).toEqual([]);
  });

  it('yields no action for a keyup with no matching keydown', () => {
    const r = chordKeyUp(EMPTY_CHORD_STATE, 'KeyF');
    expect(r.action).toEqual({ kind: 'none' });
    expect(r.state).toEqual(EMPTY_CHORD_STATE);
  });

  it('resets the accumulator between chords', () => {
    const { actions } = play([
      ['down', 'KeyF'], ['up', 'KeyF'], // dot 1
      ['down', 'KeyD'], ['up', 'KeyD'], // dot 2, not 1+2
    ]);
    expect(actions).toEqual([{ kind: 'cell', cell: [1] }, { kind: 'cell', cell: [2] }]);
  });
});
