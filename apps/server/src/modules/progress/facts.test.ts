import { HOUSE_DATA, MapResponseSchema, type HouseData } from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeHomestead } from '../../../tests/homestead.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import {
  battles,
  journeys,
  keepers,
  milestoneRewards,
  sessions,
  speciesSeen,
  squishies,
  tileExplore,
  tileTending,
  tradeOffers,
  users,
} from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createHouseService } from '../house/service.js';
import { gatherProgressFacts } from './facts.js';

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
const START = '2026-10-02T12:00:00Z';

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('progress facts (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const at = new Date(START);
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
      HP_HOUSE: 'on',
      HP_DEV_SQUISHY_GRANTS: 'true',
    });
    app = await buildApp({ config, db, clock: () => at, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `factful_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'UTC' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(at.getTime() + 365 * DAY_MS),
    });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, username, token };
  }

  const call = (
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    payload?: object,
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, { name: 'Facts Patch', timeZone: 'UTC' });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function join(server: FastifyInstance, owner: Player, friend: Player, mapId: string) {
    const detail = () =>
      call(server, 'GET', `/maps/${mapId}`, owner).then(
        (res) => MapResponseSchema.parse(res.json()).map,
      );
    const code = (await detail()).admin!.invite!.code;
    expect((await call(server, 'POST', '/maps/join', friend, { code })).statusCode).toBe(201);
    const requestId = (await detail()).admin!.requests[0]!.id;
    expect(
      (await call(server, 'POST', `/maps/${mapId}/requests/${requestId}/approve`, owner))
        .statusCode,
    ).toBe(204);
  }

  const facts = (mapId: string, who: Player) =>
    gatherProgressFacts(db, { mapId, userId: who.id, timeZone: 'UTC', at });

  it('reads nothing done for a brand-new Keeper but their home ring', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const got = await facts(mapId, kid);
    expect(got).toMatchObject({
      heartSeedLevel: 1,
      milestoneTiers: {},
      buildings: [],
      explored: 0,
      speciesSeen: 0,
      litFires: 0,
      decorations: 0,
      residents: [],
      trades: [],
      postsUsed: 0,
      tilesTended: 7,
      homesteads: 0,
    });
    // The seed and its ring: one tile at 0, six at 1.
    expect([...got.ownedTileDistances].sort()).toEqual([0, 1, 1, 1, 1, 1, 1]);
  });

  it('counts squishies, species seen, explored tiles and milestone tiers per track', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const pud = {
      mapId,
      ownerUserId: kid.id,
      speciesId: 'puddlepuff',
      element: 'water',
      feeling: 'silly',
    } as const;
    await db.insert(squishies).values([pud, pud, { ...pud, state: 'in-trade' }]);
    await db.insert(speciesSeen).values([
      { mapId, userId: kid.id, speciesId: 'puddlepuff', firstSeenAt: at },
      { mapId, userId: kid.id, speciesId: 'pebblesnooze', firstSeenAt: at },
    ]);
    await db.insert(milestoneRewards).values([
      { id: crypto.randomUUID(), userId: kid.id, milestoneId: 'collector', tier: 1, earnedAt: at },
      { id: crypto.randomUUID(), userId: kid.id, milestoneId: 'collector', tier: 2, earnedAt: at },
      { id: crypto.randomUUID(), userId: kid.id, milestoneId: 'territory', tier: 1, earnedAt: at },
    ]);
    // A searched-out tile and a half-searched one.
    const [done, half] = await db.query.tiles.findMany({
      where: (t, { and, eq, isNull }) => and(eq(t.mapId, mapId), isNull(t.ownerUserId)),
      limit: 2,
    });
    const explore = (tileId: string, completedAt: Date | null) => ({
      userId: kid.id,
      tileId,
      mapId,
      layout: 1,
      terrain: 'meadow',
      searched: 1,
      spotCount: 3,
      completedAt,
    });
    await db.insert(tileExplore).values([explore(done!.id, at), explore(half!.id, null)]);
    expect(await facts(mapId, kid)).toMatchObject({
      befriended: 3,
      speciesSeen: 2,
      explored: 1,
      milestoneTiers: { collector: 2, territory: 1 },
    });
  });

  it('counts accepted trades and gifts only, with each partner once', async () => {
    const server = await start();
    const [kid, mate, other] = [await player(), await player(), await player()];
    const mapId = await newMap(server, kid);
    await join(server, kid, mate, mapId);
    await join(server, kid, other, mapId);
    const offer = (
      fromUserId: string,
      toUserId: string,
      kind: 'trade' | 'gift',
      status: 'accepted' | 'declined',
    ) => ({
      mapId,
      kind,
      status,
      fromUserId,
      toUserId,
      createdAt: at,
      expiresAt: new Date(at.getTime() + DAY_MS),
    });
    await db.insert(tradeOffers).values([
      offer(kid.id, mate.id, 'trade', 'accepted'),
      offer(mate.id, kid.id, 'gift', 'accepted'),
      offer(other.id, kid.id, 'gift', 'accepted'),
      offer(kid.id, other.id, 'trade', 'declined'),
      offer(mate.id, other.id, 'trade', 'accepted'), // not mine
    ]);
    const got = await facts(mapId, kid);
    expect(got.trades).toHaveLength(3);
    expect(new Set(got.trades.map((t) => t.partnerUserId))).toEqual(new Set([mate.id, other.id]));
    expect(got.trades.filter((t) => t.kind === 'gift')).toHaveLength(2);
  });

  it('counts joined homesteads and won journeys, and leaves fading land out of tended', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const homestead = await makeHomestead(db, mapId, kid.id, at);
    // A tile far from home, last tended a month ago: it misses you.
    const far = (
      await db.query.tiles.findMany({
        where: (t, { and, eq, isNull }) =>
          and(eq(t.mapId, mapId), isNull(t.ownerUserId), isNull(t.homeSlot)),
      })
    ).find(
      (t) =>
        t.terrain !== 'trading-post' &&
        Math.abs(t.q - homestead.q) + Math.abs(t.r - homestead.r) > 6,
    )!;
    await db.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${far.id}'`);
    await db
      .insert(tileTending)
      .values({ tileId: far.id, mapId, tendedAt: new Date(at.getTime() - 30 * DAY_MS) });
    const post = await db.query.tiles.findFirst({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.terrain, 'trading-post')),
    });
    expect(post).toBeDefined();
    const [battle] = await db
      .insert(battles)
      .values({
        mapId,
        kind: 'journey',
        playerUserId: kid.id,
        seed: '00',
        contentHash: 'x',
        setup: {},
        actions: [],
        state: {},
        status: 'finished',
        startedAt: at,
      })
      .returning({ id: battles.id });
    const journey = {
      mapId,
      userId: kid.id,
      postTileId: post!.id,
      battleId: battle!.id,
      distance: 3,
      level: 5,
      teamSize: 3,
      outcome: 'won' as const,
      startedAt: at,
      endedAt: at,
    };
    await db.insert(journeys).values(journey);
    const got = await facts(mapId, kid);
    expect(got.homesteads).toBe(1);
    // Home ring (7) and the homestead count; the far tile is fading.
    expect(got.tilesTended).toBe(8);
    expect(got.ownedTileDistances).toHaveLength(9);
    expect(got.postsUsed).toBe(1);
  });

  it('leaves a paused homestead out, and counts a post my land reaches', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await makeHomestead(db, mapId, kid.id, at, 0);
    const paused = await makeHomestead(db, mapId, kid.id, at, 1);
    await db.execute(
      `update tile_explore set paused_at = '${at.toISOString()}' where tile_id = '${paused.id}'`,
    );
    expect((await facts(mapId, kid)).homesteads).toBe(1);
    // It resumes: it counts again.
    await db.execute(
      `update tile_explore set resumed_at = '${at.toISOString()}' where tile_id = '${paused.id}'`,
    );
    expect((await facts(mapId, kid)).homesteads).toBe(2);
    // The dev route claims a path from home to the nearest post.
    expect((await facts(mapId, kid)).postsUsed).toBe(0);
    expect((await call(server, 'POST', `/maps/${mapId}/dev/posts/connect`, kid)).statusCode).toBe(
      200,
    );
    expect((await facts(mapId, kid)).postsUsed).toBe(1);
  });

  it('counts public milestones only, never a secret one', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await db.insert(milestoneRewards).values([
      { id: crypto.randomUUID(), userId: kid.id, milestoneId: 'collector', tier: 1, earnedAt: at },
      {
        id: crypto.randomUUID(),
        userId: kid.id,
        milestoneId: 'not-a-public-track',
        tier: 3,
        earnedAt: at,
      },
    ]);
    expect((await facts(mapId, kid)).milestoneTiers).toEqual({ collector: 1 });
  });

  it('invites a patch-mate on a solo patch, and not once one joins', async () => {
    const server = await start();
    const [kid, mate] = [await player(), await player()];
    const mapId = await newMap(server, kid);
    // A level 2 that needs a trade, to see the patch-mate row.
    const data: HouseData = structuredClone(HOUSE_DATA);
    data.levels[1]!.requirements.push({ kind: 'tradesCompleted', count: 1 });
    const service = createHouseService({
      db,
      clock: () => at,
      house: { mode: 'on', testers: [] },
      data,
    });
    const user = { id: kid.id, username: kid.username };
    const tradeRow = async () =>
      (await service.get(user, mapId)).next!.requirements.find(
        (r) => r.kind === 'tradesCompleted',
      )!;
    expect((await tradeRow()).hint).toBe('Invite a patch-mate to grow further 💌');
    await join(server, kid, mate, mapId);
    expect((await tradeRow()).hint).toBeNull();
  });
});
