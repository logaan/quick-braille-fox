import { createElement as e, type ReactElement } from 'react';
import type { AppHandlers, AppViewModel } from '../state';
import { CurriculumPage } from './curriculum';
import { Drill } from './drill';
import { Brand, HeaderControls } from './header';
import { HelpSection } from './help';
import { OverallPanel } from './skills';

export interface AppProps {
  readonly vm: AppViewModel;
  readonly on: AppHandlers;
}

export function App(props: AppProps): ReactElement {
  const { vm, on } = props;
  if (vm.page === 'curriculum') {
    return e('div', { className: 'app app-curriculum' }, e(Brand), e(CurriculumPage, { vm, on }));
  }
  return e(
    'div',
    { className: 'app' },
    e(Brand),
    e(
      'main',
      { className: 'layout' },
      e(Drill, { vm, on }),
      e(OverallPanel, { vm, on }),
      e(
        'p',
        { className: 'a11y-note' },
        'Hints and cell displays are literal braille characters — a connected ' +
          'braille display shows exactly the dots on screen, whatever output ' +
          'table you use.',
      ),
      e(HelpSection, { inputMode: vm.inputMode }),
    ),
    e(HeaderControls, {
      bestFox: vm.bestFox,
      confirmingReset: vm.confirmingReset,
      resetConfirmText: vm.resetConfirmText,
      canConfirmReset: vm.canConfirmReset,
      inputMode: vm.inputMode,
      revealTimer: vm.revealTimer,
      on,
    }),
  );
}
