// src/ui — presentation layer. No JSX: components are built with
// `import { createElement as e } from 'react'`.

import { createElement as e, type ReactElement } from 'react';
import { skills } from '../data/skills';

export function App(): ReactElement {
  return e(
    'main',
    null,
    e('h1', null, 'Braille Tutor'),
    e(
      'p',
      null,
      `Curriculum loaded: ${skills.length} skills, ` +
        `from "${skills[0]?.print ?? '?'}" to "${skills[skills.length - 1]?.print ?? '?'}".`,
    ),
  );
}
