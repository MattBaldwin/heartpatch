import {
  ApiErrorSchema,
  COMMUNITY_RULES,
  CommunityViewSchema,
  hexKey,
  hexNeighbors,
  HomeResponseSchema,
  JoinMapResponseSchema,
  MAP_GEN,
  MapResponseSchema,
  MapViewSchema,
  pieceCost,
  restoredNameIdeas,
  RestoreTileResponseSchema,
  villageRing,
  type MapDetail,
  type PublicUser,
} from '@heartpatch/shared';
import { HOLLOWED_HELPER_GIFT } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { grantItems } from '../inventory/service.js';

/*
 * Restoring, claiming, naming and planting a grey village (#306 PR 3): a
 * piece is paid from data in one transaction, a retried tap pays once, the
 * last piece claims its tile, the last tile wins the village and plants its
 * ring as home tiles, the winner names it through the filter, and leaving
 * sends the ring and its name back.
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE = 'America/Denver';
// Noon in Denver: villages are open by day.
const NOON = '2026-10-02T18:00:00Z';
// Ten at night in Denver.
const NIGHT = '2026-10-03T04:00:00Z';
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

interface Player extends PublicUser {
  token: string;
}

interface Tile {
  id: string;
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
  homeSlot: number | null;
  communityId: string | null;
}

describe.skipIf(!url)('restoring grey villages (#306 PR 3, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date(NOON);
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse(NOON));
  });

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: 'true',
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `restorer_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return { id: user!.id, username, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    payload?: object,
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Rekindle Patch',
      timeZone: ZONE,
    });
    expect(res.statusCode, res.body).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const join = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      const request = JoinMapResponseSchema.parse(join.json()).request;
      const ok = await call(
        server,
        'POST',
        `/maps/${map.id}/requests/${request.id}/approve`,
        owner,
      );
      expect(ok.statusCode).toBe(204);
    }
    return map.id;
  }

  const tilesOf = async (mapId: string): Promise<Tile[]> =>
    db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const bagOf = (mapId: string, who: Player) =>
    createInventoryRepo(db).list({ mapId, userId: who.id });
  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));
  const eventsOf = async (mapId: string, type: string) =>
    (
      await db.query.gameEvents.findMany({
        where: (t, { eq }) => eq(t.mapId, mapId),
        orderBy: (t, { asc }) => [asc(t.seq)],
      })
    ).filter((e) => e.type === type);

  /** My land reaches my nearest grey village (the explore dev route); its village and tiles. */
  async function reachVillage(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/hollowed-reach`, who);
    expect(res.statusCode, res.body).toBe(201);
    const square = res.json<{ q: number; r: number }>();
    const all = await tilesOf(mapId);
    const squareTile = all.find((t) => t.q === square.q && t.r === square.r)!;
    const communityId = squareTile.communityId!;
    const village = (
      await db.query.communityTiles.findMany({
        where: (t, { eq }) => eq(t.communityId, communityId),
      })
    ).map((ct) => ({ ...ct, tile: all.find((t) => t.id === ct.tileId)! }));
    return { communityId, square: squareTile, village };
  }

  const sheetOf = async (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    cid: string,
    t: Tile,
  ) => {
    const res = await call(
      server,
      'GET',
      `/maps/${mapId}/communities/${cid}/restore?q=${t.q}&r=${t.r}`,
      who,
    );
    expect(res.statusCode, res.body).toBe(200);
    return RestoreTileResponseSchema.parse(res.json());
  };
  const restore = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    cid: string,
    t: Tile,
    piecesDone: number,
  ) =>
    call(server, 'POST', `/maps/${mapId}/communities/${cid}/restore`, who, {
      q: t.q,
      r: t.r,
      piecesDone,
    });

  /** Enough for `n` pieces on any terrain. */
  const plenty = (n: number) => ({ timber: 10 * n, stone: 10 * n, heartdust: n });

  it('shows the next piece’s cost from data against my bag, and why it waits', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const village = (await tilesOf(mapId)).find((t) => t.communityId !== null)!;
    const away = await sheetOf(server, me, mapId, village.communityId!, village);
    expect(away.problem).toBe('away');

    const { communityId, square } = await reachVillage(server, me, mapId);
    await give(mapId, me, { timber: 3 });
    const sheet = await sheetOf(server, me, mapId, communityId, square);
    expect(sheet.problem).toBeNull();
    expect(sheet.cost).toEqual(pieceCost(square.terrain, COMMUNITY_RULES));
    expect(sheet.have['timber']).toBe(3);
    expect(sheet.tile).toMatchObject({ piecesDone: 0, restoredBy: null });
    expect(sheet.tile.piecesNeeded).toBeGreaterThanOrEqual(3);
    expect(sheet.helpers).toEqual([]);
    // Never the village's seed or its cellar key's tile (rule 6).
    expect(JSON.stringify(sheet)).not.toMatch(/seed|key/i);

    clock.setTime(Date.parse(NIGHT));
    expect((await sheetOf(server, me, mapId, communityId, square)).problem).toBe('night');
    const night = await restore(server, me, mapId, communityId, square, 0);
    expect(night.statusCode).toBe(403);
    expect(errorOf(night).message).toBe('Too spooky after dark! Come back in the morning 🌙');
  });

  it('pays one piece in one go, thanks the helper, and a retried tap pays nothing', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { communityId, square } = await reachVillage(server, me, mapId);
    await give(mapId, me, plenty(3));
    const before = await bagOf(mapId, me);
    const cost = pieceCost(square.terrain, COMMUNITY_RULES);

    const res = await restore(server, me, mapId, communityId, square, 0);
    expect(res.statusCode, res.body).toBe(200);
    const done = RestoreTileResponseSchema.parse(res.json());
    expect(done.outcome).toBe('piece');
    expect(done.gift).toEqual(HOLLOWED_HELPER_GIFT);
    expect(done.tile.piecesDone).toBe(1);
    expect(done.helpers).toEqual([{ userId: me.id, pieces: 1 }]);
    const after = await bagOf(mapId, me);
    for (const [id, n] of Object.entries(cost)) expect(after[id]).toBe((before[id] ?? 0) - n);
    for (const [id, n] of Object.entries(HOLLOWED_HELPER_GIFT)) {
      expect(after[id]).toBe((before[id] ?? 0) + n);
    }
    const ledger = await db.query.communityPieces.findMany({
      where: (t, { eq }) => eq(t.tileId, square.id),
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ userId: me.id, pieces: 1, paid: cost });
    expect(await eventsOf(mapId, 'community.mended')).toHaveLength(1);

    // The same tap again (it said 0 done): nothing more is paid or put back.
    const retry = await restore(server, me, mapId, communityId, square, 0);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(RestoreTileResponseSchema.parse(retry.json()).tile.piecesDone).toBe(1);
    expect(await bagOf(mapId, me)).toEqual(after);
  });

  it('refuses a piece I can’t pay for, and writes nothing', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { communityId, square } = await reachVillage(server, me, mapId);
    const before = await bagOf(mapId, me);
    const res = await restore(server, me, mapId, communityId, square, 0);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).message).toMatch(/^You need .* first!$/);
    expect(await bagOf(mapId, me)).toEqual(before);
    expect((await sheetOf(server, me, mapId, communityId, square)).tile.piecesDone).toBe(0);
    expect(await eventsOf(mapId, 'community.mended')).toHaveLength(0);
  });

  it('claims the tile with its last piece, and wins the village and its ring with the last tile', async () => {
    const server = await start();
    const me = await player();
    const rival = await player();
    const mapId = await patch(server, me, [rival]);
    const reached = await reachVillage(server, me, mapId);
    const { communityId, square } = reached;
    let village = reached.village;
    const slot = (await db.query.mapMembers.findFirst({
      where: (m, { and, eq }) => and(eq(m.mapId, mapId), eq(m.userId, me.id)),
    }))!.homeSlot!;
    const firstHome = (await tilesOf(mapId)).filter(
      (t) => t.ownerUserId === me.id && t.homeSlot !== null,
    );

    // A ring tile that isn't a village tile: the rival's. It stays theirs. A
    // village that fills its ring gives one tile away from my land to its grounds.
    let all = await tilesOf(mapId);
    const villageKeys = () => new Set(village.map((v) => `${v.tile.q},${v.tile.r}`));
    const freeGrounds = () =>
      villageRing(square)
        .map((h) => all.find((t) => t.q === h.q && t.r === h.r))
        .filter(
          (t): t is Tile =>
            t !== undefined &&
            !villageKeys().has(`${t.q},${t.r}`) &&
            t.ownerUserId === null &&
            t.homeSlot === null,
        );
    if (freeGrounds().length === 0) {
      const mine = all.filter((t) => t.ownerUserId === me.id);
      const spare = village.find(
        (v) =>
          v.tileId !== square.id &&
          !mine.some(
            (m) =>
              Math.abs(m.q - v.tile.q) +
                Math.abs(m.r - v.tile.r) +
                Math.abs(m.q + m.r - v.tile.q - v.tile.r) <=
              2,
          ),
      )!;
      await db.execute(`delete from community_tiles where tile_id = '${spare.tileId}'`);
      await db.execute(`update tiles set community_id = null where id = '${spare.tileId}'`);
      village = village.filter((v) => v !== spare);
      all = await tilesOf(mapId);
    }
    const theirs = freeGrounds()[0]!;
    await db.execute(`update tiles set owner_user_id = '${rival.id}' where id = '${theirs.id}'`);

    const almost = await call(server, 'POST', `/maps/${mapId}/dev/village-almost`, me, {
      communityId,
    });
    expect(almost.statusCode, almost.body).toBe(201);
    const ordered = [...village].sort((a, b) =>
      a.tile.id === square.id ? 1 : b.tile.id === square.id ? -1 : 0,
    );
    let last = null;
    for (const [i, v] of ordered.entries()) {
      const res = await restore(server, me, mapId, communityId, v.tile, v.piecesNeeded - 1);
      expect(res.statusCode, res.body).toBe(200);
      last = RestoreTileResponseSchema.parse(res.json());
      expect(last.gift).toBeUndefined();
      expect(last.outcome).toBe(i === ordered.length - 1 ? 'village' : 'tile');
      expect(last.tile.restoredBy).toBe(me.id);
    }
    expect(await eventsOf(mapId, 'tile.restored')).toHaveLength(village.length);
    const [won] = await eventsOf(mapId, 'community.restored');
    expect(won?.payload).toMatchObject({
      communityId,
      userId: me.id,
      square: { q: square.q, r: square.r },
    });

    // The village is mine, wearing its first restored name until I type one.
    const name = restoredNameIdeas(
      (await db.query.communities.findFirst({ where: (c, { eq }) => eq(c.id, communityId) }))!.name,
      COMMUNITY_RULES,
      MAP_GEN.communities,
    )[0];
    expect(last?.community).toMatchObject({ ownerUserId: me.id, named: false, name });

    // The ring: every village tile and the wild grounds are my home tiles now.
    const after = await tilesOf(mapId);
    for (const h of villageRing(square)) {
      const t = after.find((x) => x.q === h.q && x.r === h.r);
      if (!t) continue;
      if (t.id === theirs.id) {
        expect(t).toMatchObject({ ownerUserId: rival.id, homeSlot: null, communityId: null });
      } else {
        expect(t, `${t.q},${t.r}`).toMatchObject({
          ownerUserId: me.id,
          homeSlot: slot,
          communityId,
        });
      }
    }

    // One Heart Seed still: my home sheet lists my first home only.
    const home = HomeResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/home`, me)).json(),
    );
    expect(home.tiles).toHaveLength(firstHome.length);
    expect(home.tiles.filter((t) => t.heartSeed)).toHaveLength(1);
    // The map shows the ring as home land, and no ring tile can be battled.
    const view = MapViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/view`, rival)).json(),
    );
    expect(view.communities?.find((c) => c.id === communityId)?.ownerUserId).toBe(me.id);
    const claim = await call(server, 'POST', `/maps/${mapId}/attacks`, rival, {
      q: square.q,
      r: square.r,
    });
    expect(claim.statusCode).not.toBe(200);
    // Nothing more to restore: a stale tap just gets the sheet back, a fresh one is refused.
    const stale = await restore(server, me, mapId, communityId, square, 0);
    expect(stale.statusCode).toBe(200);
    expect(RestoreTileResponseSchema.parse(stale.json()).problem).toBe('won');
    const needed = village.find((v) => v.tileId === square.id)!.piecesNeeded;
    const again = await restore(server, me, mapId, communityId, square, needed);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toBe('This village is already restored! 🌈');
  });

  it('takes in my own grounds (its guard goes home), but leaves my tile with a building be', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const reached = await reachVillage(server, me, mapId);
    const { communityId, square } = reached;
    // Two grounds tiles for sure: village tiles past the first two become plain land,
    // never one my land touches (the only way in).
    const mine = new Set(
      (await tilesOf(mapId)).filter((t) => t.ownerUserId === me.id).map((t) => hexKey(t)),
    );
    const touching = (t: Tile) => hexNeighbors(t).some((n) => mine.has(hexKey(n)));
    const spare = reached.village
      .filter((v) => v.tileId !== square.id)
      .sort((a, b) => Number(touching(b.tile)) - Number(touching(a.tile)))
      .slice(2)
      .filter((v) => !touching(v.tile));
    for (const v of spare) {
      await db.execute(`delete from community_tiles where tile_id = '${v.tileId}'`);
      await db.execute(`update tiles set community_id = null where id = '${v.tileId}'`);
    }
    const village = reached.village.filter((v) => !spare.includes(v));
    const villageIds = new Set(village.map((v) => v.tileId));
    const all = await tilesOf(mapId);
    const grounds = villageRing(square)
      .map((h) => all.find((t) => t.q === h.q && t.r === h.r))
      .filter((t): t is Tile => t !== undefined && !villageIds.has(t.id) && t.homeSlot === null);
    const [guarded, built] = grounds.filter((t) => t.terrain !== 'trading-post');
    expect(built).toBeDefined();
    if (!guarded || !built) return;
    await db.execute(
      `update tiles set owner_user_id = '${me.id}' where id in ('${guarded.id}', '${built.id}')`,
    );
    const made = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, me, {
      level: 5,
      speciesId: 'puddlepuff',
    });
    expect(made.statusCode, made.body).toBe(201);
    const squishyId = made.json<{ squishy: { id: string } }>().squishy.id;
    const posted = await call(server, 'POST', `/maps/${mapId}/defenders`, me, {
      q: guarded.q,
      r: guarded.r,
      squishyIds: [squishyId],
    });
    expect(posted.statusCode, posted.body).toBe(200);
    await db.insert(buildings).values({
      mapId,
      ownerUserId: me.id,
      tileId: built.id,
      buildingId: 'hearthfire',
      kind: 'hearthfire',
      spot: 0,
    });

    await call(server, 'POST', `/maps/${mapId}/dev/village-almost`, me, { communityId });
    // A tile my land touches first: the rest are reached through it.
    const order = [...village].sort((a, b) => Number(touching(b.tile)) - Number(touching(a.tile)));
    for (const v of order) {
      const res = await restore(server, me, mapId, communityId, v.tile, v.piecesNeeded - 1);
      expect(res.statusCode, res.body).toBe(200);
      expect(RestoreTileResponseSchema.parse(res.json()).problem, res.body).not.toBe('away');
    }
    const after = await tilesOf(mapId);
    expect(after.find((t) => t.id === guarded.id)).toMatchObject({
      ownerUserId: me.id,
      communityId,
    });
    expect(after.find((t) => t.id === guarded.id)?.homeSlot).not.toBeNull();
    expect(
      await db.query.tileDefenders.findMany({ where: (d, { eq }) => eq(d.tileId, guarded.id) }),
    ).toEqual([]);
    expect(after.find((t) => t.id === built.id)).toMatchObject({
      ownerUserId: me.id,
      homeSlot: null,
      communityId: null,
    });
  });

  it('lets only the winner name it, through the filter, once a seed level', async () => {
    const server = await start();
    const me = await player();
    const rival = await player();
    const mapId = await patch(server, me, [rival]);
    const { communityId, village } = await reachVillage(server, me, mapId);
    await call(server, 'POST', `/maps/${mapId}/dev/village-almost`, me, { communityId });
    for (const v of village)
      await restore(server, me, mapId, communityId, v.tile, v.piecesNeeded - 1);

    const path = `/maps/${mapId}/communities/${communityId}/name`;
    expect((await call(server, 'POST', path, rival, { name: 'Their Glen' })).statusCode).toBe(403);
    const rude = await call(server, 'POST', path, me, { name: 'stupid town' });
    expect(rude.statusCode).toBe(400);
    const long = await call(server, 'POST', path, me, { name: 'A Very Long Village Name' });
    expect(long.statusCode).toBe(400);

    const ok = await call(server, 'POST', path, me, { name: '  Puddle   Glen ' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(CommunityViewSchema.parse(ok.json())).toMatchObject({
      name: 'Puddle Glen',
      named: true,
    });
    const [named] = await eventsOf(mapId, 'community.named');
    expect(named?.payload).toEqual({ communityId, userId: me.id, name: 'Puddle Glen' });
    // Village seeds don't grow yet: no second name.
    const twice = await call(server, 'POST', path, me, { name: 'Sunny Glen' });
    expect(twice.statusCode).toBe(403);
    expect(errorOf(twice).message).toBe('Your village’s Heart Seed needs to grow first 🌱');
  });

  it('sends the ring and its name back when the winner leaves', async () => {
    const server = await start();
    const owner = await player();
    const me = await player();
    const mapId = await patch(server, owner, [me]);
    const { communityId, village } = await reachVillage(server, me, mapId);
    await call(server, 'POST', `/maps/${mapId}/dev/village-almost`, me, { communityId });
    for (const v of village)
      await restore(server, me, mapId, communityId, v.tile, v.piecesNeeded - 1);
    await call(server, 'POST', `/maps/${mapId}/communities/${communityId}/name`, me, {
      name: 'Puddle Glen',
    });

    const left = await call(server, 'POST', `/maps/${mapId}/leave`, me);
    expect(left.statusCode, left.body).toBe(204);
    const c = await db.query.communities.findFirst({ where: (t, { eq }) => eq(t.id, communityId) });
    expect(c).toMatchObject({ ownerUserId: null, restoredName: null, namedAtLevel: null });
    const tiles = await tilesOf(mapId);
    const villageIds = new Set(village.map((v) => v.tileId));
    for (const t of tiles.filter((x) => x.homeSlot !== null)) expect(t.communityId).toBeNull();
    // The village stays a village (restored, ownerless); its grounds are plain land again.
    expect(
      tiles
        .filter((t) => t.communityId === communityId)
        .map((t) => t.id)
        .sort(),
    ).toEqual([...villageIds].sort());
    const rows = await db.query.communityTiles.findMany({
      where: (t, { eq }) => eq(t.communityId, communityId),
    });
    expect(rows.every((r) => r.restoredAt !== null)).toBe(true);
  });
});
