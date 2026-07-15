// Braille cell display: renders a U+2800-block string as large, clearly
// segmented cells. The raw braille characters are left accessible on
// purpose — a connected braille display renders them as actual dots.

import { createElement as e, type ReactElement } from 'react';

const BLANK = '⠀';

export interface BrailleCellsProps {
  /** Braille text in the U+2800 block (e.g. from core textToUnicode). */
  readonly unicode: string;
  readonly size: 'sm' | 'md' | 'lg';
  readonly className?: string;
}

export function BrailleCells(props: BrailleCellsProps): ReactElement {
  const cells: ReactElement[] = [];
  let i = 0;
  for (const ch of props.unicode) {
    cells.push(
      e('span', { key: i, className: ch === BLANK ? 'cell cell-blank' : 'cell' }, ch),
    );
    i += 1;
  }
  const classes = ['cells', `cells-${props.size}`];
  if (props.className !== undefined) classes.push(props.className);
  return e('span', { className: classes.join(' ') }, cells);
}
