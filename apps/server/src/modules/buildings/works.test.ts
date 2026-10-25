import {
  ApiErrorSchema,
  BUILDINGS,
  GAME_DATA,
  HeartCoinsResponseSchema,
  HOME_BASE_RULES,
  HomeResponseSchema,
  isBuildable,
  isBuildableOn,
  MapResponseSchema,
  SettleResponseSchema,
  WEATHER_RULES,
  hexKey,
  hexNeighbors,
  type Hex,
  type HomeResponse,
  type WeatherFront,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { putPlan } from '../../../tests/weather.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { localDate } from '../../lib/time.js';
import { grantItems } from '../inventory/service.js';

/*
 * Wild Isle water works (#621 W1-8): where a works, a canal or a shelter
 * may stand (water next door, canal chains up to `maxRun`), only on a Wild
 * Isle; works producing with the settle like resource buildings (the
 * weather's pace from the stored plan, a Watermill eating only what the
 * bag holds, upkeep each morning); and a Cozy Patch's Build sheet exactly
 * as it was.
 */

describe('a Cozy Patch’s Build sheet (#621 W1-8, plan §10)', () => {
  it('lists exactly the buildings it did before the water works', () => {
    const cozy = GAME_DATA.buildings
      .filter((b) => isBuildableOn(HOME_BASE_RULES, b, 'cozy'))
      .map((b) => b.id);
    expect(cozy).toEqual(
      GAME_DATA.buildings.filter((b) => isBuildable(HOME_BASE_RULES, b)).map((b) => b.id),
    );
    expect(cozy).toMatchInlineSnapshot(`
      [
        "hearthfire",
        "jack-o-lantern-hearthfire",
        "joy-lantern",
        "ember-den",
        "cozy-meadow",
        "training-grounds",
        "crafting-factory",
        "hedge",
        "moat",
        "stone-wall",
        "emberwood-palisade",
        "glimmer-rail",
        "lantern-fence",
        "bramble-hedge",
        "ice-wall",
        "woodcutters-hut",
        "ember-kiln",
        "stone-quarry",
        "ice-cutter",
        "water-well",
        "greenhouse",
        "pumpkin-barn",
        "warehouse",
      ]
    `);
  });

  it('keeps the Cozy Water Well as it was', () => {
    expect(BUILDINGS.find((b) => b.id === 'water-well')).toMatchInlineSnapshot(`
      {
        "description": "Draws Water all by itself, much faster than a squishy!",
        "id": "water-well",
        "kind": "resource",
        "levels": [
          {
            "cost": {
              "stone": 15,
              "timber": 20,
            },
            "pacePercent": 300,
            "storageHours": 24,
            "upkeep": 17,
          },
          {
            "cost": {
              "stone": 30,
              "timber": 40,
            },
            "pacePercent": 350,
            "storageHours": 48,
            "upkeep": 20,
          },
          {
            "cost": {
              "glimmer": 4,
              "stone": 60,
              "timber": 80,
            },
            "pacePercent": 400,
            "storageHours": 72,
            "upkeep": 23,
          },
          {
            "cost": {
              "glimmer": 10,
              "stone": 90,
              "timber": 120,
            },
            "pacePercent": 400,
            "storageHours": 96,
            "upkeep": 23,
          },
        ],
        "maxPerTile": 1,
        "name": "Water Well",
        "placement": "homestead",
        "slot": "ring",
        "terrain": "lake",
      }
    `);
  });

  it('gives a lake no flood bonus: only the sea and rivers flood (`nearWater`)', () => {
    expect(WEATHER_RULES.effects.storm.nearWater).toEqual(['deep', 'river']);
  });
});

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
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
/** Oct 2, 10:00 AM in Denver: mornings are at 6:00 (12:00Z while daylight saving lasts). */
const START = '2026-10-02T16:00:00Z';
const PLENTY = { timber: 400, stone: 400, glimmer: 20 };
const DIRECTIONS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

interface Player {
  id: string;
  token: string;
}

interface Tile {
  id: string;
  q: number;
  r: number;
  ownerUserId: string | null;
  homeSlot: number | null;
  terrain: string;
  communityId: string | null;
}

describe.skipIf(!url)('Wild Isle water works (#621 W1-8, needs DATABASE_URL)', () => {
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
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: 'true',
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `miller_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
    });
    return { id: user!.id, token };
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
  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));
  const tilesOf = async (mapId: string): Promise<Tile[]> =>
    db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const setTerrain = (tile: { id: string }, terrain: string) =>
    db.execute(
      `update tiles set terrain = '${terrain}', node_resource = null where id = '${tile.id}'`,
    );

  /** Makes `tile` a joined homestead of `who`'s with no resource spot, as #199 would. */
  async function homestead(mapId: string, who: Player, tile: Tile) {
    await db.execute(
      `update tiles set owner_user_id = '${who.id}', node_resource = null where id = '${tile.id}'`,
    );
    const when = clock.toISOString();
    await db.execute(
      `insert into tile_explore (user_id, tile_id, map_id, layout, terrain, searched, spot_count, completed_at, joined_at)
       values ('${who.id}', '${tile.id}', '${mapId}', 1, '${tile.terrain}', 7, 3, '${when}', '${when}')`,
    );
  }

  async function patch(wild = true) {
    const server = await start();
    const kid = await player();
    const res = await call(server, 'POST', '/maps', kid, { name: 'Mill Patch', timeZone: ZONE });
    expect(res.statusCode).toBe(201);
    const mapId = MapResponseSchema.parse(res.json()).map.id;
    if (wild) await db.execute(`update maps set patch_type = 'wild-isle' where id = '${mapId}'`);
    await give(mapId, kid, PLENTY);
    return { server, kid, mapId };
  }

  /** `who`'s Heart Seed. */
  async function seedOf(mapId: string, who: Player): Promise<Tile> {
    const tiles = await tilesOf(mapId);
    const home = tiles.filter((t) => t.ownerUserId === who.id && t.homeSlot !== null);
    const homeKeys = new Set(home.map(hexKey));
    return home.find((t) => hexNeighbors(t).every((n) => homeKeys.has(hexKey(n))))!;
  }

  /**
   * A straight line of tiles out from `who`'s Heart Seed: `line[k]` is k
   * steps away. Every tile past the home ring is plain neutral land, and
   * so is every tile beside it, so only the water this test lays is there.
   */
  async function lineFrom(mapId: string, who: Player, length: number): Promise<Tile[]> {
    const tiles = await tilesOf(mapId);
    const at = new Map(tiles.map((t) => [hexKey(t), t]));
    const seed = await seedOf(mapId, who);
    const plain = (t: Tile | undefined) =>
      t !== undefined &&
      t.ownerUserId === null &&
      t.homeSlot === null &&
      t.communityId === null &&
      t.terrain !== 'trading-post';
    for (const d of DIRECTIONS) {
      const line = Array.from({ length: length + 1 }, (_, k) =>
        at.get(hexKey({ q: seed.q + d.q * k, r: seed.r + d.r * k })),
      );
      if (line.every((t, k) => t !== undefined && (k <= 1 || plain(t)))) {
        for (const t of line.slice(2)) await setTerrain(t!, 'meadow');
        return line as Tile[];
      }
    }
    throw new Error('no clear line out of home');
  }

  const build = (server: FastifyInstance, who: Player, mapId: string, id: string, h: Hex) =>
    call(server, 'POST', `/maps/${mapId}/buildings`, who, {
      buildingId: id,
      q: h.q,
      r: h.r,
      spot: 1,
    });
  const settle = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'POST', `/maps/${mapId}/settle`, who);
    expect(res.statusCode, res.body).toBe(200);
    return SettleResponseSchema.parse(res.json());
  };
  const home = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/home`, who);
    expect(res.statusCode).toBe(200);
    return HomeResponseSchema.parse(res.json());
  };
  const on = (view: HomeResponse, tile: Hex) =>
    view.buildings.find((b) => b.q === tile.q && b.r === tile.r);

  /** A works on `tile` as placing makes one, counting from `since` (placed then). */
  async function works(mapId: string, who: Player, tile: Tile, buildingId: string, since: Date) {
    const [row] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: who.id,
        tileId: tile.id,
        buildingId,
        kind: 'works',
        spot: 1,
        placedAt: since,
        producedSince: since,
      })
      .returning({ id: buildings.id });
    return row!.id;
  }

  describe('placing', () => {
    it('stands next to the water it needs, with the kid line for what’s missing', async () => {
      const { server, kid, mapId } = await patch();
      const line = await lineFrom(mapId, kid, 6);
      for (const k of [2, 3, 4, 5]) await homestead(mapId, kid, line[k]!);
      await setTerrain(line[6]!, 'river');

      // Next to nothing wet yet.
      const cases = [
        ['salt-pans', 'Only on the coast 🐚'],
        ['watermill', 'Needs the river 🌊'],
        ['river-well', 'Needs a river or lake next door 💧'],
        ['fishing-pier', 'Needs water next door 💧'],
        ['seawall', 'Only on the coast 🐚'],
        ['levee', 'Needs the river 🌊'],
        ['canal', 'Canal needs water or a canal next to it 💧'],
      ] as const;
      for (const [id, message] of cases) {
        const res = await build(server, kid, mapId, id, line[3]!);
        expect(res.statusCode, id).toBe(403);
        expect(errorOf(res).message, id).toBe(message);
      }
      // By the river: a Watermill fits; Salt Pans still want the sea.
      const salt = await build(server, kid, mapId, 'salt-pans', line[5]!);
      expect(errorOf(salt).message).toBe('Only on the coast 🐚');
      const mill = await build(server, kid, mapId, 'watermill', line[5]!);
      expect(mill.statusCode, mill.body).toBe(201);
      const placed = on(HomeResponseSchema.parse(mill.json()), line[5]!)!;
      expect(placed).toMatchObject({ buildingId: 'watermill', kind: 'works' });
      expect(placed.production).toMatchObject({
        resource: 'flour',
        perCycle: 1,
        cycles: 0,
        eats: { greens: 2 },
        upkeep: 14,
      });
      // The river becomes the sea: two tiles off, a Seawall still won't go;
      // a Fishing Pier fishes anything wet next door.
      await setTerrain(line[6]!, 'ocean');
      expect(errorOf(await build(server, kid, mapId, 'seawall', line[4]!)).message).toBe(
        'Only on the coast 🐚',
      );
      await setTerrain(line[5]!, 'wild-lake');
      await db.execute(`delete from buildings where tile_id = '${line[5]!.id}'`);
      expect((await build(server, kid, mapId, 'fishing-pier', line[4]!)).statusCode).toBe(201);
      // A vane needs no water at all.
      expect((await build(server, kid, mapId, 'weather-vane', line[3]!)).statusCode).toBe(201);
    });

    it('carries water inland along canals, up to maxRun, and never along a dry chain', async () => {
      const { server, kid, mapId } = await patch();
      const line = await lineFrom(mapId, kid, 7);
      for (const k of [2, 3, 4, 5, 6]) await homestead(mapId, kid, line[k]!);
      await setTerrain(line[7]!, 'river');

      // A canal goes next to the water, then each next to the last: 6, 5, 4, 3.
      expect(errorOf(await build(server, kid, mapId, 'canal', line[5]!)).message).toBe(
        'Canal needs water or a canal next to it 💧',
      );
      for (const k of [6, 5, 4, 3]) {
        const res = await build(server, kid, mapId, 'canal', line[k]!);
        expect(res.statusCode, `canal ${String(k)}`).toBe(201);
      }
      // A fifth would be past `maxRun` (4).
      const canal = BUILDINGS.find((b) => b.id === 'canal');
      expect(canal?.kind === 'canal' && canal.maxRun).toBe(4);
      const fifth = await build(server, kid, mapId, 'canal', line[2]!);
      expect(fifth.statusCode).toBe(403);
      expect(errorOf(fifth).message).toBe('Canal needs water or a canal next to it 💧');
      // A field beside the 4th canal has water; a Watermill (river only) doesn't.
      expect(errorOf(await build(server, kid, mapId, 'watermill', line[2]!)).message).toBe(
        'Needs the river 🌊',
      );
      const field = await build(server, kid, mapId, 'irrigated-field', line[2]!);
      expect(field.statusCode, field.body).toBe(201);

      // The river dries up (a test's hand): the chain carries nothing now.
      await db.execute(
        `delete from buildings where map_id = '${mapId}' and building_id = 'irrigated-field'`,
      );
      await setTerrain(line[7]!, 'meadow');
      const dry = await build(server, kid, mapId, 'irrigated-field', line[2]!);
      expect(dry.statusCode).toBe(403);
      expect(errorOf(dry).message).toBe('Needs water next door 💧');
    });

    it('never goes up on a Cozy Patch, water or not', async () => {
      const { server, kid, mapId } = await patch(false);
      const line = await lineFrom(mapId, kid, 4);
      for (const k of [2, 3]) await homestead(mapId, kid, line[k]!);
      await setTerrain(line[4]!, 'river');
      for (const id of [
        'fishing-pier',
        'watermill',
        'irrigated-field',
        'rain-barrel',
        'canal',
        'levee',
        'weather-vane',
      ]) {
        const res = await build(server, kid, mapId, id, line[3]!);
        expect(res.statusCode, id).toBe(409);
        expect(errorOf(res).message, id).toBe("That one isn't ready to build yet. Soon!");
      }
      // The Cozy Water Well still wants a lake tile, as it always has.
      expect(errorOf(await build(server, kid, mapId, 'water-well', line[3]!)).message).toBe(
        'A Water Well needs a Lake tile!',
      );
    });
  });

  describe('producing', () => {
    it('a Watermill short of Greens makes only what the bag pays for, and eats exactly that', async () => {
      const { server, kid, mapId } = await patch();
      const line = await lineFrom(mapId, kid, 3);
      await homestead(mapId, kid, line[2]!);
      const placedAt = new Date(clock);
      const mill = await works(mapId, kid, line[2]!, 'watermill', placedAt);
      await give(mapId, kid, { greens: 7 });

      // An hour at level 1: 6 cycles of 10 minutes; the bag pays for 3.
      clock.setTime(placedAt.getTime() + HOUR_MS);
      const before = await home(server, kid, mapId);
      expect(on(before, line[2]!)?.production).toMatchObject({
        cycles: 6,
        ready: { flour: 3 },
        eats: { greens: 2 },
      });
      const settled = await settle(server, kid, mapId);
      expect(settled.produced).toEqual([
        expect.objectContaining({ buildingRowId: mill, items: { flour: 3 } }),
      ]);
      const after = await home(server, kid, mapId);
      expect(after.items['flour']).toBe(3);
      expect(after.items['greens'] ?? 0).toBe(1);
      const eaten = await db.query.resourceLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'works-eat')),
      });
      expect(eaten.map((e) => [e.itemId, e.delta, e.refId])).toEqual([['greens', -6, mill]]);
      // The cycles it couldn't pay for were idle: the count moved on all the same.
      const row = await db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.id, mill) });
      expect(row?.producedSince?.getTime()).toBe(placedAt.getTime() + HOUR_MS);
      // Nothing more to grind: a settle later makes nothing and eats nothing.
      clock.setTime(clock.getTime() + HOUR_MS);
      expect((await settle(server, kid, mapId)).produced).toEqual([]);
      expect((await home(server, kid, mapId)).items['greens'] ?? 0).toBe(1);
    });

    it('charges a works its upkeep each morning, as a resource building', async () => {
      const { server, kid, mapId } = await patch();
      const line = await lineFrom(mapId, kid, 3);
      await homestead(mapId, kid, line[2]!);
      const pans = await works(mapId, kid, line[2]!, 'salt-pans', new Date(clock));
      const grant = await call(server, 'POST', `/maps/${mapId}/dev/heart-coins`, kid, {
        amount: 50,
      });
      expect(grant.statusCode).toBe(201);
      // The next morning, 7:00 AM in Denver.
      clock.setTime(Date.parse('2026-10-03T13:00:00Z'));
      const settled = await settle(server, kid, mapId);
      const salt = (settled.produced ?? []).find((p) => p.buildingRowId === pans);
      // 21 hours at 20 minutes a cycle, held to its 24-hour storage: 63 cycles of 2.
      expect(salt?.items).toEqual({ salt: 126 });
      const upkeep = await db.query.heartCoinLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.source, 'upkeep')),
      });
      expect(upkeep.map((u) => u.amount)).toEqual([-10]);
      const res = await call(server, 'GET', `/maps/${mapId}/heart-coins`, kid);
      const sheet = HeartCoinsResponseSchema.parse(res.json()).heartCoins;
      expect(sheet.upkeep?.due).toEqual([
        expect.objectContaining({ buildingRowId: pans, buildingId: 'salt-pans', coins: 10 }),
      ]);
    });

    it('fills a Rain Barrel only under the stored plan’s rain, and fishes faster in its fog', async () => {
      const { server, kid, mapId } = await patch();
      const line = await lineFrom(mapId, kid, 5);
      await homestead(mapId, kid, line[2]!);
      await homestead(mapId, kid, line[4]!);
      const placedAt = new Date(clock);
      const barrel = await works(mapId, kid, line[2]!, 'rain-barrel', placedAt);
      const pier = await works(mapId, kid, line[4]!, 'fishing-pier', placedAt);
      const front = (id: string, kind: WeatherFront['kind'], tile: Hex): WeatherFront => ({
        id,
        kind,
        from: { q: tile.q, r: tile.r },
        to: { q: tile.q, r: tile.r },
        startAt: placedAt.toISOString(),
        endAt: new Date(placedAt.getTime() + HOUR_MS).toISOString(),
        radius: 1,
      });
      // An hour of rain over the barrel and fog over the pier, then clear.
      await putPlan(db, mapId, localDate(placedAt, ZONE), [
        front('rain-1', 'rain', line[2]!),
        front('fog-1', 'fog', line[4]!),
      ]);
      clock.setTime(placedAt.getTime() + 2 * HOUR_MS);
      const settled = await settle(server, kid, mapId);
      const made = (id: string) =>
        (settled.produced ?? []).find((p) => p.buildingRowId === id)?.items;
      // Barrel, level 1: a 3-minute cycle at 300 % is 2 minutes; an hour of rain is 30 cycles of 15.
      expect(made(barrel)).toEqual({ water: 450 });
      // Pier, level 1: 20-minute cycles. The foggy hour at 150 % makes 4 and
      // half a 5th; the clear hour finishes it and 2 more: 7 cycles of 2.
      expect(made(pier)).toEqual({ fish: 14 });
    });
  });
});
