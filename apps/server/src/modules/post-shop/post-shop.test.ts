import {
  ApiErrorSchema,
  BuyResponseSchema,
  heartSeedOf,
  hexDistance,
  MapResponseSchema,
  POST_SHOP,
  ShopViewResponseSchema,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import {
  createDbClient,
  withTransaction,
  type Database,
  type DbClient,
  type Transaction,
} from '../../db/client.js';
import { keepers, postPurchases, sessions, users } from '../../db/schema.js';
import { backendPid, waitUntilBlockedBy } from '../../../tests/lock-waits.js';
import { AppError } from '../../lib/errors.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createHeartCoinsRepo } from '../heart-coins/repo.js';
import { creditHeartCoins, HEART_COIN_MESSAGES, spendHeartCoins } from '../heart-coins/service.js';
import { createPostShopService } from './service.js';

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
/** 10 AM in Denver, the patches' time zone (UTC−7 in November). */
const START = '2026-11-04T17:00:00Z';
const priceOf = (id: string) => POST_SHOP.find((i) => i.id === id)!.price;

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('the trading post Shop (#729, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date(START);
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 12 });
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
    const username = `shopper_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'UTC' })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return { id: user!.id, username, token };
  }

  const call = (
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...HEADERS, ...headers },
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });
  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  /** The kid's nearest post, with the neutral tiles on the straight way to it claimed (#270's test path). */
  async function nearestPost(mapId: string, kid: PublicUser) {
    const tiles = await db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
    const seed = heartSeedOf(tiles.filter((t) => t.ownerUserId === kid.id && t.homeSlot !== null))!;
    const posts = tiles.filter((t) => t.terrain === 'trading-post');
    const post = [...posts].sort((a, b) => hexDistance(seed, a) - hexDistance(seed, b))[0]!;
    const reach = hexDistance(seed, post);
    for (const t of tiles) {
      const onTheWay =
        t.ownerUserId === null &&
        t.homeSlot === null &&
        t.terrain !== 'trading-post' &&
        hexDistance(seed, t) < reach &&
        hexDistance(t, post) + hexDistance(seed, t) === reach;
      if (onTheWay) {
        await db.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${t.id}'`);
      }
    }
    return { q: post.q, r: post.r, seed };
  }

  /** A patch of the kid's (Denver time) with `coins` Heart Coins, connected to a post. */
  async function patch(server: FastifyInstance, kid: Player, coins: number) {
    const res = await call(server, 'POST', '/maps', kid, {
      name: `Shop Patch ${String(counter)}`,
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const mapId = MapResponseSchema.parse(res.json()).map.id;
    if (coins > 0) await grant(mapId, kid, coins);
    const { q, r, seed } = await nearestPost(mapId, kid);
    return { mapId, post: { q, r }, seed };
  }
  const grant = (mapId: string, kid: PublicUser, amount: number) =>
    withTransaction(db, (tx) =>
      creditHeartCoins(tx, {
        source: 'dev-grant',
        refId: crypto.randomUUID(),
        mapId,
        userId: kid.id,
        amount,
        at: clock,
      }),
    );

  type At = Awaited<ReturnType<typeof patch>>;
  const buy = (
    server: FastifyInstance,
    kid: Player,
    at: At,
    itemId: string,
    headers: Record<string, string> = { 'idempotency-key': crypto.randomUUID() },
  ) => call(server, 'POST', `/maps/${at.mapId}/posts/shop`, kid, { ...at.post, itemId }, headers);
  const shopOf = async (server: FastifyInstance, kid: Player, at: At) => {
    const res = await call(
      server,
      'GET',
      `/maps/${at.mapId}/posts/shop?q=${String(at.post.q)}&r=${String(at.post.r)}`,
      kid,
    );
    expect(res.statusCode, res.body).toBe(200);
    return ShopViewResponseSchema.parse(res.json()).shop;
  };
  const heartRows = async (mapId: string, kid: PublicUser) =>
    (
      await db.query.heartCoinLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
        orderBy: (t, { asc }) => asc(t.createdAt),
      })
    )
      .filter((r) => r.source !== 'dev-grant')
      .map((r) => ({ source: r.source, refId: r.refId, amount: r.amount }));
  const balanceOf = (mapId: string, kid: PublicUser) =>
    createHeartCoinsRepo(db).balance(mapId, kid.id);
  const purchases = (mapId: string, kid: PublicUser) =>
    db.query.postPurchases.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
      orderBy: (t, { asc }) => asc(t.createdAt),
    });
  const bag = async (mapId: string, kid: PublicUser) => {
    const rows = await db.query.inventories.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
    });
    return Object.fromEntries(
      rows.filter((r) => r.quantity > 0).map((r) => [r.itemId, r.quantity]),
    );
  };
  const shopItemRows = (mapId: string) =>
    db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'shop')),
    });
  /** Uses the kid's held lure, as a wild start would. */
  const useLure = (mapId: string, kid: PublicUser) =>
    db.execute(
      `update post_purchases set consumed_at = now() where map_id = '${mapId}' and user_id = '${kid.id}' and consumed_at is null`,
    );

  it("buys a Charm pack: ledger ('shop', purchaseId) −40, 5 charms in the bag with reason shop, one purchase row, the event to the buyer", async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 100);
    const res = await buy(server, kid, at, 'heart-charm-pack');
    expect(res.statusCode, res.body).toBe(200);
    const body = BuyResponseSchema.parse(res.json());
    expect(body.bought).toEqual({
      itemId: 'heart-charm-pack',
      price: 40,
      got: { kind: 'items', items: { 'heart-charm': 5 } },
    });
    expect(body.balance).toBe(60);
    const [row, ...rest] = await purchases(at.mapId, kid);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ itemId: 'heart-charm-pack', price: 40, day: '2026-11-04' });
    expect(await heartRows(at.mapId, kid)).toEqual([
      { source: 'shop', refId: row!.id, amount: -40 },
    ]);
    expect((await bag(at.mapId, kid))['heart-charm']).toBe(5);
    expect((await shopItemRows(at.mapId)).map((r) => r.refId)).toEqual([row!.id]);
    const card = body.shop.items.find((i) => i.id === 'heart-charm-pack');
    expect(card).toMatchObject({ left: 0, status: 'capped' });
    const events = await db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, at.mapId), eq(t.type, 'post.bought')),
    });
    expect(events.map((e) => e.payload)).toEqual([
      { userId: kid.id, purchaseId: row!.id, itemId: 'heart-charm-pack', price: 40, balance: 60 },
    ]);
  });

  it('buys a Potion crate: one of each potion', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, priceOf('potion-crate'));
    const res = await buy(server, kid, at, 'potion-crate');
    expect(res.statusCode, res.body).toBe(200);
    expect(await bag(at.mapId, kid)).toMatchObject({
      'brave-brew': 1,
      'cozy-cocoa': 1,
      'hearty-soup': 1,
    });
    expect(await balanceOf(at.mapId, kid)).toBe(0);
  });

  it("a second pack today is CONFLICT and changes nothing; the day cap resets on the patch's midnight, not UTC's", async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 200);
    expect((await buy(server, kid, at, 'heart-charm-pack')).statusCode).toBe(200);
    // 11:30 PM in Denver: already the 5th in UTC, still the 4th on the patch.
    clock.setTime(Date.parse('2026-11-05T06:30:00Z'));
    const again = await buy(server, kid, at, 'heart-charm-pack');
    expect(again.statusCode, again.body).toBe(409);
    expect(errorOf(again).message).toMatch(/tomorrow/);
    expect(await purchases(at.mapId, kid)).toHaveLength(1);
    expect(await balanceOf(at.mapId, kid)).toBe(160);
    const card = (await shopOf(server, kid, at)).items.find((i) => i.id === 'heart-charm-pack');
    // Denver's midnight is 07:00 UTC.
    expect(card).toMatchObject({ status: 'capped', nextAt: '2026-11-05T07:00:00.000Z' });
    // 12:10 AM on the patch: a new day.
    clock.setTime(Date.parse('2026-11-05T07:10:00Z'));
    expect((await buy(server, kid, at, 'heart-charm-pack')).statusCode).toBe(200);
    expect(await purchases(at.mapId, kid)).toHaveLength(2);
  });

  it('a lure with one held is CONFLICT; a third lure in 7 patch days is CONFLICT; the 8th day allows it', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 1000);
    expect((await buy(server, kid, at, 'rare-lure')).statusCode).toBe(200);
    let shop = await shopOf(server, kid, at);
    expect(shop.lureHeld).toBe(true);
    expect(shop.items.find((i) => i.id === 'rare-lure')).toMatchObject({ status: 'held', left: 1 });
    const holding = await buy(server, kid, at, 'rare-lure');
    expect(holding.statusCode, holding.body).toBe(409);
    expect(errorOf(holding).message).toMatch(/already have a lure/);

    await useLure(at.mapId, kid);
    clock.setTime(Date.parse(START) + 2 * DAY_MS); // the 6th
    expect((await buy(server, kid, at, 'rare-lure')).statusCode).toBe(200);
    await useLure(at.mapId, kid);
    clock.setTime(Date.parse(START) + 6 * DAY_MS); // the 10th: the 4th is still in the week
    const third = await buy(server, kid, at, 'rare-lure');
    expect(third.statusCode, third.body).toBe(409);
    expect(errorOf(third).message).toMatch(/ready tomorrow/);
    shop = await shopOf(server, kid, at);
    expect(shop.lureHeld).toBe(false);
    expect(shop.items.find((i) => i.id === 'rare-lure')).toMatchObject({
      status: 'capped',
      left: 0,
      // The 4th's purchase drops out at the patch's midnight starting the 11th.
      nextAt: '2026-11-11T07:00:00.000Z',
    });
    clock.setTime(Date.parse(START) + 7 * DAY_MS); // the 11th
    expect((await buy(server, kid, at, 'rare-lure')).statusCode).toBe(200);
    expect(await balanceOf(at.mapId, kid)).toBe(1000 - 3 * priceOf('rare-lure'));
  });

  it('too few Heart Coins is CONFLICT with notEnough and no row', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, priceOf('rare-lure') - 1);
    const res = await buy(server, kid, at, 'rare-lure');
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res).message).toBe(HEART_COIN_MESSAGES.notEnough);
    expect(await purchases(at.mapId, kid)).toHaveLength(0);
    expect(await heartRows(at.mapId, kid)).toEqual([]);
  });

  it('a retried POST with the same Idempotency-Key replays the reply and charges once', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 300);
    const key = { 'idempotency-key': crypto.randomUUID() };
    const first = await buy(server, kid, at, 'rare-lure', key);
    const retry = await buy(server, kid, at, 'rare-lure', key);
    expect(first.statusCode, first.body).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(await purchases(at.mapId, kid)).toHaveLength(1);
    expect(await balanceOf(at.mapId, kid)).toBe(300 - priceOf('rare-lure'));
  });

  it('a replayed spend (same purchaseId) takes nothing twice', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 100);
    const spend = {
      source: 'shop' as const,
      refId: crypto.randomUUID(),
      mapId: at.mapId,
      userId: kid.id,
      amount: 40,
      at: clock,
    };
    expect(await withTransaction(db, (tx) => spendHeartCoins(tx, spend))).toBe(60);
    expect(await withTransaction(db, (tx) => spendHeartCoins(tx, spend))).toBe(60);
    expect(await heartRows(at.mapId, kid)).toEqual([
      { source: 'shop', refId: spend.refId, amount: -40 },
    ]);
  });

  it('a failed grant rolls back the spend and the purchase row', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 100);
    // A pack naming something the game doesn't have: `grantItems` refuses it.
    const shop = createPostShopService({
      db,
      clock: () => clock,
      shop: [
        {
          id: 'heart-charm-pack',
          price: 40,
          effect: { kind: 'items', items: { 'not-a-thing': 1 } },
          cap: { count: 1, per: 'day' },
        },
      ],
    });
    await expect(
      shop.buy(kid, at.mapId, { ...at.post, itemId: 'heart-charm-pack' }),
    ).rejects.toThrow();
    expect(await purchases(at.mapId, kid)).toHaveLength(0);
    expect(await heartRows(at.mapId, kid)).toEqual([]);
    expect(await balanceOf(at.mapId, kid)).toBe(100);
  });

  it('not at a post is NOT_FOUND; an unknown item is VALIDATION_FAILED', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 100);
    const home = { ...at, post: { q: at.seed.q, r: at.seed.r } };
    const notAPost = await buy(server, kid, home, 'rare-lure');
    expect(notAPost.statusCode, notAPost.body).toBe(404);
    const unknown = await buy(server, kid, at, 'golden-lure');
    expect(unknown.statusCode, unknown.body).toBe(400);
    expect(await purchases(at.mapId, kid)).toHaveLength(0);
  });

  it('the partial unique index holds one lure at a time even past the service', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 300);
    expect((await buy(server, kid, at, 'rare-lure')).statusCode).toBe(200);
    await expect(
      db.insert(postPurchases).values({
        mapId: at.mapId,
        userId: kid.id,
        itemId: 'rare-lure',
        price: 120,
        day: '2026-11-04',
        createdAt: clock,
      }),
    ).rejects.toThrow();
  });

  it('shows the Shop: prices, caps left and my balance', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 75);
    expect(await shopOf(server, kid, at)).toEqual({
      items: POST_SHOP.map((i) => ({
        id: i.id,
        price: i.price,
        left: i.cap.count,
        nextAt: null,
        status: 'buy',
      })),
      lureHeld: false,
      balance: 75,
    });
  });

  describe('lock order (tech spec §7)', () => {
    /** Holds `first`, starts the purchase, and once it waits on us takes `then` too. */
    async function holdThen(
      first: (tx: Transaction) => Promise<unknown>,
      command: () => Promise<LightMyRequestResponse>,
      then: (tx: Transaction) => Promise<unknown>,
    ): Promise<LightMyRequestResponse> {
      let running: Promise<LightMyRequestResponse> | undefined;
      await db.transaction(async (tx) => {
        await tx.execute(`set local lock_timeout = '10s'`);
        await first(tx);
        const pid = await backendPid(tx);
        running = command();
        await waitUntilBlockedBy(db, pid);
        await then(tx);
      });
      return running!;
    }

    it('a pack purchase takes bag rows (11) before the balance (12b)', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, 100);
      // The bag row exists, so the purchase's `lockGrantRows` waits on it.
      await withTransaction(db, async (tx) => {
        await tx.execute(
          `insert into inventories (map_id, user_id, item_id, quantity) values ('${at.mapId}', '${kid.id}', 'heart-charm', 0) on conflict do nothing`,
        );
      });
      const res = await holdThen(
        (tx) =>
          tx.execute(
            `select item_id from inventories where map_id = '${at.mapId}' and user_id = '${kid.id}' and item_id = 'heart-charm' for update`,
          ),
        () => buy(server, kid, at, 'heart-charm-pack'),
        (tx) => createHeartCoinsRepo(tx).lockBalance(at.mapId, kid.id),
      );
      expect(res.statusCode, res.body).toBe(200);
      expect(await purchases(at.mapId, kid)).toHaveLength(1);
    });

    it('two purchases at once take turns on the balance: one wins, the other is capped', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, 500);
      const [a, b] = await Promise.all([
        buy(server, kid, at, 'potion-crate'),
        buy(server, kid, at, 'potion-crate'),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      expect(await purchases(at.mapId, kid)).toHaveLength(1);
      expect(await balanceOf(at.mapId, kid)).toBe(500 - priceOf('potion-crate'));
    });
  });

  it('AppError is what a refusal throws (kid-readable)', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 0);
    const shop = createPostShopService({ db, clock: () => clock });
    await expect(shop.buy(kid, at.mapId, { ...at.post, itemId: 'rare-lure' })).rejects.toThrow(
      AppError,
    );
  });
});
