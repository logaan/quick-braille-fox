import { describe, expect, it } from 'vitest';
import type { ChordAction, ChordState } from './chords';
import { EMPTY_CHORD_STATE, chordKeyDown, chordKeyUp, isChordCode } from './chords';

/** Press and release the given codes in order; return the resolved actions. */
function play(codes: Array<['down' | 'up', string]>): { state: ChordState; actions: ChordAction[] } {
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
});

describe('chord resolution', () => {
  it('resolves f+j+k to dots 1,4,5 regardless of press/release order', () => {
    const orders: Array<Array<['down' | 'up', string]>> = [
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
