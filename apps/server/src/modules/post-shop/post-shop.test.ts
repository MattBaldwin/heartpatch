import {
  addFuel,
  ApiErrorSchema,
  BuyResponseSchema,
  fenceMaxHp,
  GAME_DATA,
  heartSeedOf,
  HOME_BASE_RULES,
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
import {
  buildings,
  fenceSegments,
  keepers,
  mapMembers,
  maps,
  postPurchases,
  sessions,
  users,
} from '../../db/schema.js';
import { backendPid, waitUntilBlockedBy } from '../../../tests/lock-waits.js';
import { AppError } from '../../lib/errors.js';
import { mapLocalTime } from '../../lib/time.js';
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
    const username = `post_buyer_${String((counter += 1))}`;
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

  it('a Tutorial Glade has no Shop: buying or looking is NOT_FOUND and charges nothing', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, 100);
    const [glade] = await db
      .insert(maps)
      .values({ kind: 'tutorial', name: 'Tutorial Glade', timeZone: 'UTC', maxPlayers: 1 })
      .returning({ id: maps.id });
    await db.insert(mapMembers).values({ mapId: glade!.id, userId: kid.id, role: 'owner' });
    const inGlade = { ...at, mapId: glade!.id };
    const refused = await buy(server, kid, inGlade, 'heart-charm-pack');
    expect(refused.statusCode, refused.body).toBe(404);
    const look = await call(
      server,
      'GET',
      `/maps/${glade!.id}/posts/shop?q=${String(at.post.q)}&r=${String(at.post.r)}`,
      kid,
    );
    expect(look.statusCode, look.body).toBe(404);
    expect(await purchases(glade!.id, kid)).toHaveLength(0);
    expect(await balanceOf(at.mapId, kid)).toBe(100);
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

  describe('lock order (tech spec §7)', () => {
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

  describe('Night supplies and the Fence patch kit (729b)', () => {
    const HEARTH = GAME_DATA.buildings.find((b) => b.id === 'hearthfire');
    const PALISADE = GAME_DATA.buildings.find((b) => b.id === 'emberwood-palisade');
    if (HEARTH?.kind !== 'hearthfire' || PALISADE?.kind !== 'fence') throw new Error('no data');
    const local = () => mapLocalTime(clock, 'America/Denver');
    /** The fuel date `nights` of fuel from empty reaches now. */
    const fuelled = (nights: number) => addFuel(HEARTH, null, local(), nights, HOME_BASE_RULES);

    /** Two tiles of the kid's land out of home (claiming neutral land if the way to the post is short). */
    async function landOf(mapId: string, kid: PublicUser) {
      const tiles = await db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
      const out = tiles.filter((t) => t.homeSlot === null && t.terrain !== 'trading-post');
      const mine = out.filter((t) => t.ownerUserId === kid.id);
      for (const t of out.filter((t) => t.ownerUserId === null).slice(0, 2 - mine.length)) {
        await db.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${t.id}'`);
        mine.push(t);
      }
      return mine.slice(0, 2);
    }
    async function fire(mapId: string, kid: PublicUser, tileId: string, fuel: string | null) {
      const [row] = await db
        .insert(buildings)
        .values({
          mapId,
          ownerUserId: kid.id,
          tileId,
          buildingId: 'hearthfire',
          kind: 'hearthfire',
          spot: 0,
          fuelledThrough: fuel,
        })
        .returning({ id: buildings.id });
      return row!.id;
    }
    const fuelOf = async (id: string) =>
      (await db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!.fuelledThrough;
    async function fence(
      mapId: string,
      owner: PublicUser,
      tileId: string,
      edge: number,
      hp: number,
    ) {
      const [row] = await db
        .insert(fenceSegments)
        .values({ mapId, ownerUserId: owner.id, tileId, edge, buildingId: PALISADE!.id, hp })
        .returning({ id: fenceSegments.id });
      return row!.id;
    }
    const hpOf = async (id: string) =>
      (await db.query.fenceSegments.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!.hp;
    const full = fenceMaxHp(PALISADE, 1);
    const eventsOf = async (mapId: string, type: string) =>
      (
        await db.query.gameEvents.findMany({
          where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, type)),
        })
      ).map((e) => e.payload as Record<string, unknown>);

    it('Night supplies adds 3 nights to each fire, only what fits, and charges 80 once', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, 200);
      const [a, b] = await landOf(at.mapId, kid);
      const empty = await fire(at.mapId, kid, a!.id, null);
      const nearlyFull = await fire(at.mapId, kid, b!.id, fuelled(HEARTH.maxFuelNights - 1));
      const res = await buy(server, kid, at, 'night-supplies');
      expect(res.statusCode, res.body).toBe(200);
      const body = BuyResponseSchema.parse(res.json());
      expect(body.bought).toEqual({
        itemId: 'night-supplies',
        price: 80,
        got: { kind: 'fuel-all', fires: 2, nights: 4 },
      });
      expect(body.balance).toBe(120);
      expect(await fuelOf(empty)).toBe(fuelled(3));
      expect(await fuelOf(nearlyFull)).toBe(fuelled(HEARTH.maxFuelNights));
      const [row] = await purchases(at.mapId, kid);
      expect(await heartRows(at.mapId, kid)).toEqual([
        { source: 'shop', refId: row!.id, amount: -80 },
      ]);
      // No fuel taken from the bag: it was paid for in Heart Coins.
      expect(await bag(at.mapId, kid)).toEqual({});
      const fueled = await eventsOf(at.mapId, 'building.fueled');
      expect(fueled.map((p) => p['nights']).sort()).toEqual([1, 3]);
      expect(await eventsOf(at.mapId, 'post.bought')).toHaveLength(1);
      // One a rolling week: the next day is still capped, with the supplies' words.
      clock.setTime(Date.parse(START) + DAY_MS);
      const again = await buy(server, kid, at, 'night-supplies');
      expect(again.statusCode, again.body).toBe(409);
      expect(errorOf(again).message).toBe("That's this week's supplies! More in 6 days. 🔥");
      expect(await balanceOf(at.mapId, kid)).toBe(120);
    });

    it('Night supplies with no fire, or every fire full, is CONFLICT and charges nothing', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, 200);
      const none = await buy(server, kid, at, 'night-supplies');
      expect(none.statusCode, none.body).toBe(409);
      expect(errorOf(none).message).toBe('No fires to stock yet 🔥');
      const [a] = await landOf(at.mapId, kid);
      const id = await fire(at.mapId, kid, a!.id, fuelled(HEARTH.maxFuelNights));
      const stocked = await buy(server, kid, at, 'night-supplies');
      expect(stocked.statusCode, stocked.body).toBe(409);
      expect(errorOf(stocked).message).toBe('Your fires are all stocked up! 🔥');
      expect(await fuelOf(id)).toBe(fuelled(HEARTH.maxFuelNights));
      expect(await purchases(at.mapId, kid)).toHaveLength(0);
      expect(await heartRows(at.mapId, kid)).toEqual([]);
      expect(await balanceOf(at.mapId, kid)).toBe(200);
    });

    it("Night supplies leaves another Keeper's fires on the same patch alone", async () => {
      const server = await start();
      const kid = await player();
      const rival = await player();
      const at = await patch(server, kid, 100);
      const [a, b] = await landOf(at.mapId, kid);
      // A rival on the same patch with an empty fire on a tile they hold.
      await db.insert(mapMembers).values({ mapId: at.mapId, userId: rival.id, role: 'member' });
      await db.execute(`update tiles set owner_user_id = '${rival.id}' where id = '${b!.id}'`);
      const mine = await fire(at.mapId, kid, a!.id, null);
      const notMine = await fire(at.mapId, rival, b!.id, null);
      const res = await buy(server, kid, at, 'night-supplies');
      expect(res.statusCode, res.body).toBe(200);
      expect(BuyResponseSchema.parse(res.json()).bought.got).toEqual({
        kind: 'fuel-all',
        fires: 1,
        nights: 3,
      });
      expect(await fuelOf(mine)).toBe(fuelled(3));
      expect(await fuelOf(notMine)).toBeNull();
    });

    it('a retried Night supplies (same Idempotency-Key) fuels and charges once', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, 200);
      const [a] = await landOf(at.mapId, kid);
      const id = await fire(at.mapId, kid, a!.id, null);
      const key = { 'idempotency-key': crypto.randomUUID() };
      const first = await buy(server, kid, at, 'night-supplies', key);
      const retry = await buy(server, kid, at, 'night-supplies', key);
      expect(first.statusCode, first.body).toBe(200);
      expect(retry.json()).toEqual(first.json());
      expect(await fuelOf(id)).toBe(fuelled(3));
      expect(await purchases(at.mapId, kid)).toHaveLength(1);
      expect(await balanceOf(at.mapId, kid)).toBe(120);
    });

    it('the Fence patch kit mends every worn fence of mine to full, leaves full ones, and charges 50', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, 100);
      const [a, b] = await landOf(at.mapId, kid);
      const worn = await fence(at.mapId, kid, a!.id, 0, 10);
      const alsoWorn = await fence(at.mapId, kid, b!.id, 3, full - 1);
      const fine = await fence(at.mapId, kid, a!.id, 1, full);
      const res = await buy(server, kid, at, 'fence-patch-kit');
      expect(res.statusCode, res.body).toBe(200);
      const body = BuyResponseSchema.parse(res.json());
      expect(body.bought.got).toEqual({ kind: 'repair-fences', fences: 2 });
      expect(body.balance).toBe(50);
      expect([await hpOf(worn), await hpOf(alsoWorn), await hpOf(fine)]).toEqual([
        full,
        full,
        full,
      ]);
      const repaired = await eventsOf(at.mapId, 'fence.repaired');
      expect(repaired).toHaveLength(2);
      expect(repaired.every((p) => JSON.stringify(p['cost']) === '{}')).toBe(true);
      // One a day.
      await db.execute(`update fence_segments set hp = 5 where map_id = '${at.mapId}'`);
      const again = await buy(server, kid, at, 'fence-patch-kit');
      expect(again.statusCode, again.body).toBe(409);
      expect(errorOf(again).message).toBe("That's today's! Come back tomorrow for another. 🌙");
      expect(await balanceOf(at.mapId, kid)).toBe(50);
    });

    it("the Fence patch kit with no fences, or none worn, is CONFLICT and charges nothing; a rival's stay worn", async () => {
      const server = await start();
      const kid = await player();
      const rival = await player();
      const at = await patch(server, kid, 100);
      const none = await buy(server, kid, at, 'fence-patch-kit');
      expect(none.statusCode, none.body).toBe(409);
      expect(errorOf(none).message).toBe('No fences to fix yet 🪵');
      const [a, b] = await landOf(at.mapId, kid);
      await fence(at.mapId, kid, a!.id, 0, full);
      // A rival's worn segment on the same patch (on a tile they hold) isn't mine to mend.
      await db.insert(mapMembers).values({ mapId: at.mapId, userId: rival.id, role: 'member' });
      await db.execute(`update tiles set owner_user_id = '${rival.id}' where id = '${b!.id}'`);
      const theirs = await fence(at.mapId, rival, b!.id, 2, 10);
      const fine = await buy(server, kid, at, 'fence-patch-kit');
      expect(fine.statusCode, fine.body).toBe(409);
      expect(errorOf(fine).message).toBe('Your fences are all fine! 🪵');
      expect(await hpOf(theirs)).toBe(10);
      expect(await purchases(at.mapId, kid)).toHaveLength(0);
      expect(await balanceOf(at.mapId, kid)).toBe(100);
    });
    it('the Fence patch kit skips my fence on a tile I no longer hold, and with only that one charges nothing', async () => {
      const server = await start();
      const kid = await player();
      const rival = await player();
      const at = await patch(server, kid, 100);
      const [a, b] = await landOf(at.mapId, kid);
      // My worn segment, then its tile goes to a rival.
      const lost = await fence(at.mapId, kid, b!.id, 2, 10);
      await db.insert(mapMembers).values({ mapId: at.mapId, userId: rival.id, role: 'member' });
      await db.execute(`update tiles set owner_user_id = '${rival.id}' where id = '${b!.id}'`);
      const only = await buy(server, kid, at, 'fence-patch-kit');
      expect(only.statusCode, only.body).toBe(409);
      expect(errorOf(only).message).toBe('No fences to fix yet 🪵');
      expect(await hpOf(lost)).toBe(10);
      expect(await purchases(at.mapId, kid)).toHaveLength(0);
      expect(await balanceOf(at.mapId, kid)).toBe(100);
      // With a worn one on land I hold, only that one is mended.
      const held = await fence(at.mapId, kid, a!.id, 0, 10);
      const res = await buy(server, kid, at, 'fence-patch-kit');
      expect(res.statusCode, res.body).toBe(200);
      expect(BuyResponseSchema.parse(res.json()).bought.got).toEqual({
        kind: 'repair-fences',
        fences: 1,
      });
      expect([await hpOf(held), await hpOf(lost)]).toEqual([full, 10]);
    });

    it('Night supplies takes my fires (8) before the balance (12b)', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, 100);
      const [a] = await landOf(at.mapId, kid);
      const id = await fire(at.mapId, kid, a!.id, null);
      const res = await holdThen(
        (tx) => tx.execute(`select id from buildings where id = '${id}' for update`),
        () => buy(server, kid, at, 'night-supplies'),
        (tx) => createHeartCoinsRepo(tx).lockBalance(at.mapId, kid.id),
      );
      expect(res.statusCode, res.body).toBe(200);
    });

    it('the Fence patch kit takes my tiles (6) and fences (8) before the balance (12b)', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, 100);
      const [a] = await landOf(at.mapId, kid);
      const id = await fence(at.mapId, kid, a!.id, 0, 10);
      const res = await holdThen(
        (tx) => tx.execute(`select id from fence_segments where id = '${id}' for update`),
        () => buy(server, kid, at, 'fence-patch-kit'),
        (tx) => createHeartCoinsRepo(tx).lockBalance(at.mapId, kid.id),
      );
      expect(res.statusCode, res.body).toBe(200);
      expect(await hpOf(id)).toBe(full);
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
