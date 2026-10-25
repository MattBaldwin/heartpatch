import { randomUUID } from 'node:crypto';
import {
  addDays,
  ApiErrorSchema,
  deriveSeed,
  HomeResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  repairCost,
  Rng,
  SettleResponseSchema,
  WEATHER_RULES,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { BUILDING_DATA } from '../buildings/hearthfire.js';
import { productionAt } from '../buildings/production.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { creditHeartCoins } from '../heart-coins/service.js';
import { grantItems } from '../inventory/service.js';
import { makeHomestead, type HomesteadTile } from '../../../tests/homestead.js';
import { frontIdThat, makeWildIsle, putPlan, stormOver } from '../../../tests/weather.js';
import { rollKnocks, type KnockFacts } from './knocks.js';
import { createWeatherService } from './service.js';

/*
 * Storm knocks on a Wild Isle (#621 W1-7): the seeded roll knocks a building
 * once whether the settle or the sweep sees the storm first; shelters,
 * weatherproof buildings, home tiles and fires; output banked up to the
 * knock; and fixing it (its cost, and CONFLICT when there's nothing to fix).
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ZONE = 'UTC';
const TODAY = '2026-10-25';
/** Late afternoon: no upkeep morning falls between placing and settling. */
const START = '2026-10-25T18:00:00Z';
const PLACED = new Date(Date.parse(START) - 6 * HOUR_MS);
const HUT = BUILDING_DATA.get('woodcutters-hut')!;
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

describe('the knock roll (shelters)', () => {
  const facts = (over: Partial<KnockFacts> = {}): KnockFacts => ({
    buildingRowId: 'b-1',
    tile: { q: 0, r: 0 },
    fromMs: 0,
    nowMs: 10 * HOUR_MS,
    nearWater: false,
    ...over,
  });
  const rules = WEATHER_RULES.effects;
  const roll = (id: string, building: string, percent: number) =>
    Rng.fromSeed(deriveSeed('seed', 'knock', id, building)).chance(percent);
  const storm = (id: string) => ({
    id,
    kind: 'storm' as const,
    from: { q: 0, r: 0 },
    to: { q: 0, r: 0 },
    startAt: new Date(HOUR_MS).toISOString(),
    endAt: new Date(2 * HOUR_MS).toISOString(),
    radius: 1,
  });
  const { knockPercent, floodBonusPercent } = rules.storm;
  const find = (ok: (id: string) => boolean) =>
    Array.from({ length: 500 }, (_, n) => `f-${String(n)}`).find(ok)!;
  const hits = find((id) => roll(id, 'b-1', knockPercent));
  const floodOnly = find(
    (id) => !roll(id, 'b-1', knockPercent) && roll(id, 'b-1', knockPercent + floodBonusPercent),
  );
  const shelter = (from: ('storm' | 'flood')[], placedAtMs = 0, at = { q: 1, r: 0 }) => ({
    at,
    radius: 1,
    from,
    placedAtMs,
  });

  it('knocks at the end of the front’s minutes over the tile', () => {
    expect(rollKnocks(facts(), [storm(hits)], [], rules, 'seed')).toEqual({
      rolled: true,
      knock: { frontId: hits, atMs: 2 * HOUR_MS },
    });
  });

  it('never knocks a building a storm shelter stood by, only once it stood', () => {
    expect(rollKnocks(facts(), [storm(hits)], [shelter(['storm'])], rules, 'seed').knock).toBe(
      null,
    );
    // Out of its reach, or built after the storm left: no help.
    const far = shelter(['storm'], 0, { q: 3, r: 0 });
    expect(rollKnocks(facts(), [storm(hits)], [far], rules, 'seed').knock).not.toBe(null);
    const late = shelter(['storm'], 3 * HOUR_MS);
    expect(rollKnocks(facts(), [storm(hits)], [late], rules, 'seed').knock).not.toBe(null);
  });

  it('adds the flood bonus next to water, unless a flood shelter stands by', () => {
    const wet = facts({ nearWater: true });
    expect(rollKnocks(facts(), [storm(floodOnly)], [], rules, 'seed').knock).toBe(null);
    expect(rollKnocks(wet, [storm(floodOnly)], [], rules, 'seed').knock).not.toBe(null);
    expect(rollKnocks(wet, [storm(floodOnly)], [shelter(['flood'])], rules, 'seed').knock).toBe(
      null,
    );
  });

  it('rolls nothing for a front still over the tile or rolled already', () => {
    expect(rollKnocks(facts({ nowMs: 1.5 * HOUR_MS }), [storm(hits)], [], rules, 'seed')).toEqual({
      rolled: false,
      knock: null,
    });
    expect(rollKnocks(facts({ fromMs: 2 * HOUR_MS }), [storm(hits)], [], rules, 'seed')).toEqual({
      rolled: false,
      knock: null,
    });
  });
});

describe.skipIf(!url)('storm knocks (needs DATABASE_URL)', () => {
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
    const username = `stormy_${String((counter += 1))}`;
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

  function call(server: FastifyInstance, method: 'GET' | 'POST', path: string, who: Player) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
    });
  }

  /** A Wild Isle with my Woodcutter's Hut on a forest homestead, placed this noon. */
  async function setup(buildingId = HUT.id, kind = 'resource') {
    const server = await start();
    const kid = await player();
    const made = await server.inject({
      method: 'POST',
      url: '/api/v1/maps',
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: kid.token },
      payload: { name: 'Storm Patch', timeZone: ZONE },
    });
    expect(made.statusCode, made.body).toBe(201);
    const mapId = MapResponseSchema.parse(made.json()).map.id;
    const seed = await makeWildIsle(db, mapId);
    const plot = await makeHomestead(db, mapId, kid.id, PLACED);
    await db.execute(
      `update tiles set terrain = 'forest', node_resource = null where id = '${plot.id}'`,
    );
    const row = await place(mapId, kid, plot, buildingId, kind);
    return { server, kid, mapId, seed, plot, row };
  }

  async function place(
    mapId: string,
    kid: Player,
    plot: { id: string },
    buildingId: string,
    kind: string,
  ): Promise<string> {
    const [row] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: kid.id,
        tileId: plot.id,
        buildingId,
        kind,
        spot: kind === 'hearthfire' ? 0 : 1,
        placedAt: PLACED,
        producedSince: kind === 'resource' ? PLACED : null,
        ...(kind === 'hearthfire' ? { fuelledThrough: TODAY } : {}),
      })
      .returning({ id: buildings.id });
    return row!.id;
  }

  /** A storm over `plot` from 13:00 to 14:00 today whose roll for `rowId` hits (or misses). */
  async function storm(
    mapId: string,
    seed: string,
    plot: HomesteadTile,
    rowId: string,
    hits = true,
  ) {
    const id = frontIdThat(hits, seed, rowId);
    const from = new Date(PLACED.getTime() + HOUR_MS);
    const to = new Date(PLACED.getTime() + 2 * HOUR_MS);
    await putPlan(db, mapId, TODAY, [stormOver(id, plot, from, to)]);
    return { id, endsAt: to };
  }

  const rowOf = async (rowId: string) =>
    (await db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.id, rowId) }))!;
  const knocksOn = async (mapId: string) =>
    (
      await db.query.gameEvents.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'building.knocked')),
      })
    ).map((e) => parseGameEventPayload('building.knocked', e.payload));
  const settle = async (server: FastifyInstance, kid: Player, mapId: string) => {
    const res = await call(server, 'POST', `/maps/${mapId}/settle`, kid);
    expect(res.statusCode, res.body).toBe(200);
    return SettleResponseSchema.parse(res.json());
  };
  const home = async (server: FastifyInstance, kid: Player, mapId: string) =>
    HomeResponseSchema.parse((await call(server, 'GET', `/maps/${mapId}/home`, kid)).json());
  const sweep = (mapId: string) => createWeatherService({ db, clock: () => clock }).sweep(mapId);

  it('knocks a building once, whether the sweep or the settle rolls the storm first', async () => {
    const a = await setup();
    const { id, endsAt } = await storm(a.mapId, a.seed, a.plot, a.row);
    expect(await sweep(a.mapId)).toBe(1);
    expect(await rowOf(a.row)).toMatchObject({
      damagedAt: endsAt,
      damagedBy: id,
      weatherCheckedThrough: clock,
    });
    expect((await settle(a.server, a.kid, a.mapId)).weather).toEqual({ knocked: [] });
    expect(await sweep(a.mapId)).toBe(0);
    expect(await knocksOn(a.mapId)).toEqual([
      {
        userId: a.kid.id,
        buildingRowId: a.row,
        buildingId: HUT.id,
        q: a.plot.q,
        r: a.plot.r,
        frontId: id,
        at: endsAt.toISOString(),
      },
    ]);
    await app?.close();

    const b = await setup();
    await storm(b.mapId, b.seed, b.plot, b.row);
    expect((await settle(b.server, b.kid, b.mapId)).weather).toEqual({
      knocked: [{ buildingRowId: b.row, buildingId: HUT.id, q: b.plot.q, r: b.plot.r }],
    });
    expect(await sweep(b.mapId)).toBe(0);
    clock.setTime(clock.getTime() + HOUR_MS);
    expect((await settle(b.server, b.kid, b.mapId)).weather).toEqual({ knocked: [] });
    expect(await knocksOn(b.mapId)).toHaveLength(1);
    // Everyone sees the knock, never the roll.
    const mine = (await home(b.server, b.kid, b.mapId)).buildings.find((x) => x.id === b.row)!;
    expect(mine.knocked).toBe(true);
  });

  it('rolls a missed storm once, and it never knocks later', async () => {
    const { server, kid, mapId, seed, plot, row } = await setup();
    await storm(mapId, seed, plot, row, false);
    expect((await settle(server, kid, mapId)).weather).toEqual({ knocked: [] });
    expect(await rowOf(row)).toMatchObject({ damagedAt: null, weatherCheckedThrough: clock });
    clock.setTime(clock.getTime() + HOUR_MS);
    expect(await sweep(mapId)).toBe(0);
    // Nothing new to roll: how far it's rolled stays put.
    expect((await rowOf(row)).weatherCheckedThrough).toEqual(new Date(START));
  });

  it('never knocks the weatherproof Greenhouse, a building on a home tile, or a fire', async () => {
    const green = await setup('greenhouse');
    await storm(green.mapId, green.seed, green.plot, green.row);
    expect(await sweep(green.mapId)).toBe(0);
    expect(await rowOf(green.row)).toMatchObject({ damagedAt: null, weatherCheckedThrough: null });
    await app?.close();

    const fire = await setup('hearthfire', 'hearthfire');
    await storm(fire.mapId, fire.seed, fire.plot, fire.row);
    expect(await sweep(fire.mapId)).toBe(0);
    expect((await settle(fire.server, fire.kid, fire.mapId)).weather).toEqual({ knocked: [] });
    expect((await rowOf(fire.row)).damagedAt).toBe(null);
    await app?.close();

    // A hut straight on a home tile (placement never allows it; the rule holds anyway).
    const { server, kid, mapId, seed, row } = await setup();
    // Only the hut at home stands, so nothing else under the storm can be knocked.
    await db.execute(`delete from buildings where id = '${row}'`);
    const [ring] = [
      ...(await db.execute<{ id: string; q: number; r: number }>(
        `select t.id, t.q, t.r from tiles t where t.map_id = '${mapId}' and t.owner_user_id = '${kid.id}'
         and t.home_slot is not null and not exists (select 1 from buildings b where b.tile_id = t.id)
         order by t.id limit 1`,
      )),
    ];
    const atHome = await place(mapId, kid, ring!, HUT.id, 'resource');
    const plot = { id: ring!.id, q: ring!.q, r: ring!.r, terrain: 'forest' };
    await storm(mapId, seed, plot, atHome);
    expect(await sweep(mapId)).toBe(0);
    expect((await settle(server, kid, mapId)).weather).toEqual({ knocked: [] });
    expect((await rowOf(atHome)).damagedAt).toBe(null);
  });

  it('banks what a knocked building made up to the knock, and nothing after', async () => {
    const { server, kid, mapId, seed, plot, row } = await setup();
    const { endsAt } = await storm(mapId, seed, plot, row);
    // What it had made when the storm left, worked out from the row as it was.
    const [before] = (await createBuildingsRepo(db).listOwned(mapId, kid.id)).filter(
      (r) => r.id === row,
    );
    const expected = productionAt(before!, endsAt, ZONE, null)!.ready;
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    const settled = await settle(server, kid, mapId);
    expect(settled.produced).toEqual([
      { buildingRowId: row, buildingId: HUT.id, q: plot.q, r: plot.r, items: expected },
    ]);
    clock.setTime(clock.getTime() + 2 * HOUR_MS);
    expect((await settle(server, kid, mapId)).produced).toEqual([]);
  });

  it('fixes a knocked building for a share of its cost, and refuses one that works', async () => {
    const { server, kid, mapId, seed, plot, row } = await setup();
    const repair = () => call(server, 'POST', `/maps/${mapId}/buildings/${row}/repair`, kid);
    const fine = await repair();
    expect(fine.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(fine.json()).error.message).toBe(
      'Nothing to fix here, it works just fine! ✨',
    );

    await storm(mapId, seed, plot, row);
    await settle(server, kid, mapId);
    const cost = repairCost(HUT, 1, WEATHER_RULES.effects);
    expect(cost).toEqual({ timber: 5, stone: 4 });
    const card = (await home(server, kid, mapId)).buildings.find((b) => b.id === row)!;
    expect(card).toMatchObject({ knocked: true, repairCost: cost });

    // Short of Stone: nothing changes.
    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId, userId: kid.id }, { timber: 5 }, 'dev-grant'),
    );
    expect((await repair()).statusCode).toBe(409);
    expect((await rowOf(row)).damagedAt).not.toBe(null);

    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId, userId: kid.id }, { stone: 4 }, 'dev-grant'),
    );
    clock.setTime(clock.getTime() + HOUR_MS);
    const fixed = await repair();
    expect(fixed.statusCode, fixed.body).toBe(200);
    const after = HomeResponseSchema.parse(fixed.json());
    const mine = after.buildings.find((b) => b.id === row)!;
    expect(mine.knocked).toBeUndefined();
    expect(mine.repairCost).toBeUndefined();
    expect(await rowOf(row)).toMatchObject({
      damagedAt: null,
      damagedBy: null,
      weatherCheckedThrough: clock,
      producedSince: clock,
    });
    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'repair')),
    });
    expect(Object.fromEntries(ledger.map((l) => [l.itemId, l.delta]))).toEqual({
      timber: -5,
      stone: -4,
    });
    const [event] = await db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'building.repaired')),
    });
    expect(parseGameEventPayload('building.repaired', event!.payload)).toEqual({
      userId: kid.id,
      buildingRowId: row,
      q: plot.q,
      r: plot.r,
      cost,
    });
    // The storm that knocked it never rolls again.
    expect(await sweep(mapId)).toBe(0);
    expect((await rowOf(row)).damagedAt).toBe(null);
    expect((await repair()).statusCode).toBe(409);
  });

  it('knocks a building placed while a storm sits over it, and again after a fix by a later front', async () => {
    const { server, kid, mapId, seed, plot } = await setup();
    // A second hut placed mid-storm, on the second homestead (the first one's hut goes).
    await db.execute(`delete from buildings where map_id = '${mapId}'`);
    const midStorm = new Date(PLACED.getTime() + 90 * 60_000);
    const [row] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: kid.id,
        tileId: plot.id,
        buildingId: HUT.id,
        kind: 'resource',
        spot: 1,
        placedAt: midStorm,
        producedSince: midStorm,
      })
      .returning({ id: buildings.id });
    const first = frontIdThat(true, seed, row!.id, 'early');
    const later = frontIdThat(true, seed, row!.id, 'late');
    const at = (h: number) => new Date(PLACED.getTime() + h * HOUR_MS);
    await putPlan(db, mapId, TODAY, [
      stormOver(first, plot, at(1), at(2)),
      stormOver(later, plot, at(3), at(4)),
    ]);
    // Built at 13:30 under the 13:00–14:00 storm: the rest of it still counts.
    clock.setTime(at(2.5).getTime());
    expect(await sweep(mapId)).toBe(1);
    expect(await rowOf(row!.id)).toMatchObject({ damagedAt: at(2), damagedBy: first });
    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId, userId: kid.id }, { timber: 5, stone: 4 }, 'dev-grant'),
    );
    const fixed = await call(server, 'POST', `/maps/${mapId}/buildings/${row!.id}/repair`, kid);
    expect(fixed.statusCode, fixed.body).toBe(200);
    // The 15:00–16:00 front is a new roll, and it hits.
    clock.setTime(at(5).getTime());
    expect(await sweep(mapId)).toBe(1);
    expect(await rowOf(row!.id)).toMatchObject({ damagedAt: at(4), damagedBy: later });
  });

  it('stops a knocked Warehouse delivering, skips its knocked mornings, and delivers again from the fix', async () => {
    const server = await start();
    const kid = await player();
    const made = await server.inject({
      method: 'POST',
      url: '/api/v1/maps',
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: kid.token },
      payload: { name: 'Store Patch', timeZone: ZONE },
    });
    const mapId = MapResponseSchema.parse(made.json()).map.id;
    await makeWildIsle(db, mapId);
    // Placed Wednesday afternoon; the Warehouse is knocked Thursday 10:00,
    // after that morning's upkeep. Mornings (06:00 UTC) Thu–Sun fall between.
    const placed = new Date('2026-10-21T14:00:00Z');
    const knockedAt = new Date('2026-10-22T10:00:00Z');
    for (let day = '2026-10-21'; day <= TODAY; day = addDays(day, 1)) {
      await putPlan(db, mapId, day, []);
    }
    const hutPlot = await makeHomestead(db, mapId, kid.id, placed, 0);
    const storePlot = await makeHomestead(db, mapId, kid.id, placed, 1);
    await db.execute(
      `update tiles set terrain = 'forest', node_resource = null where id = '${hutPlot.id}'`,
    );
    await db.execute(`update tiles set node_resource = null where id = '${storePlot.id}'`);
    const [hut] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: kid.id,
        tileId: hutPlot.id,
        buildingId: HUT.id,
        kind: 'resource',
        level: 3,
        spot: 1,
        placedAt: placed,
        producedSince: placed,
      })
      .returning({ id: buildings.id });
    const [store] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: kid.id,
        tileId: storePlot.id,
        buildingId: 'warehouse',
        kind: 'warehouse',
        spot: 1,
        placedAt: placed,
        damagedAt: knockedAt,
        damagedBy: 'dev',
        weatherCheckedThrough: knockedAt,
      })
      .returning({ id: buildings.id });
    await withTransaction(db, (tx) =>
      creditHeartCoins(tx, {
        source: 'dev-grant',
        refId: randomUUID(),
        mapId,
        userId: kid.id,
        amount: 1000,
        at: placed,
      }),
    );
    const rows = await createBuildingsRepo(db).listOwned(mapId, kid.id);
    const hutRow = rows.find((r) => r.id === hut!.id)!;
    const storeRow = rows.find((r) => r.id === store!.id)!;
    // The knock cuts the delivery: what the hut banks is capped from there.
    const capped = productionAt(hutRow, clock, ZONE, storeRow)!.ready;
    const uncapped = productionAt(hutRow, clock, ZONE, { ...storeRow, damagedAt: null })!.ready;
    expect(capped['timber']).toBeLessThan(uncapped['timber']!);

    const settled = await settle(server, kid, mapId);
    expect(settled.produced?.find((p) => p.buildingRowId === hut!.id)?.items).toEqual(capped);
    const upkeep = async () =>
      (
        await db.query.heartCoinLedger.findMany({
          where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.source, 'upkeep')),
        })
      ).reduce((n, r) => n + r.amount, 0);
    // The hut pays four mornings at level 3; the Warehouse only the one before its knock.
    expect(await upkeep()).toBe(-(4 * 23 + 20));
    expect(await rowOf(store!.id)).toMatchObject({ pausedAt: null, upkeepPaidThrough: TODAY });
    const before = await home(server, kid, mapId);
    expect(before.buildings.find((b) => b.id === store!.id)?.warehouse?.delivering).toBe(false);

    await withTransaction(db, (tx) =>
      grantItems(
        tx,
        { mapId, userId: kid.id },
        { timber: 150, stone: 113, glimmer: 5 },
        'dev-grant',
      ),
    );
    const fixed = await call(server, 'POST', `/maps/${mapId}/buildings/${store!.id}/repair`, kid);
    expect(fixed.statusCode, fixed.body).toBe(200);
    const after = HomeResponseSchema.parse(fixed.json());
    expect(after.buildings.find((b) => b.id === store!.id)?.warehouse?.delivering).toBe(true);
    expect(after.buildings.find((b) => b.id === hut!.id)?.production?.maxCycles).toBe(null);
    // The knocked mornings are never charged back.
    clock.setTime(clock.getTime() + HOUR_MS);
    await settle(server, kid, mapId);
    expect(await upkeep()).toBe(-(4 * 23 + 20));
  });
});
