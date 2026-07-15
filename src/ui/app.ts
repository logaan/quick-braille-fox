// Top-level layout: header, drill view, skill panel.

import { createElement as e, type ReactElement } from 'react';
import type { AppHandlers, AppViewModel } from '../state';
import { Drill } from './drill';
import { Header } from './header';
import { SkillPanel } from './skills';

export interface AppProps {
  readonly vm: AppViewModel;
  readonly on: AppHandlers;
}

export function App(props: AppProps): ReactElement {
  const { vm, on } = props;
  return e(
    'div',
    { className: 'app' },
    e(Header, { bestQbf: vm.bestQbf, confirmingReset: vm.confirmingReset, on }),
    e(
      'main',
      { className: 'layout' },
      e(Drill, { vm, on }),
      e(SkillPanel, { vm }),
    ),
  );
}
