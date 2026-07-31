// App header: the "fox" brand as three braille cells, the best fox result,
// and the reset-progress control (with its confirm step).

import {
  createElement as e,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { AppHandlers, BestFox } from '../state';
import { RESET_CONFIRM_WORD } from '../state';
import { formatPercent } from './labels';

export interface HeaderProps {
  readonly bestFox: BestFox | null;
  readonly confirmingReset: boolean;
  readonly resetConfirmText: string;
  readonly canConfirmReset: boolean;
  readonly voiceOverInput: boolean;
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
 * Switch between VoiceOver braille screen input (the OS commits whole words)
 * and typing braille chords directly on the QWERTY home row (f d s a j k l ;).
 */
function InputModeToggle(props: {
  readonly voiceOverInput: boolean;
  readonly onToggle: () => void;
}): ReactElement {
  const { voiceOverInput, onToggle } = props;
  return e(
    'button',
    {
      type: 'button',
      className: 'btn btn-quiet mode-toggle',
      role: 'switch',
      'aria-checked': voiceOverInput,
      onClick: onToggle,
    },
    e('span', { className: 'mode-toggle-indicator', 'aria-hidden': 'true' }),
    'VoiceOver input',
  );
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
        if (event.key === 'Enter' && canConfirm) on.onResetConfirm();
        if (event.key === 'Escape') on.onResetCancel();
      },
    }),
    e(
      'button',
      { className: 'btn btn-danger', disabled: !canConfirm, onClick: on.onResetConfirm },
      'Erase',
    ),
    e('button', { className: 'btn', onClick: on.onResetCancel }, 'Cancel'),
  );
}

export function Header(props: HeaderProps): ReactElement {
  const { bestFox, confirmingReset, resetConfirmText, canConfirmReset, voiceOverInput, on } = props;
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
      e(InputModeToggle, { voiceOverInput, onToggle: on.onInputModeToggle }),
      bestFox === null ? null : e(BestFoxBadge, { best: bestFox }),
      confirmingReset
        ? e(ResetConfirm, { text: resetConfirmText, canConfirm: canConfirmReset, on })
        : e(
            'button',
            { className: 'btn btn-quiet', onClick: on.onResetRequest },
            'Reset progress',
          ),
    ),
  );
}
