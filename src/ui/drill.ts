// The main drill view: prompt with progressive match colouring, a visible raw
// text input (VoiceOver braille screen input types into it, and showing its
// literal DOM value lets the learner see and recover from VoiceOver mangling a
// word), a persistent status line, the hint area, and the fox
// challenge/result presentation.
// The input's native caret is hidden in CSS so the prompt's caret is the only
// cursor on screen; only its text is shown.
// Pure render functions of props — all behaviour lives in src/state.
//
// String budget: refreshable braille displays show one line of 12–80 cells
// (commonly 14, 20 or 40) at a time, and every extra word costs a physical
// pan. User-facing strings therefore lead with the variable information
// (position, wrong input, outcome) and keep boilerplate short, last, or —
// in terse mode (vm.terse) — dropped.

import {
  createElement as e,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { FoxResult } from '../core';
import type { AppHandlers, AppViewModel, FoxFailureView } from '../state';
import { BrailleCells, describeCells } from './braille';
import { formatPercent, signLabel } from './labels';

/**
 * What the polite status region says about the prompt on screen. Sighted
 * users see the prompt swap and the gold fox banner appear; a screen reader
 * hears nothing on either unless this text changes and gets announced — so
 * it names a fox round and numbers ordinary prompts so a completed one
 * audibly gives way to the next. The prompt text comes first; the fox
 * stakes trail it (the full rules stay on screen in FoxRules) and are
 * dropped entirely in terse mode.
 */
function promptAnnouncement(vm: AppViewModel): string {
  if (vm.foxResult !== null) return ''; // the result panel takes over
  if (vm.isFox) {
    if (vm.terse) return `fox: ${vm.promptText}`;
    return `fox: ${vm.promptText} — type it exactly; no hints, one wrong character ends the run.`;
  }
  const n = vm.promptsCompleted + 1;
  return vm.terse ? `${n}: ${vm.promptText}` : `Prompt ${n}: ${vm.promptText}`;
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
 * spoken as the dots that were chorded. Variable facts first: "wrong at 12:
 * d", boilerplate last (dropped in terse mode).
 */
function mistakeAnnouncement(vm: AppViewModel): string {
  if (!vm.diverged) return '';
  const at = `wrong at ${vm.matchedPrint + 1}`;
  const label = wrongLabel(vm);
  const fact = label === null ? at : `${at}: ${label}`;
  return vm.terse ? fact : `${fact} — backspace to fix.`;
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
 * Monkeytype-style prompt colouring: correct prefix / wrong / untyped.
 * Diverged positions show what was actually produced (not the target
 * characters) — the mistyped print, or on a cell-judged round the chorded
 * cells themselves as braille glyphs — so a mistake is visible as what it
 * was; backspacing restores the target. `match` (vm.matchedPrint) says
 * where the correct prefix ends: on a cell-judged round that is where the
 * chorded cells left the canon, which the derived print alone cannot place.
 */
function PromptText(props: {
  readonly text: string;
  readonly match: number;
  readonly wrong: string;
}): ReactElement {
  const { text, match, wrong } = props;
  const typedEnd = match + wrong.length;
  const caretAt = Math.min(typedEnd, text.length);
  const parts: ReactElement[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (i === caretAt) parts.push(e('span', { key: 'caret', className: 'caret' }));
    const isWrong = i >= match && i < typedEnd;
    const cls = isWrong ? 'char-wrong' : i < match ? 'char-correct' : 'char-untyped';
    parts.push(e('span', { key: i, className: cls }, (isWrong ? wrong[i - match] : text[i]) ?? ''));
  }
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
    vm.terse ? null : e('p', { className: 'fox-detail' }, detail),
    vm.foxFailure === null ? null : e(FoxFailureDetail, { failure: vm.foxFailure }),
    e('button', { className: 'btn btn-primary', onClick: onContinue }, 'Continue'),
  );
}

/**
 * The challenge's rules, on screen for the whole fox round — it turns up
 * rarely enough (and scores differently enough) that the learner should
 * never have to remember how it works. In terse mode the list collapses
 * behind a disclosure: still one interaction away, no longer re-read by a
 * practiced user's screen reader every fox.
 */
function FoxRules(props: {
  readonly interval: number;
  readonly award: number;
  readonly minCells: number;
  readonly terse: boolean;
}): ReactElement {
  const { interval, award, minCells, terse } = props;
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
    terse
      ? e(
          'details',
          { className: 'fox-rules-disclosure' },
          e('summary', null, 'rules'),
          list,
        )
      : list,
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
          terse: vm.terse,
        })
      : null,
    e(
      'label',
      { className: 'prompt-label', htmlFor: 'drill-input' },
      e(PromptText, { text: vm.promptText, match: vm.matchedPrint, wrong: vm.divergedText }),
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
            : e(FoxResultPanel, { vm, result: vm.foxResult, onContinue: on.onFoxContinue }),
        )
      : e(
          'div',
          { className: 'hint-area', 'aria-live': 'polite' },
          vm.hint === null
            ? null
            : e(
                'div',
                { className: 'hint' },
                // Cells first: braille readers consume the dots directly, and
                // on a short display the first window must be the answer
                // itself. The dot-number narration is the speech fallback.
                e(BrailleCells, { unicode: vm.hint, size: 'lg' }),
                e(
                  'span',
                  { className: 'visually-hidden' },
                  ` — hint: ${describeCells(vm.hint)}.`,
                ),
              ),
        ),
  );
}
