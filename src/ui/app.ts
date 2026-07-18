// Top-level layout: header, then a single centred column stacking the drill
// view above the progress panels.

import { createElement as e, type ReactElement } from 'react';
import type { AppHandlers, AppViewModel } from '../state';
import { Drill } from './drill';
import { Header } from './header';
import { LearningNowPanel, OverallPanel } from './skills';

export interface AppProps {
  readonly vm: AppViewModel;
  readonly on: AppHandlers;
}

export function App(props: AppProps): ReactElement {
  const { vm, on } = props;
  return e(
    'div',
    { className: 'app' },
    e(Header, {
      bestQbf: vm.bestQbf,
      confirmingReset: vm.confirmingReset,
      resetConfirmText: vm.resetConfirmText,
      canConfirmReset: vm.canConfirmReset,
      voiceOverInput: vm.voiceOverInput,
      on,
    }),
    e(
      'main',
      { className: 'layout' },
      e(Drill, { vm, on }),
      e(LearningNowPanel, { vm }),
      e(OverallPanel, { vm }),
    ),
  );
}
