// Progress panels: "Learning now" (the 5 active skills with braille cells,
// print form, and score bars) and "Overall" (totals and per-group progress).
// They are separate cards so the single-column layout can stack them.

import { createElement as e, type ReactElement } from 'react';
import type { AppViewModel } from '../state';
import { BrailleCells } from './braille';
import { GROUP_LABELS } from './labels';

export interface SkillPanelProps {
  readonly vm: AppViewModel;
}

export function LearningNowPanel(props: SkillPanelProps): ReactElement {
  const { vm } = props;
  return e(
    'section',
    { className: 'panel', 'aria-label': 'Learning now' },
    e('h2', { className: 'panel-heading' }, 'Learning now'),
    e(
      'ul',
      { className: 'active-skills' },
      vm.activeSkills.map((s) =>
        e(
          'li',
          { key: s.id, className: 'active-skill' },
          e(BrailleCells, { unicode: s.unicode, size: 'md' }),
          e(
            'div',
            { className: 'active-skill-info' },
            e('span', { className: 'skill-print' }, s.print),
            e(
              'div',
              {
                className: 'bar',
                role: 'progressbar',
                'aria-valuemin': 0,
                'aria-valuemax': 10,
                'aria-valuenow': Math.min(10, s.score),
                'aria-label': `${s.print}: score ${s.score} of 10`,
              },
              e('div', {
                className: 'bar-fill',
                style: { width: `${s.progress * 100}%` },
              }),
            ),
          ),
          e('span', { className: 'skill-score', 'aria-hidden': 'true' }, String(s.score)),
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
    e(
      'p',
      { className: 'overall' },
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
