import {
  ApiErrorSchema,
  CollectResponseSchema,
  CraftResponseSchema,
  GAME_DATA,
  InventoryResponseSchema,
  ItemsResponseSchema,
  MapResponseSchema,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { inventories, keepers, sessions, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { consumeItems, grantItems } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
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
const START = '2026-10-02T12:00:00Z';

interface Player {
  id: string;
  username: string;
  token: string;
}

const recipe = (id: string) => GAME_DATA.recipes.find((r) => r.id === id)!;
const HEART_CHARM = recipe('heart-charm');
const LANTERN = recipe('jack-o-lantern-hearthfire');

describe.skipIf(!url)('inventory and crafting (needs DATABASE_URL)', () => {
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

  async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: 'true',
      ...env,
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `crafter_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
    });
    // Every player has picked a Keeper (the map gate, #42).
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, username, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player | null,
    payload?: object,
    headers: Record<string, string> = {},
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...HEADERS, ...headers },
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, {
      name: 'Craft Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function give(server: FastifyInstance, who: Player, mapId: string, items: object) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/items`, who, { items });
    expect(res.statusCode).toBe(201);
    return ItemsResponseSchema.parse(res.json()).items;
  }

  const inventory = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/inventory`, who);
    expect(res.statusCode).toBe(200);
    return InventoryResponseSchema.parse(res.json());
  };

  const craft = (server: FastifyInstance, who: Player | null, mapId: string, recipeId: string) =>
    call(server, 'POST', `/maps/${mapId}/crafts`, who, { recipeId });

  const collect = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    craftId: string,
    headers: Record<string, string> = {},
  ) => call(server, 'POST', `/maps/${mapId}/crafts/${craftId}/collect`, who, undefined, headers);

  /**
   * The ledger reconciles (tech spec §4): every balance equals the sum of its
   * ledger deltas, for every item the player ever had. Returns the ledger.
   */
  async function reconciled(mapId: string, userId: string) {
    const [balances, ledger] = await Promise.all([
      db.query.inventories.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
      }),
      db.query.resourceLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
        orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
      }),
    ]);
    const sums: Record<string, number> = {};
    for (const row of ledger) sums[row.itemId] = (sums[row.itemId] ?? 0) + row.delta;
    expect(Object.fromEntries(balances.map((b) => [b.itemId, b.quantity]))).toEqual(sums);
    return ledger;
  }

  describe('grantItems and consumeItems (the contract #14 builds on)', () => {
    it('adds and takes inside the caller transaction; short means CONFLICT and no change', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const owner = { mapId, userId: kid.id };

      await withTransaction(db, (tx) =>
        grantItems(tx, owner, { timber: 3, 'heart-charm': 2 }, 'capture'),
      );
      await withTransaction(db, (tx) => grantItems(tx, owner, { timber: 1 }, 'capture'));
      expect((await inventory(server, kid, mapId)).items).toEqual({ timber: 4, 'heart-charm': 2 });

      // One short item: nothing at all is taken, and the message says what's missing.
      const short = withTransaction(db, (tx) =>
        consumeItems(tx, owner, { 'heart-charm': 1, timber: 6, treats: 1 }, 'capture'),
      );
      await expect(short).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'You need 2 more Timber and 1 more Treats first!',
      });
      await expect(short).rejects.toBeInstanceOf(AppError);
      expect((await inventory(server, kid, mapId)).items).toEqual({ timber: 4, 'heart-charm': 2 });

      await withTransaction(db, (tx) =>
        consumeItems(tx, owner, { 'heart-charm': 2, timber: 1 }, 'capture'),
      );
      // Spent-out rows stay at 0 and don't show in the bag.
      expect((await inventory(server, kid, mapId)).items).toEqual({ timber: 3 });

      // A rollback in the caller undoes the grant with everything else.
      await expect(
        withTransaction(db, async (tx) => {
          await grantItems(tx, owner, { stone: 5 }, 'capture');
          throw new Error('the capture fell through');
        }),
      ).rejects.toThrow('the capture fell through');
      expect((await inventory(server, kid, mapId)).items).toEqual({ timber: 3 });

      // Every change that committed is in the ledger, with its reason; none that rolled back.
      const ledger = await reconciled(mapId, kid.id);
      expect(ledger.map((l) => [l.itemId, l.delta, l.reason])).toEqual(
        expect.arrayContaining([
          ['timber', 3, 'capture'],
          ['heart-charm', 2, 'capture'],
          ['timber', 1, 'capture'],
          ['heart-charm', -2, 'capture'],
          ['timber', -1, 'capture'],
        ]),
      );
      expect(ledger).toHaveLength(5);
    });

    it('refuses item ids the game data does not have', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const owner = { mapId, userId: kid.id };
      for (const move of [grantItems, consumeItems]) {
        await expect(
          withTransaction(db, (tx) => move(tx, owner, { 'golden-ticket': 1 }, 'capture')),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      const res = await call(server, 'POST', `/maps/${mapId}/dev/items`, kid, {
        items: { 'golden-ticket': 1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('never spends the same Heart Charm twice when two consumers race', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const owner = { mapId, userId: kid.id };
      await give(server, kid, mapId, { 'heart-charm': 1 });
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          withTransaction(db, (tx) => consumeItems(tx, owner, { 'heart-charm': 1 }, 'capture')),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const rows = await db.query.inventories.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
      });
      expect(rows.map((r) => [r.itemId, r.quantity])).toEqual([['heart-charm', 0]]);
      // One grant, one spend: the loser left no trace.
      expect((await reconciled(mapId, kid.id)).map((l) => [l.delta, l.reason])).toEqual([
        [1, 'dev-grant'],
        [-1, 'capture'],
      ]);
    });

    it('keeps quantities at 0 or more in the database too', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await expect(
        db.insert(inventories).values({ mapId, userId: kid.id, itemId: 'timber', quantity: -1 }),
      ).rejects.toThrow();
    });
  });

  describe('dev grants', () => {
    it('hands the caller items, only when HP_DEV_SQUISHY_GRANTS is on', async () => {
      const on = await start();
      const kid = await player();
      const mapId = await newMap(on, kid);
      expect(await give(on, kid, mapId, { 'heart-charm': 3 })).toEqual({ 'heart-charm': 3 });
      const stranger = await player();
      const probe = await call(on, 'POST', `/maps/${mapId}/dev/items`, stranger, {
        items: { timber: 1 },
      });
      expect(probe.statusCode).toBe(404);
      await on.close();

      const off = await start({ HP_DEV_SQUISHY_GRANTS: 'false' });
      const res = await call(off, 'POST', `/maps/${mapId}/dev/items`, kid, {
        items: { timber: 1 },
      });
      expect(res.statusCode).toBe(404);
    });
    // Refused in production: config.test.ts (HP_DEV_SQUISHY_GRANTS).
  });

  describe('crafting', () => {
    it('needs a logged-in member', async () => {
      const server = await start();
      const [kid, stranger] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      expect((await craft(server, null, mapId, 'heart-charm')).statusCode).toBe(401);
      expect((await call(server, 'GET', `/maps/${mapId}/inventory`, stranger)).statusCode).toBe(
        404,
      );
      expect((await craft(server, stranger, mapId, 'heart-charm')).statusCode).toBe(404);
    });

    it('makes a Heart Charm: inputs up front, the charm once the timer is done', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);

      const broke = await craft(server, kid, mapId, 'heart-charm');
      expect(broke.statusCode).toBe(409);
      expect(errorOf(broke).message).toBe('You need 2 more Timber and 1 more Treats first!');

      await give(server, kid, mapId, { timber: 5, treats: 2 });
      const started = await craft(server, kid, mapId, 'heart-charm');
      expect(started.statusCode).toBe(201);
      const made = CraftResponseSchema.parse(started.json());
      expect(made.craft).toMatchObject({
        recipeId: 'heart-charm',
        items: { 'heart-charm': 1 },
        readyAt: new Date(clock.getTime() + HEART_CHARM.craftSeconds * 1000).toISOString(),
      });
      expect(made.items).toEqual({ timber: 3, treats: 1 });
      expect((await inventory(server, kid, mapId)).crafts).toEqual([made.craft]);

      const busy = await craft(server, kid, mapId, 'heart-charm');
      expect(busy.statusCode).toBe(409);
      expect(errorOf(busy).message).toBe(
        'Your pot is still cooking! It pops into your bag when it’s ready.',
      );

      const early = await collect(server, kid, mapId, made.craft.id);
      expect(early.statusCode).toBe(409);
      const notMine = await collect(server, friend, mapId, made.craft.id);
      expect(notMine.statusCode).toBe(404);

      clock.setTime(Date.parse(made.craft.readyAt));
      const key = { 'idempotency-key': 'craft-collect-1' };
      const done = await collect(server, kid, mapId, made.craft.id, key);
      expect(done.statusCode).toBe(200);
      expect(CollectResponseSchema.parse(done.json())).toMatchObject({
        granted: { 'heart-charm': 1 },
        items: { 'heart-charm': 1, timber: 3, treats: 1 },
      });
      const retried = await collect(server, kid, mapId, made.craft.id, key);
      expect(retried.headers['idempotent-replayed']).toBe('true');
      const twice = await collect(server, kid, mapId, made.craft.id);
      expect(twice.statusCode).toBe(409);
      const after = await inventory(server, kid, mapId);
      expect(after.items['heart-charm']).toBe(1);
      expect(after.crafts).toEqual([]);
      // Inputs and output are both on the ledger, pointing at the craft.
      const crafted = (await reconciled(mapId, kid.id)).filter((l) => l.reason === 'craft');
      expect(crafted.map((l) => [l.itemId, l.delta, l.refId])).toEqual(
        expect.arrayContaining([
          ['timber', -2, made.craft.id],
          ['treats', -1, made.craft.id],
          ['heart-charm', 1, made.craft.id],
        ]),
      );
      expect(crafted).toHaveLength(3);

      const events = await db.query.gameEvents.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'item.crafted')),
      });
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toEqual({
        craftId: made.craft.id,
        userId: kid.id,
        recipeId: 'heart-charm',
        items: { 'heart-charm': 1 },
      });
      expect(publicViewFor(PUBLIC_VIEWS, events[0]!, { userId: friend.id })).toEqual({
        userId: kid.id,
        recipeId: 'heart-charm',
      });
    });

    it('makes one thing on a double tap, and spends its inputs once', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(server, kid, mapId, { timber: 10, treats: 10 });
      const [a, b] = await Promise.all([
        craft(server, kid, mapId, 'heart-charm'),
        craft(server, kid, mapId, 'heart-charm'),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
      const refused = a.statusCode === 409 ? a : b;
      expect(errorOf(refused).message).toBe(
        'Your pot is still cooking! It pops into your bag when it’s ready.',
      );
      const after = await inventory(server, kid, mapId);
      expect(after.crafts).toHaveLength(1);
      expect(after.items).toEqual({
        timber: 10 - HEART_CHARM.inputs['timber']!,
        treats: 10 - HEART_CHARM.inputs['treats']!,
      });
      // The loser's spend rolled back with it: the ledger still adds up.
      await reconciled(mapId, kid.id);
    });

    it("only unlocks the Jack-o'-Lantern Hearthfire around Halloween", async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(server, kid, mapId, { pumpkins: 10, emberwood: 10, 'witch-dust': 5 });
      expect((await inventory(server, kid, mapId)).seasons).toEqual(['halloween']);

      const made = await craft(server, kid, mapId, LANTERN.id);
      expect(made.statusCode).toBe(201);
      const { craft: lantern } = CraftResponseSchema.parse(made.json());
      clock.setTime(Date.parse(lantern.readyAt));
      expect((await collect(server, kid, mapId, lantern.id)).statusCode).toBe(200);
      expect((await inventory(server, kid, mapId)).items[LANTERN.output.resource]).toBe(1);

      // Leftover Pumpkins stay as keepsakes, but the recipe sleeps until next year.
      clock.setTime(Date.parse('2026-12-05T12:00:00Z'));
      const later = await inventory(server, kid, mapId);
      expect(later.seasons).toEqual(['christmas']);
      expect(later.items['pumpkins']).toBe(10 - LANTERN.inputs['pumpkins']!);
      const shut = await craft(server, kid, mapId, LANTERN.id);
      expect(shut.statusCode).toBe(409);
      expect(errorOf(shut).message).toBe('That recipe only works around Halloween!');
    });

    it('does not know made-up recipes', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      expect((await craft(server, kid, mapId, 'golden-ticket')).statusCode).toBe(404);
    });
  });
});
