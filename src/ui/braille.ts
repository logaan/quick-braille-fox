// Braille cell display: renders a U+2800-block string as large, clearly
// segmented cells. The raw braille characters are left accessible on
// purpose — a connected braille display renders them as actual dots.

import { createElement as e, type ReactElement } from 'react';

const BLANK = '⠀';

/**
 * Spoken form of a U+2800 string: "dots 1-4-5, dots 1-3-5" (a blank cell is
 * "space"). Raw braille glyphs serve braille displays but are unintelligible
 * to speech output; hidden text built from this serves speech-only users.
 */
export function describeCells(unicode: string): string {
  const parts: string[] = [];
  for (const ch of unicode) {
    const bits = (ch.codePointAt(0) ?? 0x2800) - 0x2800;
    if (bits <= 0) {
      parts.push('space');
      continue;
    }
    const dots: number[] = [];
    for (let d = 0; d < 6; d += 1) if (bits & (1 << d)) dots.push(d + 1);
    parts.push(`dots ${dots.join('-')}`);
  }
  return parts.join(', ');
}

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
