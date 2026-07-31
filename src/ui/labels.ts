// Display strings for curriculum groups and qbf percentages.

import type { SkillGroup } from '../data/skills';

export const GROUP_LABELS: Record<SkillGroup, string> = {
  letters: 'Letters',
  capitals: 'Capitals',
  numbers: 'Numbers',
  punctuation: 'Punctuation',
  'alphabetic-wordsigns': 'Alphabetic wordsigns',
  'strong-contractions': 'Strong contractions',
  'strong-wordsigns': 'Strong wordsigns',
  'strong-groupsigns': 'Strong groupsigns',
  'lower-signs': 'Lower signs',
  'initial-letter-contractions': 'Initial-letter contractions',
  'final-letter-groupsigns': 'Final-letter groupsigns',
  shortforms: 'Shortforms',
  symbols: 'Symbols',
};

/**
 * How a sign's print form reads on screen. A space's print is a space, which
 * would show as nothing at all next to its cell — name it instead.
 */
export function signLabel(print: string): string {
  return print.trim() === '' ? 'space' : print;
}

/** "2.8", "25" — one decimal at most, no trailing ".0". */
export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
