import { createWebAPIs } from './api';
import type { RuntimeAPIs } from '@ax-code/app-ui/lib/api/types';
import '@ax-code/app-ui/index.css';
import '@ax-code/app-ui/styles/fonts';

declare global {
  interface Window {
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

window.__OPENCHAMBER_RUNTIME_APIS__ = createWebAPIs();

void import('@ax-code/app-ui/apps/renderElectronMiniChatApp')
  .then(({ renderElectronMiniChatApp }) => {
    renderElectronMiniChatApp(window.__OPENCHAMBER_RUNTIME_APIS__ ?? createWebAPIs());
  });
