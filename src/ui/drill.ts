// The main drill view: the prompt as an aligned column grid (expected cells
// over target print over, in emulated mode, the print and cells the learner
// produced), a visible raw text input (VoiceOver braille screen input types
// into it, and showing its literal DOM value lets the learner see and recover
// from VoiceOver mangling a word), a persistent status line, and the fox
// challenge/result presentation.
// The input's native caret is hidden in CSS so the prompt's caret is the only
// cursor on screen; only its text is shown.
// Pure render functions of props — all behaviour lives in src/state.
//
// String budget: refreshable braille displays show one line of 12–80 cells
// (commonly 14, 20 or 40) at a time, and every extra word costs a physical
// pan. The announcements a learner hears on every prompt and every slip are
// therefore cut to their variable information — position, wrong input,
// outcome — with no fixed prefixes and no boilerplate tail. Explanation
// lives where it is read once and not per event: the fox rules and the fox
// result detail, both of which come round only every foxInterval prompts.

import {
  createElement as e,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { Column, FoxResult, RowModel } from '../core';
import type { AppHandlers, AppViewModel, FoxFailureView } from '../state';
import { BrailleCells, describeCells } from './braille';
import { CHORD_HELP_ID } from './help';
import { formatPercent, signLabel } from './labels';
import { LearningNowLine } from './skills';

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
 * it names a fox round and numbers ordinary prompts so a completed one
 * audibly gives way to the next. Nothing but the variable facts: the number
 * alone does the disambiguating a "Prompt" prefix would, and the fox stakes
 * are already on screen in FoxRules rather than repeated into speech. The
 * cell count carries what the placeholder row shows sighted users — how much
 * braille the prompt expects.
 */
function promptAnnouncement(vm: AppViewModel): string {
  if (vm.foxResult !== null) return ''; // the result panel takes over
  if (vm.isFox) return `fox: ${vm.promptText}`;
  const n = vm.promptsCompleted + 1;
  const cells = promptCellCount(vm.rows);
  const suffix = cells === 0 ? '' : ` — ${cells} ${cells === 1 ? 'cell' : 'cells'}.`;
  return `${n}: ${vm.promptText}${suffix}`;
}

/** Is `ch` a U+2800-block braille glyph (a chorded cell shown literally)? */
function isBrailleGlyph(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x2800 && code <= 0x28ff;
}

/**
 * What the learner produced where typing diverged, named for speech: the
 * mistyped print, or on a cell-judged round the dots that were chorded.
 * Null when the divergence is an over-deletion with nothing to name.
 */
function wrongLabel(vm: AppViewModel): string | null {
  const wrong = vm.divergedText[0];
  if (wrong === undefined) return null;
  return isBrailleGlyph(wrong) ? describeCells(wrong) : signLabel(wrong);
}

/**
 * What the mistake alert says while typing has diverged, '' otherwise. The
 * coloured prompt spans that show sighted users a mistake are aria-hidden,
 * so this is the only way a speech user learns they have diverged.
 * Positions come from vm.matchedPrint, so on a cell-judged round the
 * mistake is placed where the *cells* went wrong — even when the derived
 * print still spells a prefix of the prompt — and the offending input is
 * spoken as the dots that were chorded. The variable facts and nothing else:
 * "wrong at 12: d". What to do about it is not repeated here, because the
 * status line a pan below already ends in "— backspace" and stays there.
 */
function mistakeAnnouncement(vm: AppViewModel): string {
  if (!vm.diverged) return '';
  const at = `wrong at ${vm.matchedPrint + 1}`;
  const label = wrongLabel(vm);
  return label === null ? at : `${at}: ${label}`;
}

/**
 * The one-line result summary, shared by the focused result heading and the
 * persistent status line: outcome first, then the fact that explains it.
 */
function foxOutcomeLine(vm: AppViewModel): string {
  const r = vm.foxResult;
  if (r === null) return '';
  if (r.kind === 'failed') {
    const f = vm.foxFailure;
    const at = `run failed at ${vm.matchedPrint + 1}`;
    return f === null ? at : `${at}: expected ${signLabel(f.expectedPrint)}`;
  }
  if (r.kind === 'crown') return `crown — perfect ${vm.foxMinCells}-cell run`;
  return `flawless — +${formatPercent(r.percentAbove)}% over ${vm.foxMinCells} cells`;
}

/**
 * The persistent status line: always rendered, always current, updated in
 * place directly after the drill input in DOM order. Live regions are at
 * best ephemeral flashes on refreshable braille displays (NVDA renders
 * role=alert in braille as just the word "alert"; VoiceOver flashes alerts
 * for a few seconds), so a deafblind user needs drill state somewhere
 * stable and re-readable: one pan below the input line their display
 * already shows. Terse by design — the first braille window carries the
 * facts.
 */
function statusLine(vm: AppViewModel): string {
  if (vm.foxResult !== null) return foxOutcomeLine(vm);
  if (vm.diverged) {
    const label = wrongLabel(vm);
    const at = `wrong at ${vm.matchedPrint + 1}`;
    return `${label === null ? at : `${at}: ${label}`} — backspace`;
  }
  const progress = `${vm.matchedPrint}/${vm.promptText.length}`;
  return vm.isFox ? `fox ${progress} — exact, no hints` : `ok ${progress}`;
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
 * Cells first, spoken description second: a braille display reads the row in
 * order, and the cells themselves are the answer.
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
  readonly vm: AppViewModel;
  readonly result: FoxResult;
  readonly onContinue: () => void;
}): ReactElement {
  const { vm, result, onContinue } = props;
  // Focus moves to the summary line, not the Continue button: dynamic
  // aria-describedby text is unreliable in braille (NVDA does not expose
  // it; JAWS support has come and gone), and a braille display shows the
  // focused item's line — which must therefore *be* the outcome. The
  // detail rows sit one pan forward in DOM order; Continue is one Tab (or
  // an Enter anywhere in the panel) away.
  const summaryRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    summaryRef.current?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Enter continues from anywhere in the panel — except the button, whose
    // own click (fired by the same Enter) already does.
    if (event.key !== 'Enter') return;
    if ((event.target as HTMLElement).tagName === 'BUTTON') return;
    onContinue();
  };
  let outcome: ReactElement;
  let detail: string;
  if (result.kind === 'failed') {
    outcome = e('p', { className: 'fox-outcome fox-failed', 'aria-hidden': 'true' }, '✗ Run failed');
    detail = `One wrong character ends a fox run. It comes back every ${vm.foxInterval} prompts.`;
  } else if (result.kind === 'crown') {
    outcome = e(
      'p',
      { className: 'fox-outcome fox-crown', 'aria-hidden': 'true' },
      e('span', { role: 'img', 'aria-label': 'crown' }, '👑'),
    );
    detail = `Perfect — the minimum ${vm.foxMinCells} cells. Flawless grade 2.`;
  } else {
    outcome = e(
      'p',
      { className: 'fox-outcome fox-badge', 'aria-hidden': 'true' },
      `+${formatPercent(result.percentAbove)}%`,
    );
    detail =
      `Flawless run, ${formatPercent(result.percentAbove)}% above the ` +
      `${vm.foxMinCells}-cell grade 2 minimum. More contractions, fewer cells.`;
  }
  return e(
    'div',
    { className: 'fox-result', onKeyDown },
    e(
      'p',
      { className: 'fox-result-summary', tabIndex: -1, ref: summaryRef },
      foxOutcomeLine(vm),
    ),
    outcome,
    e('p', { className: 'fox-detail' }, detail),
    vm.foxFailure === null ? null : e(FoxFailureDetail, { failure: vm.foxFailure }),
    e('button', { className: 'btn btn-primary', onClick: onContinue }, 'Continue'),
  );
}

/**
 * The challenge's rules, on screen for the whole fox round — it turns up
 * rarely enough (and scores differently enough) that the learner should
 * never have to remember how it works. Spelled out in full, always: once
 * every foxInterval prompts is not the per-event cost the announcements are
 * budgeted against, and a rule you have to go looking for is one you will be
 * failed by.
 */
function FoxRules(props: {
  readonly interval: number;
  readonly award: number;
  readonly minCells: number;
}): ReactElement {
  const { interval, award, minCells } = props;
  const list = e(
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
  );
  return e(
    'div',
    { className: 'fox-rules' },
    e(
      'p',
      { className: 'fox-banner' },
      e('strong', null, 'fox challenge'),
      ` — every ${interval} prompts, starting with your first.`,
    ),
    list,
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
    // The chord key map lives in the collapsed help section at the foot of
    // the page (help.ts), but a description referenced by id is exposed even
    // when the element is hidden — so speech and braille users still get the
    // keys at the field, where they are needed, with nothing on screen.
    'aria-describedby': vm.inputMode === 'emulated' ? CHORD_HELP_ID : undefined,
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
    // The persistent status line, straight after the input in DOM order: a
    // braille display focused on the input reaches it in one pan, any time.
    // role=status names it, but aria-live=off keeps it out of speech — it
    // changes on every keystroke, and speech users get the event-driven
    // announcements above instead of a per-keystroke counter.
    e(
      'p',
      { className: vm.diverged ? 'drill-status drill-status-wrong' : 'drill-status',
        role: 'status', 'aria-live': 'off' },
      statusLine(vm),
    ),
    vm.isFox
      ? e(
          'div',
          { className: 'fox-result-area' },
          vm.foxResult === null
            ? null
            : e(FoxResultPanel, { vm, result: vm.foxResult, onContinue: on.onFoxContinue }),
        )
      : // Revealed hints now show in place, in the grid's cell row — which is
        // aria-hidden, so this live region is how a non-visual user hears a
        // reveal. Cells first: braille readers consume the dots directly, and
        // on a short display the first window must be the answer itself. The
        // dot-number narration is the speech fallback.
        e(
          'div',
          { className: 'visually-hidden', 'aria-live': 'polite' },
          vm.hint === null ? '' : `${vm.hint} — hint: ${describeCells(vm.hint)}.`,
        ),
    // Progress lives in the drill card, pinned to its bottom edge — one
    // compact line, after everything the round itself needs in DOM order.
    e(LearningNowLine, { vm }),
  );
}
