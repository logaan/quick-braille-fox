// The main drill view: prompt with progressive match colouring, a visible raw
// text input (VoiceOver braille screen input types into it, and showing its
// literal DOM value lets the learner see and recover from VoiceOver mangling a
// word), the hint area, and the fox challenge/result presentation.
// The input's native caret is hidden in CSS so the prompt's caret is the only
// cursor on screen; only its text is shown.
// Pure render functions of props — all behaviour lives in src/state.

import { createElement as e, type ReactElement } from 'react';
import type { FoxResult } from '../core';
import type { AppHandlers, AppViewModel, FoxFailureView } from '../state';
import { BrailleCells, describeCells } from './braille';
import { formatPercent, signLabel } from './labels';

/**
 * What the polite status region says about the prompt on screen. Sighted
 * users see the prompt swap and the gold fox banner appear; a screen reader
 * hears nothing on either unless this text changes and gets announced — so
 * it names a fox round (with the rules that change the stakes) and numbers
 * ordinary prompts so a completed one audibly gives way to the next.
 */
function promptAnnouncement(vm: AppViewModel): string {
  if (vm.foxResult !== null) return ''; // the result panel takes over
  if (vm.isFox) {
    return (
      'fox challenge — type the sentence exactly. No hints; one wrong ' +
      `character ends the run. ${vm.promptText}`
    );
  }
  return `Prompt ${vm.promptsCompleted + 1}: ${vm.promptText}`;
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
      e(PromptText, { text: vm.promptText, match: vm.matchedPrint, wrong: vm.divergedText }),
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
      : e(
          'div',
          { className: 'hint-area', 'aria-live': 'polite' },
          vm.hint === null
            ? null
            : e(
                'div',
                { className: 'hint' },
                e(
                  'span',
                  { className: 'visually-hidden' },
                  `Hint: ${describeCells(vm.hint)}. `,
                ),
                e(BrailleCells, { unicode: vm.hint, size: 'lg' }),
              ),
        ),
  );
}
