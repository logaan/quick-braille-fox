// The page top: the "fox" brand as three braille cells (Brand), and the
// settings/controls cluster (HeaderControls) — input mode, terse
// announcements, best fox result, fullscreen, and the reset-progress control
// with its confirm step. Brand and controls are separate components because
// they sit apart in DOM order: braille users read the page top-to-bottom one
// line at a time, so everything between the title and the drill costs them a
// pan — the controls render *after* the drill and panels, and CSS grid puts
// them back in the visual header row.

import {
  createElement as e,
  useEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { AppHandlers, BestFox, InputMode } from '../state';
import { INPUT_MODE_LABELS, RESET_CONFIRM_WORD } from '../state';
import { formatPercent } from './labels';

export interface HeaderControlsProps {
  readonly bestFox: BestFox | null;
  readonly confirmingReset: boolean;
  readonly resetConfirmText: string;
  readonly canConfirmReset: boolean;
  readonly inputMode: InputMode;
  readonly terse: boolean;
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

/**
 * Those nine cells flattened into one 6-wide, 9-tall field of dots — three
 * cells across is six dot columns, three rows of cells is nine dot rows.
 * Drawing the dots directly on one evenly spaced grid reads as a single
 * braille shape; nine boxed glyphs read as nine cramped little cards.
 *
 * A braille character is U+2800 plus a bitmask, bit n−1 standing for dot n,
 * and dots 1–3 run down a cell's left column with 4–6 down its right — so
 * within a row of cells, dot row `r` takes bits `r` and `r + 3` from each
 * cell in turn.
 */
const BRAND_DOT_ROWS: readonly (readonly boolean[])[] = BRAND_ROWS.flatMap((cells) =>
  [0, 1, 2].map((r) =>
    cells.flatMap((cell) => {
      const dots = (cell.codePointAt(0) ?? 0x2800) - 0x2800;
      return [r, r + 3].map((bit) => (dots & (1 << bit)) !== 0);
    }),
  ),
);

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

/** The vendor-prefixed fullscreen API, which is still what older Safari ships. */
interface WebkitDocument extends Document {
  readonly webkitFullscreenEnabled?: boolean;
  readonly webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}

function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as WebkitDocument;
  return doc.fullscreenEnabled || doc.webkitFullscreenEnabled === true;
}

function inFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as WebkitDocument;
  return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null;
}

/**
 * Toggle the whole app in and out of fullscreen. Fullscreen is browser
 * chrome, not tutor state, so this stays out of the store: local state,
 * synced from the document on `fullscreenchange` — which also covers exits
 * the button never sees, like pressing Escape. Renders nothing where the
 * API is unavailable (iPhones, and the DOM-less test environment).
 */
function FullscreenButton(): ReactElement | null {
  const [active, setActive] = useState(inFullscreen);
  useEffect(() => {
    const sync = (): void => {
      setActive(inFullscreen());
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  if (!fullscreenSupported()) return null;
  const toggle = (): void => {
    if (inFullscreen()) {
      const doc = document as WebkitDocument;
      if (doc.exitFullscreen) {
        void doc.exitFullscreen().catch(() => undefined);
      } else {
        doc.webkitExitFullscreen?.();
      }
    } else {
      const el = document.documentElement as WebkitElement;
      if (el.requestFullscreen) {
        // The browser may refuse (no user gesture, iframe policy); the
        // change event never fires and the label simply stays put.
        void el.requestFullscreen().catch(() => undefined);
      } else {
        el.webkitRequestFullscreen?.();
      }
    }
  };
  return e(
    'button',
    { className: 'btn btn-quiet', onClick: toggle },
    active ? 'Exit full screen' : 'Full screen',
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

/**
 * Terse announcements, as a visible checkbox: shorter status lines and
 * screen reader messages for practiced users — on a braille display every
 * boilerplate word is a pan of a short line, so the drill loop should cost
 * one window per event once the wording is familiar.
 */
function TerseToggle(props: {
  readonly terse: boolean;
  readonly onToggle: (terse: boolean) => void;
}): ReactElement {
  const { terse, onToggle } = props;
  return e(
    'label',
    { className: 'terse-toggle' },
    e('input', {
      type: 'checkbox',
      className: 'terse-toggle-input',
      checked: terse,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        onToggle(event.currentTarget.checked);
      },
    }),
    e('span', { className: 'terse-toggle-text' }, 'Terse'),
    e(
      'span',
      { className: 'visually-hidden' },
      ' announcements — shorter status lines and screen reader messages',
    ),
  );
}

/** The page title, first in DOM order — it alone identifies the page. */
export function Brand(): ReactElement {
  return e(
    'header',
    { className: 'app-header' },
    e(
      'h1',
      { className: 'brand', 'aria-label': 'Quick Braille Fox' },
      e(
        'span',
        { className: 'brand-dots', 'aria-hidden': 'true' },
        BRAND_DOT_ROWS.flatMap((row, r) =>
          row.map((raised, c) =>
            e('span', {
              key: `${r}-${c}`,
              className: raised ? 'brand-dot brand-dot-raised' : 'brand-dot',
            }),
          ),
        ),
      ),
    ),
  );
}

/**
 * The settings cluster. Rendered after the drill and panels in DOM order
 * (see app.ts) but shown in the visual header row via CSS grid, so a screen
 * reader's "read from top" reaches the prompt without crossing four control
 * stops — and the reset flow never sits between the page top and the drill.
 */
export function HeaderControls(props: HeaderControlsProps): ReactElement {
  const { bestFox, confirmingReset, resetConfirmText, canConfirmReset, inputMode, terse, on } =
    props;
  return e(
    'section',
    { className: 'header-controls', 'aria-label': 'Settings' },
    e(InputModePicker, { inputMode, onSelect: on.onInputModeSelect }),
    e(TerseToggle, { terse, onToggle: on.onTerseToggle }),
    bestFox === null ? null : e(BestFoxBadge, { best: bestFox }),
    e(FullscreenButton),
    confirmingReset
      ? e(ResetConfirm, { text: resetConfirmText, canConfirm: canConfirmReset, on })
      : e(
          'button',
          { className: 'btn btn-quiet', id: 'reset-request-button', onClick: on.onResetRequest },
          'Reset progress',
        ),
  );
}
