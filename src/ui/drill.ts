// The main drill view: prompt with progressive match colouring, a visible raw
// text input (VoiceOver braille screen input types into it, and showing its
// literal DOM value lets the learner see and recover from VoiceOver mangling a
// word), the hint area, and the fox challenge/result presentation.
// The input's native caret is hidden in CSS so the prompt's caret is the only
// cursor on screen; only its text is shown.
// Pure render functions of props — all behaviour lives in src/state.

import { createElement as e, type ReactElement } from 'react';
import type { FoxResult } from '../core';
import { commonPrefixLength } from '../core';
import type { AppHandlers, AppViewModel, FoxFailureView } from '../state';
import { BrailleCells } from './braille';
import { formatPercent, signLabel } from './labels';

/**
 * Monkeytype-style prompt colouring: correct prefix / wrong / untyped.
 * Diverged positions show the character actually typed (not the target one),
 * so a mistake is visible as what it was; backspacing restores the target.
 */
function PromptText(props: { readonly text: string; readonly typed: string }): ReactElement {
  const { text, typed } = props;
  const match = commonPrefixLength(text, typed);
  const caretAt = Math.min(typed.length, text.length);
  const parts: ReactElement[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (i === caretAt) parts.push(e('span', { key: 'caret', className: 'caret' }));
    const wrong = i >= match && i < typed.length;
    const cls = wrong ? 'char-wrong' : i < match ? 'char-correct' : 'char-untyped';
    parts.push(e('span', { key: i, className: cls }, (wrong ? typed[i] : text[i]) ?? ''));
  }
  if (caretAt === text.length) parts.push(e('span', { key: 'caret', className: 'caret' }));
  if (typed.length > text.length) {
    parts.push(e('span', { key: 'extra', className: 'char-wrong char-extra' }, typed.slice(text.length)));
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
    ),
  ];
  if (failure.typed !== null) {
    rows.push(
      e(
        'div',
        { className: 'fox-failure-row', key: 'typed' },
        e('span', { className: 'fox-failure-label' }, 'You typed'),
        e(BrailleCells, { unicode: failure.typed, size: 'md', className: 'cells-wrong' }),
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
    outcome,
    e('p', { className: 'fox-detail' }, detail),
    failure === null ? null : e(FoxFailureDetail, { failure }),
    e(
      'button',
      { className: 'btn btn-primary', autoFocus: true, onClick: onContinue },
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
  // and makes a slip unrecoverable. Keying on the prompt epoch remounts (and so
  // clears) the field at a genuine prompt change, never mid-typing. The field
  // is visible so you can see exactly what VoiceOver put in the DOM and, if it
  // mangles a word, clear/retype to recover.
  const input = e('input', {
    key: `prompt-${vm.promptKey}`,
    className: 'drill-input',
    id: 'drill-input',
    type: 'text',
    defaultValue: '',
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
      e(PromptText, { text: vm.promptText, typed: vm.typed }),
    ),
    showResult ? null : input,
    vm.isFox
      ? e(
          'div',
          { className: 'fox-result-area', 'aria-live': 'assertive' },
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
                e('span', { className: 'visually-hidden' }, 'Hint: '),
                e(BrailleCells, { unicode: vm.hint, size: 'lg' }),
              ),
        ),
  );
}
