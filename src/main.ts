// Bootstrap: create the interaction store (persisted to localStorage) and
// re-render the pure UI from a fresh view-model snapshot on every change.

import { createElement as e } from 'react';
import { createRoot } from 'react-dom/client';
import { createTutorStore } from './state';
import { App } from './ui';
import './ui/styles.css';

const store = createTutorStore({ storage: window.localStorage });

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}
const root = createRoot(container);

function renderApp(): void {
  root.render(e(App, { vm: store.viewModel(), on: store.handlers }));
}

store.subscribe(renderApp);
renderApp();
