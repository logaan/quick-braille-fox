// Top-level layout. DOM order is reading order for a braille display (one
// line at a time, top to bottom), so the drill comes as early as possible:
// brand (page identity), then the drill and progress panels, then the
// settings controls — which CSS grid places back in the visual header row,
// pixel-equivalent to the old header-first layout. A note on how the braille
// glyphs behave on a real display closes the page.

import { createElement as e, type ReactElement } from 'react';
import type { AppHandlers, AppViewModel } from '../state';
import { Drill } from './drill';
import { Brand, HeaderControls } from './header';
import { OverallPanel } from './skills';

export interface AppProps {
  readonly vm: AppViewModel;
  readonly on: AppHandlers;
}

export function App(props: AppProps): ReactElement {
  const { vm, on } = props;
  return e(
    'div',
    { className: 'app' },
    e(Brand),
    e(
      'main',
      { className: 'layout' },
      e(Drill, { vm, on }),
      e(OverallPanel, { vm }),
      // MDN's aria-braillelabel guidance: when content contains Unicode
      // braille patterns, tell users, so they know how it interacts with
      // their translation settings.
      e(
        'p',
        { className: 'a11y-note' },
        'Hints and cell displays are literal braille characters — a connected ' +
          'braille display shows exactly the dots on screen, whatever output ' +
          'table you use.',
      ),
    ),
    e(HeaderControls, {
      bestFox: vm.bestFox,
      confirmingReset: vm.confirmingReset,
      resetConfirmText: vm.resetConfirmText,
      canConfirmReset: vm.canConfirmReset,
      inputMode: vm.inputMode,
      terse: vm.terse,
      on,
    }),
  );
}
