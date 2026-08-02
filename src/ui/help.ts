// The page-foot help section: reference material a learner needs once and
// then never again. Chording is a small, sticky skill — you look the keys up
// on your first session and are an expert by your third — so the key map is
// not drill furniture; it is a collapsed disclosure below the fold, out of
// the way of everything the round itself needs.
//
// The text is still wired to the drill input via aria-describedby (see
// drill.ts): a description referenced by id is exposed even when the
// referenced element is hidden, so a screen reader user hears the key map at
// the field without the sighted layout paying for it.

import { createElement as e, type ReactElement } from 'react';
import type { InputMode } from '../state';

/** The id drill.ts points `aria-describedby` at while chord mode is on. */
export const CHORD_HELP_ID = 'chord-help';

export const CHORD_HELP_TEXT =
  'F D S = dots 1 2 3 · J K L = dots 4 5 6 · ' +
  'Space = space · Backspace deletes a cell';

/**
 * Help for the current input mode, collapsed behind a disclosure. Only chord
 * mode has keys to explain — VoiceOver mode's typing is the OS's business —
 * so in VoiceOver mode there is nothing to show and the section renders
 * nothing at all.
 */
export function HelpSection(props: { readonly inputMode: InputMode }): ReactElement | null {
  if (props.inputMode !== 'emulated') return null;
  return e(
    'details',
    { className: 'help' },
    e('summary', null, 'Chording keys'),
    e('p', { className: 'help-body', id: CHORD_HELP_ID }, CHORD_HELP_TEXT),
  );
}
