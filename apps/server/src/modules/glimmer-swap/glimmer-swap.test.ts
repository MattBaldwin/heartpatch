import {
  ApiErrorSchema,
  GLIMMER_SWAP,
  GlimmerSwapResponseSchema,
  heartSeedOf,
  hexDistance,
  MapResponseSchema,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = {
  base: 'pip',
  hairColor: 'honey',
  eyeColor: 'sky',
  outfit: 'sunflower',
  face: 'pip',
  body: 'pip',
  skinTone: 'tone-1',
  eyes: 'round' as const,
  brows: 'arched',
  mouth: 'smile',
  extras: [],
};
/** 10 AM in Denver. */
const START = '2026-11-04T17:00:00Z';
const { give, get, dailyCap } = GLIMMER_SWAP;

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('the Glimmer swap (#523, needs DATABASE_URL)', () => {
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

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `swapper_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return { id: user!.id, username, token };
  }

  const call = (
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...HEADERS, ...headers },
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });
  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;
  const swapOf = (res: LightMyRequestResponse) => GlimmerSwapResponseSchema.parse(res.json()).swap;

  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });

  /** The kid's nearest post; `join` claims the neutral tiles on the straight way to it (#270's test path). */
  async function nearestPost(mapId: string, kid: PublicUser, join: boolean) {
    const tiles = await tilesOf(mapId);
    const seed = heartSeedOf(tiles.filter((t) => t.ownerUserId === kid.id && t.homeSlot !== null))!;
    const posts = tiles.filter((t) => t.terrain === 'trading-post');
    const post = [...posts].sort((a, b) => hexDistance(seed, a) - hexDistance(seed, b))[0]!;
    const reach = hexDistance(seed, post);
    if (join) {
      for (const t of tiles) {
        const onTheWay =
          t.ownerUserId === null &&
          t.homeSlot === null &&
          t.terrain !== 'trading-post' &&
          hexDistance(seed, t) < reach &&
          hexDistance(t, post) + hexDistance(seed, t) === reach;
        if (onTheWay) {
          await db.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${t.id}'`);
        }
      }
    }
    return { q: post.q, r: post.r };
  }

  /** A patch of the kid's with `items` in the bag; `join` connects their land to a post. */
  async function patch(
    server: FastifyInstance,
    kid: Player,
    items: Record<string, number>,
    join = true,
  ) {
    const res = await call(server, 'POST', '/maps', kid, {
      name: `Swap Patch ${String(counter)}`,
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const mapId = MapResponseSchema.parse(res.json()).map.id;
    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId, userId: kid.id }, items, 'dev-grant'),
    );
    return { mapId, post: await nearestPost(mapId, kid, join) };
  }

  const swap = (
    server: FastifyInstance,
    kid: Player,
    mapId: string,
    body: object,
    headers: Record<string, string> = {},
  ) => call(server, 'POST', `/maps/${mapId}/glimmer-swap`, kid, body, headers);

  const bag = async (mapId: string, kid: PublicUser) => {
    const rows = await db.query.inventories.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
    });
    return Object.fromEntries(
      rows.filter((r) => r.quantity > 0).map((r) => [r.itemId, r.quantity]),
    );
  };
  const swapRows = (mapId: string) =>
    db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'post-swap')),
    });

  it('swaps 10 of an accepted resource for 1 Glimmer at a connected post', async () => {
    const server = await start();
    const kid = await player();
    const { mapId, post } = await patch(server, kid, { stone: 24 });

    const before = swapOf(await call(server, 'GET', `/maps/${mapId}/glimmer-swap`, kid));
    expect(before).toMatchObject({ swappedToday: 0, have: { stone: 24, glimmer: 0, ice: 0 } });
    // The account's day ends at midnight in Denver (MDT until Nov 1, MST after: UTC−7).
    expect(before.resetsAt).toBe('2026-11-05T07:00:00.000Z');

    const res = await swap(server, kid, mapId, { ...post, itemId: 'stone' });
    expect(res.statusCode, res.body).toBe(200);
    expect(swapOf(res)).toMatchObject({
      swappedToday: get,
      have: { stone: 24 - give, glimmer: get },
    });
    expect(await bag(mapId, kid)).toEqual({ stone: 24 - give, glimmer: get });
    // One swap: the give and the get, ledgered together against it at the game's clock.
    const rows = await swapRows(mapId);
    expect(rows.map((r) => [r.itemId, r.delta]).sort()).toEqual([
      ['glimmer', get],
      ['stone', -give],
    ]);
    expect(new Set(rows.map((r) => r.refId)).size).toBe(1);
    expect(rows.every((r) => r.createdAt.getTime() === clock.getTime())).toBe(true);
  });

  it('stops at the daily cap, and swaps again on the next day', async () => {
    const server = await start();
    const kid = await player();
    const { mapId, post } = await patch(server, kid, { water: 100 });
    for (let i = 0; i < dailyCap / get; i += 1) {
      expect((await swap(server, kid, mapId, { ...post, itemId: 'water' })).statusCode).toBe(200);
    }
    const capped = await swap(server, kid, mapId, { ...post, itemId: 'water' });
    expect(capped.statusCode).toBe(409);
    expect(errorOf(capped).message).toContain("That's all the Glimmer for today");
    expect(await bag(mapId, kid)).toEqual({ water: 100 - give * dailyCap, glimmer: dailyCap });

    // 11:30 PM in Denver: still today.
    clock.setTime(Date.parse('2026-11-05T06:30:00Z'));
    expect((await swap(server, kid, mapId, { ...post, itemId: 'water' })).statusCode).toBe(409);
    // Just past midnight in Denver: a new day.
    clock.setTime(Date.parse('2026-11-05T07:00:01Z'));
    const view = swapOf(await call(server, 'GET', `/maps/${mapId}/glimmer-swap`, kid));
    expect(view.swappedToday).toBe(0);
    expect((await swap(server, kid, mapId, { ...post, itemId: 'water' })).statusCode).toBe(200);
  });

  it('counts the cap across every patch the kid is in', async () => {
    const server = await start();
    const kid = await player();
    const one = await patch(server, kid, { timber: 50 });
    const two = await patch(server, kid, { timber: 50 });
    for (let i = 0; i < dailyCap / get; i += 1) {
      expect(
        (await swap(server, kid, one.mapId, { ...one.post, itemId: 'timber' })).statusCode,
      ).toBe(200);
    }
    const other = await swap(server, kid, two.mapId, { ...two.post, itemId: 'timber' });
    expect(other.statusCode).toBe(409);
    expect(swapOf(await call(server, 'GET', `/maps/${two.mapId}/glimmer-swap`, kid))).toMatchObject(
      { swappedToday: dailyCap, have: { timber: 50, glimmer: 0 } },
    );
  });

  it('takes only the data’s resources, and never a part swap when short', async () => {
    const server = await start();
    const kid = await player();
    const { mapId, post } = await patch(server, kid, { emberwood: 30, greens: give - 1 });
    const ember = await swap(server, kid, mapId, { ...post, itemId: 'emberwood' });
    expect(ember.statusCode).toBe(400);
    expect(errorOf(ember).code).toBe('VALIDATION_FAILED');
    const glimmer = await swap(server, kid, mapId, { ...post, itemId: 'glimmer' });
    expect(glimmer.statusCode).toBe(400);
    const short = await swap(server, kid, mapId, { ...post, itemId: 'greens' });
    expect(short.statusCode).toBe(409);
    expect(errorOf(short).message).toMatch(/1 more Greens/);
    expect(await bag(mapId, kid)).toEqual({ emberwood: 30, greens: give - 1 });
    expect(await swapRows(mapId)).toEqual([]);
  });

  it('needs a post the kid can use, and a member of the patch', async () => {
    const server = await start();
    const kid = await player();
    const stranger = await player();
    const { mapId, post } = await patch(server, kid, { ice: 30 }, false);
    const far = await swap(server, kid, mapId, { ...post, itemId: 'ice' });
    expect(far.statusCode).toBe(403);
    const tiles = await tilesOf(mapId);
    const notPost = tiles.find((t) => t.terrain !== 'trading-post')!;
    const notAPost = await swap(server, kid, mapId, { q: notPost.q, r: notPost.r, itemId: 'ice' });
    expect(notAPost.statusCode).toBe(404);
    const outsider = await swap(server, stranger, mapId, { ...post, itemId: 'ice' });
    expect(outsider.statusCode).toBe(404);
    expect((await call(server, 'GET', `/maps/${mapId}/glimmer-swap`, stranger)).statusCode).toBe(
      404,
    );
    expect(await bag(mapId, kid)).toEqual({ ice: 30 });
  });

  it('replays a retried swap with the same Idempotency-Key instead of swapping twice', async () => {
    const server = await start();
    const kid = await player();
    const { mapId, post } = await patch(server, kid, { stone: 30 });
    const headers = { 'idempotency-key': 'swap-it-once' };
    const first = await swap(server, kid, mapId, { ...post, itemId: 'stone' }, headers);
    const again = await swap(server, kid, mapId, { ...post, itemId: 'stone' }, headers);
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json()).toEqual(first.json());
    expect(await bag(mapId, kid)).toEqual({ stone: 30 - give, glimmer: get });
  });

  it('never passes the cap or overspends when taps race', async () => {
    const server = await start();
    const kid = await player();
    // Enough for the cap and two more, so only the cap can stop the extra taps.
    const { mapId, post } = await patch(server, kid, { stone: give * (dailyCap + 2) });
    const taps = await Promise.all(
      Array.from({ length: dailyCap + 2 }, () =>
        swap(server, kid, mapId, { ...post, itemId: 'stone' }),
      ),
    );
    const codes = taps.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(dailyCap / get);
    expect(codes.filter((c) => c === 409)).toHaveLength(2);
    expect(await bag(mapId, kid)).toEqual({ stone: give * 2, glimmer: dailyCap });
  });
});
