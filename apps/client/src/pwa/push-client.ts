import {
  PushOkResponseSchema,
  PushSettingsSchema,
  PushStatusResponseSchema,
  type PushSettings,
  type PushSettingsPatch,
  type PushStatusResponse,
} from '@heartpatch/shared';
import { ApiRequestError, apiCall, apiCallFor } from '../net/api.js';
import { PUSH_HEAL_INTERVAL_MS, PUSH_HEALED_AT_KEY, PUSH_READY_TIMEOUT_MS } from './config.js';
import { isPageMessage } from './messages.js';
import { isStandalone } from './platform.js';
import {
  base64UrlToUint8Array,
  saveVapidKey,
  subscriptionBody,
  type PushManagerLike,
  type PushSubscriptionLike,
} from './push-subscription.js';

// Push nudges on this device (#726 plan, "Client UI flow"): the helpers the
// offer card and Settings call, and the start-up self-heal and logout hooks.
// Everything the browser provides comes in through `PushEnv`, so it's
// unit-tested with fakes. `/push` routes answer NOT_FOUND while push is off
// for this player: after the first one, every helper treats push as off for
// the rest of the session and never calls again.

/** The parts of `window.Notification` used. */
export interface NotificationLike {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
}

/** What the browser gives this module. `browserPushEnv()` is the real one. */
export interface PushEnv {
  /** `isStandalone()`: a Home Screen app. iOS has push only there. */
  standalone(): boolean;
  /** `'PushManager' in window`. */
  hasPushManager(): boolean;
  /** `window.Notification`, or null. */
  notification(): NotificationLike | null;
  /** `navigator.serviceWorker.ready`'s push manager. Never resolves without a worker. */
  pushManager(): Promise<PushManagerLike>;
  fetch: typeof fetch;
  storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now(): number;
  saveKey(key: string): Promise<void>;
  /** Hears worker → page messages. */
  onWorkerMessage(listener: (data: unknown) => void): void;
  /** Resolves after `ms`. */
  sleep: (ms: number) => Promise<void>;
}

/** `GET /push`: available (with the key to subscribe with), off for me, or unreachable. */
export type PushStatus =
  ({ state: 'available' } & PushStatusResponse) | { state: 'off' } | { state: 'unreachable' };

/**
 * How a subscribe ended. `on`: subscribed and the server has it. `denied`:
 * the player said no or closed the prompt (never ask again; iOS keeps "no").
 * `off`: push is off for this player. `failed`: anything else (offline, the
 * push service refused); nothing is left subscribed.
 */
export type SubscribeOutcome = 'on' | 'denied' | 'off' | 'failed';

/** This device's push, once the service worker is ready (`pushClient.device()`). */
export interface PushDevice {
  /**
   * Subscribes this device. **Call it synchronously inside the tap handler**
   * (no `await` before it in the handler): iOS only allows the permission
   * prompt and `pushManager.subscribe` during a user gesture. This function
   * starts both before its first `await`, which is why it takes the key
   * rather than fetching it: get `vapidPublicKey` from `pushClient.status()`
   * and the device from `pushClient.device()` before showing the button.
   *
   * ```ts
   * const status = await pushClient.status();     // before: show the card
   * const device = await pushClient.device();     // only if both are ready
   * yes.addEventListener('click', () => {
   *   void device.subscribe(status.vapidPublicKey).then(showOutcome);
   * });
   * ```
   */
  subscribe(vapidPublicKey: string): Promise<SubscribeOutcome>;
  /** Stops nudges here: `DELETE` on the server, then unsubscribe locally (always). */
  unsubscribe(): Promise<void>;
  /** The current subscription, or null. */
  subscription(): Promise<PushSubscriptionLike | null>;
}

/** Self-heal is due when it never ran or ran at least `intervalMs` ago (a bad stamp is due). */
export function healDue(stamp: string | null, now: number, intervalMs: number): boolean {
  if (stamp === null) return true;
  const at = Number(stamp);
  if (!Number.isFinite(at) || at > now) return true;
  return now - at >= intervalMs;
}

function withTimeout<T>(work: Promise<T>, ms: number, sleep: PushEnv['sleep']): Promise<T | null> {
  return Promise.race([work, sleep(ms).then(() => null)]);
}

export function createPushClient(env: PushEnv) {
  let off = false;

  /** Runs a `/push` call; a NOT_FOUND turns push off for the session. */
  async function call<T>(work: () => Promise<T>): Promise<T | 'off'> {
    if (off) return 'off';
    try {
      return await work();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'NOT_FOUND') {
        off = true;
        return 'off';
      }
      throw err;
    }
  }

  const put = (subscription: PushSubscriptionLike) =>
    call(() =>
      apiCallFor(
        '/push/subscription',
        { method: 'PUT', body: subscriptionBody(subscription), schema: PushOkResponseSchema },
        env.fetch,
      ),
    );

  function stamp(): void {
    try {
      env.storage()?.setItem(PUSH_HEALED_AT_KEY, String(env.now()));
    } catch {
      // Blocked: the next start heals again, which is a cheap upsert.
    }
  }

  function supported(): boolean {
    return env.standalone() && env.hasPushManager() && env.notification() !== null;
  }

  async function pushManager(): Promise<PushManagerLike | null> {
    if (!supported()) return null;
    try {
      return await withTimeout(env.pushManager(), PUSH_READY_TIMEOUT_MS, env.sleep);
    } catch {
      return null;
    }
  }

  function device(manager: PushManagerLike, notification: NotificationLike): PushDevice {
    async function finish(
      asked: Promise<NotificationPermission>,
      subscribing: Promise<PushSubscriptionLike>,
      key: string,
    ): Promise<SubscribeOutcome> {
      // Whatever the prompt said, never leave its rejection unhandled.
      const answer = asked.catch(() => notification.permission);
      let subscription: PushSubscriptionLike;
      try {
        subscription = await subscribing;
      } catch {
        return (await answer) === 'granted' ? 'failed' : 'denied';
      }
      const saved = await put(subscription).catch(() => null);
      if (saved === null || saved === 'off') {
        // Don't leave a subscription the server doesn't know about.
        await subscription.unsubscribe().catch(() => false);
        return saved === 'off' ? 'off' : 'failed';
      }
      stamp();
      await env.saveKey(key).catch(() => undefined);
      return 'on';
    }

    return {
      subscribe(vapidPublicKey) {
        if (off) return Promise.resolve('off');
        let key: Uint8Array<ArrayBuffer>;
        try {
          key = base64UrlToUint8Array(vapidPublicKey);
        } catch {
          return Promise.resolve('failed');
        }
        // The gesture-bound calls, before any await (see the doc comment).
        let asked: Promise<NotificationPermission>;
        let subscribing: Promise<PushSubscriptionLike>;
        try {
          asked = notification.requestPermission();
        } catch (err) {
          asked = Promise.reject(err instanceof Error ? err : new Error('requestPermission'));
        }
        try {
          subscribing = manager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        } catch (err) {
          subscribing = Promise.reject(err instanceof Error ? err : new Error('subscribe'));
        }
        return finish(asked, subscribing, vapidPublicKey);
      },

      async unsubscribe() {
        const subscription = await manager.getSubscription().catch(() => null);
        if (!subscription) return;
        try {
          await call(() =>
            apiCall(
              '/push/subscription',
              {
                method: 'DELETE',
                body: { endpoint: subscription.endpoint },
                schema: PushOkResponseSchema,
              },
              env.fetch,
            ),
          );
        } catch {
          // Offline: the server drops the row when Apple says it's gone.
        }
        await subscription.unsubscribe().catch(() => false);
      },

      subscription: () => manager.getSubscription().catch(() => null),
    };
  }

  return {
    /** A Home Screen app with push (#726 plan, "iOS and iPadOS reality"). */
    supported,

    /** The notification permission, or `unsupported` outside a Home Screen app with push. */
    permission(): NotificationPermission | 'unsupported' {
      return supported() ? (env.notification()?.permission ?? 'unsupported') : 'unsupported';
    },

    /** True once a `/push` route said NOT_FOUND this session. */
    isOff: () => off,

    /** `GET /push`. `off` is remembered for the session; `unreachable` may be retried. */
    async status(): Promise<PushStatus> {
      try {
        const result = await call(() =>
          apiCallFor('/push', { method: 'GET', schema: PushStatusResponseSchema }, env.fetch),
        );
        return result === 'off' ? { state: 'off' } : { state: 'available', ...result };
      } catch {
        return { state: 'unreachable' };
      }
    },

    /** `PUT /push/settings`: the switches as saved, `off`, or null when it didn't save. */
    async saveSettings(patch: PushSettingsPatch): Promise<PushSettings | 'off' | null> {
      try {
        return await call(() =>
          apiCallFor(
            '/push/settings',
            { method: 'PUT', body: patch, schema: PushSettingsSchema },
            env.fetch,
          ),
        );
      } catch {
        return null;
      }
    },

    /**
     * This device's push, or null when unsupported or the service worker isn't
     * ready in time (dev builds have none). Await it before showing a button
     * that subscribes: see `PushDevice.subscribe`.
     */
    async device(): Promise<PushDevice | null> {
      const notification = env.notification();
      const manager = await pushManager();
      return manager && notification ? device(manager, notification) : null;
    },

    /**
     * Start-up self-heal (#726 plan, "Start-up"): when permission is granted
     * and this device has a subscription, `PUT` it again (an upsert by
     * endpoint), at most once per `PUSH_HEAL_INTERVAL_MS`. Never throws.
     */
    async heal(): Promise<'healed' | 'skipped' | 'failed'> {
      if (off || !supported() || env.notification()?.permission !== 'granted') return 'skipped';
      let last: string | null;
      try {
        last = env.storage()?.getItem(PUSH_HEALED_AT_KEY) ?? null;
      } catch {
        last = null;
      }
      if (!healDue(last, env.now(), PUSH_HEAL_INTERVAL_MS)) return 'skipped';
      const manager = await pushManager();
      const subscription = await manager?.getSubscription().catch(() => null);
      if (!subscription) return 'skipped';
      try {
        if ((await put(subscription)) === 'off') return 'skipped';
      } catch {
        return 'failed';
      }
      stamp();
      return 'healed';
    },

    /**
     * Logout (#726 plan, "Logout"): unsubscribe this device locally, best
     * effort and bounded by `timeoutMs`; the server's session cascade deletes
     * the row. "Off" was the old player's (`HP_PUSH=testers` is per account),
     * so the next one to sign in asks again. Never throws.
     */
    async forgetDevice(timeoutMs: number): Promise<void> {
      off = false;
      // A subscription is only ever made in a Home Screen app with push.
      if (!supported()) return;
      const work = (async () => {
        const manager = await env.pushManager();
        const subscription = await manager.getSubscription();
        await subscription?.unsubscribe();
      })();
      await withTimeout(work, timeoutMs, env.sleep).catch(() => null);
    },

    /** Hears a tapped nudge while the app is open: open `mapId` (null: none named). */
    onOpenMap(listener: (mapId: string | null) => void): void {
      env.onWorkerMessage((data) => {
        if (isPageMessage(data)) listener(data.mapId);
      });
    },
  };
}

export type PushClient = ReturnType<typeof createPushClient>;

/** The real browser, read when called (so importing this module touches nothing). */
export function browserPushEnv(): PushEnv {
  return {
    standalone: () =>
      isStandalone({
        iosStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
        standaloneDisplay: window.matchMedia('(display-mode: standalone)').matches,
      }),
    hasPushManager: () => 'PushManager' in window && 'serviceWorker' in navigator,
    notification: () => ('Notification' in window ? window.Notification : null),
    pushManager: async () => (await navigator.serviceWorker.ready).pushManager,
    fetch: (input, init) => fetch(input, init),
    storage: () => window.localStorage,
    now: () => Date.now(),
    saveKey: (key) => saveVapidKey(key),
    onWorkerMessage: (listener) => {
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
        listener(event.data);
      });
    },
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}

/** The app's push client (one per page, so "off" holds for the session). */
export const pushClient: PushClient = createPushClient(browserPushEnv());
