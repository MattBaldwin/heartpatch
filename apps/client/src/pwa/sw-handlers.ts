import { isWorkerRequest, type PageMessage, type WorkerDescription } from './messages.js';
import { mapIdOf, nudgeFor } from './push-payload.js';
import { API_HEADERS, PUSH_SUBSCRIPTION_URL } from './push-subscription.js';

// The service worker's event glue (sw.ts), kept apart from `self` so it's
// unit-tested (sw-handlers.test.ts). Each handler gets the worker parts it
// touches; the types are the few members used, so the tests pass fakes and
// this file builds under both the DOM and WebWorker libs. No zod here: the
// worker stays small (see push-payload.ts).

/** What `message` answers a `describe` with, and how it skips waiting. */
export interface WorkerSelf {
  version: string;
  cache: string;
  hasPath: (path: string) => boolean;
  skipWaiting: () => Promise<void>;
}

/**
 * A page's message (register.ts): `skip-waiting`, or `describe`, answered on
 * the message's first port. Anything else is ignored.
 */
export function answerMessage(
  data: unknown,
  ports: readonly { postMessage: (message: WorkerDescription) => void }[],
  worker: WorkerSelf,
): void {
  if (!isWorkerRequest(data)) return;
  if (data.type === 'skip-waiting') {
    void worker.skipWaiting();
    return;
  }
  ports[0]?.postMessage({
    version: worker.version,
    cache: worker.cache,
    hasPath: worker.hasPath(data.path),
  });
}

export interface NudgeTargets {
  showNotification: (title: string, options: NotificationOptions) => Promise<void>;
  /** The app icon's badge, where the browser has one. */
  setAppBadge?: ((count: number) => Promise<void>) | undefined;
}

/**
 * A push: always show something, even for a push it can't read (iOS ends a
 * subscription after a few pushes that show nothing), and badge the icon.
 * No network work. Never rejects for the badge.
 */
export function showNudge(text: string | null, targets: NudgeTargets): Promise<unknown> {
  const nudge = nudgeFor(text);
  const options: NotificationOptions & { renotify: boolean } = {
    body: nudge.body,
    tag: nudge.tag,
    data: nudge.data,
    renotify: false,
  };
  return Promise.all([
    targets.showNotification(nudge.title, options),
    // The app's start-up clears it (pwa.ts).
    targets.setAppBadge?.(1).catch(() => undefined),
  ]);
}

export interface WorkerClients {
  matchAll: (options: {
    type: 'window';
    includeUncontrolled: boolean;
  }) => Promise<
    readonly { postMessage: (message: PageMessage) => void; focus: () => Promise<unknown> }[]
  >;
  openWindow: (url: string) => Promise<unknown>;
}

/**
 * A tapped nudge: with the app open, tell it which patch (`open-map`) and
 * bring it to the front; otherwise open `/`. No patch deep link exists yet:
 * a cold start opens where it would anyway (the last patch, #160).
 */
export async function openNudge(notificationData: unknown, clients: WorkerClients): Promise<void> {
  const mapId = mapIdOf(notificationData);
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows[0];
  if (open) {
    open.postMessage({ type: 'open-map', mapId });
    await open.focus();
    return;
  }
  await clients.openWindow('/');
}

/** `PUT` a renewed subscription; throws when the server says no. */
export async function putSubscription(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  body: unknown,
): Promise<void> {
  const response = await fetcher(PUSH_SUBSCRIPTION_URL, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: API_HEADERS,
    body: JSON.stringify(body),
  });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`push subscription ${String(response.status)}`);
}
