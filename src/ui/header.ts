// App header: the "qbf" brand as three braille cells, the best qbf result,
// and the reset-progress control (with its confirm step).

import { createElement as e, type ReactElement } from 'react';
import type { AppHandlers, BestQbf } from '../state';
import { formatPercent } from './labels';

export interface HeaderProps {
  readonly bestQbf: BestQbf | null;
  readonly confirmingReset: boolean;
  readonly on: AppHandlers;
}

const BRAND_CELLS = ['⠟', '⠃', '⠋'];

function BestQbfBadge(props: { readonly best: BestQbf }): ReactElement {
  const { best } = props;
  return e(
    'span',
    { className: 'best-qbf' },
    'best qbf ',
    best.kind === 'crown'
      ? e(
          'span',
          { className: 'best-crown', role: 'img', 'aria-label': 'crown — perfect minimum-cell run' },
          '👑',
        )
      : e('span', { className: 'best-badge' }, `+${formatPercent(best.percentAbove)}%`),
  );
}

export function Header(props: HeaderProps): ReactElement {
  const { bestQbf, confirmingReset, on } = props;
  return e(
    'header',
    { className: 'app-header' },
    e(
      'h1',
      { className: 'brand', 'aria-label': 'qbf' },
      BRAND_CELLS.map((c, i) =>
        e('span', { key: i, className: 'brand-cell', 'aria-hidden': 'true' }, c),
      ),
    ),
    e(
      'div',
      { className: 'header-right' },
      bestQbf === null ? null : e(BestQbfBadge, { best: bestQbf }),
      confirmingReset
        ? e(
            'span',
            { className: 'reset-confirm' },
            e('span', null, 'Erase all progress?'),
            e('button', { className: 'btn btn-danger', onClick: on.onResetConfirm }, 'Erase'),
            e('button', { className: 'btn', onClick: on.onResetCancel }, 'Cancel'),
          )
        : e(
            'button',
            { className: 'btn btn-quiet', onClick: on.onResetRequest },
            'Reset progress',
          ),
    ),
  );
}
