import {
  GAME_DATA,
  heartSeedOf,
  hexDistance,
  hexNeighbors,
  MapResponseSchema,
  parseGameEventPayload,
  placeTradingPosts,
  STARTERS,
} from '@heartpatch/shared';
import type * as Shared from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { placeMissingTradingPosts } from './trading-posts.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = {
  base: 'pip',
  hairColor: 'honey',
  eyeColor: 'sky',
  outfit: 'sunflower',
  skinTone: 'tone-1',
  eyes: 'round' as const,
  brows: 'arched',
  mouth: 'smile',
  extras: [],
};
const UUID = /^[0-9a-f-]{36}$/;
const uuid = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
};
const RULES = GAME_DATA.mapGen.tradingPosts;

// Patches made before trading posts were all 4-seat (#318 made new ones 6),
// so this file's patches are made with 4 seats, as theirs were.
vi.mock('@heartpatch/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof Shared>()),
  MAP_MAX_PLAYERS: 4,
}));

describe.skipIf(!url)('trading posts on older patches (#269, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: 'true',
    });
    app = await buildApp({ config, db, logger: false });
    return app;
  }

  async function player() {
    const username = `poster_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return { id: user!.id, token };
  }

  /** A new patch, then made "older": its posts turned back into meadow. */
  async function olderPatch(): Promise<{ mapId: string; ownerId: string; token: string }> {
    const server = await start();
    const owner = await player();
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/maps',
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: owner.token },
      payload: { name: 'Old Patch', timeZone: 'America/Denver' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const mapId = uuid(MapResponseSchema.parse(res.json()).map.id);
    await db.execute(
      `update tiles set terrain = 'meadow' where map_id = '${mapId}' and terrain = 'trading-post'`,
    );
    return { mapId, ownerId: owner.id, token: owner.token };
  }

  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
  const postsOf = async (mapId: string) =>
    (await tilesOf(mapId)).filter((t) => t.terrain === 'trading-post');
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const pass = () =>
    placeMissingTradingPosts(db, (mapId, err) => {
      throw new Error(`pass failed on ${mapId}: ${String(err)}`);
    });

  it('gives an older patch its 4 posts by the mapgen rule, once, with post.placed', async () => {
    const { mapId } = await olderPatch();
    expect(await postsOf(mapId)).toEqual([]);
    const done = await pass();
    expect(done.skipped).not.toContain(mapId);
    const posts = await postsOf(mapId);
    expect(posts).toHaveLength(RULES.perMap);
    for (const p of posts) {
      expect(p).toMatchObject({ ownerUserId: null, homeSlot: null, nodeResource: null });
      expect(p.guardianStrength).toBeNull();
    }
    const placed = (await eventsOf(mapId)).filter((e) => e.type === 'post.placed');
    expect(placed).toHaveLength(1);
    expect(parseGameEventPayload('post.placed', placed[0]!.payload).tiles).toHaveLength(4);

    // Idempotent: a second boot changes nothing and writes no event.
    await pass();
    expect((await postsOf(mapId)).map((t) => t.id)).toEqual(posts.map((t) => t.id));
    expect((await eventsOf(mapId)).filter((e) => e.type === 'post.placed')).toHaveLength(1);
  });

  it('never puts a post on a tile someone is battling for right now', async () => {
    const { mapId, ownerId, token } = await olderPatch();
    const server = app!;
    const call = (path: string, payload: object) =>
      server.inject({
        method: 'POST',
        url: `/api/v1${path}`,
        headers: HEADERS,
        cookies: { [SESSION_COOKIE]: token },
        payload,
      });
    // Where the rule would put the posts on this patch right now.
    const all = await tilesOf(mapId);
    const homes = [0, 1, 2, 3].flatMap(
      (slot) => heartSeedOf(all.filter((t) => t.homeSlot === slot)) ?? [],
    );
    const planned = placeTradingPosts({
      tiles: all,
      homes,
      gapTerrain: GAME_DATA.mapGen.gapTerrain,
      rules: RULES,
      seed: (await db.query.maps.findFirst({ where: (m, { eq }) => eq(m.id, mapId) }))!.seed!,
    })!;
    // Start a claim on one of them: hand the owner the tile between it and
    // home (not a post spot itself), then challenge its guardians.
    const target = planned.find((p) => hexDistance(p, homes[0]!) === RULES.minFromSeed)!;
    const between = all.find(
      (t) =>
        t.homeSlot === null &&
        hexDistance(t, homes[0]!) === RULES.minFromSeed - 1 &&
        hexNeighbors(target).some((n) => n.q === t.q && n.r === t.r),
    )!;
    await db.execute(
      `update tiles set owner_user_id = '${uuid(ownerId)}' where id = '${uuid(between.id)}'`,
    );
    expect(
      (await call(`/maps/${mapId}/dev/squishies`, { level: 40, speciesId: STARTERS.speciesIds[0] }))
        .statusCode,
    ).toBe(201);
    const claim = await call(`/maps/${mapId}/attacks`, { q: target.q, r: target.r });
    expect(claim.statusCode, claim.body).toBe(201);

    await pass();
    // The battle's tile is still meadow, wild and unowned; any posts went elsewhere.
    const after = (await tilesOf(mapId)).find((t) => t.q === target.q && t.r === target.r)!;
    expect(after.terrain).not.toBe('trading-post');
    expect(after.ownerUserId).toBeNull();
    for (const p of await postsOf(mapId)) expect(p.ownerUserId).toBeNull();
  });

  it('never takes owned land, and skips a patch with no fair spot free', async () => {
    const { mapId, ownerId } = await olderPatch();
    const all = await tilesOf(mapId);
    // Every home slot's Heart Seed: the middle of its 7 home tiles.
    const seeds = [0, 1, 2, 3].flatMap((slot) => {
      const home = all.filter((t) => t.homeSlot === slot);
      if (home.length === 0) return [];
      const q = home.reduce((n, t) => n + t.q, 0) / home.length;
      const r = home.reduce((n, t) => n + t.r, 0) / home.length;
      return [{ q, r }];
    });
    // The owner holds every tile a post could stand on near the first home.
    const near = all.filter(
      (t) => t.homeSlot === null && hexDistance(t, seeds[0]!) <= RULES.maxFromSeed,
    );
    await db.execute(
      `update tiles set owner_user_id = '${uuid(ownerId)}' where id in (${near.map((t) => `'${uuid(t.id)}'`).join(',')})`,
    );
    const done = await pass();
    expect(done.skipped).toContain(mapId);
    expect(await postsOf(mapId)).toEqual([]);
    expect((await eventsOf(mapId)).filter((e) => e.type === 'post.placed')).toEqual([]);

    // Free half of it again: a later boot places them, on neutral land only.
    const freed = near.filter((t) => hexDistance(t, seeds[0]!) === 3);
    await db.execute(
      `update tiles set owner_user_id = null where id in (${freed.map((t) => `'${uuid(t.id)}'`).join(',')})`,
    );
    expect((await pass()).skipped).not.toContain(mapId);
    const posts = await postsOf(mapId);
    expect(posts).toHaveLength(RULES.perMap);
    for (const p of posts) expect(p.ownerUserId).toBeNull();
  });
});
