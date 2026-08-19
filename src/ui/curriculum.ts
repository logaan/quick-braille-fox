import { createElement as e, useEffect, useRef, type ReactElement } from 'react';
import { LEARNT_THRESHOLD, SKILL_POLICIES, type SkillPolicy } from '../core';
import type {
  AppHandlers,
  AppViewModel,
  CurriculumGroupView,
  CurriculumSkillView,
  CurriculumView,
  PolicyCounts,
} from '../state';
import { BrailleCells, describeCells } from './braille';
import { GROUP_LABELS, POLICY_DESCRIPTIONS, POLICY_LABELS, signLabel } from './labels';

export interface CurriculumPageProps {
  readonly vm: AppViewModel;
  readonly on: AppHandlers;
}

function countsSummary(counts: PolicyCounts): string {
  return SKILL_POLICIES.map((policy) => `${counts[policy]} ${POLICY_LABELS[policy]}`).join(' · ');
}

function statusLabel(skill: CurriculumSkillView): string {
  if (skill.learnt) return skill.active ? 'Learnt, in rotation' : 'Learnt';
  if (skill.active) return 'Learning now';
  return skill.score > 0 ? 'Started' : 'Not started';
}

function PolicyButtons(props: {
  readonly label: string;
  readonly current: SkillPolicy | null;
  readonly onSelect: (policy: SkillPolicy) => void;
}): ReactElement {
  const { label, current, onSelect } = props;
  return e(
    'div',
    { className: 'policy-batch', role: 'group', 'aria-label': label },
    SKILL_POLICIES.map((policy) =>
      e(
        'button',
        {
          key: policy,
          type: 'button',
          className: `btn btn-quiet policy-batch-btn policy-${policy}`,
          'aria-pressed': current === policy,
          onClick: () => {
            onSelect(policy);
          },
        },
        POLICY_LABELS[policy],
      ),
    ),
  );
}

function PolicyRadios(props: {
  readonly skill: CurriculumSkillView;
  readonly onSelect: (skillId: string, policy: SkillPolicy) => void;
}): ReactElement {
  const { skill, onSelect } = props;
  return e(
    'div',
    {
      className: 'policy-picker',
      role: 'radiogroup',
      'aria-label': `Rotation for ${signLabel(skill.print)}`,
    },
    SKILL_POLICIES.map((policy) =>
      e(
        'label',
        { key: policy, className: `policy-option policy-${policy}` },
        e('input', {
          type: 'radio',
          className: 'policy-option-input',
          name: `policy-${skill.id}`,
          value: policy,
          checked: skill.policy === policy,
          onChange: () => {
            onSelect(skill.id, policy);
          },
        }),
        e('span', { className: 'policy-option-text' }, POLICY_LABELS[policy]),
        e('span', { className: 'visually-hidden' }, POLICY_DESCRIPTIONS[policy]),
      ),
    ),
  );
}

function SkillRow(props: {
  readonly skill: CurriculumSkillView;
  readonly onSelect: (skillId: string, policy: SkillPolicy) => void;
}): ReactElement {
  const { skill, onSelect } = props;
  const classes = ['skill-row', `skill-row-${skill.policy}`];
  if (skill.active) classes.push('skill-row-active');
  if (skill.learnt) classes.push('skill-row-learnt');
  return e(
    'tr',
    { className: classes.join(' ') },
    e('td', { className: 'skill-order' }, String(skill.order + 1)),
    e('th', { scope: 'row', className: 'skill-print' }, signLabel(skill.print)),
    e(
      'td',
      { className: 'skill-cells' },
      e(BrailleCells, { unicode: skill.unicode, size: 'sm' }),
      e('span', { className: 'visually-hidden' }, describeCells(skill.unicode)),
    ),
    e('td', { className: 'skill-id' }, skill.id),
    e(
      'td',
      { className: 'skill-score' },
      e(
        'div',
        {
          className: 'bar',
          role: 'progressbar',
          'aria-valuemin': 0,
          'aria-valuemax': LEARNT_THRESHOLD,
          'aria-valuenow': Math.min(LEARNT_THRESHOLD, skill.score),
          'aria-label': `${signLabel(skill.print)}: score ${skill.score} of ${LEARNT_THRESHOLD}`,
        },
        e('div', { className: 'bar-fill', style: { width: `${skill.progress * 100}%` } }),
      ),
      e('span', { className: 'skill-score-value' }, `${skill.score}/${LEARNT_THRESHOLD}`),
    ),
    e('td', { className: 'skill-status' }, statusLabel(skill)),
    e('td', { className: 'skill-policy' }, e(PolicyRadios, { skill, onSelect })),
  );
}

const COLUMNS = ['No.', 'Print', 'Cells', 'Id', 'Score', 'Status', 'Rotation'];

function GroupSection(props: {
  readonly group: CurriculumGroupView;
  readonly on: AppHandlers;
}): ReactElement {
  const { group, on } = props;
  const label = GROUP_LABELS[group.group];
  return e(
    'section',
    { className: 'curriculum-group', 'aria-label': label },
    e(
      'div',
      { className: 'curriculum-group-head' },
      e('h3', { className: 'curriculum-group-name' }, label),
      e(
        'p',
        { className: 'curriculum-group-meta' },
        `${group.learnt} of ${group.total} learnt · ${countsSummary(group.counts)}`,
      ),
      e(PolicyButtons, {
        label: `Set rotation for all ${label}`,
        current: group.policy,
        onSelect: (policy: SkillPolicy) => {
          on.onGroupPolicyChange(group.group, policy);
        },
      }),
    ),
    e(
      'div',
      { className: 'curriculum-table-wrap' },
      e(
        'table',
        { className: 'curriculum-table' },
        e(
          'thead',
          null,
          e(
            'tr',
            null,
            COLUMNS.map((name) => e('th', { key: name, scope: 'col' }, name)),
          ),
        ),
        e(
          'tbody',
          null,
          group.skills.map((skill) =>
            e(SkillRow, { key: skill.id, skill, onSelect: on.onSkillPolicyChange }),
          ),
        ),
      ),
    ),
  );
}

function CurriculumBody(props: {
  readonly curriculum: CurriculumView;
  readonly totalSkills: number;
  readonly on: AppHandlers;
}): ReactElement {
  const { curriculum, totalSkills, on } = props;
  return e(
    'div',
    { className: 'curriculum-body' },
    e(
      'div',
      { className: 'curriculum-summary' },
      e(
        'p',
        { className: 'curriculum-counts' },
        `${totalSkills} skills · ${countsSummary(curriculum.counts)} · ` +
          `${curriculum.activeCount} in rotation now`,
      ),
      e(PolicyButtons, {
        label: 'Set rotation for every skill',
        current: curriculum.policy,
        onSelect: on.onAllPolicyChange,
      }),
    ),
    curriculum.groups.map((group) => e(GroupSection, { key: group.group, group, on })),
  );
}

export function CurriculumPage(props: CurriculumPageProps): ReactElement {
  const { vm, on } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return e(
    'main',
    { className: 'layout curriculum' },
    e(
      'div',
      { className: 'curriculum-head' },
      e('h2', { className: 'curriculum-heading', tabIndex: -1, ref: headingRef }, 'Curriculum'),
      e(
        'button',
        {
          type: 'button',
          className: 'btn',
          onClick: () => {
            on.onNavigate('drill');
          },
        },
        'Back to drill',
      ),
    ),
    e(
      'p',
      { className: 'curriculum-intro' },
      'Every skill the app teaches. Allow lets the algorithm decide when to ' +
        'teach a skill, Force keeps it in the rotation whatever the algorithm ' +
        'picks, and Block takes it out of the rotation and out of the words ' +
        'prompts are built from.',
    ),
    vm.curriculum === null
      ? null
      : e(CurriculumBody, {
          curriculum: vm.curriculum,
          totalSkills: vm.totalSkills,
          on,
        }),
  );
}
