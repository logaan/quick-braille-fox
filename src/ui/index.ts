// src/ui — presentation layer. No JSX: components are built with
// `import { createElement as e } from 'react'`. Components are pure render
// functions of props; all behaviour lives in src/state.

export type { AppProps } from './app';
export { App } from './app';
export { BrailleCells } from './braille';
