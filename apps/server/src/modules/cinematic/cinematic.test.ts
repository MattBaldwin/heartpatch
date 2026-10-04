import { ApiErrorSchema, CinematicResponseSchema } from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { CINEMATIC_RATE_LIMITS } from './limits.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;

interface Player {
  id: string;
  token: string;
}

describe.skipIf(!url)('opening cinematic (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let clock = new Date('2026-10-04T12:00:00Z');
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock = new Date('2026-10-04T12:00:00Z');
  });

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  /** A logged-in player, written straight to the database. */
  async function player(): Promise<Player> {
    const username = `moviekid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014 })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return { id: user!.id, token };
  }

  function call(server: FastifyInstance, method: 'GET' | 'POST', path: string, who: Player | null) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function state(server: FastifyInstance, method: 'GET' | 'POST', who: Player) {
    const res = await call(
      server,
      method,
      method === 'GET' ? '/cinematic' : '/cinematic/seen',
      who,
    );
    expect(res.statusCode).toBe(200);
    return CinematicResponseSchema.parse(res.json()).cinematic;
  }

  it('needs a logged-in player', async () => {
    const server = await start();
    expect(errorOf(await call(server, 'GET', '/cinematic', null)).code).toBe('UNAUTHENTICATED');
    expect(errorOf(await call(server, 'POST', '/cinematic/seen', null)).code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('is unseen for a new player, then remembered on the account', async () => {
    const server = await start();
    const kid = await player();
    expect(await state(server, 'GET', kid)).toEqual({ seenAt: null });
    expect(await state(server, 'POST', kid)).toEqual({ seenAt: '2026-10-04T12:00:00.000Z' });
    expect(await state(server, 'GET', kid)).toEqual({ seenAt: '2026-10-04T12:00:00.000Z' });
    const row = (await db.select().from(users)).find((u) => u.id === kid.id);
    expect(row!.cinematicSeenAt).toEqual(new Date('2026-10-04T12:00:00Z'));
  });

  it('is idempotent: a replay or a second device keeps the first time', async () => {
    const server = await start();
    const kid = await player();
    await state(server, 'POST', kid);
    clock = new Date('2026-10-05T08:30:00Z');
    expect(await state(server, 'POST', kid)).toEqual({ seenAt: '2026-10-04T12:00:00.000Z' });
    // Two devices finishing together still agree on one time.
    const [a, b] = await Promise.all([state(server, 'POST', kid), state(server, 'POST', kid)]);
    expect(a).toEqual(b);
    expect(a.seenAt).toBe('2026-10-04T12:00:00.000Z');
  });

  it("only touches the caller's account", async () => {
    const server = await start();
    const [kid, sibling] = [await player(), await player()];
    await state(server, 'POST', kid);
    expect(await state(server, 'GET', sibling)).toEqual({ seenAt: null });
  });

  it('rate-limits marking it seen per player', async () => {
    const server = await start();
    const kid = await player();
    const { max } = CINEMATIC_RATE_LIMITS.seen.perUser;
    for (let i = 0; i < max; i += 1) {
      expect((await call(server, 'POST', '/cinematic/seen', kid)).statusCode).toBe(200);
    }
    expect(errorOf(await call(server, 'POST', '/cinematic/seen', kid)).code).toBe('RATE_LIMITED');
  });
});
