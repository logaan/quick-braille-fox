import skillsJson from './skills.json';

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
  readonly id: string;
  readonly kind: SkillKind;
  readonly print: string;
  readonly dots: readonly (readonly number[])[];
  readonly unicode: string;
  readonly group: SkillGroup;
  readonly order: number;
}

export const skills: readonly Skill[] = skillsJson as readonly Skill[];
