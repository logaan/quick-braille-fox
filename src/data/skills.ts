// Typed access to the generated curriculum data.
//
// `skills.json` is produced by `npm run generate` (scripts/generate-skills.mjs)
// from the liblouis UEB tables in data/. Do not edit it by hand; regenerate
// instead. See docs/ARCHITECTURE.md for the format.

import skillsJson from './skills.json';

/** What kind of braille sign a skill teaches. */
export type SkillKind =
  | 'letter'
  | 'capital'
  | 'number'
  | 'number-sign'
  | 'punctuation'
  | 'wordsign'
  | 'contraction'
  | 'groupsign'
  | 'lowersign'
  | 'initial-letter'
  | 'final-letter'
  | 'shortform';

/** Curriculum groups, in teaching order. */
export type SkillGroup =
  | 'letters'
  | 'capitals'
  | 'numbers'
  | 'punctuation'
  | 'alphabetic-wordsigns'
  | 'strong-contractions'
  | 'strong-wordsigns'
  | 'strong-groupsigns'
  | 'lower-signs'
  | 'initial-letter-contractions'
  | 'final-letter-groupsigns'
  | 'shortforms'
  | 'symbols';

export interface Skill {
  /** Stable unique id, e.g. "letter-a", "groupsign-ing", "shortform-about". */
  readonly id: string;
  readonly kind: SkillKind;
  /** The print form: "a", "7", ",", "and", "ing", "about". */
  readonly print: string;
  /** Braille cells; each cell is an array of dot numbers (1-6), ascending. */
  readonly dots: readonly (readonly number[])[];
  /** Same cells as a Unicode braille string (U+2800 block). */
  readonly unicode: string;
  readonly group: SkillGroup;
  /** Global curriculum index (0-based, dense, matches array position). */
  readonly order: number;
}

/** All skills in curriculum order (sorted by `order`). */
export const skills: readonly Skill[] = skillsJson as readonly Skill[];
