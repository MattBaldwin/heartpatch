import type { Page } from '@playwright/test';

// A stand-in for an iPhone Home Screen app with push (#726): Playwright can't
// receive a real push, and WebKit outside a Home Screen app has no
// `PushManager`. Installed with `addInitScript`, so it is there before the
// app's first line runs. What it remembers (permission, subscription, Home
// Screen or tab) lives in sessionStorage, so a reload keeps it, and
// `setPushStub` changes it for the next load.

export interface PushStub {
  /** A Home Screen app (`navigator.standalone`, `display-mode: standalone`). */
  standalone: boolean;
  /** `Notification.permission` at start. */
  permission: NotificationPermission;
  /** What the iOS prompt answers. */
  answer: NotificationPermission;
}

const STUB_KEY = 'heartpatch.e2ePush';
const SUB_KEY = 'heartpatch.e2ePushEndpoint';

/** Installs the stand-in on the page's context (from the next load). */
export async function stubPush(page: Page, start: Partial<PushStub> = {}): Promise<void> {
  const first: PushStub = { standalone: true, permission: 'default', answer: 'granted', ...start };
  await page.context().addInitScript(
    ({ first, stubKey, subKey }) => {
      const read = (): PushStub => {
        try {
          return { ...first, ...JSON.parse(sessionStorage.getItem(stubKey) ?? '{}') } as PushStub;
        } catch {
          return first;
        }
      };
      const write = (patch: Partial<PushStub>) => {
        sessionStorage.setItem(stubKey, JSON.stringify({ ...read(), ...patch }));
      };
      const stub = read();
      const counts = { requests: 0, subscribes: 0 };
      (window as unknown as { __pushStub: typeof counts }).__pushStub = counts;

      Object.defineProperty(navigator, 'standalone', {
        configurable: true,
        get: () => stub.standalone,
      });
      const matchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query.includes('display-mode: standalone')
          ? ({
              matches: stub.standalone,
              media: query,
              onchange: null,
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
              addListener: () => undefined,
              removeListener: () => undefined,
              dispatchEvent: () => false,
            } as MediaQueryList)
          : matchMedia(query);

      const FakeNotification = {
        get permission(): NotificationPermission {
          return read().permission;
        },
        requestPermission(): Promise<NotificationPermission> {
          const now = read();
          // Only a `default` permission brings up iOS's question.
          if (now.permission === 'default') {
            counts.requests++;
            write({ permission: now.answer });
          }
          return Promise.resolve(read().permission);
        },
      };
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: FakeNotification,
      });
      if (!('PushManager' in window)) {
        Object.defineProperty(window, 'PushManager', {
          configurable: true,
          value: function PushManager() {},
        });
      }

      // A 65-byte P-256 point and a 16-byte secret, base64url: the shapes the server checks.
      const keys = { p256dh: `B${'Q'.repeat(86)}`, auth: 'A'.repeat(22) };
      const subscription = (endpoint: string) => ({
        endpoint,
        expirationTime: null,
        toJSON: () => ({ endpoint, expirationTime: null, keys }),
        unsubscribe: () => {
          sessionStorage.removeItem(subKey);
          return Promise.resolve(true);
        },
      });
      const pushManager = {
        subscribe: () => {
          counts.subscribes++;
          if (read().permission !== 'granted') {
            return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
          }
          // A host the server accepts (it only stores real push services'). The
          // e2e server sends no nudge to it: nothing in these specs is due.
          const endpoint = `https://web.push.apple.com/e2e-${Math.random().toString(36).slice(2)}`;
          sessionStorage.setItem(subKey, endpoint);
          return Promise.resolve(subscription(endpoint));
        },
        getSubscription: () => {
          const endpoint = sessionStorage.getItem(subKey);
          return Promise.resolve(endpoint ? subscription(endpoint) : null);
        },
      };
      // The dev server has no service worker: hand the app a ready one with push.
      const ready = Promise.resolve({ pushManager });
      if ('serviceWorker' in navigator) {
        Object.defineProperty(navigator.serviceWorker, 'ready', {
          configurable: true,
          get: () => ready,
        });
      } else {
        Object.defineProperty(navigator, 'serviceWorker', {
          configurable: true,
          value: Object.assign(new EventTarget(), { ready }),
        });
      }
    },
    { first, stubKey: STUB_KEY, subKey: SUB_KEY },
  );
}

/** Changes the stand-in for the next load (a reload keeps the rest). */
export async function setPushStub(page: Page, patch: Partial<PushStub>): Promise<void> {
  await page.evaluate(
    ({ patch, stubKey }) => {
      const now = JSON.parse(sessionStorage.getItem(stubKey) ?? '{}') as object;
      sessionStorage.setItem(stubKey, JSON.stringify({ ...now, ...patch }));
    },
    { patch, stubKey: STUB_KEY },
  );
}

/** How often iOS's question came up, and how often the app subscribed, on this load. */
export async function pushStubCounts(
  page: Page,
): Promise<{ requests: number; subscribes: number }> {
  return page.evaluate(
    () =>
      (window as unknown as { __pushStub: { requests: number; subscribes: number } }).__pushStub,
  );
}
