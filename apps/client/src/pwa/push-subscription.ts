// Push plumbing both sides share (#726): the page (push-client.ts) and the
// service worker (sw.ts). Worker-safe: no DOM, no `@heartpatch/shared` values
// (the worker stays small; the server validates every body with the shared
// `PushSubscribeRequestSchema` anyway).

/** `PUT` / `DELETE` here (#726b). The page reaches it through `apiCall`. */
export const PUSH_SUBSCRIPTION_URL = '/api/v1/push/subscription';

/** The CSRF header every `/api/v1` call carries (tech spec §5; `apiCall` sends it too). */
export const API_HEADERS = {
  'x-requested-with': 'heartpatch',
  'content-type': 'application/json',
} as const;

/**
 * Where the VAPID public key waits for the worker's `pushsubscriptionchange`
 * handler, which must not need `GET /push`. A Cache Storage entry, since both
 * the page and the worker can read it; the name is outside the shell's
 * `heartpatch-shell-` prefix, so a new shell never deletes it.
 */
export const PUSH_KEY_CACHE = 'heartpatch-push';
const PUSH_KEY_PATH = '/push-key';

/** Decodes a base64url string (RFC 4648 §5, padding optional), e.g. a VAPID public key. */
export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(value)) throw new Error('not base64url');
  const base64 = value.replace(/=+$/, '').replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The parts of a `PushSubscription` both sides read (tests pass fakes). */
export interface PushSubscriptionLike {
  readonly endpoint: string;
  readonly options?: { readonly applicationServerKey: ArrayBuffer | null };
  toJSON(): PushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
}

export interface PushManagerLike {
  subscribe(options: {
    userVisibleOnly: true;
    applicationServerKey: BufferSource;
  }): Promise<PushSubscriptionLike>;
  getSubscription(): Promise<PushSubscriptionLike | null>;
}

/** The `PUT /push/subscription` body (shared `PushSubscribeRequestSchema`). */
export interface SubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime: number | null;
  replaces?: string;
}

/**
 * A subscription as the server wants it: only the fields the strict schema
 * allows. `replaces` is the endpoint this one took over from, if different.
 */
export function subscriptionBody(
  subscription: PushSubscriptionLike,
  replaces?: string,
): SubscriptionBody {
  const json = subscription.toJSON();
  const body: SubscriptionBody = {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
    expirationTime: json.expirationTime ?? null,
  };
  if (replaces !== undefined && replaces !== subscription.endpoint) body.replaces = replaces;
  return body;
}

/** Keeps the VAPID public key for the worker. Best effort. */
export async function saveVapidKey(key: string, store: CacheStorage = caches): Promise<void> {
  const cache = await store.open(PUSH_KEY_CACHE);
  await cache.put(PUSH_KEY_PATH, new Response(key, { headers: { 'content-type': 'text/plain' } }));
}

/** The kept VAPID public key, or null. Never throws. */
export async function loadVapidKey(store: CacheStorage = caches): Promise<string | null> {
  try {
    const cache = await store.open(PUSH_KEY_CACHE);
    const hit = await cache.match(PUSH_KEY_PATH);
    return hit ? await hit.text() : null;
  } catch {
    return null;
  }
}

export interface RenewDeps {
  pushManager: PushManagerLike;
  loadKey: () => Promise<string | null>;
  put: (body: SubscriptionBody) => Promise<void>;
}

/**
 * The worker's `pushsubscriptionchange` (#726 plan, "Subscriptions rotate"):
 * use the browser's new subscription, else subscribe again with the old one's
 * key (or the kept one), then `PUT` it with `replaces: <old endpoint>` so the
 * server drops the dead row. Resolves false when there was nothing to do it
 * with (no key, no subscription); a failing `PUT` rejects.
 */
export async function renewSubscription(
  oldSubscription: PushSubscriptionLike | null,
  newSubscription: PushSubscriptionLike | null,
  deps: RenewDeps,
): Promise<boolean> {
  let next = newSubscription;
  if (!next) {
    const kept = oldSubscription?.options?.applicationServerKey ?? null;
    const stored = kept ? null : await deps.loadKey();
    let key: BufferSource | null = kept;
    if (!key && stored) {
      try {
        key = base64UrlToUint8Array(stored);
      } catch {
        key = null;
      }
    }
    if (!key) return false;
    next = await deps.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  await deps.put(subscriptionBody(next, oldSubscription?.endpoint));
  return true;
}
