import {
  ApiErrorSchema,
  PUSH_RULES,
  PushSettingsSchema,
  PushStatusResponseSchema,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { newDeviceKeys, newVapidPair } from '../../../tests/vapid.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { PUSH_RATE_LIMITS } from './limits.js';
import { createPushRepo } from './repo.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const START = '2026-11-01T12:00:00Z';
const VAPID = newVapidPair();

interface Player {
  id: string;
  username: string;
  token: string;
  sessionId: string;
}

describe.skipIf(!url)('push nudges: subscribe and settings (#726b, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date(START);
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse(START));
  });

  async function start(env: Record<string, string> = { HP_PUSH: 'on' }): Promise<FastifyInstance> {
    const keys =
      env['HP_PUSH'] === undefined || env['HP_PUSH'] === 'off'
        ? {}
        : { HP_VAPID_PUBLIC_KEY: VAPID.publicKey, HP_VAPID_PRIVATE_KEY: VAPID.privateKey };
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, ...keys, ...env });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `nudgee_${String((counter += 1))}_${String(Date.now() % 100000)}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'UTC' })
      .returning({ id: users.id });
    return { id: user!.id, username, ...(await login(user!.id)) };
  }

  /** Another session (device) for the same account. */
  async function login(userId: string): Promise<{ token: string; sessionId: string }> {
    const { token, tokenHash } = newSessionToken();
    const [session] = await db
      .insert(sessions)
      .values({ userId, tokenHash, expiresAt: new Date(Date.parse(START) + 30 * DAY_MS) })
      .returning({ id: sessions.id });
    return { token, sessionId: session!.id };
  }

  const call = (
    server: FastifyInstance,
    method: 'GET' | 'PUT' | 'DELETE' | 'POST',
    path: string,
    who: Pick<Player, 'token'> | null,
    payload?: object,
    headers: Record<string, string> = HEADERS,
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers,
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
    });

  let endpoints = 0;
  const endpoint = () =>
    `https://web.push.apple.com/QG${String((endpoints += 1))}-${String(Date.now())}`;
  const subscription = (at = endpoint()) => ({ endpoint: at, keys: newDeviceKeys() });

  const rowsOf = (userId: string) =>
    db.query.pushSubscriptions.findMany({
      columns: { endpoint: true, sessionId: true, p256dh: true, failCount: true, expiresAt: true },
      where: (t, { eq }) => eq(t.userId, userId),
    });

  it('answers NOT_FOUND, like an unknown route, while push is off', async () => {
    const server = await start({});
    const me = await player();
    const unknown = await call(server, 'GET', '/no-such-route', me);
    for (const [method, path, body] of [
      ['GET', '/push', undefined],
      ['PUT', '/push/subscription', subscription()],
      ['DELETE', '/push/subscription', { endpoint: endpoint() }],
      ['PUT', '/push/settings', { dusk: false }],
    ] as const) {
      const res = await call(server, method, path, me, body);
      expect(res.statusCode, `${method} ${path}`).toBe(404);
      expect(ApiErrorSchema.parse(res.json())).toEqual(ApiErrorSchema.parse(unknown.json()));
    }
    expect(await rowsOf(me.id)).toEqual([]);
  });

  it('on testers, only a tester gets in, whatever the case of their name', async () => {
    const tester = await player();
    const other = await player();
    const server = await start({
      HP_PUSH: 'testers',
      HP_PUSH_TESTERS: tester.username.toUpperCase(),
    });
    expect((await call(server, 'GET', '/push', tester)).statusCode).toBe(200);
    expect((await call(server, 'GET', '/push', other)).statusCode).toBe(404);
    expect(
      (await call(server, 'PUT', '/push/subscription', other, subscription())).statusCode,
    ).toBe(404);
  });

  it('needs a login and the CSRF header', async () => {
    const server = await start();
    const me = await player();
    expect((await call(server, 'GET', '/push', null)).statusCode).toBe(401);
    expect((await call(server, 'PUT', '/push/subscription', null, subscription())).statusCode).toBe(
      401,
    );
    const noHeader = await call(server, 'PUT', '/push/subscription', me, subscription(), {});
    expect(noHeader.statusCode).toBe(403);
    expect(
      (await call(server, 'DELETE', '/push/subscription', me, { endpoint: endpoint() }, {}))
        .statusCode,
    ).toBe(403);
    expect((await call(server, 'PUT', '/push/settings', me, { dusk: false }, {})).statusCode).toBe(
      403,
    );
    expect(await rowsOf(me.id)).toEqual([]);
  });

  it('GET /push gives the public key and every switch on by default', async () => {
    const server = await start();
    const me = await player();
    const res = await call(server, 'GET', '/push', me);
    expect(res.statusCode).toBe(200);
    expect(PushStatusResponseSchema.parse(res.json())).toEqual({
      vapidPublicKey: VAPID.publicKey,
      settings: { dusk: true, gatherers: true, friend: true, longNight: true },
    });
    // The private key never goes out.
    expect(res.body).not.toContain(VAPID.privateKey);
  });

  it('PUT /push/settings changes only the switches sent, and they follow the account', async () => {
    const server = await start();
    const me = await player();
    const first = await call(server, 'PUT', '/push/settings', me, { dusk: false });
    expect(first.statusCode).toBe(200);
    expect(PushSettingsSchema.parse(first.json())).toEqual({
      dusk: false,
      gatherers: true,
      friend: true,
      longNight: true,
    });
    const second = await call(server, 'PUT', '/push/settings', me, {
      longNight: false,
      dusk: false,
    });
    expect(second.json()).toEqual({ dusk: false, gatherers: true, friend: true, longNight: false });
    // Another device of mine sees the same switches.
    const ipad = await login(me.id);
    expect(
      PushStatusResponseSchema.parse((await call(server, 'GET', '/push', ipad)).json()).settings,
    ).toEqual({ dusk: false, gatherers: true, friend: true, longNight: false });
    // Nothing to change, or something unknown, is refused.
    expect((await call(server, 'PUT', '/push/settings', me, {})).statusCode).toBe(400);
    expect((await call(server, 'PUT', '/push/settings', me, { volume: 11 })).statusCode).toBe(400);
    expect((await call(server, 'PUT', '/push/settings', me, { dusk: 'no' })).statusCode).toBe(400);
    expect(
      await db.query.pushSettings.findMany({ where: (t, { eq }) => eq(t.userId, me.id) }),
    ).toHaveLength(1);
  });

  it('PUT /push/subscription stores the device under this session, and upserts by endpoint', async () => {
    const server = await start();
    const me = await player();
    const device = subscription();
    const res = await call(server, 'PUT', '/push/subscription', me, {
      ...device,
      expirationTime: Date.parse('2026-12-01T00:00:00Z'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await rowsOf(me.id)).toEqual([
      {
        endpoint: device.endpoint,
        sessionId: me.sessionId,
        p256dh: device.keys.p256dh,
        failCount: 0,
        expiresAt: new Date('2026-12-01T00:00:00Z'),
      },
    ]);

    // The same endpoint again (every app start) updates in place, failures reset.
    await db.execute(
      `update push_subscriptions set fail_count = 3 where endpoint = '${device.endpoint}'`,
    );
    const newKeys = newDeviceKeys();
    expect(
      (
        await call(server, 'PUT', '/push/subscription', me, {
          endpoint: device.endpoint,
          keys: newKeys,
        })
      ).statusCode,
    ).toBe(200);
    expect(await rowsOf(me.id)).toEqual([
      {
        endpoint: device.endpoint,
        sessionId: me.sessionId,
        p256dh: newKeys.p256dh,
        failCount: 0,
        expiresAt: null,
      },
    ]);
  });

  it('a sibling logging in on the same iPad takes the endpoint over', async () => {
    const server = await start();
    const big = await player();
    const little = await player();
    const ipad = subscription();
    await call(server, 'PUT', '/push/subscription', big, ipad);
    await db.execute(
      `update push_subscriptions set last_ok_at = '${START}' where endpoint = '${ipad.endpoint}'`,
    );
    // Big sibling's app starts again: same account, history kept.
    await call(server, 'PUT', '/push/subscription', big, ipad);
    expect(
      (
        await db.query.pushSubscriptions.findFirst({
          columns: { lastOkAt: true },
          where: (t, { eq }) => eq(t.endpoint, ipad.endpoint),
        })
      )?.lastOkAt,
    ).toEqual(new Date(START));
    expect((await call(server, 'PUT', '/push/subscription', little, ipad)).statusCode).toBe(200);
    expect(await rowsOf(big.id)).toEqual([]);
    expect((await rowsOf(little.id)).map((r) => r.sessionId)).toEqual([little.sessionId]);
    // The big sibling's history doesn't come with it.
    const [row] = await db.query.pushSubscriptions.findMany({
      columns: { lastOkAt: true },
      where: (t, { eq }) => eq(t.endpoint, ipad.endpoint),
    });
    expect(row?.lastOkAt).toBeNull();
  });

  it('replaces deletes my old endpoint, never someone else’s', async () => {
    const server = await start();
    const me = await player();
    const friend = await player();
    const old = subscription();
    const theirs = subscription();
    await call(server, 'PUT', '/push/subscription', me, old);
    await call(server, 'PUT', '/push/subscription', friend, theirs);
    const fresh = subscription();
    await call(server, 'PUT', '/push/subscription', me, { ...fresh, replaces: old.endpoint });
    expect((await rowsOf(me.id)).map((r) => r.endpoint)).toEqual([fresh.endpoint]);
    await call(server, 'PUT', '/push/subscription', me, {
      ...subscription(),
      replaces: theirs.endpoint,
    });
    expect((await rowsOf(friend.id)).map((r) => r.endpoint)).toEqual([theirs.endpoint]);
  });

  it(`keeps at most ${String(PUSH_RULES.maxDevicesPerAccount)} devices, dropping the least recently working`, async () => {
    const server = await start();
    const me = await player();
    const devices = Array.from({ length: PUSH_RULES.maxDevicesPerAccount }, () => subscription());
    for (const [i, device] of devices.entries()) {
      clock.setTime(Date.parse(START) + i * 60_000);
      await call(server, 'PUT', '/push/subscription', me, device);
    }
    // The first device worked an hour ago, so the second is now the stalest.
    await db.execute(
      `update push_subscriptions set last_ok_at = '${new Date(Date.parse(START) + 60 * 60_000).toISOString()}'
       where endpoint = '${devices[0]!.endpoint}'`,
    );
    clock.setTime(Date.parse(START) + 2 * 60 * 60_000);
    const extra = subscription();
    expect((await call(server, 'PUT', '/push/subscription', me, extra)).statusCode).toBe(200);
    const kept = (await rowsOf(me.id)).map((r) => r.endpoint).sort();
    expect(kept).toEqual([devices[0]!, ...devices.slice(2), extra].map((d) => d.endpoint).sort());
  });

  it('refuses a subscription that is not an https push service URL or has bad keys', async () => {
    const server = await start();
    const me = await player();
    const keys = newDeviceKeys();
    for (const body of [
      { endpoint: 'http://web.push.apple.com/x', keys },
      { endpoint: `https://web.push.apple.com/${'x'.repeat(2048)}`, keys },
      { endpoint: endpoint(), keys: { p256dh: 'not base64!', auth: keys.auth } },
      { endpoint: endpoint(), keys: { ...keys, extra: 'x' } },
      { endpoint: endpoint() },
      { ...subscription(), replaces: 'javascript:alert(1)' },
      // Only a real push service: never a URL the server would POST to for a player.
      { endpoint: 'https://localhost/push', keys },
      { endpoint: 'https://169.254.169.254/latest/meta-data', keys },
      { endpoint: 'https://heartpatch-db:5432/x', keys },
      { endpoint: 'https://web.push.apple.com.evil.example/x', keys },
      { endpoint: 'https://web.push.apple.com:8443/x', keys },
      // An integer past what a Date can hold.
      { ...subscription(), expirationTime: Number.MAX_SAFE_INTEGER },
    ]) {
      expect((await call(server, 'PUT', '/push/subscription', me, body)).statusCode).toBe(400);
    }
    expect(await rowsOf(me.id)).toEqual([]);
  });

  it('DELETE /push/subscription removes only my own row, and is idempotent', async () => {
    const server = await start();
    const me = await player();
    const friend = await player();
    const mine = subscription();
    const theirs = subscription();
    await call(server, 'PUT', '/push/subscription', me, mine);
    await call(server, 'PUT', '/push/subscription', friend, theirs);
    expect(
      (await call(server, 'DELETE', '/push/subscription', me, { endpoint: theirs.endpoint }))
        .statusCode,
    ).toBe(200);
    expect(await rowsOf(friend.id)).toHaveLength(1);
    for (let i = 0; i < 2; i += 1) {
      const res = await call(server, 'DELETE', '/push/subscription', me, {
        endpoint: mine.endpoint,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    }
    expect(await rowsOf(me.id)).toEqual([]);
  });

  it('logging out ends this device’s nudges, and only this device’s', async () => {
    const server = await start();
    const me = await player();
    const ipad = await login(me.id);
    await call(server, 'PUT', '/push/subscription', me, subscription());
    await call(server, 'PUT', '/push/subscription', ipad, subscription());
    expect((await call(server, 'POST', '/auth/logout', me)).statusCode).toBe(204);
    expect((await rowsOf(me.id)).map((r) => r.sessionId)).toEqual([ipad.sessionId]);
  });

  it('an expired session’s device gets no nudges, and can’t subscribe', async () => {
    const server = await start();
    const me = await player();
    const ipad = await login(me.id);
    await call(server, 'PUT', '/push/subscription', me, subscription());
    await call(server, 'PUT', '/push/subscription', ipad, subscription());
    // The phone's session runs out; expiry deletes no row (#726a).
    await db.execute(
      `update sessions set expires_at = '${new Date(Date.parse(START) + DAY_MS).toISOString()}'
       where id = '${me.sessionId}'`,
    );
    clock.setTime(Date.parse(START) + 2 * DAY_MS);
    expect(await rowsOf(me.id)).toHaveLength(2);
    const targets = await createPushRepo(db).targets(me.id, clock);
    expect(targets).toHaveLength(1);
    expect((await call(server, 'PUT', '/push/subscription', me, subscription())).statusCode).toBe(
      401,
    );
  });

  it('a subscription past its own expirationTime is skipped and deleted', async () => {
    const server = await start();
    const me = await player();
    await call(server, 'PUT', '/push/subscription', me, {
      ...subscription(),
      expirationTime: Date.parse(START) + 60_000,
    });
    const keeper = subscription();
    await call(server, 'PUT', '/push/subscription', me, keeper);
    const repo = createPushRepo(db);
    expect(await repo.targets(me.id, new Date(Date.parse(START) + 59_000))).toHaveLength(2);
    const later = await repo.targets(me.id, new Date(Date.parse(START) + 60_000));
    expect(later.map((t) => t.endpoint)).toEqual([keeper.endpoint]);
    expect((await rowsOf(me.id)).map((r) => r.endpoint)).toEqual([keeper.endpoint]);
  });

  it('is rate limited', async () => {
    const server = await start();
    const me = await player();
    const { max } = PUSH_RATE_LIMITS.subscription.perUser;
    const device = subscription();
    for (let i = 0; i < max; i += 1) {
      expect((await call(server, 'PUT', '/push/subscription', me, device)).statusCode).toBe(200);
    }
    expect((await call(server, 'PUT', '/push/subscription', me, device)).statusCode).toBe(429);
  });
});
