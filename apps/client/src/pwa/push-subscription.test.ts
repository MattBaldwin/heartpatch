import { PushSubscribeRequestSchema } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  base64UrlToUint8Array,
  loadVapidKey,
  renewSubscription,
  saveVapidKey,
  subscriptionBody,
  type PushManagerLike,
  type PushSubscriptionLike,
  type SubscriptionBody,
} from './push-subscription.js';

// A VAPID public key's shape: an uncompressed P-256 point, 65 bytes starting
// 0x04, which base64url-encodes to "B" + 86 characters.
const POINT = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : (i * 37) % 256));
const VAPID_KEY = Buffer.from(POINT).toString('base64url');

class FakeSubscription implements PushSubscriptionLike {
  unsubscribed = 0;
  readonly options: { applicationServerKey: ArrayBuffer | null };
  readonly endpoint: string;
  constructor(endpoint: string, key: ArrayBuffer | null = null) {
    this.endpoint = endpoint;
    this.options = { applicationServerKey: key };
  }
  toJSON(): PushSubscriptionJSON {
    return {
      endpoint: this.endpoint,
      expirationTime: null,
      keys: { p256dh: Buffer.from(POINT).toString('base64url'), auth: 'c2VjcmV0LWF1dGgtMTY' },
    };
  }
  unsubscribe(): Promise<boolean> {
    this.unsubscribed++;
    return Promise.resolve(true);
  }
}

class FakePushManager implements PushManagerLike {
  keys: BufferSource[] = [];
  current: PushSubscriptionLike | null = null;
  subscribe(options: { applicationServerKey: BufferSource }): Promise<PushSubscriptionLike> {
    this.keys.push(options.applicationServerKey);
    this.current = new FakeSubscription('https://push.example/new');
    return Promise.resolve(this.current);
  }
  getSubscription(): Promise<PushSubscriptionLike | null> {
    return Promise.resolve(this.current);
  }
}

describe('base64UrlToUint8Array', () => {
  it('decodes a VAPID public key to its 65-byte point', () => {
    expect(VAPID_KEY).toMatch(/^B[A-Za-z0-9_-]{86}$/);
    const bytes = base64UrlToUint8Array(VAPID_KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect([...bytes]).toEqual([...POINT]);
  });

  it('decodes with or without padding, and the url-safe characters', () => {
    expect([...base64UrlToUint8Array('-_8')]).toEqual([0xfb, 0xff]);
    expect([...base64UrlToUint8Array('-_8=')]).toEqual([0xfb, 0xff]);
    expect([...base64UrlToUint8Array('')]).toEqual([]);
  });

  it('refuses plain base64 and junk', () => {
    expect(() => base64UrlToUint8Array('ab+/')).toThrow();
    expect(() => base64UrlToUint8Array('not a key!')).toThrow();
  });
});

describe('subscriptionBody', () => {
  it('is exactly what the server’s strict schema takes', () => {
    const body = subscriptionBody(new FakeSubscription('https://push.example/a'));
    expect(PushSubscribeRequestSchema.parse(body)).toEqual(body);
    expect(body).not.toHaveProperty('replaces');
  });

  it('names the endpoint it replaces, unless it is the same one', () => {
    const sub = new FakeSubscription('https://push.example/b');
    expect(subscriptionBody(sub, 'https://push.example/a').replaces).toBe('https://push.example/a');
    expect(subscriptionBody(sub, 'https://push.example/b')).not.toHaveProperty('replaces');
  });
});

describe('saveVapidKey / loadVapidKey', () => {
  it('keeps the key in its own cache, outside the shell', async () => {
    const stored = new Map<string, Map<string, string>>();
    const store = {
      open: (name: string) => {
        const cache = stored.get(name) ?? new Map<string, string>();
        stored.set(name, cache);
        return Promise.resolve({
          put: async (path: string, response: Response) => {
            cache.set(path, await response.text());
          },
          match: (path: string) =>
            Promise.resolve(cache.has(path) ? new Response(cache.get(path)) : undefined),
        });
      },
    } as unknown as CacheStorage;
    expect(await loadVapidKey(store)).toBeNull();
    await saveVapidKey(VAPID_KEY, store);
    expect(await loadVapidKey(store)).toBe(VAPID_KEY);
    expect([...stored.keys()]).toEqual(['heartpatch-push']);
  });

  it('reads as no key when Cache Storage fails', async () => {
    const broken = { open: () => Promise.reject(new Error('no')) } as unknown as CacheStorage;
    expect(await loadVapidKey(broken)).toBeNull();
  });
});

describe('renewSubscription', () => {
  function deps(key: string | null = VAPID_KEY) {
    const manager = new FakePushManager();
    const puts: SubscriptionBody[] = [];
    return {
      manager,
      puts,
      deps: {
        pushManager: manager,
        loadKey: () => Promise.resolve(key),
        put: (body: SubscriptionBody) => {
          puts.push(body);
          return Promise.resolve();
        },
      },
    };
  }

  it('sends the browser’s new subscription, replacing the old one', async () => {
    const { manager, puts, deps: d } = deps();
    const old = new FakeSubscription('https://push.example/old');
    const next = new FakeSubscription('https://push.example/next');
    expect(await renewSubscription(old, next, d)).toBe(true);
    expect(manager.keys).toEqual([]);
    expect(puts).toEqual([
      expect.objectContaining({
        endpoint: 'https://push.example/next',
        replaces: 'https://push.example/old',
      }),
    ]);
  });

  it('subscribes again with the old subscription’s key', async () => {
    const { manager, puts, deps: d } = deps(null);
    const key = POINT.buffer;
    await renewSubscription(new FakeSubscription('https://push.example/old', key), null, d);
    expect(manager.keys).toEqual([key]);
    expect(puts[0]).toMatchObject({
      endpoint: 'https://push.example/new',
      replaces: 'https://push.example/old',
    });
  });

  it('falls back to the kept key, with no old subscription', async () => {
    const { manager, puts, deps: d } = deps();
    expect(await renewSubscription(null, null, d)).toBe(true);
    expect([...new Uint8Array(manager.keys[0] as ArrayBuffer)]).toEqual([...POINT]);
    expect(puts[0]).not.toHaveProperty('replaces');
  });

  it('does nothing without a key', async () => {
    const { manager, puts, deps: d } = deps(null);
    expect(await renewSubscription(new FakeSubscription('https://push.example/old'), null, d)).toBe(
      false,
    );
    expect(manager.keys).toEqual([]);
    expect(puts).toEqual([]);
  });

  it('does nothing with a broken kept key', async () => {
    const { puts, deps: d } = deps('not a key!');
    expect(await renewSubscription(null, null, d)).toBe(false);
    expect(puts).toEqual([]);
  });
});
