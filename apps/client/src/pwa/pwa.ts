import { createInstallGuide, type InstallGuide } from './install-guide.js';
import { registerServiceWorker } from './register.js';
import { mountUpdatePrompt } from './update-prompt.js';
import './pwa.css';

/**
 * The installable app (issue #26): offline shell, update prompt and the Add
 * to Home Screen guide (returned, for the lobby to show). main.ts calls this in production builds only; a
 * service worker on the dev server would serve stale modules.
 */
export function startPwa(root: HTMLElement): InstallGuide {
  const guide = createInstallGuide();
  const prompt = mountUpdatePrompt(root);
  registerServiceWorker(prompt.show).catch((err: unknown) => {
    // The game works without it, just not offline.
    console.warn('Service worker registration failed', err);
  });
  // The guide is a card in the lobby's patch list (#135).
  return guide;
}
