import {
  ApiErrorSchema,
  CellarViewSchema,
  COMMUNITY_RULES,
  CommunityKindIdSchema,
  CommunityViewSchema,
  BIG_CHEST_KIND,
  hexDistance,
  isBigChest,
  keyInReach,
  MapResponseSchema,
  MapViewSchema,
  JoinMapResponseSchema,
  REKINDLED,
  SearchSpotResponseSchema,
  type MapDetail,
  type PublicUser,
} from '@heartpatch/shared';
import { CELLAR_RULES } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { setDevDropChance } from '../wardrobe/drops.js';

/*
 * The key hunt and the hidden cellar (#306 PR 2c): winning a village gives
 * its winner (only) a map to the key's tile; they dig the key up there once
 * their land reaches it, whoever holds that tile, and nobody's land changes;
 * the key opens the cellar on the square once; its spots are searched once
 * each for never-empty finds; leaving takes the key and the cellar with it.
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE = 'America/Denver';
// Noon in Denver: villages are open by day.
const NOON = '2026-10-02T18:00:00Z';
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

describe.skipIf(!url)('the key hunt and the hidden cellar (#306 PR 2c, needs DATABASE_URL)', () => {
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
    const username = `digger_${String((counter += 1))}`;
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
      name: 'Cellar Patch',
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
  const eventsOf = async (mapId: string, type: string) =>
    (
      await db.query.gameEvents.findMany({
        where: (t, { eq }) => eq(t.mapId, mapId),
        orderBy: (t, { asc }) => [asc(t.seq)],
      })
    ).filter((e) => e.type === type);
  const communityRow = (id: string) =>
    db.query.communities.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  const cellarRow = async (communityId: string) =>
    (
      await db.query.communityTiles.findMany({
        where: (t, { eq }) => eq(t.communityId, communityId),
      })
    ).find((t) => t.cellar)!;
  const villageOf = async (server: FastifyInstance, who: Player, mapId: string, id: string) =>
    MapViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/view`, who)).json(),
    ).communities?.find((c) => c.id === id);

  /** Me, a rival, a patch (theirs if `joined`), and the village my land reaches, won by me. */
  async function wonVillage(joined = false) {
    const server = await start();
    const me = await player();
    const rival = await player();
    const mapId = joined ? await patch(server, rival, [me]) : await patch(server, me, [rival]);
    const res = await call(server, 'POST', `/maps/${mapId}/dev/hollowed-reach`, me);
    expect(res.statusCode, res.body).toBe(201);
    const at = res.json<{ q: number; r: number }>();
    const square = (await tilesOf(mapId)).find((t) => t.q === at.q && t.r === at.r)!;
    const communityId = square.communityId!;
    const village = await db.query.communityTiles.findMany({
      where: (t, { eq }) => eq(t.communityId, communityId),
    });

    // Before the win: no map for anyone.
    expect((await villageOf(server, me, mapId, communityId))?.cellar).toBeUndefined();

    await call(server, 'POST', `/maps/${mapId}/dev/village-almost`, me, { communityId });
    const all = await tilesOf(mapId);
    for (const v of village) {
      const t = all.find((x) => x.id === v.tileId)!;
      const done = await call(
        server,
        'POST',
        `/maps/${mapId}/communities/${communityId}/restore`,
        me,
        {
          q: t.q,
          r: t.r,
          piecesDone: v.piecesNeeded - 1,
        },
      );
      expect(done.statusCode, done.body).toBe(200);
    }
    expect((await communityRow(communityId))?.ownerUserId).toBe(me.id);
    return { server, me, rival, mapId, communityId, square };
  }

  const path = (mapId: string, communityId: string, rest: string) =>
    `/maps/${mapId}/communities/${communityId}/${rest}`;

  it('gives the winner, and only the winner, a map to the key', async () => {
    const { server, me, rival, mapId, communityId } = await wonVillage();
    const row = (await communityRow(communityId))!;
    const key = (await tilesOf(mapId)).find((t) => t.id === row.keyTileId)!;
    const mine = await villageOf(server, me, mapId, communityId);
    expect(mine?.cellar).toEqual({ state: 'hunt', keyTile: { q: key.q, r: key.r } });
    // The key hides outside the village (owner decision 5).
    expect(mine!.tiles.some((t) => t.q === key.q && t.r === key.r)).toBe(false);
    expect(Math.min(...mine!.tiles.map((t) => hexDistance(t, key)))).toBeGreaterThanOrEqual(2);
    // Rule 6: the rival's view never says where it is.
    expect((await villageOf(server, rival, mapId, communityId))?.cellar).toBeUndefined();
    expect((await call(server, 'POST', path(mapId, communityId, 'key'), rival)).statusCode).toBe(
      403,
    );
  });

  it("digs the key up next to my land on a rival's tile, and changes nobody's land", async () => {
    const { server, me, rival, mapId, communityId } = await wonVillage();
    // Hide the key on a rival's tile out of my reach (the placement allows owned and busy land).
    const all = await tilesOf(mapId);
    const far = all.find(
      (t) =>
        t.homeSlot === null &&
        t.communityId === null &&
        t.ownerUserId === null &&
        t.terrain !== 'trading-post' &&
        t.terrain !== 'junipers-gap' &&
        !keyInReach(t, all, me.id) &&
        all.some((x) => x.ownerUserId === me.id && hexDistance(x, t) === 3),
    )!;
    await db.execute(
      `update tiles set owner_user_id = '${rival.id}' where id = '${far.id}';
       update communities set key_tile_id = '${far.id}' where id = '${communityId}';`,
    );
    const dig = path(mapId, communityId, 'key');
    const away = await call(server, 'POST', dig, me);
    expect(away.statusCode).toBe(403);
    expect(errorOf(away).message).toBe('Claim land next to it to dig for the key!');
    expect((await communityRow(communityId))?.keyRevealedAt).toBeNull();

    // Claim toward it (the dev path), then dig: the tile stays the rival's.
    const reach = await call(server, 'POST', `/maps/${mapId}/dev/key-reach`, me, { communityId });
    expect(reach.statusCode, reach.body).toBe(201);
    const before = (await tilesOf(mapId)).find((t) => t.id === far.id);
    const ok = await call(server, 'POST', dig, me);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(CommunityViewSchema.parse(ok.json()).cellar).toEqual({ state: 'key' });
    expect((await tilesOf(mapId)).find((t) => t.id === far.id)).toEqual(before);
    expect(before?.ownerUserId).toBe(rival.id);
    expect((await communityRow(communityId))?.keyRevealedAt).toEqual(new Date(NOON));

    // Once.
    const again = await call(server, 'POST', dig, me);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toBe('You already found this key! 🔑');

    // The event keeps where internally, and only I hear of it.
    const [found] = await eventsOf(mapId, 'key.found');
    expect(found?.payload).toEqual({ communityId, userId: me.id, q: far.q, r: far.r });
    expect(publicViewFor(PUBLIC_VIEWS, found!, { userId: me.id })).toEqual({
      communityId,
      userId: me.id,
    });
    expect(publicViewFor(PUBLIC_VIEWS, found!, { userId: rival.id })).toBeNull();
    // And my view stops naming the key's tile.
    const view = JSON.stringify(await villageOf(server, me, mapId, communityId));
    expect(view).not.toContain('keyTile');
  });

  it('opens the cellar with the key, once, and only for its winner', async () => {
    const { server, me, rival, mapId, communityId } = await wonVillage();
    const open = path(mapId, communityId, 'cellar');
    const noKey = await call(server, 'POST', open, me);
    expect(noKey.statusCode).toBe(409);
    expect(errorOf(noKey).message).toBe('Find the cellar key first! 🗺️');
    const shut = await call(server, 'GET', open, me);
    expect(shut.statusCode).toBe(409);
    expect(errorOf(shut).message).toBe('Open the cellar with its key first! 🔑');

    await call(server, 'POST', `/maps/${mapId}/dev/key-reach`, me, { communityId });
    expect((await call(server, 'POST', path(mapId, communityId, 'key'), me)).statusCode).toBe(200);
    expect((await call(server, 'POST', open, rival)).statusCode).toBe(403);
    const opened = await call(server, 'POST', open, me);
    expect(opened.statusCode, opened.body).toBe(200);
    expect(CommunityViewSchema.parse(opened.json()).cellar).toEqual({ state: 'open' });
    expect((await cellarRow(communityId)).cellarOpenedAt).toEqual(new Date(NOON));
    expect(await eventsOf(mapId, 'cellar.opened')).toHaveLength(1);
    const twice = await call(server, 'POST', open, me);
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice).message).toBe('The cellar is already open! 🕯️');
  });

  it('searches every cellar spot once, hands only, for finds that are never empty', async () => {
    const { server, me, rival, mapId, communityId, square } = await wonVillage();
    await call(server, 'POST', `/maps/${mapId}/dev/key-reach`, me, { communityId });
    await call(server, 'POST', path(mapId, communityId, 'key'), me);
    await call(server, 'POST', path(mapId, communityId, 'cellar'), me);

    const res = await call(server, 'GET', path(mapId, communityId, 'cellar'), me);
    expect(res.statusCode, res.body).toBe(200);
    const view = CellarViewSchema.parse(res.json());
    expect(view).toMatchObject({
      q: square.q,
      r: square.r,
      terrain: COMMUNITY_RULES.cellar.terrain,
      needs: [],
      homestead: null,
      cellar: { communityId },
    });
    // The small chests, then the big chest (#306).
    const { min, max } = COMMUNITY_RULES.cellar.spots;
    expect(view.spots.length).toBeGreaterThanOrEqual(min + 1);
    expect(view.spots.length).toBeLessThanOrEqual(max + 1);
    expect(view.spots.at(-1)?.kind).toBe(BIG_CHEST_KIND);
    expect(view.spots.every((s) => s.tool === null && !s.done)).toBe(true);
    // Rule 6: no seed, no odds.
    expect(res.body).not.toMatch(/seed|weight|keepsake/i);
    expect((await call(server, 'GET', path(mapId, communityId, 'cellar'), rival)).statusCode).toBe(
      403,
    );

    const search = path(mapId, communityId, 'cellar/search');
    for (const spot of view.spots) {
      const found = await call(server, 'POST', search, me, { spot: spot.index });
      expect(found.statusCode, found.body).toBe(200);
      const body = SearchSpotResponseSchema.parse(found.json());
      expect(Object.keys(body.found).length > 0 || body.lore !== null).toBe(true);
      expect(body.tool).toBeNull();
    }
    const done = CellarViewSchema.parse(
      (await call(server, 'GET', path(mapId, communityId, 'cellar'), me)).json(),
    );
    expect(done.progress).toEqual({ searched: view.spots.length, total: view.spots.length });
    expect(done.spots.every((s) => s.done)).toBe(true);
    const again = await call(server, 'POST', search, me, { spot: 0 });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toBe('You already opened that chest!');
    expect((await call(server, 'POST', search, me, { spot: 99 })).statusCode).toBe(404);

    // An explore search at the square, so lore and the Seeker track count it.
    const searched = (await eventsOf(mapId, 'explore.searched')).filter(
      (e) => (e.payload as { userId: string }).userId === me.id,
    );
    expect(searched).toHaveLength(view.spots.length);
    expect(searched[0]?.payload).toMatchObject({ q: square.q, r: square.r, tool: null });
  });

  it('finds the Rekindled set in the cellar too, through its cellar odds (#306 PR 5)', async () => {
    const { server, me, mapId, communityId } = await wonVillage();
    await call(server, 'POST', `/maps/${mapId}/dev/key-reach`, me, { communityId });
    await call(server, 'POST', path(mapId, communityId, 'key'), me);
    await call(server, 'POST', path(mapId, communityId, 'cellar'), me);
    const view = CellarViewSchema.parse(
      (await call(server, 'GET', path(mapId, communityId, 'cellar'), me)).json(),
    );
    // Every drop table finds something: each search turns up a piece or a find
    // of the set (two members here, so pieces count toward the title).
    setDevDropChance(100);
    try {
      for (const spot of view.spots.filter((s) => !isBigChest(s))) {
        const res = await call(server, 'POST', path(mapId, communityId, 'cellar/search'), me, {
          spot: spot.index,
        });
        expect(res.statusCode, res.body).toBe(200);
        const body = SearchSpotResponseSchema.parse(res.json());
        const piece = body.clothing !== null && REKINDLED.pieces.includes(body.clothing);
        const find = REKINDLED.finds.some((id) => (body.found[id] ?? 0) > 0);
        expect(piece || find, res.body).toBe(true);
        for (const id of REKINDLED.finds) {
          if ((body.found[id] ?? 0) > 0) expect(body.items[id]).toBeGreaterThan(0);
        }
      }
    } finally {
      setDevDropChance(null);
    }
  });

  it("opens the big chest last, once, for a big pile and the Hollow kind's keepsake (#306)", async () => {
    const { server, me, mapId, communityId } = await wonVillage();
    await call(server, 'POST', `/maps/${mapId}/dev/key-reach`, me, { communityId });
    await call(server, 'POST', path(mapId, communityId, 'key'), me);
    await call(server, 'POST', path(mapId, communityId, 'cellar'), me);
    const view = CellarViewSchema.parse(
      (await call(server, 'GET', path(mapId, communityId, 'cellar'), me)).json(),
    );
    const big = view.spots.find(isBigChest)!;
    const search = path(mapId, communityId, 'cellar/search');
    const { bigChest } = CELLAR_RULES;
    const kind = CommunityKindIdSchema.parse((await communityRow(communityId))?.kind);
    const keepsake = bigChest.keepsakes[kind];

    // Shut until the little chests are open (`afterSmall`).
    expect(bigChest.afterSmall).toBe(true);
    const early = await call(server, 'POST', search, me, { spot: big.index });
    expect(early.statusCode).toBe(409);
    expect(errorOf(early).message).toBe('Open the little chests first! 🗝️');
    expect((await cellarRow(communityId)).cellarSearched).toBe(0);
    for (const spot of view.spots.filter((s) => !isBigChest(s))) {
      const res = await call(server, 'POST', search, me, { spot: spot.index });
      expect(res.statusCode, res.body).toBe(200);
      // A small chest never gives a keepsake.
      expect(SearchSpotResponseSchema.parse(res.json()).clothing).not.toBe(keepsake);
    }
    const before = (await call(server, 'GET', `/maps/${mapId}/inventory`, me)).json<{
      items: Record<string, number>;
    }>().items;

    const res = await call(server, 'POST', search, me, { spot: big.index });
    expect(res.statusCode, res.body).toBe(200);
    const body = SearchSpotResponseSchema.parse(res.json());
    expect(body.found).toEqual(bigChest.items);
    expect(body.clothing).toBe(keepsake);
    expect(body.notable).toBe('cosmetic');
    expect(body.lore).toBeNull();
    for (const [id, n] of Object.entries(bigChest.items)) {
      expect(body.items[id]).toBe((before[id] ?? 0) + n);
    }
    expect(body.progress).toEqual({ searched: view.spots.length, total: view.spots.length });
    const owned = await db.query.clothingOwned.findMany({
      where: (t, { and, eq }) => and(eq(t.userId, me.id), eq(t.itemId, keepsake)),
    });
    expect(owned).toHaveLength(1);
    const found = (await eventsOf(mapId, 'clothing.found')).filter(
      (e) => (e.payload as { itemId: string }).itemId === keepsake,
    );
    expect(found).toHaveLength(1);

    // Once only.
    const again = await call(server, 'POST', search, me, { spot: big.index });
    expect(again.statusCode).toBe(409);
    expect(
      await db.query.clothingOwned.findMany({
        where: (t, { and, eq }) => and(eq(t.userId, me.id), eq(t.itemId, keepsake)),
      }),
    ).toHaveLength(1);
  });

  it('gives the pile but not a second keepsake to a Keeper who has it already (#306)', async () => {
    const { server, me, mapId, communityId } = await wonVillage();
    await call(server, 'POST', `/maps/${mapId}/dev/key-reach`, me, { communityId });
    await call(server, 'POST', path(mapId, communityId, 'key'), me);
    await call(server, 'POST', path(mapId, communityId, 'cellar'), me);
    const kind = CommunityKindIdSchema.parse((await communityRow(communityId))?.kind);
    const keepsake = CELLAR_RULES.bigChest.keepsakes[kind];
    const given = await call(server, 'POST', '/dev/wardrobe/items', me, { items: [keepsake] });
    expect(given.statusCode, given.body).toBe(201);
    const view = CellarViewSchema.parse(
      (await call(server, 'GET', path(mapId, communityId, 'cellar'), me)).json(),
    );
    const search = path(mapId, communityId, 'cellar/search');
    for (const spot of view.spots) {
      const res = await call(server, 'POST', search, me, { spot: spot.index });
      expect(res.statusCode, res.body).toBe(200);
      if (!isBigChest(spot)) continue;
      const body = SearchSpotResponseSchema.parse(res.json());
      expect(body.found).toEqual(CELLAR_RULES.bigChest.items);
      expect(body.clothing).toBeNull();
    }
    expect(
      await db.query.clothingOwned.findMany({
        where: (t, { and, eq }) => and(eq(t.userId, me.id), eq(t.itemId, keepsake)),
      }),
    ).toHaveLength(1);
  });

  it('lets a double tap dig, open or search only once', async () => {
    const { server, me, mapId, communityId } = await wonVillage();
    await call(server, 'POST', `/maps/${mapId}/dev/key-reach`, me, { communityId });
    const twice = async (p: string, payload?: object) =>
      (
        await Promise.all([
          call(server, 'POST', p, me, payload),
          call(server, 'POST', p, me, payload),
        ])
      )
        .map((r) => r.statusCode)
        .sort();
    expect(await twice(path(mapId, communityId, 'key'))).toEqual([200, 409]);
    expect(await twice(path(mapId, communityId, 'cellar'))).toEqual([200, 409]);
    expect(await twice(path(mapId, communityId, 'cellar/search'), { spot: 1 })).toEqual([200, 409]);
    expect(await eventsOf(mapId, 'key.found')).toHaveLength(1);
    expect(await eventsOf(mapId, 'cellar.opened')).toHaveLength(1);
    expect((await cellarRow(communityId)).cellarSearched).toBe(2);
  });

  it('takes the key and the cellar with the winner when they leave', async () => {
    const { server, me, mapId, communityId } = await wonVillage(true);
    await call(server, 'POST', `/maps/${mapId}/dev/key-reach`, me, { communityId });
    await call(server, 'POST', path(mapId, communityId, 'key'), me);
    await call(server, 'POST', path(mapId, communityId, 'cellar'), me);
    await call(server, 'POST', path(mapId, communityId, 'cellar/search'), me, { spot: 0 });
    const left = await call(server, 'POST', `/maps/${mapId}/leave`, me);
    expect(left.statusCode, left.body).toBe(204);
    expect((await communityRow(communityId))?.keyRevealedAt).toBeNull();
    expect(await cellarRow(communityId)).toMatchObject({
      cellarOpenedAt: null,
      cellarSearched: 0,
    });
  });
});
