import {
  COMMUNITY_RULES,
  communityCount,
  GAME_DATA,
  heartSeedOf,
  hexDistance,
  hexKey,
  hexSpiral,
  MapResponseSchema,
  MapViewSchema,
  parseGameEventPayload,
  placeCommunities,
  TutorialResponseSchema,
  type Hex,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { placeMissingCommunities } from './backfill.js';

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
const UUID = /^[0-9a-f-]{36}$/;
const uuid = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
};
const RULES = GAME_DATA.mapGen.communities;
const inList = (ids: readonly string[]) => ids.map((id) => `'${uuid(id)}'`).join(',');

describe.skipIf(!url)('Hollowed Communities (#306, needs DATABASE_URL)', () => {
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
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, logger: false });
    return app;
  }

  async function player() {
    const username = `villager_${String((counter += 1))}`;
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

  async function newPatch() {
    const server = app ?? (await start());
    const owner = await player();
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/maps',
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: owner.token },
      payload: { name: 'Grey Patch', timeZone: 'America/Denver' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const mapId = uuid(MapResponseSchema.parse(res.json()).map.id);
    return { server, mapId, owner };
  }

  /** A new patch, then made "older": its villages taken off again. */
  async function olderPatch() {
    const made = await newPatch();
    await db.execute(`delete from communities where map_id = '${made.mapId}'`);
    return made;
  }

  const viewOf = async (server: FastifyInstance, mapId: string, token: string) => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/maps/${mapId}/view`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(res.statusCode, res.body).toBe(200);
    return { body: res.body, view: MapViewSchema.parse(res.json()) };
  };
  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
  const communitiesOf = (mapId: string) =>
    db.query.communities.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.id)],
    });
  const communityTilesOf = async (communityId: string) =>
    db.query.communityTiles.findMany({ where: (t, { eq }) => eq(t.communityId, communityId) });
  const eventsOf = async (mapId: string) =>
    (
      await db.query.gameEvents.findMany({
        where: (t, { eq }) => eq(t.mapId, mapId),
        orderBy: (t, { asc }) => [asc(t.seq)],
      })
    ).filter((e) => e.type === 'community.placed');
  const pass = () =>
    placeMissingCommunities(db, (mapId, err) => {
      throw new Error(`pass failed on ${mapId}: ${String(err)}`);
    });
  /** Every home slot's Heart Seed on the stored map. */
  const homesOf = (all: Awaited<ReturnType<typeof tilesOf>>): Hex[] =>
    [...new Set(all.flatMap((t) => (t.homeSlot === null ? [] : [t.homeSlot])))]
      .sort((a, b) => a - b)
      .flatMap((slot) => heartSeedOf(all.filter((t) => t.homeSlot === slot)) ?? []);

  describe('a new patch', () => {
    it('is made with its villages: rows, tiles, pieces by size and the cellar on the square', async () => {
      const { mapId } = await newPatch();
      const map = (await db.query.maps.findFirst({ where: (m, { eq }) => eq(m.id, mapId) }))!;
      const rows = await communitiesOf(mapId);
      expect(rows).toHaveLength(communityCount(map.maxPlayers, RULES));
      expect(rows.some((c) => c.kind === RULES.requiredKind)).toBe(true);
      const all = await tilesOf(mapId);
      const byId = new Map(all.map((t) => [t.id, t]));
      for (const c of rows) {
        expect(c.perkId).toBe(c.kind);
        expect(c.ownerUserId).toBeNull();
        expect(c.seed).not.toBe(map.seed);
        const village = await communityTilesOf(c.id);
        expect(village.length).toBeGreaterThanOrEqual(RULES.size.min);
        expect(village.length).toBeLessThanOrEqual(RULES.size.max);
        for (const t of village) {
          expect(t.piecesNeeded).toBe(COMMUNITY_RULES.piecesBySize[String(village.length)]);
          expect(t.piecesDone).toBe(0);
          expect(t.cellar).toBe(t.tileId === c.seedTileId);
          const tile = byId.get(t.tileId)!;
          expect(tile.communityId).toBe(c.id);
          expect(tile).toMatchObject({ ownerUserId: null, homeSlot: null });
        }
        expect(village.filter((t) => t.cellar)).toHaveLength(1);
        // The key hides outside the village.
        expect(village.map((t) => t.tileId)).not.toContain(c.keyTileId);
      }
      const marked = all.filter((t) => t.communityId !== null);
      expect(marked).toHaveLength(
        (await Promise.all(rows.map((c) => communityTilesOf(c.id)))).flat().length,
      );
      // New patches write no `community.placed`: they're made with theirs.
      expect(await eventsOf(mapId)).toEqual([]);
    });

    it('shows them in the view with reach, never the seed or the key tile', async () => {
      const { server, mapId, owner } = await newPatch();
      const rows = await communitiesOf(mapId);
      const all = await tilesOf(mapId);
      const byId = new Map(all.map((t) => [t.id, t]));
      const { body, view } = await viewOf(server, mapId, owner.token);
      expect(view.communities!.map((c) => c.id)).toEqual(rows.map((c) => c.id));
      for (const c of view.communities!) {
        const row = rows.find((r) => r.id === c.id)!;
        const square = byId.get(row.seedTileId)!;
        expect(c.square).toEqual({ q: square.q, r: square.r });
        expect(c.tiles[0]).toEqual(c.square);
        expect(c).toMatchObject({ restored: 0, ownerUserId: null, reach: 'away' });
        expect(c.distance).toBeGreaterThanOrEqual(1);
        for (const h of c.tiles) {
          const tile = view.tiles.find((t) => t.q === h.q && t.r === h.r)!;
          expect(tile.communityId).toBe(c.id);
        }
        // Rule 6: the seed and the key tile never leave the server.
        expect(Object.keys(c).sort()).toEqual([
          'distance',
          'id',
          'kind',
          'name',
          'ownerUserId',
          'reach',
          'restored',
          'square',
          'tiles',
        ]);
        expect(body).not.toContain(row.seed);
        expect(body).not.toContain(row.keyTileId);
        const key = byId.get(row.keyTileId)!;
        expect(JSON.stringify(view.communities)).not.toContain(
          `{"q":${String(key.q)},"r":${String(key.r)}}`,
        );
      }
      const others = view.tiles.filter(
        (t) => !view.communities!.some((c) => c.tiles.some((h) => h.q === t.q && h.r === t.r)),
      );
      for (const t of others) expect(t.communityId).toBeNull();

      // Own land joined to home right up to the nearest village: it's touching.
      const home = homesOf(all)[0]!;
      const villageHexes = view.communities!.flatMap((c) => c.tiles);
      const nearest = Math.min(...villageHexes.map((h) => hexDistance(h, home)));
      const disk = all.filter((t) => t.homeSlot === null && hexDistance(t, home) < nearest);
      await db.execute(
        `update tiles set owner_user_id = '${uuid(owner.id)}' where id in (${inList(disk.map((t) => t.id))})`,
      );
      const after = (await viewOf(server, mapId, owner.token)).view;
      const touched = after.communities!.filter((c) => c.reach === 'touching');
      expect(touched.length).toBeGreaterThanOrEqual(1);
      for (const c of touched) expect(c.distance).toBeNull();
      expect(touched.some((c) => c.tiles.some((h) => hexDistance(h, home) === nearest))).toBe(true);
    });

    it('leaves the Tutorial Glade without any', async () => {
      const server = await start();
      const kid = await player();
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/tutorial/start',
        headers: HEADERS,
        cookies: { [SESSION_COOKIE]: kid.token },
      });
      expect(res.statusCode, res.body).toBe(201);
      const mapId = TutorialResponseSchema.parse(res.json()).tutorial.mapId!;
      expect(await communitiesOf(mapId)).toEqual([]);
      expect((await viewOf(server, mapId, kid.token)).view.communities).toEqual([]);
      await pass();
      expect(await communitiesOf(mapId)).toEqual([]);
    });
  });

  describe('older patches (the boot pass)', () => {
    it('places the missing villages once, with community.placed and no key', async () => {
      const { mapId } = await olderPatch();
      expect(await communitiesOf(mapId)).toEqual([]);
      expect((await tilesOf(mapId)).filter((t) => t.communityId !== null)).toEqual([]);
      const done = await pass();
      expect(done.skipped).not.toContain(mapId);
      const rows = await communitiesOf(mapId);
      const map = (await db.query.maps.findFirst({ where: (m, { eq }) => eq(m.id, mapId) }))!;
      expect(rows).toHaveLength(communityCount(map.maxPlayers, RULES));
      const all = await tilesOf(mapId);
      for (const c of rows) {
        const village = await communityTilesOf(c.id);
        for (const t of village) {
          expect(all.find((x) => x.id === t.tileId)!.communityId).toBe(c.id);
          expect(t.piecesNeeded).toBe(COMMUNITY_RULES.piecesBySize[String(village.length)]);
        }
      }
      const events = await eventsOf(mapId);
      expect(events).toHaveLength(1);
      const payload = parseGameEventPayload('community.placed', events[0]!.payload);
      expect(payload.communities.map((c) => c.communityId)).toEqual(rows.map((c) => c.id));
      for (const c of rows) expect(JSON.stringify(events[0]!.payload)).not.toContain(c.keyTileId);
      expect(JSON.stringify(payload)).not.toMatch(/key/i);

      // Idempotent: a second boot changes nothing and writes no event.
      await pass();
      expect((await communitiesOf(mapId)).map((c) => c.id)).toEqual(rows.map((c) => c.id));
      expect(await eventsOf(mapId)).toHaveLength(1);
    });

    it('never puts a village tile on owned or busy land', async () => {
      const { mapId, owner } = await olderPatch();
      const all = await tilesOf(mapId);
      const map = (await db.query.maps.findFirst({ where: (m, { eq }) => eq(m.id, mapId) }))!;
      const planned = placeCommunities({
        tiles: all,
        homes: homesOf(all),
        gapTerrain: GAME_DATA.mapGen.gapTerrain,
        rules: RULES,
        seed: map.seed!,
      })!;
      // The first planned village: its square owned, a fire on another tile.
      const idAt = new Map(all.map((t) => [hexKey(t), t.id]));
      const [square, other] = planned[0]!.tiles;
      await db.execute(
        `update tiles set owner_user_id = '${uuid(owner.id)}' where id = '${uuid(idAt.get(hexKey(square!))!)}'`,
      );
      await db.insert(buildings).values({
        mapId,
        ownerUserId: owner.id,
        tileId: idAt.get(hexKey(other!))!,
        buildingId: 'hearthfire',
        kind: 'hearthfire',
        spot: 0,
      });
      await pass();
      const rows = await communitiesOf(mapId);
      expect(rows.length).toBeGreaterThan(0);
      const villageIds = (await Promise.all(rows.map((c) => communityTilesOf(c.id))))
        .flat()
        .map((t) => t.tileId);
      expect(villageIds).not.toContain(idAt.get(hexKey(square!)));
      expect(villageIds).not.toContain(idAt.get(hexKey(other!)));
      const after = await tilesOf(mapId);
      for (const id of villageIds) {
        expect(after.find((t) => t.id === id)).toMatchObject({ ownerUserId: null, homeSlot: null });
      }
    });

    it('skips a patch with no room, then places as many as fit (partial)', async () => {
      const { mapId, owner } = await olderPatch();
      const all = await tilesOf(mapId);
      const wild = all.filter((t) => t.homeSlot === null);
      // Every wild tile owned: no room at all.
      await db.execute(
        `update tiles set owner_user_id = '${uuid(owner.id)}' where id in (${inList(wild.map((t) => t.id))})`,
      );
      const done = await pass();
      expect(done.skipped).toContain(mapId);
      expect(await communitiesOf(mapId)).toEqual([]);
      expect(await eventsOf(mapId)).toEqual([]);

      // Free only the ring of one village the rule would place on open land:
      // the rule can't cover every home, so the pass places the one that fits.
      const homes = homesOf(all);
      const map = (await db.query.maps.findFirst({ where: (m, { eq }) => eq(m.id, mapId) }))!;
      const open = placeCommunities({
        tiles: all.map((t) => ({ ...t, ownerUserId: null })),
        homes,
        gapTerrain: GAME_DATA.mapGen.gapTerrain,
        rules: RULES,
        seed: map.seed!,
      })!;
      const ring = new Set(hexSpiral(open[0]!.square, 1).map(hexKey));
      const freed = wild.filter((t) => ring.has(hexKey(t)));
      await db.execute(
        `update tiles set owner_user_id = null where id in (${inList(freed.map((t) => t.id))})`,
      );
      const freedKeys = new Set(freed.map(hexKey));
      const now = all.map((t) => ({
        ...t,
        ownerUserId: t.homeSlot === null && !freedKeys.has(hexKey(t)) ? owner.id : t.ownerUserId,
      }));
      const input = {
        tiles: now,
        homes,
        gapTerrain: GAME_DATA.mapGen.gapTerrain,
        rules: RULES,
        seed: map.seed!,
        maxFromSeed: RULES.relaxedMaxFromSeed,
      };
      expect(placeCommunities(input)).toBeNull();
      const partial = placeCommunities({ ...input, partial: true });
      expect(partial?.length).toBeGreaterThan(0);

      expect((await pass()).skipped).not.toContain(mapId);
      const rows = await communitiesOf(mapId);
      expect(rows).toHaveLength(partial!.length);
      expect(rows.length).toBeLessThan(communityCount(map.maxPlayers, RULES));
      expect(await eventsOf(mapId)).toHaveLength(1);
      const villageIds = new Set(
        (await Promise.all(rows.map((c) => communityTilesOf(c.id)))).flat().map((t) => t.tileId),
      );
      for (const t of await tilesOf(mapId)) {
        if (villageIds.has(t.id)) expect(t.ownerUserId).toBeNull();
      }

      // Still short, still no room: the next boot skips it and writes nothing.
      expect((await pass()).skipped).toContain(mapId);
      expect(await communitiesOf(mapId)).toHaveLength(rows.length);
      expect(await eventsOf(mapId)).toHaveLength(1);
    });
  });
});
