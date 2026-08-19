import type { SkillPolicy } from '../core';
import type { SkillGroup, SkillKind } from '../data/skills';

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

export const KIND_LABELS: Record<SkillKind, string> = {
  letter: 'Letter',
  capital: 'Capital indicator',
  number: 'Digit',
  'number-sign': 'Number sign',
  punctuation: 'Punctuation',
  wordsign: 'Wordsign',
  contraction: 'Contraction',
  groupsign: 'Groupsign',
  lowersign: 'Lower sign',
  'initial-letter': 'Initial-letter contraction',
  'final-letter': 'Final-letter groupsign',
  shortform: 'Shortform',
};

export const POLICY_LABELS: Record<SkillPolicy, string> = {
  force: 'Force',
  allow: 'Allow',
  block: 'Block',
};

export const POLICY_DESCRIPTIONS: Record<SkillPolicy, string> = {
  force: ' — always in the rotation, whatever the algorithm picks',
  allow: ' — the algorithm decides when to teach it',
  block: ' — never in the rotation, and never used in prompt text',
};

export function signLabel(print: string): string {
  return print.trim() === '' ? 'space' : print;
}

export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
