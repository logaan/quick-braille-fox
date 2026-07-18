// App header: the "fox" brand as three braille cells, the best fox result,
// and the reset-progress control (with its confirm step).

import {
  createElement as e,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { AppHandlers, BestFox, InputMode } from '../state';
import { INPUT_MODE_LABELS, RESET_CONFIRM_WORD } from '../state';
import { formatPercent } from './labels';

export interface HeaderProps {
  readonly bestFox: BestFox | null;
  readonly confirmingReset: boolean;
  readonly resetConfirmText: string;
  readonly canConfirmReset: boolean;
  readonly inputMode: InputMode;
  readonly on: AppHandlers;
}

/**
 * The logo: "Quick braille fox" as a 3×3 grid of braille cells, one word per
 * row — ⠠⠟⠅ (capital sign + the shortform "qk"), ⠃⠗⠇ (the shortform "brl"),
 * and ⠋⠕⠭ ("fox" in full).
 */
const BRAND_ROWS = [
  ['⠠', '⠟', '⠅'],
  ['⠃', '⠗', '⠇'],
  ['⠋', '⠕', '⠭'],
];

function BestFoxBadge(props: { readonly best: BestFox }): ReactElement {
  const { best } = props;
  return e(
    'span',
    { className: 'best-fox' },
    'best fox ',
    best.kind === 'crown'
      ? e(
          'span',
          { className: 'best-crown', role: 'img', 'aria-label': 'crown — perfect minimum-cell run' },
          '👑',
        )
      : e('span', { className: 'best-badge' }, `+${formatPercent(best.percentAbove)}%`),
  );
}

/**
 * What a screen reader appends to each option's name — the modes are
 * otherwise a mystery, especially Emulated, where the drill starts
 * swallowing every printable key except the (undocumented) home-row chord
 * keys.
 */
const MODE_DESCRIPTIONS: Record<InputMode, string> = {
  emulated:
    ' — type braille chords on the home row: F D S for dots 1 2 3, J K L for dots 4 5 6',
  voiceover: ' — VoiceOver braille screen input; the OS commits whole words',
};

/**
 * Pick the input mode: Emulated (braille chords on the QWERTY home row,
 * f d s a j k l ;) or VoiceOver (braille screen input, where the OS commits
 * whole words). Real radio inputs so a screen reader announces the group
 * name, each option's name, its checked state, and its position in the set —
 * and so arrow keys move between the options natively.
 */
function InputModePicker(props: {
  readonly inputMode: InputMode;
  readonly onSelect: (mode: InputMode) => void;
}): ReactElement {
  const { inputMode, onSelect } = props;
  return e(
    'div',
    { className: 'mode-picker', role: 'radiogroup', 'aria-label': 'Input mode' },
    e('span', { className: 'mode-picker-label', 'aria-hidden': 'true' }, 'Input'),
    INPUT_MODE_LABELS.map(({ mode, label }) =>
      e(
        'label',
        { key: mode, className: 'mode-option' },
        e('input', {
          type: 'radio',
          className: 'mode-option-input',
          name: 'input-mode',
          value: mode,
          checked: mode === inputMode,
          onChange: () => {
            onSelect(mode);
          },
        }),
        e('span', { className: 'mode-option-text' }, label),
        e('span', { className: 'visually-hidden' }, MODE_DESCRIPTIONS[mode]),
      ),
    ),
  );
}

/**
 * Leaving the confirm step unmounts whichever of its elements holds focus,
 * which would drop keyboard focus to <body> and throw a screen reader to
 * the top of the page. Return it to the control that opened the flow (after
 * the re-render has put that button back).
 */
function refocusResetButton(): void {
  if (typeof document === 'undefined') return;
  setTimeout(() => document.getElementById('reset-request-button')?.focus(), 0);
}

/**
 * The confirm step for an unrecoverable erase: the word has to be typed out
 * before the erase button unlocks. Enter submits once it matches.
 */
function ResetConfirm(props: {
  readonly text: string;
  readonly canConfirm: boolean;
  readonly on: AppHandlers;
}): ReactElement {
  const { text, canConfirm, on } = props;
  const confirm = (): void => {
    on.onResetConfirm();
    refocusResetButton();
  };
  const cancel = (): void => {
    on.onResetCancel();
    refocusResetButton();
  };
  return e(
    'span',
    { className: 'reset-confirm' },
    e('span', null, `Erase all progress? Type “${RESET_CONFIRM_WORD}” to confirm.`),
    e('input', {
      type: 'text',
      className: 'reset-confirm-input',
      value: text,
      autoFocus: true,
      autoComplete: 'off',
      autoCorrect: 'off',
      autoCapitalize: 'off',
      spellCheck: false,
      placeholder: RESET_CONFIRM_WORD,
      'aria-label': `Type ${RESET_CONFIRM_WORD} to confirm erasing all progress`,
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        on.onResetTextChange(event.currentTarget.value),
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && canConfirm) confirm();
        if (event.key === 'Escape') cancel();
      },
    }),
    e('button', { className: 'btn btn-danger', disabled: !canConfirm, onClick: confirm }, 'Erase'),
    e('button', { className: 'btn', onClick: cancel }, 'Cancel'),
  );
}

export function Header(props: HeaderProps): ReactElement {
  const { bestFox, confirmingReset, resetConfirmText, canConfirmReset, inputMode, on } = props;
  return e(
    'header',
    { className: 'app-header' },
    e(
      'h1',
      { className: 'brand', 'aria-label': 'Quick Braille Fox' },
      BRAND_ROWS.map((row, r) =>
        e(
          'span',
          { key: r, className: 'brand-row', 'aria-hidden': 'true' },
          row.map((c, i) => e('span', { key: i, className: 'brand-cell' }, c)),
        ),
      ),
    ),
    e(
      'div',
      { className: 'header-right' },
      e(InputModePicker, { inputMode, onSelect: on.onInputModeSelect }),
      bestFox === null ? null : e(BestFoxBadge, { best: bestFox }),
      confirmingReset
        ? e(ResetConfirm, { text: resetConfirmText, canConfirm: canConfirmReset, on })
        : e(
            'button',
            { className: 'btn btn-quiet', id: 'reset-request-button', onClick: on.onResetRequest },
            'Reset progress',
          ),
    ),
  );
}
