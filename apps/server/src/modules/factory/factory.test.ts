import {
  ApiErrorSchema,
  FactoryQueueResponseSchema,
  GAME_DATA,
  HomeResponseSchema,
  InventoryResponseSchema,
  MapResponseSchema,
  RemoveBuildingResponseSchema,
  SettleResponseSchema,
  StopFactoryQueueResponseSchema,
  type InventoryResponse,
  type MyBuilding,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;
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
const ZONE = 'America/Denver';
/** Oct 2, 6:00 AM in Denver: in the Halloween window. */
const START = '2026-10-02T12:00:00Z';
/** Enough to build a level 1 Factory (30 Timber, 20 Stone). */
const FACTORY_COST = { timber: 30, stone: 20 };
const charm = GAME_DATA.recipes.find((r) => r.id === 'heart-charm')!;

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('the Crafting Factory (#294, needs DATABASE_URL)', () => {
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

  const later = (ms: number) => clock.setTime(clock.getTime() + ms);

  async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, ...env });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `factory_${String(process.pid)}_${String((counter += 1))}`;
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
    return { id: user!.id, username, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player | null,
    payload?: object,
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, { name: 'Busy Patch', timeZone: ZONE });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));

  async function bag(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'GET', `/maps/${mapId}/inventory`, who);
    expect(res.statusCode).toBe(200);
    return InventoryResponseSchema.parse(res.json());
  }

  /** Builds a level 1 Factory on a ring spot of a home tile. */
  async function buildFactory(server: FastifyInstance, who: Player, mapId: string) {
    await give(mapId, who, FACTORY_COST);
    const homeRes = await call(server, 'GET', `/maps/${mapId}/home`, who);
    const tile = HomeResponseSchema.parse(homeRes.json()).tiles.find((t) => !t.heartSeed)!;
    const res = await call(server, 'POST', `/maps/${mapId}/buildings`, who, {
      buildingId: 'crafting-factory',
      q: tile.q,
      r: tile.r,
      spot: 1,
    });
    expect(res.statusCode, res.body).toBe(201);
    const factory = HomeResponseSchema.parse(res.json()).buildings.find(
      (b) => b.buildingId === 'crafting-factory',
    );
    return { factory: factory!, tile };
  }

  const queue = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    recipeId: string,
    count: number | 'max',
  ) => call(server, 'POST', `/maps/${mapId}/factory/queues`, who, { recipeId, count });

  async function queued(
    server: FastifyInstance,
    who: Player,
    mapId: string,
    recipeId: string,
    count: number | 'max',
  ) {
    const res = await queue(server, who, mapId, recipeId, count);
    expect(res.statusCode, res.body).toBe(201);
    return FactoryQueueResponseSchema.parse(res.json());
  }

  async function settle(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'POST', `/maps/${mapId}/settle`, who);
    expect(res.statusCode).toBe(200);
    return SettleResponseSchema.parse(res.json());
  }

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  /** Every balance equals the sum of its ledger rows (tech spec §4). */
  async function reconciled(mapId: string, userId: string) {
    const [balances, ledger] = await Promise.all([
      db.query.inventories.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
      }),
      db.query.resourceLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
      }),
    ]);
    const sums: Record<string, number> = {};
    for (const row of ledger) sums[row.itemId] = (sums[row.itemId] ?? 0) + row.delta;
    expect(Object.fromEntries(balances.map((b) => [b.itemId, b.quantity]))).toEqual(sums);
    return ledger;
  }

  const batchesIn = (inv: InventoryResponse) => inv.factory?.batches ?? [];

  it('needs a Factory, then starts a batch capped at what the bag can pay for', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    // No Factory yet: nothing on any reply, and a batch is refused.
    expect((await bag(server, kid, mapId)).factory).toBeNull();
    const none = await queue(server, kid, mapId, 'heart-charm', 1);
    expect(none.statusCode).toBe(409);
    expect(errorOf(none).message).toBe('Build a Crafting Factory at home first!');

    const { factory } = await buildFactory(server, kid, mapId);
    expect(factory).toMatchObject({ kind: 'factory', level: 1 });
    // One per home (`maxPerHome`).
    await give(mapId, kid, FACTORY_COST);
    const homeRes = await call(server, 'GET', `/maps/${mapId}/home`, kid);
    const other = HomeResponseSchema.parse(homeRes.json()).tiles.find(
      (t) => !t.heartSeed && !(t.q === factory.q && t.r === factory.r),
    )!;
    const second = await call(server, 'POST', `/maps/${mapId}/buildings`, kid, {
      buildingId: 'crafting-factory',
      q: other.q,
      r: other.r,
      spot: 1,
    });
    expect(second.statusCode).toBe(409);

    // 12 Timber and 5 Treats pay for 5 Heart Charms; "max" asks for them all.
    await give(mapId, kid, { timber: 12, treats: 5 });
    const before = (await bag(server, kid, mapId)).items;
    const started = await queued(server, kid, mapId, 'heart-charm', 'max');
    expect(started.queue.total).toBe(5);
    expect(started.items['timber']).toBe((before['timber'] ?? 0) - 10);
    expect(started.items['treats'] ?? 0).toBe(0);
    expect(started.factory).toMatchObject({ level: 1, slots: 2 });
    const [batch] = batchesIn(started);
    expect(batch).toMatchObject({
      recipeId: 'heart-charm',
      total: 5,
      done: 0,
      itemSeconds: charm.craftSeconds,
      nextAt: new Date(Date.parse(START) + charm.craftSeconds * 1000).toISOString(),
      doneAt: new Date(Date.parse(START) + 5 * charm.craftSeconds * 1000).toISOString(),
    });
    const ledger = await reconciled(mapId, kid.id);
    expect(ledger.filter((l) => l.reason === 'factory').map((l) => [l.itemId, l.delta])).toEqual(
      expect.arrayContaining([
        ['timber', -10],
        ['treats', -5],
      ]),
    );
    const events = await eventsOf(mapId);
    expect(events.at(-1)).toMatchObject({
      type: 'factory.started',
      payload: { queueId: started.queue.id, recipeId: 'heart-charm', total: 5 },
    });
  });

  it('asks for more than the bag has: makes what it can, and refuses when it can pay for none', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await buildFactory(server, kid, mapId);
    await give(mapId, kid, { greens: 5 });
    // Cooked Treats take 2 Greens: 5 Greens pay for 2, whatever is asked.
    expect((await queued(server, kid, mapId, 'cook-treats', 40)).queue.total).toBe(2);
    const broke = await queue(server, kid, mapId, 'cook-treats', 1);
    expect(broke.statusCode).toBe(409);
    expect(errorOf(broke).message).toMatch(/You need 1 more Greens first!/);
    expect(batchesIn(await bag(server, kid, mapId))).toHaveLength(1);
    await reconciled(mapId, kid.id);
  });

  it('refuses sealed and out-of-season recipes and unknown ones', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await buildFactory(server, kid, mapId);
    // Thanksgiving's charms in October: not in season.
    await give(mapId, kid, { 'magic-fallen-leaves': 8, treats: 2 });
    const season = await queue(server, kid, mapId, 'leafy-heart-charms', 1);
    expect(season.statusCode).toBe(409);
    expect(errorOf(season).message).toMatch(/only works around Thanksgiving/);
    // Brave Brew's page opens once Treats and Stone have both been collected:
    // a brand-new account with only Stone has it sealed.
    const fresh = await player();
    const freshMap = await newMap(server, fresh);
    await buildFactory(server, fresh, freshMap);
    const sealed = await queue(server, fresh, freshMap, 'brave-brew', 1);
    expect(sealed.statusCode).toBe(403);
    expect((await queue(server, kid, mapId, 'no-such-recipe', 1)).statusCode).toBe(404);
  });

  it('runs 2 batches at level 1, 3 after an upgrade, and upgrades keep them going', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const { factory } = await buildFactory(server, kid, mapId);
    await give(mapId, kid, { timber: 40, treats: 20, greens: 20 });
    await queued(server, kid, mapId, 'heart-charm', 3);
    // Two of the same recipe is fine (owner decision 2026-10-08).
    await queued(server, kid, mapId, 'heart-charm', 2);
    const full = await queue(server, kid, mapId, 'cook-treats', 1);
    expect(full.statusCode).toBe(409);
    expect(errorOf(full).message).toBe(
      'Your Factory is busy! A spot frees up when a batch finishes.',
    );
    await give(mapId, kid, { timber: 60, stone: 50, glimmer: 5 });
    const up = await call(server, 'POST', `/maps/${mapId}/buildings/${factory.id}/upgrade`, kid);
    expect(up.statusCode, up.body).toBe(200);
    const third = await queued(server, kid, mapId, 'cook-treats', 1);
    expect(third.factory).toMatchObject({ level: 2, slots: 3 });
    expect(batchesIn(third).map((b) => b.total)).toEqual([3, 2, 1]);
  });

  it('settles one thing at a time as they finish, ends a finished batch and frees its spot', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await buildFactory(server, kid, mapId);
    await give(mapId, kid, { timber: 20, treats: 10, greens: 4 });
    const charms = await queued(server, kid, mapId, 'heart-charm', 4);
    const treats = await queued(server, kid, mapId, 'cook-treats', 2);
    const charmsBefore = charms.items['heart-charm'] ?? 0;

    // 2.5 minutes later: 2 charms and 2 pots of Treats are made.
    later(2.5 * MINUTE_MS);
    const first = await settle(server, kid, mapId);
    expect(first.landed).toEqual(
      expect.arrayContaining([
        { kind: 'factory', items: { 'heart-charm': 2 }, recipeId: 'heart-charm' },
        { kind: 'factory', items: { treats: 6 }, recipeId: 'cook-treats' },
      ]),
    );
    expect(first.items['heart-charm']).toBe(charmsBefore + 2);
    expect(first.nextAt).toBe(new Date(Date.parse(START) + 3 * MINUTE_MS).toISOString());
    // The Treats batch is done and gone; the charms keep going.
    expect(batchesIn(first).map((b) => [b.id, b.done])).toEqual([[charms.queue.id, 2]]);
    // Settling again banks nothing new.
    const again = await settle(server, kid, mapId);
    expect(again.landed.filter((l) => l.kind === 'factory')).toEqual([]);
    expect(again.items['heart-charm']).toBe(charmsBefore + 2);

    later(DAY_MS);
    const last = await settle(server, kid, mapId);
    expect(last.items['heart-charm']).toBe(charmsBefore + 4);
    expect(last.factory?.batches).toEqual([]);
    expect(last.nextAt).toBeNull();
    const rows = await db.query.factoryQueues.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.startedAt), asc(t.id)],
    });
    expect(rows.map((r) => [r.id, r.banked, r.endReason])).toEqual([
      [charms.queue.id, 4, 'done'],
      [treats.queue.id, 2, 'done'],
    ]);
    // Ended when it really finished, not when it was settled.
    expect(rows[0]!.endedAt?.toISOString()).toBe(
      new Date(Date.parse(START) + 4 * MINUTE_MS).toISOString(),
    );
    const crafted = (await eventsOf(mapId)).filter((e) => e.type === 'factory.crafted');
    expect(crafted.map((e) => (e.payload as { count: number }).count).sort()).toEqual([2, 2, 2]);
    await reconciled(mapId, kid.id);
  });

  it('stops a batch: keeps what is made and gives back everything else, the one in progress too', async () => {
    const server = await start();
    const kid = await player();
    const friend = await player();
    const mapId = await newMap(server, kid);
    await buildFactory(server, kid, mapId);
    await give(mapId, kid, { timber: 20, treats: 10 });
    const started = await queued(server, kid, mapId, 'heart-charm', 10);
    const after = started.items;
    // 4.5 minutes in: 4 made, the 5th half-done.
    later(4.5 * MINUTE_MS);
    const stopPath = `/maps/${mapId}/factory/queues/${started.queue.id}/stop`;
    // Nobody else's to stop (not even a patch they're not on).
    expect((await call(server, 'POST', stopPath, friend)).statusCode).toBe(404);
    const res = await call(server, 'POST', stopPath, kid);
    expect(res.statusCode, res.body).toBe(200);
    const stopped = StopFactoryQueueResponseSchema.parse(res.json());
    expect(stopped.kept).toBe(4);
    expect(stopped.refunded).toEqual({ timber: 12, treats: 6 });
    expect(stopped.items['heart-charm']).toBe((after['heart-charm'] ?? 0) + 4);
    expect(stopped.items['timber']).toBe((after['timber'] ?? 0) + 12);
    expect(stopped.factory?.batches).toEqual([]);
    const again = await call(server, 'POST', stopPath, kid);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toBe('That batch is already finished!');
    expect((await eventsOf(mapId)).at(-1)).toMatchObject({
      type: 'factory.stopped',
      payload: { kept: 4, refunded: { timber: 12, treats: 6 }, reason: 'stopped' },
    });
    await reconciled(mapId, kid.id);
  });

  it('taking the Factory down stops its batches with the refund, plus half the building back', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const { factory } = await buildFactory(server, kid, mapId);
    await give(mapId, kid, { timber: 8, treats: 4 });
    await queued(server, kid, mapId, 'heart-charm', 4);
    const before = (await bag(server, kid, mapId)).items;
    later(1.5 * MINUTE_MS);
    const res = await call(server, 'POST', `/maps/${mapId}/buildings/${factory.id}/remove`, kid);
    expect(res.statusCode, res.body).toBe(200);
    expect(RemoveBuildingResponseSchema.parse(res.json()).refund).toEqual({
      timber: 15,
      stone: 10,
    });
    const after = await bag(server, kid, mapId);
    expect(after.factory).toBeNull();
    // 1 charm made; 3 runs back (6 Timber, 3 Treats); half of 30 Timber and 20 Stone.
    expect(after.items['heart-charm']).toBe((before['heart-charm'] ?? 0) + 1);
    expect(after.items['timber']).toBe((before['timber'] ?? 0) + 6 + 15);
    expect(after.items['treats']).toBe((before['treats'] ?? 0) + 3);
    expect((await eventsOf(mapId)).map((e) => e.type)).toEqual(
      expect.arrayContaining(['building.removed', 'factory.crafted', 'factory.stopped']),
    );
    const [row] = await db.query.factoryQueues.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
    });
    expect(row).toMatchObject({ banked: 1, endReason: 'taken-down' });
    await reconciled(mapId, kid.id);
  });

  it('a dev route finishes batches now, so a settle lands them', async () => {
    const server = await start({ HP_DEV_SQUISHY_GRANTS: 'true' });
    const kid = await player();
    const mapId = await newMap(server, kid);
    await buildFactory(server, kid, mapId);
    await give(mapId, kid, { water: 9 });
    // Frozen Water takes 30 minutes each.
    await queued(server, kid, mapId, 'freeze-water', 'max');
    const ready = await call(server, 'POST', `/maps/${mapId}/dev/factory/ready`, kid);
    expect(ready.statusCode).toBe(200);
    expect(batchesIn(InventoryResponseSchema.parse(ready.json()))[0]).toMatchObject({
      total: 3,
      done: 3,
      nextAt: null,
    });
    const landed = await settle(server, kid, mapId);
    expect(landed.landed).toContainEqual({
      kind: 'factory',
      items: { ice: 3 },
      recipeId: 'freeze-water',
    });
    expect(landed.items['ice']).toBe(3);
  });

  it("leaving the patch stops a member's batches and gives back what wasn't made", async () => {
    const server = await start();
    const owner = await player();
    const kid = await player();
    const mapId = await newMap(server, owner);
    const detail = async () =>
      MapResponseSchema.parse((await call(server, 'GET', `/maps/${mapId}`, owner)).json()).map;
    const code = (await detail()).admin!.invite!.code;
    expect((await call(server, 'POST', '/maps/join', kid, { code })).statusCode).toBe(201);
    const requestId = (await detail()).admin!.requests[0]!.id;
    expect(
      (await call(server, 'POST', `/maps/${mapId}/requests/${requestId}/approve`, owner))
        .statusCode,
    ).toBe(204);
    await buildFactory(server, kid, mapId);
    await give(mapId, kid, { greens: 6 });
    const started = await queued(server, kid, mapId, 'cook-treats', 3);
    later(1.5 * MINUTE_MS);
    expect((await call(server, 'POST', `/maps/${mapId}/leave`, kid)).statusCode).toBe(204);
    const [row] = await db.query.factoryQueues.findMany({
      where: (t, { eq }) => eq(t.id, started.queue.id),
    });
    expect(row).toMatchObject({ banked: 1, endReason: 'taken-down' });
    const stopped = (await eventsOf(mapId)).find((e) => e.type === 'factory.stopped');
    expect(stopped?.payload).toMatchObject({ kept: 1, refunded: { greens: 4 }, reason: 'left' });
    await reconciled(mapId, kid.id);
  });

  it('shows my Factory on the home screen like any building', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const { factory } = await buildFactory(server, kid, mapId);
    const homeRes = await call(server, 'GET', `/maps/${mapId}/home`, kid);
    const mine: MyBuilding | undefined = HomeResponseSchema.parse(homeRes.json()).buildings.find(
      (b) => b.id === factory.id,
    );
    expect(mine).toMatchObject({ kind: 'factory', capacity: null, residents: null });
  });
});
