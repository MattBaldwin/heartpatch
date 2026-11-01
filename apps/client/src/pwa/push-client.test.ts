import { describe, expect, it } from 'vitest';
import { PUSH_HEAL_INTERVAL_MS, PUSH_HEALED_AT_KEY } from './config.js';
import { createPushClient, healDue, type NotificationLike, type PushEnv } from './push-client.js';
import type { PushManagerLike, PushSubscriptionLike } from './push-subscription.js';
import { startPush, type PushStartEnv } from './pwa.js';

const VAPID_KEY = `B${'A'.repeat(86)}`;
const SETTINGS = { dusk: true, gatherers: true, friend: false, longNight: true };
const DAY = PUSH_HEAL_INTERVAL_MS;

class FakeSubscription implements PushSubscriptionLike {
  unsubscribed = 0;
  readonly endpoint: string;
  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }
  toJSON(): PushSubscriptionJSON {
    return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: 'p256', auth: 'au' } };
  }
  unsubscribe(): Promise<boolean> {
    this.unsubscribed++;
    return Promise.resolve(true);
  }
}

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** A fake browser: every call lands in `log`, in order. */
function fakeEnv(
  opts: {
    standalone?: boolean;
    permission?: NotificationPermission;
    answer?: NotificationPermission;
    subscribeFails?: boolean;
    existing?: boolean;
    reply?: (call: Call) => { status: number; body?: unknown } | 'offline';
    storage?: Map<string, string> | 'blocked';
    now?: number;
    workerNeverReady?: boolean;
  } = {},
) {
  const log: string[] = [];
  const calls: Call[] = [];
  const saved: string[] = [];
  const listeners: ((data: unknown) => void)[] = [];
  const store = opts.storage ?? new Map<string, string>();
  let current: FakeSubscription | null = opts.existing
    ? new FakeSubscription('https://push.example/existing')
    : null;
  const notification: NotificationLike & { permission: NotificationPermission } = {
    permission: opts.permission ?? 'default',
    requestPermission() {
      log.push('requestPermission');
      notification.permission = opts.answer ?? 'granted';
      return Promise.resolve(notification.permission);
    },
  };
  const manager: PushManagerLike = {
    subscribe() {
      log.push('subscribe');
      if (opts.subscribeFails) return Promise.reject(new Error('NotAllowedError'));
      current = new FakeSubscription('https://push.example/new');
      return Promise.resolve(current);
    },
    getSubscription: () => Promise.resolve(current),
  };
  const reply = opts.reply ?? (() => ({ status: 200, body: { ok: true } }));
  const env: PushEnv = {
    standalone: () => opts.standalone ?? true,
    hasPushManager: () => true,
    notification: () => notification,
    pushManager: () =>
      opts.workerNeverReady
        ? new Promise<PushManagerLike>(() => undefined)
        : Promise.resolve(manager),
    fetch: (input, init) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        path: input as string,
        body: init?.body === undefined ? undefined : JSON.parse(init.body as string),
      };
      log.push(`${call.method} ${call.path}`);
      calls.push(call);
      const r = reply(call);
      if (r === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status }));
    },
    storage: () => {
      if (store === 'blocked') throw new Error('SecurityError');
      return {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, v),
        removeItem: (k) => store.delete(k),
      };
    },
    now: () => opts.now ?? 10 * DAY,
    saveKey: (key) => {
      saved.push(key);
      return Promise.resolve();
    },
    onWorkerMessage: (listener) => listeners.push(listener),
    sleep: () => Promise.resolve(),
  };
  return {
    env,
    log,
    calls,
    saved,
    store,
    notification,
    listeners,
    current: () => current,
  };
}

const notFound = { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not here!' } } };

describe('healDue', () => {
  it('is due with no stamp, a bad stamp, a future stamp, or a day later', () => {
    expect(healDue(null, DAY, DAY)).toBe(true);
    expect(healDue('soon', DAY, DAY)).toBe(true);
    expect(healDue(String(2 * DAY), DAY, DAY)).toBe(true);
    expect(healDue('0', DAY, DAY)).toBe(true);
    expect(healDue('1', DAY, DAY)).toBe(false);
  });
});

describe('supported / permission', () => {
  it('needs a Home Screen app', () => {
    const client = createPushClient(fakeEnv({ standalone: false }).env);
    expect(client.supported()).toBe(false);
    expect(client.permission()).toBe('unsupported');
  });

  it('reports the permission in a Home Screen app', () => {
    expect(createPushClient(fakeEnv({ permission: 'denied' }).env).permission()).toBe('denied');
  });
});

describe('status', () => {
  it('returns the key and switches', async () => {
    const f = fakeEnv({
      reply: () => ({ status: 200, body: { vapidPublicKey: VAPID_KEY, settings: SETTINGS } }),
    });
    expect(await createPushClient(f.env).status()).toEqual({
      state: 'available',
      vapidPublicKey: VAPID_KEY,
      settings: SETTINGS,
    });
    expect(f.calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/push' });
  });

  it('reads NOT_FOUND as off and never asks again this session', async () => {
    const f = fakeEnv({ reply: () => notFound });
    const client = createPushClient(f.env);
    expect(await client.status()).toEqual({ state: 'off' });
    expect(await client.status()).toEqual({ state: 'off' });
    expect(await client.saveSettings({ dusk: false })).toBe('off');
    expect(f.calls).toHaveLength(1);
    expect(client.isOff()).toBe(true);
  });

  it('is unreachable when offline, and asks again next time', async () => {
    const f = fakeEnv({ reply: () => 'offline' });
    const client = createPushClient(f.env);
    expect(await client.status()).toEqual({ state: 'unreachable' });
    await client.status();
    expect(f.calls).toHaveLength(2);
  });
});

describe('device().subscribe', () => {
  it('asks permission and subscribes before its first await (the tap rule)', async () => {
    const f = fakeEnv();
    const device = await createPushClient(f.env).device();
    if (!device) throw new Error('no device');
    // A microtask queued now runs after every synchronous step of
    // subscribe() and before anything it awaits.
    const marker = Promise.resolve().then(() => f.log.push('first await'));
    const outcome = device.subscribe(VAPID_KEY);
    expect(f.log).toEqual(['requestPermission', 'subscribe']);
    await marker;
    expect(await outcome).toBe('on');
    expect(f.log.slice(0, 3)).toEqual(['requestPermission', 'subscribe', 'first await']);
    expect(f.log).toContain('PUT /api/v1/push/subscription');
  });

  it('sends the subscription, keeps the key for the worker and stamps the self-heal', async () => {
    const f = fakeEnv();
    const device = await createPushClient(f.env).device();
    expect(await device?.subscribe(VAPID_KEY)).toBe('on');
    expect(f.calls[0]).toEqual({
      method: 'PUT',
      path: '/api/v1/push/subscription',
      body: {
        endpoint: 'https://push.example/new',
        keys: { p256dh: 'p256', auth: 'au' },
        expirationTime: null,
      },
    });
    expect(f.saved).toEqual([VAPID_KEY]);
    expect((f.store as Map<string, string>).get(PUSH_HEALED_AT_KEY)).toBe(String(10 * DAY));
  });

  it('is denied when the player says no, and sends nothing', async () => {
    const f = fakeEnv({ answer: 'denied', subscribeFails: true });
    const device = await createPushClient(f.env).device();
    expect(await device?.subscribe(VAPID_KEY)).toBe('denied');
    expect(f.calls).toEqual([]);
  });

  it('fails when the push service refuses after a yes', async () => {
    const f = fakeEnv({ subscribeFails: true });
    const device = await createPushClient(f.env).device();
    expect(await device?.subscribe(VAPID_KEY)).toBe('failed');
  });

  it('fails on a broken key without prompting', async () => {
    const f = fakeEnv();
    const device = await createPushClient(f.env).device();
    expect(await device?.subscribe('not a key!')).toBe('failed');
    expect(f.log).toEqual([]);
  });

  it('unsubscribes locally when the server says off or can’t be reached', async () => {
    for (const [reply, outcome] of [
      [() => notFound, 'off'],
      [() => 'offline' as const, 'failed'],
    ] as const) {
      const f = fakeEnv({ reply });
      const device = await createPushClient(f.env).device();
      expect(await device?.subscribe(VAPID_KEY)).toBe(outcome);
      expect(f.current()?.unsubscribed).toBe(1);
      expect(f.saved).toEqual([]);
    }
  });
});

describe('device().unsubscribe', () => {
  it('deletes on the server, then unsubscribes locally', async () => {
    const f = fakeEnv({ existing: true, permission: 'granted' });
    const device = await createPushClient(f.env).device();
    await device?.unsubscribe();
    expect(f.calls).toEqual([
      {
        method: 'DELETE',
        path: '/api/v1/push/subscription',
        body: { endpoint: 'https://push.example/existing' },
      },
    ]);
    expect(f.current()?.unsubscribed).toBe(1);
  });

  it('still unsubscribes locally when offline', async () => {
    const f = fakeEnv({ existing: true, reply: () => 'offline' });
    const device = await createPushClient(f.env).device();
    await device?.unsubscribe();
    expect(f.current()?.unsubscribed).toBe(1);
  });
});

describe('device()', () => {
  it('is null outside a Home Screen app, or when the worker never gets ready', async () => {
    expect(await createPushClient(fakeEnv({ standalone: false }).env).device()).toBeNull();
    expect(await createPushClient(fakeEnv({ workerNeverReady: true }).env).device()).toBeNull();
  });
});

describe('heal (start-up self-heal)', () => {
  it('re-sends a granted subscription and stamps the day', async () => {
    const f = fakeEnv({ permission: 'granted', existing: true });
    expect(await createPushClient(f.env).heal()).toBe('healed');
    expect(f.calls).toEqual([
      expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({ endpoint: 'https://push.example/existing' }) as unknown,
      }),
    ]);
    expect((f.store as Map<string, string>).get(PUSH_HEALED_AT_KEY)).toBe(String(10 * DAY));
  });

  it('runs at most once a day per device', async () => {
    const store = new Map([[PUSH_HEALED_AT_KEY, String(10 * DAY - DAY + 1)]]);
    const f = fakeEnv({ permission: 'granted', existing: true, storage: store });
    expect(await createPushClient(f.env).heal()).toBe('skipped');
    expect(f.calls).toEqual([]);
    const later = fakeEnv({ permission: 'granted', existing: true, storage: store, now: 11 * DAY });
    expect(await createPushClient(later.env).heal()).toBe('healed');
  });

  it('skips without permission, a subscription or a Home Screen app', async () => {
    for (const opts of [
      { permission: 'default' as const, existing: true },
      { permission: 'granted' as const, existing: false },
      { permission: 'granted' as const, existing: true, standalone: false },
    ]) {
      const f = fakeEnv(opts);
      expect(await createPushClient(f.env).heal()).toBe('skipped');
      expect(f.calls).toEqual([]);
    }
  });

  it('heals with storage blocked (just not rate-limited)', async () => {
    const f = fakeEnv({ permission: 'granted', existing: true, storage: 'blocked' });
    expect(await createPushClient(f.env).heal()).toBe('healed');
  });

  it('leaves no stamp when the server can’t be reached, so the next start retries', async () => {
    const f = fakeEnv({ permission: 'granted', existing: true, reply: () => 'offline' });
    expect(await createPushClient(f.env).heal()).toBe('failed');
    expect((f.store as Map<string, string>).has(PUSH_HEALED_AT_KEY)).toBe(false);
  });

  it('turns push off on NOT_FOUND', async () => {
    const f = fakeEnv({ permission: 'granted', existing: true, reply: () => notFound });
    const client = createPushClient(f.env);
    expect(await client.heal()).toBe('skipped');
    expect(client.isOff()).toBe(true);
  });
});

describe('forgetDevice (logout)', () => {
  it('forgets "off", so the next player on this iPad asks again', async () => {
    let calls = 0;
    const f = fakeEnv({
      reply: () =>
        ++calls === 1
          ? notFound
          : { status: 200, body: { vapidPublicKey: VAPID_KEY, settings: SETTINGS } },
    });
    const client = createPushClient(f.env);
    expect(await client.status()).toEqual({ state: 'off' });
    await client.forgetDevice(1000);
    expect(client.isOff()).toBe(false);
    expect((await client.status()).state).toBe('available');
  });

  it('unsubscribes locally and calls no route', async () => {
    const f = fakeEnv({ existing: true });
    await createPushClient(f.env).forgetDevice(1000);
    expect(f.current()?.unsubscribed).toBe(1);
    expect(f.calls).toEqual([]);
  });

  it('gives up quietly when the worker never answers', async () => {
    const f = fakeEnv({ workerNeverReady: true });
    await expect(createPushClient(f.env).forgetDevice(1000)).resolves.toBeUndefined();
  });

  it('never throws when unsubscribing fails', async () => {
    const f = fakeEnv();
    f.env.pushManager = () => Promise.reject(new Error('InvalidStateError'));
    await expect(createPushClient(f.env).forgetDevice(1000)).resolves.toBeUndefined();
  });
});

describe('onOpenMap', () => {
  it('hears a tapped nudge from the worker and ignores other messages', () => {
    const f = fakeEnv();
    const opened: (string | null)[] = [];
    createPushClient(f.env).onOpenMap((mapId) => opened.push(mapId));
    for (const listener of f.listeners) {
      listener({ type: 'open-map', mapId: 'abc' });
      listener({ type: 'open-map', mapId: null });
      listener({ type: 'describe', path: '/' });
    }
    expect(opened).toEqual(['abc', null]);
  });
});

describe('startPush', () => {
  function startEnv() {
    const events: string[] = [];
    let visible: (() => void) | null = null;
    const env: PushStartEnv = {
      clearBadge: () => events.push('clear'),
      onVisible: (listener) => {
        visible = listener;
      },
    };
    return { env, events, show: () => visible?.() };
  }

  it('clears the badge now and on every return, and self-heals', async () => {
    const f = fakeEnv({ permission: 'granted', existing: true });
    const s = startEnv();
    startPush(createPushClient(f.env), s.env);
    expect(s.events).toEqual(['clear']);
    s.show();
    expect(s.events).toEqual(['clear', 'clear']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.calls.map((c) => c.method)).toEqual(['PUT']);
  });

  it('does nothing outside a Home Screen app with push', () => {
    const f = fakeEnv({ standalone: false, permission: 'granted', existing: true });
    const s = startEnv();
    startPush(createPushClient(f.env), s.env);
    s.show();
    expect(s.events).toEqual([]);
    expect(f.calls).toEqual([]);
  });
});
