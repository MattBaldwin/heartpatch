import {
  BUILDINGS,
  EXPLORE_RULES,
  HeartCoinsResponseSchema,
  HOME_BASE_RULES,
  HomeResponseSchema,
  JOB_RULES,
  MapResponseSchema,
  RemoveBuildingResponseSchema,
  SettleResponseSchema,
  productionCycleSeconds,
  productionSource,
  removeRefund,
  storageCycles,
  type HomeResponse,
  type MyBuilding,
  type ResourceBuilding,
  type WarehouseBuilding,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeHomestead, type HomesteadTile } from '../../../tests/homestead.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { appendGameEvent } from '../../db/game-events.js';
import { buildings, keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems, lockGrantRows } from '../inventory/service.js';
import { finishLostBuildings, lostOutputGrants, takeDownOnLostLand } from './service.js';
import { upkeepRefId } from './upkeep.js';

/*
 * The Warehouse on the server (#601 PR 8, owner decisions 2026-10-22):
 * while it stands, is paid and its homestead is joined, its owner's level 3+
 * resource buildings deliver straight to the bag with no storage cap; lower
 * levels keep theirs. Paused or lost, they fall back to their own storage
 * from that instant. Its upkeep is charged last unless the kid ranks it.
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
const WAREHOUSE = BUILDINGS.find((b) => b.id === 'warehouse') as WarehouseBuilding;
const WAREHOUSE_UPKEEP = WAREHOUSE.levels[0]!.upkeep;
const SOURCE = productionSource(HUT, JOB_RULES, EXPLORE_RULES)!;
/** A Woodcutter's Hut at a level: its cycle, storage and upkeep. */
const hutAt = (level: number) => {
  const data = HUT.levels[level - 1]!;
  const cycleS = productionCycleSeconds(SOURCE.seconds, data, JOB_RULES);
  return { cycleS, storage: storageCycles(data, cycleS), upkeep: data.upkeep };
};
const L1 = hutAt(1);
const L2 = hutAt(2);
const L3 = hutAt(3);
/** Whole cycles of a hut level in a stretch of time. */
const cyclesIn = (ms: number, level: { cycleS: number }) => Math.floor(ms / (level.cycleS * 1000));

interface Player {
  id: string;
  token: string;
}

describe.skipIf(!url)('the Warehouse (#601 PR 8, needs DATABASE_URL)', () => {
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
    const username = `stockkeeper_${String((counter += 1))}`;
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

  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));

  const setLand = (tile: HomesteadTile, terrain: string, node: string | null = null) =>
    db.execute(
      `update tiles set terrain = '${terrain}', node_resource = ${node === null ? 'null' : `'${node}'`} where id = '${tile.id}'`,
    );

  async function patch() {
    const server = await start();
    const kid = await player();
    const res = await call(server, 'POST', '/maps', kid, {
      name: 'Warehouse Patch',
      timeZone: ZONE,
    });
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

  /**
   * A building on `plot`, as placing makes one: behind the Warehouse's gate
   * (PR 9 opens it) and at any level, so straight in.
   */
  async function build(
    server: FastifyInstance,
    kid: Player,
    mapId: string,
    plot: HomesteadTile,
    { buildingId = HUT.id, level = 1 }: { buildingId?: string; level?: number } = {},
  ): Promise<MyBuilding> {
    const warehouse = buildingId === WAREHOUSE.id;
    await db.insert(buildings).values({
      mapId,
      ownerUserId: kid.id,
      tileId: plot.id,
      buildingId,
      kind: warehouse ? 'warehouse' : 'resource',
      level,
      spot: 1,
      placedAt: new Date(clock),
      producedSince: warehouse ? null : new Date(clock),
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

  /** Timber the hut's output banked, all told (ledger `produced`, ref the hut). */
  const producedTimber = async (hutId: string) =>
    (
      await db.query.resourceLedger.findMany({
        where: (t, { and, eq }) =>
          and(eq(t.refId, hutId), eq(t.reason, 'produced'), eq(t.itemId, 'timber')),
      })
    ).reduce((n, l) => n + l.delta, 0);

  /** Timber in one settle's `produced` for the hut. */
  const timberOf = (
    done: { produced?: { buildingRowId: string; items: Record<string, number> }[] },
    id: string,
  ) => done.produced?.find((p) => p.buildingRowId === id)?.items['timber'] ?? 0;

  /** The instant of a map-local 6:00 AM in Denver (daylight saving until Nov 1). */
  const morning = (day: string) =>
    new Date(`${day}T${day >= '2026-11-01' ? '13' : '12'}:00:00Z`).toISOString();

  /** A patch with my Warehouse on one homestead and a hut at `level` on another. */
  async function stocked(level: number) {
    const { server, kid, mapId } = await patch();
    const warehouse = await build(server, kid, mapId, await forest(mapId, kid, 0), {
      buildingId: WAREHOUSE.id,
    });
    const hut = await build(server, kid, mapId, await forest(mapId, kid, 1), { level });
    return { server, kid, mapId, warehouse, hut };
  }

  it('L3 delivers past its storage while the Warehouse is paid', async () => {
    const { server, kid, mapId, warehouse, hut } = await stocked(3);
    expect(hut.production).toMatchObject({ delivering: true, maxCycles: null });
    expect(warehouse.warehouse).toEqual({
      delivering: true,
      fromLevel: 3,
      napping: false,
      upkeep: WAREHOUSE_UPKEEP,
      paidThrough: null,
      pausedAt: null,
      upkeepRank: null,
    });
    // Four mornings, all paid: four days of making, well past 72 hours of storage.
    await grantCoins(server, kid, mapId, 4 * (L3.upkeep + WAREHOUSE_UPKEEP));
    clock.setTime(Date.parse('2026-10-06T16:00:00Z'));
    const card = mine(await home(server, kid, mapId), hut.id).production!;
    const cycles = cyclesIn(4 * DAY_MS, L3);
    expect(cycles).toBeGreaterThan(L3.storage);
    expect(card).toMatchObject({ cycles, full: false, delivering: true, maxCycles: null });
    expect(card.nextReadyAt).not.toBeNull();
    const done = await settle(server, kid, mapId);
    expect(timberOf(done, hut.id)).toBe(cycles * SOURCE.perCycle);
    expect((await coins(server, kid, mapId)).balance).toBe(0);
    expect((await row(warehouse.id)).upkeepPaidThrough).toBe('2026-10-06');
  });

  it('L2 keeps its storage', async () => {
    const { server, kid, mapId, hut } = await stocked(2);
    expect(hut.production).toMatchObject({ delivering: false, maxCycles: L2.storage });
    await grantCoins(server, kid, mapId, 4 * (L2.upkeep + WAREHOUSE_UPKEEP));
    clock.setTime(Date.parse('2026-10-06T16:00:00Z'));
    expect(mine(await home(server, kid, mapId), hut.id).production).toMatchObject({
      cycles: L2.storage,
      full: true,
      delivering: false,
    });
    expect(timberOf(await settle(server, kid, mapId), hut.id)).toBe(L2.storage * SOURCE.perCycle);
  });

  it('the Warehouse pausing banks L3 output to the morning and caps from there', async () => {
    const { server, kid, mapId, warehouse, hut } = await stocked(3);
    // Oct 3–6 paid for both, Oct 7 only for the hut: the Warehouse, charged
    // last, falls asleep at 6:00 that morning.
    await grantCoins(server, kid, mapId, 4 * (L3.upkeep + WAREHOUSE_UPKEEP) + L3.upkeep);
    clock.setTime(Date.parse('2026-10-07T16:00:00Z'));
    await settle(server, kid, mapId);
    expect((await row(warehouse.id)).pausedAt?.toISOString()).toBe(morning('2026-10-07'));
    expect((await row(hut.id)).pausedAt).toBeNull();
    // Delivered to the morning (past its storage), then four hours capped:
    // nothing was full, so every cycle since it was built landed.
    expect(await producedTimber(hut.id)).toBe(
      cyclesIn(clock.getTime() - Date.parse(START), L3) * SOURCE.perCycle,
    );
    const view = await home(server, kid, mapId);
    expect(mine(view, hut.id).production).toMatchObject({
      delivering: false,
      maxCycles: L3.storage,
    });
    expect(mine(view, warehouse.id).warehouse).toMatchObject({
      delivering: false,
      napping: false,
      pausedAt: morning('2026-10-07'),
    });
    // The morning card hears which buildings fell asleep this morning.
    const upkeep = (await coins(server, kid, mapId)).upkeep!;
    expect(upkeep.pausedThisMorning).toEqual([
      { buildingRowId: warehouse.id, buildingId: WAREHOUSE.id, q: warehouse.q, r: warehouse.r },
    ]);
    expect(upkeep.due.map((d) => [d.buildingRowId, d.paused])).toEqual([
      [hut.id, false],
      [warehouse.id, true],
    ]);

    // Four more mornings paid for the hut only: it fills its own storage and
    // waits. The Warehouse stays asleep (nothing left to wake it).
    await grantCoins(server, kid, mapId, 4 * L3.upkeep);
    clock.setTime(Date.parse('2026-10-11T16:00:00Z'));
    const done = await settle(server, kid, mapId);
    expect(timberOf(done, hut.id)).toBe(L3.storage * SOURCE.perCycle);
    expect((await row(warehouse.id)).pausedAt?.toISOString()).toBe(morning('2026-10-07'));
    // Not this morning's news any more.
    expect((await coins(server, kid, mapId)).upkeep?.pausedThisMorning).toEqual([]);
  });

  it('a Warehouse woken by a top-up delivers again from the wake', async () => {
    const { server, kid, mapId, warehouse, hut } = await stocked(3);
    // Asleep from Oct 7's morning, as above.
    await grantCoins(server, kid, mapId, 4 * (L3.upkeep + WAREHOUSE_UPKEEP) + L3.upkeep);
    clock.setTime(Date.parse('2026-10-07T16:00:00Z'));
    await settle(server, kid, mapId);
    expect((await row(warehouse.id)).pausedAt).not.toBeNull();
    // Topped up: the next settle wakes it, free.
    await grantCoins(server, kid, mapId, WAREHOUSE_UPKEEP);
    await settle(server, kid, mapId);
    expect((await row(warehouse.id)).pausedAt).toBeNull();
    expect(mine(await home(server, kid, mapId), hut.id).production).toMatchObject({
      delivering: true,
      maxCycles: null,
    });
    // Four more days, all paid: past the hut's storage again, and nothing
    // was ever full, so every cycle since it was built has landed.
    await grantCoins(server, kid, mapId, 4 * (L3.upkeep + WAREHOUSE_UPKEEP));
    clock.setTime(Date.parse('2026-10-11T16:00:00Z'));
    const done = await settle(server, kid, mapId);
    expect(timberOf(done, hut.id)).toBeGreaterThan(L3.storage * SOURCE.perCycle);
    expect(await producedTimber(hut.id)).toBe(
      cyclesIn(clock.getTime() - Date.parse(START), L3) * SOURCE.perCycle,
    );
  });

  it("a hut asleep for its own upkeep isn't delivering", async () => {
    const { server, kid, mapId, hut } = await stocked(3);
    // Ranked last and short: the Warehouse pays, the hut falls asleep.
    const ordered = await call(server, 'POST', `/maps/${mapId}/buildings/upkeep-order`, kid, {
      buildingIds: [(await home(server, kid, mapId)).buildings.find((b) => b.warehouse)!.id],
    });
    expect(ordered.statusCode, ordered.body).toBe(200);
    await grantCoins(server, kid, mapId, WAREHOUSE_UPKEEP);
    clock.setTime(Date.parse('2026-10-03T16:00:00Z'));
    await settle(server, kid, mapId);
    expect(mine(await home(server, kid, mapId), hut.id).production).toMatchObject({
      delivering: false,
      pausedAt: morning('2026-10-03'),
    });
  });

  it('lost Warehouse: half back, L3 huts keep running capped', async () => {
    const { server, kid, mapId, warehouse, hut } = await stocked(3);
    // Its mornings are paid through Oct 6; lost that evening, 102 hours in.
    await db.execute(
      `update buildings set upkeep_paid_through = '2026-10-06' where map_id = '${mapId}'`,
    );
    clock.setTime(Date.parse('2026-10-06T22:00:00Z'));
    const plot = (await row(warehouse.id)).tileId;
    await withTransaction(db, async (tx) => {
      const lost = await takeDownOnLostLand(tx, mapId, [plot], clock, ZONE, 'wild');
      expect(lost.map((l) => l.event.payload.buildingId)).toEqual([WAREHOUSE.id]);
      await lockGrantRows(tx, mapId, [
        ...lost.map((l) => ({ userId: l.ownerUserId, items: l.refund })),
        ...lostOutputGrants(lost),
      ]);
      for (const l of lost) {
        await grantItems(
          tx,
          { mapId, userId: l.ownerUserId },
          l.refund,
          'build-refund',
          l.event.payload.buildingRowId,
        );
      }
      for (const event of await finishLostBuildings(tx, mapId, lost, clock)) {
        await appendGameEvent(tx, event);
      }
    });
    expect(
      await db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.id, warehouse.id) }),
    ).toBe(undefined);
    const refunds = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.refId, warehouse.id), eq(t.reason, 'build-refund')),
    });
    expect(Object.fromEntries(refunds.map((l) => [l.itemId, l.delta]))).toEqual(
      removeRefund(WAREHOUSE, 1, HOME_BASE_RULES),
    );
    // What it delivered landed, past the hut's storage.
    const delivered = cyclesIn(clock.getTime() - Date.parse(START), L3);
    expect(delivered).toBeGreaterThan(L3.storage);
    expect(await producedTimber(hut.id)).toBe(delivered * SOURCE.perCycle);
    expect((await row(hut.id)).producedSince?.getTime()).toBeLessThanOrEqual(clock.getTime());

    // The hut keeps running, capped by its own storage from now.
    expect(mine(await home(server, kid, mapId), hut.id).production).toMatchObject({
      delivering: false,
      maxCycles: L3.storage,
    });
    await grantCoins(server, kid, mapId, 4 * L3.upkeep);
    clock.setTime(Date.parse('2026-10-10T22:00:00Z'));
    expect(timberOf(await settle(server, kid, mapId), hut.id)).toBe(L3.storage * SOURCE.perCycle);
  });

  it('an L3 hut lost while its Warehouse stands banks uncapped, then half back', async () => {
    const { mapId, warehouse, hut } = await stocked(3);
    await db.execute(
      `update buildings set upkeep_paid_through = '2026-10-06' where map_id = '${mapId}'`,
    );
    clock.setTime(Date.parse('2026-10-06T22:00:00Z'));
    const plot = (await row(hut.id)).tileId;
    await withTransaction(db, async (tx) => {
      const lost = await takeDownOnLostLand(tx, mapId, [plot], clock, ZONE, 'captured');
      expect(lost.map((l) => [l.event.payload.buildingId, l.delivered.length])).toEqual([
        [HUT.id, 0],
      ]);
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
    const delivered = cyclesIn(clock.getTime() - Date.parse(START), L3);
    expect(delivered).toBeGreaterThan(L3.storage);
    expect(await producedTimber(hut.id)).toBe(delivered * SOURCE.perCycle);
    const refunds = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.refId, hut.id), eq(t.reason, 'build-refund')),
    });
    expect(Object.fromEntries(refunds.map((l) => [l.itemId, l.delta]))).toEqual(
      removeRefund(HUT, 3, HOME_BASE_RULES),
    );
    // The Warehouse stays, untouched.
    expect((await row(warehouse.id)).pausedAt).toBeNull();
  });

  it('taking the Warehouse down banks what it delivered, then half back', async () => {
    const { server, kid, mapId, warehouse, hut } = await stocked(3);
    await grantCoins(server, kid, mapId, 4 * (L3.upkeep + WAREHOUSE_UPKEEP));
    clock.setTime(Date.parse('2026-10-06T16:00:00Z'));
    const res = await call(server, 'POST', `/maps/${mapId}/buildings/${warehouse.id}/remove`, kid);
    expect(res.statusCode, res.body).toBe(200);
    const removed = RemoveBuildingResponseSchema.parse(res.json());
    expect(removed.refund).toEqual(removeRefund(WAREHOUSE, 1, HOME_BASE_RULES));
    // The mornings were charged first, so all four days landed uncapped.
    expect(await producedTimber(hut.id)).toBe(cyclesIn(4 * DAY_MS, L3) * SOURCE.perCycle);
    expect(mine(removed.home, hut.id).production).toMatchObject({
      cycles: 0,
      delivering: false,
      maxCycles: L3.storage,
    });
    expect(removed.home.buildings.some((b) => b.id === warehouse.id)).toBe(false);
  });

  it('charge order puts it last unless ranked', async () => {
    // Enough for the hut or the Warehouse, not both.
    const coinsFor = Math.max(L1.upkeep, WAREHOUSE_UPKEEP);
    {
      const { server, kid, mapId, warehouse, hut } = await stocked(1);
      expect((await coins(server, kid, mapId)).upkeep?.due.map((d) => d.buildingRowId)).toEqual([
        hut.id,
        warehouse.id,
      ]);
      await grantCoins(server, kid, mapId, coinsFor);
      clock.setTime(Date.parse('2026-10-03T16:00:00Z'));
      await settle(server, kid, mapId);
      expect((await row(hut.id)).pausedAt).toBeNull();
      expect((await row(warehouse.id)).pausedAt?.toISOString()).toBe(morning('2026-10-03'));
      expect((await upkeepLedger(mapId)).map((l) => l.refId)).toEqual([
        upkeepRefId(hut.id, '2026-10-03'),
      ]);
    }
    clock.setTime(Date.parse(START));
    {
      const { server, kid, mapId, warehouse, hut } = await stocked(1);
      const ordered = await call(server, 'POST', `/maps/${mapId}/buildings/upkeep-order`, kid, {
        buildingIds: [warehouse.id],
      });
      expect(ordered.statusCode, ordered.body).toBe(200);
      expect(
        mine(HomeResponseSchema.parse(ordered.json()), warehouse.id).warehouse?.upkeepRank,
      ).toBe(0);
      await grantCoins(server, kid, mapId, coinsFor);
      clock.setTime(Date.parse('2026-10-03T16:00:00Z'));
      await settle(server, kid, mapId);
      expect((await row(warehouse.id)).pausedAt).toBeNull();
      expect((await row(hut.id)).pausedAt?.toISOString()).toBe(morning('2026-10-03'));
      expect((await upkeepLedger(mapId)).map((l) => l.refId)).toEqual([
        upkeepRefId(warehouse.id, '2026-10-03'),
      ]);
    }
  });

  it('a napping Warehouse delivers nothing and owes nothing', async () => {
    const { server, kid, mapId, warehouse, hut } = await stocked(3);
    // Its homestead is cut off from home 16 hours in, before the first morning.
    const cutOff = Date.parse('2026-10-03T08:00:00Z');
    await db.execute(
      `update tile_explore set paused_at = '${new Date(cutOff).toISOString()}' where tile_id = '${(await row(warehouse.id)).tileId}'`,
    );
    await grantCoins(server, kid, mapId, 4 * L3.upkeep);
    clock.setTime(Date.parse('2026-10-06T16:00:00Z'));
    const view = await home(server, kid, mapId);
    expect(mine(view, warehouse.id).warehouse).toMatchObject({ delivering: false, napping: true });
    expect(mine(view, hut.id).production).toMatchObject({ delivering: false, full: true });
    // Delivered until the cut-off, then capped from there.
    const done = await settle(server, kid, mapId);
    expect(timberOf(done, hut.id)).toBe(
      (cyclesIn(cutOff - Date.parse(START), L3) + L3.storage) * SOURCE.perCycle,
    );
    // Only the hut paid: a napping Warehouse owes nothing (owner decision Q4).
    const days = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];
    expect((await upkeepLedger(mapId)).map((l) => l.refId).sort()).toEqual(
      days.map((d) => upkeepRefId(hut.id, d)).sort(),
    );
    expect((await row(warehouse.id)).pausedAt).toBeNull();
  });

  it('tells the tile card when a season ends and the next morning comes', async () => {
    const { server, kid, mapId } = await patch();
    clock.setTime(Date.parse('2026-10-20T16:00:00Z'));
    const barn = await build(server, kid, mapId, await forest(mapId, kid, 0, BARN.terrain), {
      buildingId: BARN.id,
    });
    const hut = await build(server, kid, mapId, await forest(mapId, kid, 1));
    // Halloween runs to Nov 9 in 2026: it's over at midnight in Denver.
    const ends = '2026-11-10T07:00:00.000Z';
    expect(barn.production).toMatchObject({
      nextMorningAt: morning('2026-10-21'),
      seasonEndsAt: ends,
    });
    expect(hut.production).toMatchObject({ seasonEndsAt: null });
    // Its last day: the season ends before the next morning, so it's free from tomorrow.
    clock.setTime(Date.parse('2026-11-09T17:00:00Z'));
    const last = mine(await home(server, kid, mapId), barn.id).production!;
    expect(last).toMatchObject({ nextMorningAt: morning('2026-11-10'), seasonEndsAt: ends });
    expect(Date.parse(last.seasonEndsAt!)).toBeLessThanOrEqual(Date.parse(last.nextMorningAt!));
    clock.setTime(Date.parse('2026-11-10T17:00:00Z'));
    expect(mine(await home(server, kid, mapId), barn.id).production?.seasonEndsAt).toBeNull();
  });

  it('a level 3 Pumpkin Barn asleep out of season is not delivering', async () => {
    const { server, kid, mapId } = await patch();
    await build(server, kid, mapId, await forest(mapId, kid, 0), { buildingId: WAREHOUSE.id });
    clock.setTime(Date.parse('2026-11-12T17:00:00Z'));
    const barn = await build(server, kid, mapId, await forest(mapId, kid, 1, BARN.terrain), {
      buildingId: BARN.id,
      level: 3,
    });
    expect(barn.production).toMatchObject({ delivering: false, seasonEndsAt: null });
  });
});
