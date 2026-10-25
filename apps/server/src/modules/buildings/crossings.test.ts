import {
  ApiErrorSchema,
  GAME_DATA,
  HOME_BASE_RULES,
  hexDistance,
  hexKey,
  hexNeighbors,
  isBuildable,
  JoinMapResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  parseGameEventPayload,
  TRAVEL_RULES,
  type Hex,
  type MapDetail,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, tileTending, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { crossersOf, lostDockOwners, refreshSupply } from '../territory/supply.js';
import { openHomestead } from '../../../tests/homestead.js';

/*
 * Wild Isle bridges and ferry docks (#621 W1-5b): where a bridge may stand
 * and who it carries; a ferry dock by a lake, one a lake, carrying its
 * owner's line across; each one's supply line refreshed as it goes up and
 * comes down (the lost-crossing grace for exactly the lines that crossed
 * it), a bridge owner leaving the patch, and a Cozy Patch untouched.
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
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
const ZONE = 'America/Denver';
const START = '2026-10-02T18:00:00Z';
const PLENTY = { timber: 200, stone: 200 };
const DIRECTIONS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

interface Player extends PublicUser {
  token: string;
}

interface Tile {
  id: string;
  q: number;
  r: number;
  ownerUserId: string | null;
  homeSlot: number | null;
  terrain: string;
  nodeResource: string | null;
  communityId: string | null;
}

describe.skipIf(!url)('bridges and ferry docks (needs DATABASE_URL)', () => {
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
    const username = `ferrier_${String((counter += 1))}`;
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

  /** A patch (Cozy, as the generator makes them today), with `others` joined. */
  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, { name: 'Ferry Patch', timeZone: ZONE });
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

  const makeWild = (mapId: string) =>
    db.execute(`update maps set patch_type = 'wild-isle' where id = '${mapId}'`);
  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));
  const tilesOf = async (mapId: string): Promise<Tile[]> =>
    db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const setTerrain = (tile: Hex & { id: string }, terrain: string) =>
    db.execute(
      `update tiles set terrain = '${terrain}', node_resource = null where id = '${tile.id}'`,
    );
  /** Hands a tile to `userId` as a claim would: owned and tended now. */
  async function own(mapId: string, tile: Tile, userId: string) {
    await db.execute(`update tiles set owner_user_id = '${userId}' where id = '${tile.id}'`);
    await db
      .insert(tileTending)
      .values({ tileId: tile.id, mapId, tendedAt: clock, claimedAt: clock })
      .onConflictDoUpdate({
        target: tileTending.tileId,
        set: { tendedAt: clock, strandedSince: null },
      });
  }
  const strandedOf = async (tileId: string) =>
    (await db.query.tileTending.findFirst({ where: (t, { eq }) => eq(t.tileId, tileId) }))
      ?.strandedSince ?? null;
  const eventsOf = (mapId: string, type: string) =>
    db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, type)),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  /** Works out these lines now (nightfall's pass), marking land cut off from home. */
  const resupply = (mapId: string, userIds: string[]) =>
    withTransaction(db, (tx) => refreshSupply(tx, mapId, userIds, clock));
  const later = (hours: number) => new Date(clock.getTime() + hours * HOUR_MS);

  /** `who`'s Heart Seed. */
  async function seedOf(mapId: string, who: Player): Promise<Tile> {
    const tiles = await tilesOf(mapId);
    const home = tiles.filter((t) => t.ownerUserId === who.id && t.homeSlot !== null);
    const homeKeys = new Set(home.map(hexKey));
    return home.find((t) => hexNeighbors(t).every((n) => homeKeys.has(hexKey(n))))!;
  }

  /**
   * A straight line of tiles out from `who`'s Heart Seed: `line[k]` is k
   * steps away (`line[1]` is in the home ring). Every tile on it is plain
   * neutral land past the ring.
   */
  async function lineFrom(mapId: string, who: Player, length = 6): Promise<Tile[]> {
    const tiles = await tilesOf(mapId);
    const at = new Map(tiles.map((t) => [hexKey(t), t]));
    const seed = await seedOf(mapId, who);
    for (const d of DIRECTIONS) {
      const line = Array.from({ length: length + 1 }, (_, k) =>
        at.get(hexKey({ q: seed.q + d.q * k, r: seed.r + d.r * k })),
      );
      const ok = line.every(
        (t, k) =>
          t !== undefined &&
          (k <= 1 ||
            (t.ownerUserId === null &&
              t.homeSlot === null &&
              t.communityId === null &&
              t.terrain !== 'trading-post')),
      );
      if (ok) return line as Tile[];
    }
    throw new Error('no clear line out of home');
  }

  const build = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    buildingId: string,
    h: Hex,
    spot = 1,
  ) => call(server, 'POST', `/maps/${mapId}/buildings`, who, { buildingId, q: h.q, r: h.r, spot });
  const takeDown = (server: FastifyInstance, who: Player, mapId: string, buildingRowId: string) =>
    call(server, 'POST', `/maps/${mapId}/buildings/${buildingRowId}/remove`, who);
  const rowOn = async (tileId: string) =>
    (await db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.tileId, tileId) })) ?? null;

  /**
   * A Wild Isle with a river across `kid`'s line out of home at (3): their
   * land at (2), and cut-off land past the river at (4) and (5).
   */
  async function riverSetup(others: Player[] = []) {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, others);
    await makeWild(mapId);
    await give(mapId, kid, PLENTY);
    const line = await lineFrom(mapId, kid);
    await setTerrain(line[3]!, 'river');
    for (const k of [2, 4, 5]) await own(mapId, line[k]!, kid.id);
    return { server, kid, mapId, line };
  }

  describe('bridges', () => {
    it('go over a river, next to land joined up to home, one a tile, in a ring spot', async () => {
      const rival = await player();
      const { server, kid, mapId, line } = await riverSetup([rival]);
      await give(mapId, rival, PLENTY);

      const onLand = await build(server, kid, mapId, 'bridge', line[4]!);
      expect(onLand.statusCode).toBe(403);
      expect(errorOf(onLand).message).toBe('A Bridge goes over a river 💧');
      const middle = await build(server, kid, mapId, 'bridge', line[3]!, 0);
      expect(middle.statusCode).toBe(409);
      // The rival has no land joined up to home next to this river tile.
      const far = await build(server, rival, mapId, 'bridge', line[3]!);
      expect(far.statusCode).toBe(403);
      expect(errorOf(far).message).toBe(
        'Build your bridge right next to land that’s joined up to home 🌉',
      );

      const built = await build(server, kid, mapId, 'bridge', line[3]!);
      expect(built.statusCode, built.body).toBe(201);
      const row = (await rowOn(line[3]!.id))!;
      expect(row).toMatchObject({ ownerUserId: kid.id, buildingId: 'bridge', kind: 'travel' });
      // Shared: nobody needs a second one, and nobody can build one there.
      const second = await build(server, rival, mapId, 'bridge', line[3]!);
      expect(second.statusCode).toBe(409);
      expect(errorOf(second).message).toBe(
        'There’s a bridge here already! Every Keeper can cross it 🌉',
      );
      // Everyone on the patch sees it on the map, on its river tile nobody owns.
      const view = MapViewSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/view`, rival)).json(),
      );
      const river = view.tiles.find((t) => t.q === line[3]!.q && t.r === line[3]!.r)!;
      expect(river.ownerUserId).toBeNull();
      expect(river.buildings.map((b) => b.buildingId)).toEqual(['bridge']);
    });

    it('join up land past the river, and leave it the lost-crossing grace when they come down', async () => {
      const { server, kid, mapId, line } = await riverSetup();
      await resupply(mapId, [kid.id]);
      expect(await strandedOf(line[4]!.id)).toEqual(clock);

      const built = await build(server, kid, mapId, 'bridge', line[3]!);
      expect(built.statusCode, built.body).toBe(201);
      expect(await strandedOf(line[4]!.id)).toBeNull();
      expect(await strandedOf(line[5]!.id)).toBeNull();
      const [supplied] = await eventsOf(mapId, 'tile.supplied');
      expect(parseGameEventPayload('tile.supplied', supplied!.payload)).toEqual({
        userId: kid.id,
        tiles: [line[4]!, line[5]!].map(({ q, r }) => ({ q, r })),
      });

      clock.setTime(clock.getTime() + HOUR_MS);
      const row = (await rowOn(line[3]!.id))!;
      const down = await takeDown(server, kid, mapId, row.id);
      expect(down.statusCode, down.body).toBe(200);
      const grace = later(TRAVEL_RULES.stranded.graceHoursAfterBridgeLoss);
      expect(await strandedOf(line[4]!.id)).toEqual(grace);
      expect(await strandedOf(line[5]!.id)).toEqual(grace);
      // (The first marks were the pass above's, appended by nobody.)
      const [stranded] = await eventsOf(mapId, 'tile.stranded');
      expect(parseGameEventPayload('tile.stranded', stranded!.payload)).toEqual({
        userId: kid.id,
        tiles: [line[4]!, line[5]!].map(({ q, r }) => ({ q, r })),
      });
    });

    it('come down with their owner leaving, and only the lines that crossed one get the grace', async () => {
      const owner = await player();
      const leaver = await player();
      const server = await start();
      const mapId = await patch(server, owner, [leaver]);
      await makeWild(mapId);
      // The owner's line crosses the leaver's bridge at (3) to (4) and (5).
      const line = await lineFrom(mapId, owner);
      await setTerrain(line[3]!, 'river');
      for (const k of [2, 4, 5]) await own(mapId, line[k]!, owner.id);
      await db.insert(buildings).values({
        mapId,
        ownerUserId: leaver.id,
        tileId: line[3]!.id,
        buildingId: 'bridge',
        kind: 'travel',
        spot: 1,
        placedAt: clock,
      });
      expect(await withTransaction(db, (tx) => crossersOf(tx, mapId, [line[3]!]))).toEqual([
        owner.id,
      ]);

      clock.setTime(clock.getTime() + HOUR_MS);
      expect((await call(server, 'POST', `/maps/${mapId}/leave`, leaver)).statusCode).toBe(204);
      expect(await rowOn(line[3]!.id)).toBeNull();
      const grace = later(TRAVEL_RULES.stranded.graceHoursAfterBridgeLoss);
      expect(await strandedOf(line[4]!.id)).toEqual(grace);
      expect(await strandedOf(line[5]!.id)).toEqual(grace);
      const removed = (await eventsOf(mapId, 'building.removed')).map((e) =>
        parseGameEventPayload('building.removed', e.payload),
      );
      expect(removed).toContainEqual(
        expect.objectContaining({ buildingId: 'bridge', lost: 'left' }),
      );
    });
  });

  describe('ferry docks', () => {
    /**
     * A Wild Isle where the neutral land two and three rings past `kid`'s
     * home ring (3 and 4 steps from the Heart Seed) is one lake, an open
     * homestead of theirs on its shore, and land of theirs on the far bank
     * (5 steps out, past the lake beside the homestead).
     */
    async function lakeSetup() {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await makeWild(mapId);
      await give(mapId, kid, PLENTY);
      const plot = await openHomestead(db, mapId, kid.id, clock);
      const plot2 = await openHomestead(db, mapId, kid.id, clock, 1);
      const seed = await seedOf(mapId, kid);
      const tiles = await tilesOf(mapId);
      const free = (t: Tile) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        t.communityId === null &&
        t.terrain !== 'trading-post';
      return { server, kid, mapId, plot, plot2, seed, tiles, free };
    }

    it('go on a homestead by a lake, one a lake, and carry their owner’s line across', async () => {
      const { server, kid, mapId, plot, plot2, seed, tiles, free } = await lakeSetup();
      // No lake yet: nothing to ferry across.
      const dry = await build(server, kid, mapId, 'ferry-dock', plot);
      expect(dry.statusCode).toBe(403);
      expect(errorOf(dry).message).toBe('A Ferry Dock needs a lake next door 💧');

      const lake = tiles.filter((t) => free(t) && [3, 4].includes(hexDistance(t, seed)));
      for (const t of lake) await setTerrain(t, 'wild-lake');
      const lakeKeys = new Set(lake.map(hexKey));
      // Far bank: 5 steps out, touching the lake one step past the tile beside the dock.
      const near = lake.find((t) => hexDistance(t, plot) === 1 && hexDistance(t, seed) === 3)!;
      const bank = tiles.find(
        (t) =>
          free(t) &&
          hexDistance(t, seed) === 5 &&
          hexNeighbors(t).some((n) => lakeKeys.has(hexKey(n)) && hexDistance(n, near) <= 1),
      )!;
      await own(mapId, bank, kid.id);
      await resupply(mapId, [kid.id]);
      expect(await strandedOf(bank.id)).toEqual(clock);

      const docked = await build(server, kid, mapId, 'ferry-dock', plot);
      expect(docked.statusCode, docked.body).toBe(201);
      expect(await strandedOf(bank.id)).toBeNull();
      // One dock a lake (`ferry.oneDockPerLake`).
      expect(TRAVEL_RULES.ferry.oneDockPerLake).toBe(true);
      const again = await build(server, kid, mapId, 'ferry-dock', plot2);
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).message).toBe('You already have a dock on this lake! One is plenty ⛵');
      // A Waystation waits for its own lane.
      expect((await build(server, kid, mapId, 'waystation', plot2)).statusCode).toBe(409);

      // Taken down: the far bank strands after the grace.
      clock.setTime(clock.getTime() + HOUR_MS);
      const row = (await rowOn(plot.id))!;
      expect((await takeDown(server, kid, mapId, row.id)).statusCode).toBe(200);
      expect(await strandedOf(bank.id)).toEqual(
        later(TRAVEL_RULES.stranded.graceHoursAfterBridgeLoss),
      );
    });

    it('lost with their land, give their owner’s line the grace', async () => {
      const { kid, mapId, plot, plot2 } = await lakeSetup();
      await db.insert(buildings).values({
        mapId,
        ownerUserId: kid.id,
        tileId: plot.id,
        buildingId: 'ferry-dock',
        kind: 'travel',
        spot: 1,
        placedAt: clock,
      });
      const lost = (held: { q: number; r: number; ownerUserId: string | null }[]) =>
        withTransaction(db, (tx) => lostDockOwners(tx, mapId, held));
      expect(await lost([{ ...plot, ownerUserId: kid.id }])).toEqual([kid.id]);
      // Not the dock's tile, or held by someone else: no grace.
      expect(await lost([{ ...plot2, ownerUserId: kid.id }])).toEqual([]);
      expect(await lost([{ ...plot, ownerUserId: null }])).toEqual([]);
    });
  });

  it('leaves a Cozy Patch exactly as it was: no bridges, no docks, no supply lines', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await give(mapId, kid, PLENTY);
    const line = await lineFrom(mapId, kid);
    await own(mapId, line[2]!, kid.id);
    await setTerrain(line[3]!, 'river');
    const plot = await openHomestead(db, mapId, kid.id, clock);
    for (const n of hexNeighbors(plot)) {
      const t = (await tilesOf(mapId)).find((x) => hexKey(x) === hexKey(n))!;
      if (t.ownerUserId === null && t.homeSlot === null) await setTerrain(t, 'lake');
    }
    for (const [id, at] of [
      ['bridge', line[3]!],
      ['ferry-dock', plot],
      ['waystation', plot],
    ] as const) {
      const res = await build(server, kid, mapId, id, at);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).message).toBe("That one isn't ready to build yet. Soon!");
    }
    // The Build sheet's kinds are today's: no travel building fits a Cozy Patch.
    expect(
      GAME_DATA.buildings.filter((b) => b.kind === 'travel' && isBuildable(HOME_BASE_RULES, b)),
    ).toEqual([]);
    // Nothing reads or writes a supply line there.
    await withTransaction(db, async (tx) => {
      expect(await crossersOf(tx, mapId, [line[3]!])).toEqual([]);
      expect(await refreshSupply(tx, mapId, [kid.id], clock, { lostCrossing: true })).toEqual([]);
    });
    expect(await strandedOf(line[2]!.id)).toBeNull();
  });
});
