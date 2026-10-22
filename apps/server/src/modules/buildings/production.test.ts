import {
  ApiErrorSchema,
  BUILDINGS,
  EXPLORE_RULES,
  HeartCoinsResponseSchema,
  HOME_BASE_RULES,
  HomeResponseSchema,
  JOB_RULES,
  MapResponseSchema,
  MapViewSchema,
  RemoveBuildingResponseSchema,
  SettleResponseSchema,
  productionCycleSeconds,
  productionSource,
  removeRefund,
  storageCycles,
  type HomeResponse,
  type MyBuilding,
  type ResourceBuilding,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeHomestead, type HomesteadTile } from '../../../tests/homestead.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { appendGameEvent } from '../../db/game-events.js';
import { buildings, keepers, sessions, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems, lockGrantRows } from '../inventory/service.js';
import { finishLostBuildings, lostOutputGrants, takeDownOnLostLand } from './service.js';
import { suitsLand } from './production.js';
import { upkeepRefId } from './upkeep.js';

/*
 * Resource buildings on the server (#601 PR 6): placing on matching land,
 * output landing with the settle, storage, morning upkeep (charge order,
 * pauses, free wake-ups, napping and dormant buildings, the kid's order),
 * and output banked by a take-down, an upgrade, lost land and leaving.
 */

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

const HUT = BUILDINGS.find((b) => b.id === 'woodcutters-hut') as ResourceBuilding;
const BARN = BUILDINGS.find((b) => b.id === 'pumpkin-barn') as ResourceBuilding;
const HUT_L1 = HUT.levels[0]!;
const SOURCE = productionSource(HUT, JOB_RULES, EXPLORE_RULES)!;
const CYCLE_S = productionCycleSeconds(SOURCE.seconds, HUT_L1, JOB_RULES);
const STORAGE = storageCycles(HUT_L1, CYCLE_S);

interface Player {
  id: string;
  token: string;
}

describe.skipIf(!url)('resource buildings (#601, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date(START);
  let counter = 0;
  // The gate opens in PR 7 (`buildableKinds`); until then a test opens it
  // only for refusals, since the home reply's naming lists buildable kinds.
  const kinds = HOME_BASE_RULES.buildableKinds as string[];

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
    const username = `hutkeeper_${String((counter += 1))}`;
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

  const setLand = (tile: HomesteadTile, terrain: string, node: string | null = null) =>
    db.execute(
      `update tiles set terrain = '${terrain}', node_resource = ${node === null ? 'null' : `'${node}'`} where id = '${tile.id}'`,
    );

  async function patch() {
    const server = await start();
    const kid = await player();
    const res = await call(server, 'POST', '/maps', kid, { name: 'Hut Patch', timeZone: ZONE });
    expect(res.statusCode).toBe(201);
    const mapId = MapResponseSchema.parse(res.json()).map.id;
    await give(mapId, kid, PLENTY);
    return { server, kid, mapId };
  }

  /** A forest homestead with no spot, the `nth` next to home. */
  async function forest(mapId: string, kid: Player, nth = 0, terrain = 'forest') {
    const plot = await makeHomestead(db, mapId, kid.id, clock, nth);
    await setLand(plot, terrain);
    return plot;
  }

  /** A resource building on `plot`, as placing makes one (behind the gate, so straight in). */
  async function build(
    server: FastifyInstance,
    kid: Player,
    mapId: string,
    plot: HomesteadTile,
    buildingId = HUT.id,
  ): Promise<MyBuilding> {
    await db.insert(buildings).values({
      mapId,
      ownerUserId: kid.id,
      tileId: plot.id,
      buildingId,
      kind: 'resource',
      spot: 1,
      placedAt: new Date(clock),
      producedSince: new Date(clock),
    });
    return (await home(server, kid, mapId)).buildings.find(
      (b) => b.q === plot.q && b.r === plot.r,
    )!;
  }

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

  const mine = (view: HomeResponse, id: string) => view.buildings.find((b) => b.id === id)!;

  const coins = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/heart-coins`, who);
    expect(res.statusCode).toBe(200);
    return HeartCoinsResponseSchema.parse(res.json()).heartCoins;
  };

  const grantCoins = async (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    amount: number,
  ) => {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/heart-coins`, who, { amount });
    expect(res.statusCode).toBe(201);
  };

  const row = async (id: string) =>
    (await db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;

  const upkeepLedger = (mapId: string) =>
    db.query.heartCoinLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.source, 'upkeep')),
    });

  const eventsOf = (mapId: string, type: string) =>
    db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, type)),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  /** The instant of a map-local 6:00 AM in Denver (daylight saving until Nov 1). */
  const morning = (day: string) =>
    new Date(`${day}T${day >= '2026-11-01' ? '13' : '12'}:00:00Z`).toISOString();

  it('stands only on its own land: that terrain, or land cleared from it (#601 Q1, Q2)', async () => {
    const { server, kid, mapId } = await patch();
    const plot = await forest(mapId, kid, 0, 'meadow');
    const gated = await call(server, 'POST', `/maps/${mapId}/buildings`, kid, {
      buildingId: HUT.id,
      q: plot.q,
      r: plot.r,
      spot: 1,
    });
    expect(errorOf(gated).message).toMatch(/isn't ready to build yet/);
    kinds.push('resource');
    try {
      const wrong = await call(server, 'POST', `/maps/${mapId}/buildings`, kid, {
        buildingId: HUT.id,
        q: plot.q,
        r: plot.r,
        spot: 1,
      });
      expect(wrong.statusCode).toBe(409);
      expect(errorOf(wrong).message).toBe("A Woodcutter's Hut needs a Forest tile!");

      // Forest with its Timber spot: clear it first (no beside-the-spot exception).
      await setLand(plot, 'forest', 'timber');
      const spot = await call(server, 'POST', `/maps/${mapId}/buildings`, kid, {
        buildingId: HUT.id,
        q: plot.q,
        r: plot.r,
        spot: 1,
      });
      expect(spot.statusCode).toBe(409);
      expect(errorOf(spot).message).toMatch(/Clear this land first/);
    } finally {
      kinds.splice(kinds.indexOf('resource'), 1);
    }
    expect(suitsLand(HUT, { terrain: 'forest', clearedFrom: null })).toBe(true);
    expect(suitsLand(HUT, { terrain: 'clearing', clearedFrom: 'forest' })).toBe(true);
    expect(suitsLand(HUT, { terrain: 'clearing', clearedFrom: 'meadow' })).toBe(false);
    expect(suitsLand(HUT, { terrain: 'meadow', clearedFrom: null })).toBe(false);

    // Cleared land remembers it was forest.
    await setLand(plot, 'clearing');
    await db.execute(
      `insert into tile_clears (id, map_id, user_id, tile_id, from_terrain, tool, drop, started_at, ready_at, ended_at, end_reason)
       values (gen_random_uuid(), '${mapId}', '${kid.id}', '${plot.id}', 'forest', 'axe', '{}', '${START}', '${START}', '${START}', 'cleared')`,
    );
    const hut = await build(server, kid, mapId, plot);
    expect(hut.production).toMatchObject({
      resource: 'timber',
      perCycle: SOURCE.perCycle,
      cycleSeconds: CYCLE_S,
      maxCycles: STORAGE,
      cycles: 0,
      full: false,
      upkeep: HUT_L1.upkeep,
      paidThrough: null,
      pausedAt: null,
      delivering: false,
    });
    expect((await row(hut.id)).producedSince?.toISOString()).toBe(new Date(START).toISOString());
    // Everyone sees it awake; the coins stay the owner's.
    const view = MapViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/view`, kid)).json(),
    );
    const tile = view.tiles.find((t) => t.q === plot.q && t.r === plot.r)!;
    expect(tile.clearedFrom).toBe('forest');
    expect(tile.buildings[0]).toMatchObject({ id: hut.id, paused: false });
  });

  it('output lands with the settle and its event, once', async () => {
    const { server, kid, mapId } = await patch();
    const hut = await build(server, kid, mapId, await forest(mapId, kid));
    clock.setTime(Date.parse(START) + HOUR_MS + 1000);
    const cycles = Math.floor(3600 / CYCLE_S);
    expect(mine(await home(server, kid, mapId), hut.id).production).toMatchObject({
      cycles,
      ready: { timber: cycles * SOURCE.perCycle },
    });
    const done = await settle(server, kid, mapId);
    expect(done.produced).toEqual([
      {
        buildingRowId: hut.id,
        buildingId: HUT.id,
        q: hut.q,
        r: hut.r,
        items: { timber: cycles * SOURCE.perCycle },
      },
    ]);
    expect(done.items['timber']).toBe(PLENTY.timber + cycles * SOURCE.perCycle);
    // The next cycle (or the next morning) is when to ask again.
    expect(Date.parse(done.nextAt!)).toBeLessThanOrEqual(
      Date.parse(START) + (cycles + 1) * CYCLE_S * 1000,
    );
    expect((await settle(server, kid, mapId)).produced).toEqual([]);
    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'produced')),
    });
    expect(ledger.map((l) => [l.itemId, l.delta, l.refId])).toEqual([
      ['timber', cycles * SOURCE.perCycle, hut.id],
    ]);
    const [event] = await eventsOf(mapId, 'building.produced');
    expect(event!.payload).toMatchObject({ items: { timber: cycles * SOURCE.perCycle } });
    // Members see whose building was busy, never what it made.
    expect(publicViewFor(PUBLIC_VIEWS, event!, { userId: 'someone-else' })).not.toHaveProperty(
      'items',
    );
  });

  it('fills its storage and stops; counting starts again from the settle', async () => {
    const { server, kid, mapId } = await patch();
    const hut = await build(server, kid, mapId, await forest(mapId, kid));
    await grantCoins(server, kid, mapId, 500);
    clock.setTime(Date.parse(START) + 2 * HUT_L1.storageHours * HOUR_MS);
    expect(mine(await home(server, kid, mapId), hut.id).production).toMatchObject({
      cycles: STORAGE,
      full: true,
      nextReadyAt: null,
    });
    const done = await settle(server, kid, mapId);
    expect(done.produced?.[0]?.items).toEqual({ timber: STORAGE * SOURCE.perCycle });
    expect((await row(hut.id)).producedSince?.getTime()).toBe(clock.getTime());
  });

  it('charges each missed morning in order and pauses the rest in charge order', async () => {
    const { server, kid, mapId } = await patch();
    const older = await build(server, kid, mapId, await forest(mapId, kid, 0));
    clock.setTime(Date.parse(START) + 1000);
    const newer = await build(server, kid, mapId, await forest(mapId, kid, 1));
    // Enough for the first morning of both and nothing after.
    await grantCoins(server, kid, mapId, 2 * HUT_L1.upkeep + 5);
    clock.setTime(Date.parse('2026-10-05T16:00:00Z'));
    await settle(server, kid, mapId);
    expect((await coins(server, kid, mapId)).balance).toBe(5);
    const paid = await upkeepLedger(mapId);
    expect(paid.map((l) => [l.refId, l.amount]).sort()).toEqual(
      [
        [upkeepRefId(older.id, '2026-10-03'), -HUT_L1.upkeep],
        [upkeepRefId(newer.id, '2026-10-03'), -HUT_L1.upkeep],
      ].sort(),
    );
    for (const hut of [older, newer]) {
      const r = await row(hut.id);
      expect(r.pausedAt?.toISOString()).toBe(morning('2026-10-04'));
      // Every morning is dealt with: none is charged back later.
      expect(r.upkeepPaidThrough).toBe('2026-10-05');
    }
    const paused = await eventsOf(mapId, 'building.paused');
    expect(paused.map((e) => e.payload)).toEqual([
      expect.objectContaining({ buildingRowId: older.id, reason: 'upkeep', day: '2026-10-04' }),
      expect.objectContaining({ buildingRowId: newer.id, reason: 'upkeep', day: '2026-10-04' }),
    ]);
    // Output counts only to the pause: two days' storage-capped making, no more.
    const settled = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'produced')),
    });
    expect(settled).toHaveLength(2);
    // The map shows them napping; members never see coins.
    const view = MapViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/view`, kid)).json(),
    );
    const shown = view.tiles.flatMap((t) => t.buildings).filter((b) => b.kind === 'resource');
    expect(shown.map((b) => b.paused)).toEqual([true, true]);
  });

  it('a settle repeated for the same morning charges once', async () => {
    const { server, kid, mapId } = await patch();
    await build(server, kid, mapId, await forest(mapId, kid));
    await grantCoins(server, kid, mapId, 100);
    clock.setTime(Date.parse('2026-10-03T16:00:00Z'));
    await Promise.all([settle(server, kid, mapId), settle(server, kid, mapId)]);
    await settle(server, kid, mapId);
    expect(await upkeepLedger(mapId)).toHaveLength(1);
    expect((await coins(server, kid, mapId)).balance).toBe(100 - HUT_L1.upkeep);
  });

  it('a paused building owes nothing, and wakes free when topped up', async () => {
    const { server, kid, mapId } = await patch();
    const hut = await build(server, kid, mapId, await forest(mapId, kid));
    clock.setTime(Date.parse('2026-10-03T16:00:00Z'));
    await settle(server, kid, mapId);
    expect((await row(hut.id)).pausedAt?.toISOString()).toBe(morning('2026-10-03'));
    // Three more mornings asleep: nothing owed, nothing made.
    clock.setTime(Date.parse('2026-10-06T16:00:00Z'));
    expect((await settle(server, kid, mapId)).produced).toEqual([]);
    expect(await upkeepLedger(mapId)).toHaveLength(0);

    await grantCoins(server, kid, mapId, HUT_L1.upkeep);
    await settle(server, kid, mapId);
    const woke = await row(hut.id);
    expect(woke.pausedAt).toBeNull();
    // Waking is free; a part-done cycle carries on from where it stopped.
    expect((await coins(server, kid, mapId)).balance).toBe(HUT_L1.upkeep);
    expect(clock.getTime() - woke.producedSince!.getTime()).toBeLessThan(CYCLE_S * 1000);
    expect(await eventsOf(mapId, 'building.resumed')).toHaveLength(1);
    // The next morning charges as usual.
    clock.setTime(Date.parse('2026-10-07T16:00:00Z'));
    await settle(server, kid, mapId);
    expect((await coins(server, kid, mapId)).balance).toBe(0);
    expect((await upkeepLedger(mapId)).map((l) => l.refId)).toEqual([
      upkeepRefId(hut.id, '2026-10-07'),
    ]);
  });

  it("follows the kid's order when coins run short (#601 Q5)", async () => {
    const { server, kid, mapId } = await patch();
    const older = await build(server, kid, mapId, await forest(mapId, kid, 0));
    clock.setTime(Date.parse(START) + 1000);
    const newer = await build(server, kid, mapId, await forest(mapId, kid, 1));
    const ordered = await call(server, 'POST', `/maps/${mapId}/buildings/upkeep-order`, kid, {
      buildingIds: [newer.id],
    });
    expect(ordered.statusCode, ordered.body).toBe(200);
    expect(mine(HomeResponseSchema.parse(ordered.json()), newer.id).production?.upkeepRank).toBe(0);
    // The sheet lists them in that order: the ranked one first.
    expect((await coins(server, kid, mapId)).upkeep).toMatchObject({
      nextMorningAt: morning('2026-10-03'),
      total: 2 * HUT_L1.upkeep,
      due: [{ buildingRowId: newer.id }, { buildingRowId: older.id }],
    });
    await grantCoins(server, kid, mapId, HUT_L1.upkeep);
    clock.setTime(Date.parse('2026-10-03T16:00:00Z'));
    await settle(server, kid, mapId);
    expect((await row(newer.id)).pausedAt).toBeNull();
    expect((await row(older.id)).pausedAt).not.toBeNull();

    // Only my own upkeep buildings can be ordered.
    const fire = await call(server, 'POST', `/maps/${mapId}/buildings/upkeep-order`, kid, {
      buildingIds: ['00000000-0000-4000-8000-000000000000'],
    });
    expect(fire.statusCode).toBe(404);
    const twice = await call(server, 'POST', `/maps/${mapId}/buildings/upkeep-order`, kid, {
      buildingIds: [newer.id, newer.id],
    });
    expect(twice.statusCode).toBe(400);
  });

  it("a napping homestead's hut owes nothing and isn't paused", async () => {
    const { server, kid, mapId } = await patch();
    const plot = await forest(mapId, kid);
    const hut = await build(server, kid, mapId, plot);
    // Cut off from home before the morning.
    await db.execute(
      `update tile_explore set paused_at = '2026-10-02T20:00:00Z' where tile_id = '${plot.id}'`,
    );
    clock.setTime(Date.parse('2026-10-03T16:00:00Z'));
    await settle(server, kid, mapId);
    expect(await upkeepLedger(mapId)).toHaveLength(0);
    const r = await row(hut.id);
    expect(r.pausedAt).toBeNull();
    expect(r.upkeepPaidThrough).toBe('2026-10-03');
    expect((await coins(server, kid, mapId)).upkeep?.total).toBe(0);
  });

  it('a Pumpkin Barn after Halloween is dormant and owes nothing', async () => {
    const { server, kid, mapId } = await patch();
    clock.setTime(Date.parse('2026-11-08T17:00:00Z'));
    const plot = await forest(mapId, kid, 0, BARN.terrain);
    const barn = await build(server, kid, mapId, plot, BARN.id);
    await grantCoins(server, kid, mapId, 100);
    clock.setTime(Date.parse('2026-11-13T17:00:00Z'));
    await settle(server, kid, mapId);
    const charged = (await upkeepLedger(mapId)).map((l) => l.refId);
    for (const day of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
      expect(charged).not.toContain(upkeepRefId(barn.id, day));
    }
    expect((await row(barn.id)).pausedAt).toBeNull();
    // Its cycles after the season make nothing.
    clock.setTime(Date.parse('2026-11-14T17:00:00Z'));
    expect((await settle(server, kid, mapId)).produced).toEqual([]);
  });

  it('a take-down banks the output first, then half back', async () => {
    const { server, kid, mapId } = await patch();
    const hut = await build(server, kid, mapId, await forest(mapId, kid));
    clock.setTime(Date.parse(START) + HOUR_MS);
    const made = Math.floor(3600 / CYCLE_S) * SOURCE.perCycle;
    const res = await call(server, 'POST', `/maps/${mapId}/buildings/${hut.id}/remove`, kid);
    expect(res.statusCode, res.body).toBe(200);
    const removed = RemoveBuildingResponseSchema.parse(res.json());
    const refund = removeRefund(HUT, 1, HOME_BASE_RULES);
    expect(removed.refund).toEqual(refund);
    expect(removed.home.items['timber']).toBe(PLENTY.timber + made + (refund['timber'] ?? 0));
    const types = (
      await db.query.gameEvents.findMany({
        where: (t, { eq }) => eq(t.mapId, mapId),
        orderBy: (t, { asc }) => [asc(t.seq)],
      })
    ).map((e) => e.type);
    expect(types.slice(-2)).toEqual(['building.produced', 'building.removed']);
  });

  it('an upgrade banks what it made at the old pace first', async () => {
    const { server, kid, mapId } = await patch();
    const hut = await build(server, kid, mapId, await forest(mapId, kid));
    clock.setTime(Date.parse(START) + HOUR_MS);
    const res = await call(server, 'POST', `/maps/${mapId}/buildings/${hut.id}/upgrade`, kid);
    expect(res.statusCode, res.body).toBe(200);
    const after = mine(HomeResponseSchema.parse(res.json()), hut.id);
    expect(after.level).toBe(2);
    expect(after.production).toMatchObject({ cycles: 0, upkeep: HUT.levels[1]!.upkeep });
    expect(await eventsOf(mapId, 'building.produced')).toHaveLength(1);
  });

  it('lost land banks the output to its owner first, then half back', async () => {
    const { server, kid, mapId } = await patch();
    const plot = await forest(mapId, kid);
    const hut = await build(server, kid, mapId, plot);
    clock.setTime(Date.parse(START) + HOUR_MS);
    const made = Math.floor(3600 / CYCLE_S) * SOURCE.perCycle;
    await withTransaction(db, async (tx) => {
      const lost = await takeDownOnLostLand(tx, mapId, [plot.id], clock, ZONE, 'wild');
      expect(lost.map((l) => l.output)).toEqual([{ timber: made }]);
      await lockGrantRows(tx, mapId, [
        ...lost.map((l) => ({ userId: l.ownerUserId, items: l.refund })),
        ...lostOutputGrants(lost),
      ]);
      for (const l of lost) {
        await grantItems(tx, { mapId, userId: l.ownerUserId }, l.refund, 'build-refund', hut.id);
      }
      for (const event of await finishLostBuildings(tx, mapId, lost, clock)) {
        await appendGameEvent(tx, event);
      }
    });
    expect(await db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.id, hut.id) })).toBe(
      undefined,
    );
    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.refId, hut.id)),
    });
    expect(ledger.map((l) => [l.reason, l.itemId, l.delta]).sort()).toEqual(
      [
        ['produced', 'timber', made],
        ...Object.entries(removeRefund(HUT, 1, HOME_BASE_RULES)).map(([id, n]) => [
          'build-refund',
          id,
          n,
        ]),
      ].sort(),
    );
  });

  it("leaving the patch banks the output in the leaver's bag on that patch", async () => {
    const { server, kid: owner, mapId } = await patch();
    const kid = await player();
    const map = MapResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}`, owner)).json(),
    ).map;
    const join = await call(server, 'POST', '/maps/join', kid, { code: map.admin!.invite!.code });
    expect(join.statusCode).toBe(201);
    const detail = MapResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}`, owner)).json(),
    ).map;
    const approve = `/maps/${mapId}/requests/${detail.admin!.requests[0]!.id}/approve`;
    expect((await call(server, 'POST', approve, owner)).statusCode).toBe(204);
    const hut = await build(server, kid, mapId, await forest(mapId, kid));
    clock.setTime(Date.parse(START) + HOUR_MS);
    expect((await call(server, 'POST', `/maps/${mapId}/leave`, kid)).statusCode).toBe(204);
    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.refId, hut.id), eq(t.reason, 'produced')),
    });
    expect(ledger.map((l) => [l.userId, l.mapId, l.itemId, l.delta])).toEqual([
      [kid.id, mapId, 'timber', Math.floor(3600 / CYCLE_S) * SOURCE.perCycle],
    ]);
    expect(await db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.id, hut.id) })).toBe(
      undefined,
    );
    expect(await eventsOf(mapId, 'building.produced')).toHaveLength(1);
  });

  it('dev routes fill storage and make mornings due', async () => {
    const { server, kid, mapId } = await patch();
    const hut = await build(server, kid, mapId, await forest(mapId, kid));
    const ready = await call(server, 'POST', `/maps/${mapId}/dev/buildings/ready`, kid);
    expect(ready.statusCode).toBe(200);
    expect(mine(HomeResponseSchema.parse(ready.json()), hut.id).production?.full).toBe(true);
    await grantCoins(server, kid, mapId, 100);
    clock.setTime(Date.parse('2026-10-03T16:00:00Z'));
    // Two mornings owed (Oct 2 and 3); one already paid would stay paid.
    const due = await call(server, 'POST', `/maps/${mapId}/dev/upkeep/due`, kid, { mornings: 2 });
    expect(due.statusCode).toBe(200);
    await settle(server, kid, mapId);
    expect((await upkeepLedger(mapId)).map((l) => l.refId).sort()).toEqual(
      [upkeepRefId(hut.id, '2026-10-02'), upkeepRefId(hut.id, '2026-10-03')].sort(),
    );
  });
});
