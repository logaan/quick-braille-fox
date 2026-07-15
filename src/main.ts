import { createElement as e } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/index';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}
createRoot(container).render(e(App));
