// The main drill view: prompt with progressive match colouring, a visually
// hidden text input (VoiceOver braille screen input types into it; the
// prompt's own caret is the only visible cursor), the hint area,
// new-skill introductions, and the qbf challenge/result presentation.
// Pure render functions of props — all behaviour lives in src/state.

import { createElement as e, type ReactElement } from 'react';
import type { QbfResult } from '../core';
import type { AppHandlers, AppViewModel, IntroView } from '../state';
import { BrailleCells } from './braille';
import { GROUP_LABELS, formatPercent } from './labels';

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

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

/** Shown when a skill enters the active window, with its first prompt. */
function NewSkillIntro(props: { readonly intro: IntroView }): ReactElement {
  const { intro } = props;
  return e(
    'div',
    { className: 'intro' },
    e(
      'p',
      { className: 'intro-heading' },
      'New skill · ',
      e('span', { className: 'intro-group' }, GROUP_LABELS[intro.group]),
    ),
    e(
      'div',
      { className: 'intro-body' },
      e(BrailleCells, { unicode: intro.unicode, size: 'lg' }),
      e('span', { className: 'intro-print' }, intro.print),
    ),
  );
}

function QbfResultPanel(props: {
  readonly result: QbfResult;
  readonly minCells: number;
  readonly onContinue: () => void;
}): ReactElement {
  const { result, minCells, onContinue } = props;
  let outcome: ReactElement;
  let detail: string;
  if (result.kind === 'failed') {
    outcome = e('p', { className: 'qbf-outcome qbf-failed' }, '✗ Run failed');
    detail = 'One wrong character ends a qbf run. It comes back every 100 prompts.';
  } else if (result.kind === 'crown') {
    outcome = e(
      'p',
      { className: 'qbf-outcome qbf-crown' },
      e('span', { role: 'img', 'aria-label': 'crown' }, '👑'),
    );
    detail = `Perfect — the minimum ${minCells} cells. Flawless grade 2.`;
  } else {
    outcome = e(
      'p',
      { className: 'qbf-outcome qbf-badge' },
      `+${formatPercent(result.percentAbove)}%`,
    );
    detail =
      `Flawless run, ${formatPercent(result.percentAbove)}% above the ` +
      `${minCells}-cell grade 2 minimum. More contractions, fewer cells.`;
  }
  return e(
    'div',
    { className: 'qbf-result' },
    outcome,
    e('p', { className: 'qbf-detail' }, detail),
    e(
      'button',
      { className: 'btn btn-primary', autoFocus: true, onClick: onContinue },
      'Continue',
    ),
  );
}

export interface DrillProps {
  readonly vm: AppViewModel;
  readonly on: AppHandlers;
}

export function Drill(props: DrillProps): ReactElement {
  const { vm, on } = props;
  const showResult = vm.qbfResult !== null;

  const input = e('input', {
    className: 'drill-input',
    id: 'drill-input',
    type: 'text',
    value: vm.typed,
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
      className: vm.isQbf ? 'drill drill-qbf' : 'drill',
      'aria-label': vm.isQbf ? 'qbf challenge' : 'Typing drill',
    },
    vm.isQbf
      ? e(
          'p',
          { className: 'qbf-banner' },
          e('strong', null, 'qbf challenge'),
          ' — type the sentence exactly. No hints; one wrong character fails the run.',
        )
      : vm.intro === null
        ? null
        : e(NewSkillIntro, { intro: vm.intro }),
    e(
      'label',
      { className: 'prompt-label', htmlFor: 'drill-input' },
      e(PromptText, { text: vm.promptText, typed: vm.typed }),
    ),
    showResult ? null : input,
    vm.isQbf
      ? e(
          'div',
          { className: 'qbf-result-area', 'aria-live': 'assertive' },
          vm.qbfResult === null
            ? null
            : e(QbfResultPanel, {
                result: vm.qbfResult,
                minCells: vm.qbfMinCells,
                onContinue: on.onQbfContinue,
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
