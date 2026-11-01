import { appUpdates } from './app-updates.js';
import { createInstallGuide, type InstallGuide } from './install-guide.js';
import { pushClient, type PushClient } from './push-client.js';
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
  // The pill and the profile menu's "Update now" (#198) both offer it.
  registerServiceWorker((apply) => {
    appUpdates.offer(apply);
    prompt.show(apply);
  }).catch((err: unknown) => {
    // The game works without it, just not offline.
    console.warn('Service worker registration failed', err);
  });
  startPush(pushClient);
  // The guide is a card in the lobby's patch list (#135).
  return guide;
}

/** The parts of the page `startPush` touches (tests pass fakes). */
export interface PushStartEnv {
  clearBadge(): void;
  onVisible(listener: () => void): void;
}

function browserPushStartEnv(): PushStartEnv {
  return {
    clearBadge: () => {
      // Home Screen apps on iOS 16.4+; older browsers have no badge to clear.
      if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => undefined);
    },
    onVisible: (listener) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') listener();
      });
    },
  };
}

/**
 * Push at start-up (#726 plan, "Start-up"), in a Home Screen app with push
 * only: clear the badge a nudge set, now and whenever the app comes back,
 * and re-send this device's subscription (the self-heal, once a day).
 */
export function startPush(client: PushClient, env: PushStartEnv = browserPushStartEnv()): void {
  if (!client.supported()) return;
  env.clearBadge();
  env.onVisible(() => {
    env.clearBadge();
  });
  void client.heal();
}
