import {
  UPDATE_APPLY_AFTER_HIDDEN_MS,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_MIN_GAP_MS,
} from './config.js';
import { isWorkerDescription, type WorkerDescription } from './messages.js';
import { startUpdates, type RegistrationLike, type WorkerLike } from './update-flow.js';

/** How long to wait for a worker to describe itself before assuming it's new. */
const DESCRIBE_TIMEOUT_MS = 3000;

function describe(worker: WorkerLike, path: string): Promise<WorkerDescription | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      resolve(null);
    }, DESCRIBE_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      clearTimeout(timer);
      resolve(isWorkerDescription(event.data) ? event.data : null);
    };
    worker.postMessage({ type: 'describe', path }, [channel.port2]);
  });
}

/** Registers /sw.js and rolls out new versions (src/pwa/update-flow.ts). */
export async function registerServiceWorker(
  onUpdateReady: (apply: () => void) => void,
): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;
  await startUpdates(
    {
      controller: () => container.controller,
      onControllerChange: (listener) => {
        container.addEventListener('controllerchange', listener);
      },
      // `updateViaCache: 'none'`: update checks always ask the server for sw.js.
      register: async (): Promise<RegistrationLike> =>
        container.register('/sw.js', { updateViaCache: 'none' }),
      describe,
      // This module is part of the entry bundle, so its URL names this build.
      runningPath: new URL(import.meta.url).pathname,
      reload: () => {
        window.location.reload();
      },
      now: () => Date.now(),
      every: (ms, task) => {
        setInterval(task, ms);
      },
      onVisibilityChange: (listener) => {
        document.addEventListener('visibilitychange', () => {
          listener(document.visibilityState === 'visible');
        });
      },
      onUpdateReady,
    },
    {
      checkIntervalMs: UPDATE_CHECK_INTERVAL_MS,
      checkMinGapMs: UPDATE_CHECK_MIN_GAP_MS,
      applyAfterHiddenMs: UPDATE_APPLY_AFTER_HIDDEN_MS,
    },
  );
}
