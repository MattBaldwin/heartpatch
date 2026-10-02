import { mountInstallGuide } from './install-guide.js';
import { registerServiceWorker } from './register.js';
import { mountUpdatePrompt } from './update-prompt.js';
import './pwa.css';

/**
 * The installable app (issue #26): offline shell, update prompt and the Add
 * to Home Screen guide. main.ts calls this in production builds only; a
 * service worker on the dev server would serve stale modules.
 */
export function startPwa(root: HTMLElement): void {
  mountInstallGuide(root);
  const prompt = mountUpdatePrompt(root);
  registerServiceWorker({ onUpdateReady: prompt.show }).catch((err: unknown) => {
    // The game works without it, just not offline.
    console.warn('Service worker registration failed', err);
  });
}
