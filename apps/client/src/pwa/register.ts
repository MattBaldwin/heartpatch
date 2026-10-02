import { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_MIN_GAP_MS } from './config.js';

// Registers /sw.js and rolls out new versions (issue #26). A new version
// installs in the background, then waits; the player taps "Update" to switch
// and reload. Every launch also loads the newest index.html from the network
// (src/pwa/sw.ts), so an old shell never outlives a relaunch.

/** Messages to src/pwa/sw.ts (kept in sync by hand: the worker can't import). */
type WorkerMessage = { type: 'skip-waiting' } | { type: 'version' };

export interface UpdateHooks {
  /** A new version is ready. `apply` switches to it and reloads the page. */
  onUpdateReady: (apply: () => void) => void;
}

export async function registerServiceWorker({ onUpdateReady }: UpdateHooks): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;

  let applying = false;
  container.addEventListener('controllerchange', () => {
    // The first install also changes the controller (clients.claim), with
    // nothing to reload for; only reload when the player asked to update.
    if (!applying) return;
    applying = false;
    window.location.reload();
  });
  const apply = (worker: ServiceWorker) => {
    applying = true;
    const message: WorkerMessage = { type: 'skip-waiting' };
    worker.postMessage(message);
  };

  const offered = new WeakSet<ServiceWorker>();
  const offer = (worker: ServiceWorker) => {
    // No controller means a first install: there's no old version to replace.
    if (!container.controller || offered.has(worker)) return;
    offered.add(worker);
    onUpdateReady(() => {
      apply(worker);
    });
  };
  const track = (worker: ServiceWorker) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer(worker);
    });
  };

  // `updateViaCache: 'none'`: update checks always ask the server for sw.js.
  const registration = await container.register('/sw.js', { updateViaCache: 'none' });

  if (registration.waiting && container.controller) {
    // A version finished installing while the app was closed. The page has
    // only just loaded, so switch now rather than ask.
    apply(registration.waiting);
  }
  if (registration.installing) track(registration.installing);
  registration.addEventListener('updatefound', () => {
    if (registration.installing) track(registration.installing);
  });

  let lastCheck = Date.now();
  const check = () => {
    lastCheck = Date.now();
    // Offline: try again on the next check.
    registration.update().catch(() => undefined);
  };
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      Date.now() - lastCheck >= UPDATE_CHECK_MIN_GAP_MS
    ) {
      check();
    }
  });
}
