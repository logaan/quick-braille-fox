// The main drill view: the prompt as an aligned column grid (expected cells
// over target print over, in emulated mode, the print and cells the learner
// produced), a visible raw text input (VoiceOver braille screen input types
// into it, and showing its literal DOM value lets the learner see and recover
// from VoiceOver mangling a word), and the fox challenge/result presentation.
// The input's native caret is hidden in CSS so the prompt's caret is the only
// cursor on screen; only its text is shown.
// Pure render functions of props — all behaviour lives in src/state.

import { createElement as e, type ReactElement } from 'react';
import type { Column, FoxResult, RowModel } from '../core';
import type { AppHandlers, AppViewModel, FoxFailureView } from '../state';
import { BrailleCells, describeCells } from './braille';
import { formatPercent, signLabel } from './labels';

const BLANK = '⠀';

/** Total expected cells of the prompt, spaces included (one blank each). */
function promptCellCount(rows: RowModel): number {
  let n = 0;
  for (const col of rows.columns) n += [...col.expectedUnicode].length;
  return n;
}

/**
 * What the polite status region says about the prompt on screen. Sighted
 * users see the prompt swap and the gold fox banner appear; a screen reader
 * hears nothing on either unless this text changes and gets announced — so
 * it names a fox round (with the rules that change the stakes) and numbers
 * ordinary prompts so a completed one audibly gives way to the next. The
 * cell count carries what the placeholder row shows sighted users — how
 * much braille the prompt expects — to speech and braille-display users.
 */
function promptAnnouncement(vm: AppViewModel): string {
  if (vm.foxResult !== null) return ''; // the result panel takes over
  if (vm.isFox) {
    return (
      'fox challenge — type the sentence exactly. No hints; one wrong ' +
      `character ends the run. ${vm.promptText}`
    );
  }
  const cells = promptCellCount(vm.rows);
  const suffix = cells === 0 ? '' : ` — ${cells} ${cells === 1 ? 'cell' : 'cells'}.`;
  return `Prompt ${vm.promptsCompleted + 1}: ${vm.promptText}${suffix}`;
}

/** Is `ch` a U+2800-block braille glyph (a chorded cell shown literally)? */
function isBrailleGlyph(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x2800 && code <= 0x28ff;
}

/**
 * What the mistake alert says while typing has diverged, '' otherwise. The
 * coloured prompt spans that show sighted users a mistake are aria-hidden,
 * so this is the only way a screen reader user learns they have diverged.
 * Positions come from vm.matchedPrint, so on a cell-judged round the
 * mistake is placed where the *cells* went wrong — even when the derived
 * print still spells a prefix of the prompt — and the offending input is
 * spoken as the dots that were chorded.
 */
function mistakeAnnouncement(vm: AppViewModel): string {
  if (!vm.diverged) return '';
  const wrong = vm.divergedText[0];
  const at = `at character ${vm.matchedPrint + 1}`;
  if (wrong === undefined) return `Mistake ${at} — backspace to fix.`;
  const label = isBrailleGlyph(wrong) ? `chorded ${describeCells(wrong)}` : `typed ${signLabel(wrong)}`;
  return `Mistake ${at}: ${label} — backspace to fix.`;
}

/**
 * Monkeytype-style char spans for target positions [from, to): correct
 * prefix / wrong / untyped, plus the caret marker. Diverged positions show
 * what was actually produced (not the target characters) — the mistyped
 * print, or on a cell-judged round the chorded cells themselves as braille
 * glyphs — so a mistake is visible as what it was; backspacing restores the
 * target. `match` (vm.matchedPrint) says where the correct prefix ends: on
 * a cell-judged round that is where the chorded cells left the canon, which
 * the derived print alone cannot place.
 */
function charSpans(
  text: string,
  from: number,
  to: number,
  match: number,
  wrong: string,
  caretAt: number,
): ReactElement[] {
  const typedEnd = match + wrong.length;
  const parts: ReactElement[] = [];
  for (let i = from; i < to; i += 1) {
    if (i === caretAt) parts.push(e('span', { key: 'caret', className: 'caret' }));
    const isWrong = i >= match && i < typedEnd;
    const cls = isWrong ? 'char-wrong' : i < match ? 'char-correct' : 'char-untyped';
    parts.push(e('span', { key: i, className: cls }, (isWrong ? wrong[i - match] : text[i]) ?? ''));
  }
  return parts;
}

/**
 * The flat prompt line, fox challenge only. A fox run gives no hints, and
 * the grid's placeholder cells are themselves a hint — how many cells each
 * word contracts to is exactly what the challenge grades you on discovering
 * — so the fox keeps the plain coloured text.
 */
function PromptText(props: {
  readonly text: string;
  readonly match: number;
  readonly wrong: string;
}): ReactElement {
  const { text, match, wrong } = props;
  const typedEnd = match + wrong.length;
  const caretAt = Math.min(typedEnd, text.length);
  const parts = charSpans(text, 0, text.length, match, wrong, caretAt);
  if (caretAt === text.length) parts.push(e('span', { key: 'caret', className: 'caret' }));
  if (typedEnd > text.length) {
    parts.push(
      e('span', { key: 'extra', className: 'char-wrong char-extra' }, wrong.slice(text.length - match)),
    );
  }
  return e(
    'span',
    { className: 'prompt' },
    e('span', { className: 'visually-hidden' }, text),
    e('span', { className: 'prompt-chars', 'aria-hidden': 'true' }, parts),
  );
}

/** Columns grouped for wrapping: a word's columns wrap as one unit. */
interface ColumnGroup {
  readonly kind: 'word' | 'space';
  readonly columns: Column[];
}

function groupColumns(columns: readonly Column[]): ColumnGroup[] {
  const groups: ColumnGroup[] = [];
  for (const col of columns) {
    const last = groups[groups.length - 1];
    if (col.printTarget === ' ') groups.push({ kind: 'space', columns: [col] });
    else if (last?.kind === 'word') last.columns.push(col);
    else groups.push({ kind: 'word', columns: [col] });
  }
  return groups;
}

/**
 * One column of the grid: a single sign, stacked as expected cells over
 * target print over (emulated mode only) the print and cells the learner
 * actually produced. The expected cells start as blank placeholders — they
 * still show how many cells the sign costs — and flip to the real dots when
 * the sign's hint is revealed. The alternating tint (by unit parity) is what
 * ties one sign's cells to its print across all rows.
 */
function ColumnStack(props: {
  readonly col: Column;
  readonly text: string;
  readonly match: number;
  readonly wrong: string;
  readonly caretAt: number;
  readonly emulated: boolean;
}): ReactElement {
  const { col, text, match, wrong, caretAt, emulated } = props;
  const cellCount = [...col.expectedUnicode].length;
  const rows: ReactElement[] = [
    e(
      'span',
      { key: 'cells', className: 'col-cells' },
      e(BrailleCells, {
        unicode: col.hintRevealed ? col.expectedUnicode : BLANK.repeat(cellCount),
        size: 'md',
        className: col.hintRevealed ? 'cells-revealed' : undefined,
      }),
    ),
    e(
      'span',
      { key: 'print', className: 'col-print' },
      charSpans(text, col.start, col.end, match, wrong, caretAt),
    ),
  ];
  if (emulated) {
    rows.push(
      e('span', { key: 'result', className: 'col-result' }, col.printTyped ?? ''),
      e(
        'span',
        { key: 'typed', className: 'col-typed' },
        col.typedUnicode === null
          ? null
          : e(BrailleCells, { unicode: col.typedUnicode, size: 'sm' }),
      ),
    );
  }
  const tint = col.index % 2 === 0 ? 'col-even' : 'col-odd';
  return e('span', { className: `prompt-col ${tint}` }, rows);
}

/**
 * The prompt as the aligned column grid, one column per translation unit —
 * so a contraction's several letters of print sit under its single cell and
 * a capital's two cells sit over its one letter, making it visible how many
 * cells each part of the prompt expects. Words wrap as a unit; the space
 * between them is its own column, blank cell and all, because a space is a
 * cell the learner must enter.
 */
function PromptGrid(props: {
  readonly rows: RowModel;
  readonly text: string;
  readonly match: number;
  readonly wrong: string;
  readonly emulated: boolean;
}): ReactElement {
  const { rows, text, match, wrong, emulated } = props;
  const typedEnd = match + wrong.length;
  const caretAt = Math.min(typedEnd, text.length);
  const overflow = typedEnd > text.length ? wrong.slice(text.length - match) : '';
  const groups = groupColumns(rows.columns).map((group, i) =>
    e(
      'span',
      { key: i, className: group.kind === 'word' ? 'prompt-word' : 'prompt-gap' },
      group.columns.map((col) =>
        e(ColumnStack, { key: col.index, col, text, match, wrong, caretAt, emulated }),
      ),
    ),
  );
  // Caret-at-end and overflow live in a pseudo-column so they keep row
  // alignment with the real columns.
  const tail =
    caretAt !== text.length && overflow === ''
      ? null
      : e(
          'span',
          { key: 'tail', className: 'prompt-col prompt-tail' },
          e('span', { key: 'cells', className: 'col-cells' }),
          e(
            'span',
            { key: 'print', className: 'col-print' },
            caretAt === text.length ? e('span', { key: 'caret', className: 'caret' }) : null,
            overflow === ''
              ? null
              : e('span', { key: 'extra', className: 'char-wrong char-extra' }, overflow),
          ),
          ...(emulated
            ? [
                e('span', { key: 'result', className: 'col-result' }),
                e('span', { key: 'typed', className: 'col-typed' }),
              ]
            : []),
        );
  return e(
    'span',
    { className: 'prompt prompt-grid' },
    e('span', { className: 'visually-hidden' }, text),
    e('span', { className: 'prompt-columns', 'aria-hidden': 'true' }, groups, tail),
  );
}

/**
 * The braille a failed run came down to: the sign that was owed, and — when
 * the learner chorded it themselves — the cells they actually entered. Print
 * alone does not settle "but I typed that right"; two rows of cells do.
 */
function FoxFailureDetail(props: { readonly failure: FoxFailureView }): ReactElement {
  const { failure } = props;
  const rows: ReactElement[] = [
    e(
      'div',
      { className: 'fox-failure-row', key: 'expected' },
      e('span', { className: 'fox-failure-label' }, 'Expected'),
      e(BrailleCells, { unicode: failure.expected, size: 'md' }),
      e('span', { className: 'fox-failure-print' }, signLabel(failure.expectedPrint)),
      // Speech alternative: the raw glyphs above serve braille displays.
      e('span', { className: 'visually-hidden' }, `, ${describeCells(failure.expected)}`),
    ),
  ];
  if (failure.typed !== null) {
    rows.push(
      e(
        'div',
        { className: 'fox-failure-row', key: 'typed' },
        e('span', { className: 'fox-failure-label' }, 'You typed'),
        e(BrailleCells, { unicode: failure.typed, size: 'md', className: 'cells-wrong' }),
        e('span', { className: 'visually-hidden' }, `, ${describeCells(failure.typed)}`),
      ),
    );
  }
  return e('div', { className: 'fox-failure' }, rows);
}

function FoxResultPanel(props: {
  readonly result: FoxResult;
  readonly failure: FoxFailureView | null;
  readonly minCells: number;
  readonly interval: number;
  readonly onContinue: () => void;
}): ReactElement {
  const { result, failure, minCells, interval, onContinue } = props;
  let outcome: ReactElement;
  let detail: string;
  if (result.kind === 'failed') {
    outcome = e('p', { className: 'fox-outcome fox-failed' }, '✗ Run failed');
    detail = `One wrong character ends a fox run. It comes back every ${interval} prompts.`;
  } else if (result.kind === 'crown') {
    outcome = e(
      'p',
      { className: 'fox-outcome fox-crown' },
      e('span', { role: 'img', 'aria-label': 'crown' }, '👑'),
    );
    detail = `Perfect — the minimum ${minCells} cells. Flawless grade 2.`;
  } else {
    outcome = e(
      'p',
      { className: 'fox-outcome fox-badge' },
      `+${formatPercent(result.percentAbove)}%`,
    );
    detail =
      `Flawless run, ${formatPercent(result.percentAbove)}% above the ` +
      `${minCells}-cell grade 2 minimum. More contractions, fewer cells.`;
  }
  return e(
    'div',
    { className: 'fox-result' },
    // The Continue button below autofocuses the moment this panel appears,
    // and that focus announcement is what the screen reader user hears — so
    // the whole result is wired to it via aria-describedby rather than a
    // live region the focus change would preempt.
    e(
      'div',
      { id: 'fox-result-text' },
      outcome,
      e('p', { className: 'fox-detail' }, detail),
      failure === null ? null : e(FoxFailureDetail, { failure }),
    ),
    e(
      'button',
      {
        className: 'btn btn-primary',
        autoFocus: true,
        'aria-describedby': 'fox-result-text',
        onClick: onContinue,
      },
      'Continue',
    ),
  );
}

/**
 * The challenge's rules, on screen for the whole fox round — it turns up
 * rarely enough (and scores differently enough) that the learner should
 * never have to remember how it works.
 */
function FoxRules(props: {
  readonly interval: number;
  readonly award: number;
  readonly minCells: number;
}): ReactElement {
  const { interval, award, minCells } = props;
  return e(
    'div',
    { className: 'fox-rules' },
    e(
      'p',
      { className: 'fox-banner' },
      e('strong', null, 'fox challenge'),
      ` — every ${interval} prompts, starting with your first.`,
    ),
    e(
      'ul',
      { className: 'fox-rule-list' },
      e('li', { key: 'exact' }, 'Type the sentence exactly. No hints are given.'),
      e('li', { key: 'fail' }, 'One wrong character ends the run on the spot.'),
      e(
        'li',
        { key: 'score' },
        `Every skill you type correctly scores ${award} points — enough to learn it outright.`,
      ),
      e(
        'li',
        { key: 'cells' },
        `Finish flawlessly to be graded on cells used: ${minCells} is the grade 2 ` +
          'minimum and earns the crown; anything more earns a badge.',
      ),
    ),
  );
}

export interface DrillProps {
  readonly vm: AppViewModel;
  readonly on: AppHandlers;
}

export function Drill(props: DrillProps): ReactElement {
  const { vm, on } = props;
  const showResult = vm.foxResult !== null;

  // Uncontrolled on purpose: VoiceOver braille screen input owns this field.
  // We only read its value and compare against the prompt — we never write the
  // value back, because a mid-word write-back desyncs VoiceOver's word buffer
  // and makes a slip unrecoverable. Keying on the prompt epoch remounts the
  // field at a genuine prompt change, never mid-typing. defaultValue only
  // applies at those mounts: vm.typed there keeps a resumed session's field in
  // step with its restored progress (an empty field would make the next
  // keystroke read as replacing everything typed so far — a phantom mistake).
  // The field is visible so you can see exactly what VoiceOver put in the DOM
  // and, if it mangles a word, clear/retype to recover.
  const input = e('input', {
    key: `prompt-${vm.promptKey}`,
    className: 'drill-input',
    id: 'drill-input',
    type: 'text',
    defaultValue: vm.typed,
    'aria-describedby': vm.inputMode === 'emulated' ? 'chord-help' : undefined,
    onChange: on.onInput,
    // In chord mode these drive typing (dot keys, space, backspace); they
    // no-op while VoiceOver input is on.
    onKeyDown: on.onDrillKeyDown,
    onKeyUp: on.onDrillKeyUp,
    autoFocus: true,
    autoComplete: 'off',
    autoCapitalize: 'none',
    autoCorrect: 'off',
    spellCheck: false,
    enterKeyHint: 'go',
  });

  return e(
    'section',
    {
      className: vm.isFox ? 'drill drill-fox' : 'drill',
      'aria-label': vm.isFox ? 'fox challenge' : 'Typing drill',
    },
    // Spoken feedback the visual layer conveys silently: which prompt is on
    // screen (and that a fox round started), and that typing has diverged.
    e(
      'div',
      { className: 'visually-hidden', role: 'status', 'aria-live': 'polite' },
      promptAnnouncement(vm),
    ),
    e('div', { className: 'visually-hidden', role: 'alert' }, mistakeAnnouncement(vm)),
    vm.isFox
      ? e(FoxRules, {
          interval: vm.foxInterval,
          award: vm.foxAward,
          minCells: vm.foxMinCells,
        })
      : null,
    e(
      'label',
      { className: 'prompt-label', htmlFor: 'drill-input' },
      vm.isFox
        ? e(PromptText, { text: vm.promptText, match: vm.matchedPrint, wrong: vm.divergedText })
        : e(PromptGrid, {
            rows: vm.rows,
            text: vm.promptText,
            match: vm.matchedPrint,
            wrong: vm.divergedText,
            emulated: vm.inputMode === 'emulated',
          }),
    ),
    showResult ? null : input,
    vm.inputMode !== 'emulated'
      ? null
      : e(
          'p',
          { className: 'chord-help', id: 'chord-help' },
          'Chording: F D S = dots 1 2 3 · J K L = dots 4 5 6 · ' +
            'Space = space · Backspace deletes a cell',
        ),
    vm.isFox
      ? e(
          'div',
          { className: 'fox-result-area' },
          vm.foxResult === null
            ? null
            : e(FoxResultPanel, {
                result: vm.foxResult,
                failure: vm.foxFailure,
                minCells: vm.foxMinCells,
                interval: vm.foxInterval,
                onContinue: on.onFoxContinue,
              }),
        )
      : // Revealed hints now show in place, in the grid's cell row — which is
        // aria-hidden, so this live region is how a screen reader hears a
        // reveal: the dots spoken for speech users, the raw glyphs after them
        // for braille displays.
        e(
          'div',
          { className: 'visually-hidden', 'aria-live': 'polite' },
          vm.hint === null ? '' : `Hint: ${describeCells(vm.hint)} ${vm.hint}`,
        ),
  );
}
