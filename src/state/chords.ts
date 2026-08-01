// Pure braille-chord state machine (no DOM): tracks which home-row keys are
// held and resolves a chord to a braille cell when all keys are released — the
// standard Perkins-keyboard convention. The store wires DOM keydown/keyup
// events to these functions; keeping them pure keeps the chord logic testable
// without a browser.
//
// Keys are identified by KeyboardEvent.code (physical position), so the layout
// survives non-QWERTY OS keymaps: f d s a j k l ; -> dots 1 2 3 7 4 5 6 8.
// The row above (r e w q u i o p) carries the same dots, both rows live at
// once, for keyboards where holding a home-row key means something else
// (ZMK home-row mods). Deliberately undocumented in the UI.
// Dots 7 and 8 are outside the 6-dot curriculum, so a chord containing either
// is silently discarded rather than registering a stray mistake.

import type { Cell } from '../core';

/** KeyboardEvent.code -> braille dot number. */
export const CHORD_DOT_CODES: ReadonlyMap<string, number> = new Map([
  ['KeyF', 1],
  ['KeyD', 2],
  ['KeyS', 3],
  ['KeyA', 7],
  ['KeyJ', 4],
  ['KeyK', 5],
  ['KeyL', 6],
  ['Semicolon', 8],
  // Top row, same finger-to-dot assignment one row up.
  ['KeyR', 1],
  ['KeyE', 2],
  ['KeyW', 3],
  ['KeyQ', 7],
  ['KeyU', 4],
  ['KeyI', 5],
  ['KeyO', 6],
  ['KeyP', 8],
]);

/** The key that commits a space (a blank cell). */
export const CHORD_SPACE_CODE = 'Space';

export interface ChordState {
  /** Codes currently held down. */
  readonly held: ReadonlySet<string>;
  /** Every chord code seen since the current chord began. */
  readonly accumulated: ReadonlySet<string>;
}

export const EMPTY_CHORD_STATE: ChordState = { held: new Set(), accumulated: new Set() };

export type ChordAction =
  | { readonly kind: 'cell'; readonly cell: Cell }
  | { readonly kind: 'space' }
  | { readonly kind: 'none' };

/** Does `code` participate in chording (a dot key or the space key)? */
export function isChordCode(code: string): boolean {
  return code === CHORD_SPACE_CODE || CHORD_DOT_CODES.has(code);
}

/** Press a key. Unmapped or already-held keys are no-ops. */
export function chordKeyDown(state: ChordState, code: string): ChordState {
  if (!isChordCode(code) || state.held.has(code)) return state;
  const held = new Set(state.held);
  held.add(code);
  const accumulated = new Set(state.accumulated);
  accumulated.add(code);
  return { held, accumulated };
}

/**
 * Release a key. When the last held key comes up, the accumulated keys resolve
 * to a chord action and the accumulator resets. Releasing a key that was not
 * held (e.g. after a focus-loss reset) yields no action.
 */
export function chordKeyUp(state: ChordState, code: string): { state: ChordState; action: ChordAction } {
  if (!state.held.has(code)) return { state, action: { kind: 'none' } };
  const held = new Set(state.held);
  held.delete(code);
  if (held.size > 0) {
    return { state: { held, accumulated: state.accumulated }, action: { kind: 'none' } };
  }
  // Last key up: resolve the accumulated chord.
  const action = resolveChord(state.accumulated);
  return { state: { held, accumulated: new Set() }, action };
}

function resolveChord(codes: ReadonlySet<string>): ChordAction {
  if (codes.size === 0) return { kind: 'none' };
  const hasSpace = codes.has(CHORD_SPACE_CODE);
  // A Set, because both key rows carry the same dots: F+R is dot 1, once.
  const dotSet = new Set<number>();
  let hasOutOfRange = false;
  for (const code of codes) {
    if (code === CHORD_SPACE_CODE) continue;
    const dot = CHORD_DOT_CODES.get(code);
    if (dot === undefined) continue;
    if (dot > 6) hasOutOfRange = true;
    else dotSet.add(dot);
  }
  const dots = [...dotSet];
  // Space alone is a blank cell; space mixed with dots is ambiguous -> discard.
  if (hasSpace) return dots.length === 0 && !hasOutOfRange ? { kind: 'space' } : { kind: 'none' };
  // Any dot 7/8 (outside the 6-dot curriculum) discards the whole chord.
  if (hasOutOfRange || dots.length === 0) return { kind: 'none' };
  dots.sort((a, b) => a - b);
  return { kind: 'cell', cell: dots };
}
