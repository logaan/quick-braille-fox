// Progress views: the "Learning now" line (the 5 active skills as print form
// plus a score bar, compact enough to live inside the drill card) and the
// "Overall" panel (totals and per-group progress, its own card below the
// fold).

import { createElement as e, type ReactElement } from 'react';
import { LEARNT_THRESHOLD } from '../core';
import type { AppViewModel } from '../state';
import { GROUP_LABELS } from './labels';

export interface SkillPanelProps {
  readonly vm: AppViewModel;
}

/**
 * The active skills as one compact line: each skill is its print form beside
 * a progress bar — no cells (the drill itself teaches those) and no numeric
 * score (the bar carries it; the exact value stays in the aria-label). Lives
 * at the bottom of the drill card so glancing at progress never means
 * leaving the drill.
 */
export function LearningNowLine(props: SkillPanelProps): ReactElement {
  const { vm } = props;
  return e(
    'section',
    { className: 'learning-line', 'aria-label': 'Learning now' },
    e(
      'ul',
      { className: 'learning-skills' },
      vm.activeSkills.map((s) =>
        e(
          'li',
          { key: s.id, className: 'learning-skill' },
          e('span', { className: 'learning-print' }, s.print),
          e(
            'div',
            {
              className: 'bar',
              role: 'progressbar',
              'aria-valuemin': 0,
              'aria-valuemax': LEARNT_THRESHOLD,
              'aria-valuenow': Math.min(LEARNT_THRESHOLD, s.score),
              'aria-label': `${s.print}: score ${s.score} of ${LEARNT_THRESHOLD}`,
            },
            e('div', {
              className: 'bar-fill',
              style: { width: `${s.progress * 100}%` },
            }),
          ),
        ),
      ),
    ),
  );
}

export function OverallPanel(props: SkillPanelProps): ReactElement {
  const { vm } = props;
  return e(
    'section',
    { className: 'panel', 'aria-label': 'Overall progress' },
    e('h2', { className: 'panel-heading' }, 'Overall'),
    // Deliberately NOT a live region. This used to announce politely on
    // every change, but the count moves while the learner is mid-prompt —
    // a milestone interrupting the typing it rewards, worst of all during a
    // fox run. role=status still names it for a screen reader that comes
    // looking; aria-live=off keeps it out of speech until then.
    e(
      'p',
      { className: 'overall', role: 'status', 'aria-live': 'off' },
      e('strong', null, String(vm.learntCount)),
      ` of ${vm.totalSkills} skills learnt`,
    ),
    e(
      'p',
      { className: 'overall-sub' },
      `${vm.promptsCompleted} prompts · fox in ${vm.nextFoxIn}`,
    ),
    e(
      'ul',
      { className: 'groups' },
      vm.groups.map((g) =>
        e(
          'li',
          { key: g.group, className: 'group-row' },
          e('span', { className: 'group-name' }, GROUP_LABELS[g.group]),
          e('span', { className: 'group-count' }, `${g.learnt}/${g.total}`),
          e(
            'div',
            { className: 'group-bar', 'aria-hidden': 'true' },
            e('div', {
              className: 'group-bar-fill',
              style: { width: `${(g.learnt / g.total) * 100}%` },
            }),
          ),
        ),
      ),
    ),
  );
}
