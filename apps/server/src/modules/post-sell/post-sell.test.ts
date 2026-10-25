import {
  ApiErrorSchema,
  CLOTHING_BY_ID,
  GLIMMER_SWAP,
  HEART_COIN_RULES,
  heartSeedOf,
  hexDistance,
  MapResponseSchema,
  SELL_RULES,
  SellBasketResponseSchema,
  SellResponseSchema,
  SellViewResponseSchema,
  type PublicUser,
  type SellLine,
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
  clothingOwned,
  keepers,
  mapMembers,
  sessions,
  tradeLines,
  tradeOffers,
  users,
} from '../../db/schema.js';
import { backendPid, waitUntilBlockedBy } from '../../../tests/lock-waits.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createHeartCoinsRepo } from '../heart-coins/repo.js';
import { grantItems } from '../inventory/service.js';
import { createPostSellService } from './service.js';

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
/** 10 AM in Denver, the patches' time zone. */
const START = '2026-11-04T17:00:00Z';
const CAP = HEART_COIN_RULES.dailyCaps.sell;
const TIMBER = SELL_RULES.items['timber']!;
/** A tradable piece, and a milestone's account-bound one. */
const BEANIE = 'pom-pom-beanie';
/** Another tradable piece, of a different rarity. */
const CROWN = 'flower-crown';
const MILESTONE_HAT = 'explorers-hat';

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('selling to the trading post (#601 PR 3, needs DATABASE_URL)', () => {
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
    const username = `seller_${String((counter += 1))}`;
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
  const viewOf = async (server: FastifyInstance, kid: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/posts/sell`, kid);
    expect(res.statusCode, res.body).toBe(200);
    return SellViewResponseSchema.parse(res.json()).sell;
  };

  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });

  /** The kid's nearest post; `join` claims the neutral tiles on the straight way to it (#270's test path). */
  async function nearestPost(mapId: string, kid: PublicUser, join: boolean) {
    const tiles = await tilesOf(mapId);
    const seed = heartSeedOf(tiles.filter((t) => t.ownerUserId === kid.id && t.homeSlot !== null))!;
    const posts = tiles.filter((t) => t.terrain === 'trading-post');
    const post = [...posts].sort((a, b) => hexDistance(seed, a) - hexDistance(seed, b))[0]!;
    const reach = hexDistance(seed, post);
    if (join) {
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
    }
    return { q: post.q, r: post.r };
  }

  /** A patch of the kid's with `items` in the bag; `join` connects their land to a post. */
  async function patch(
    server: FastifyInstance,
    kid: Player,
    items: Record<string, number>,
    join = true,
  ) {
    const res = await call(server, 'POST', '/maps', kid, {
      name: `Sell Patch ${String(counter)}`,
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const mapId = MapResponseSchema.parse(res.json()).map.id;
    if (Object.keys(items).length > 0) {
      await withTransaction(db, (tx) =>
        grantItems(tx, { mapId, userId: kid.id }, items, 'dev-grant'),
      );
    }
    return { mapId, post: await nearestPost(mapId, kid, join) };
  }

  const sell = (
    server: FastifyInstance,
    kid: Player,
    mapId: string,
    body: object,
    headers: Record<string, string> = {},
  ) => call(server, 'POST', `/maps/${mapId}/posts/sell`, kid, body, headers);
  const sellLots = (
    server: FastifyInstance,
    kid: Player,
    at: { mapId: string; post: { q: number; r: number } },
    itemId: string,
    lots: number,
    headers: Record<string, string> = {},
  ) => sell(server, kid, at.mapId, { ...at.post, kind: 'item', itemId, lots }, headers);
  const sellPiece = (
    server: FastifyInstance,
    kid: Player,
    at: { mapId: string; post: { q: number; r: number } },
    itemId: string,
  ) => sell(server, kid, at.mapId, { ...at.post, kind: 'clothing', itemId });

  const bag = async (mapId: string, kid: PublicUser) => {
    const rows = await db.query.inventories.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
    });
    return Object.fromEntries(
      rows.filter((r) => r.quantity > 0).map((r) => [r.itemId, r.quantity]),
    );
  };
  const saleItemRows = (mapId: string) =>
    db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'post-sell')),
    });
  const heartRows = async (mapId: string, kid: PublicUser) =>
    (
      await db.query.heartCoinLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
        orderBy: (t, { asc }) => asc(t.createdAt),
      })
    ).map((r) => ({ source: r.source, refId: r.refId, amount: r.amount }));
  const pieces = async (kid: PublicUser, itemId: string) =>
    (
      await db.query.clothingOwned.findMany({
        where: (t, { and, eq }) => and(eq(t.userId, kid.id), eq(t.itemId, itemId)),
        orderBy: (t, { asc }) => asc(t.id),
      })
    ).map((p) => ({ id: p.id, heldByOfferId: p.heldByOfferId }));
  /** Holds piece `id` for `offerId`, or frees it (null). */
  const holdPiece = (id: string, offerId: string | null) =>
    db.execute(
      `update clothing_owned set held_by_offer_id = ${offerId ? `'${offerId}'` : 'null'} where id = '${id}'`,
    );
  /** Hands the kid `n` pieces of a clothing item, oldest first. */
  async function givePieces(kid: PublicUser, itemId: string, n: number) {
    for (let i = 0; i < n; i += 1) {
      await db.insert(clothingOwned).values({
        userId: kid.id,
        itemId,
        source: 'dev-grant',
        acquiredAt: new Date(Date.parse(START) + i),
      });
    }
    return pieces(kid, itemId);
  }
  /** A trade offer on the patch, with no lines yet. */
  async function offerOn(
    mapId: string,
    from: PublicUser,
    to: PublicUser,
    status: 'open' | 'declined',
  ) {
    const [row] = await db
      .insert(tradeOffers)
      .values({
        mapId,
        kind: 'trade',
        fromUserId: from.id,
        toUserId: to.id,
        status,
        createdAt: clock,
        expiresAt: new Date(clock.getTime() + DAY_MS),
      })
      .returning({ id: tradeOffers.id });
    return row!.id;
  }
  const sellBasket = (
    server: FastifyInstance,
    kid: Player,
    at: { mapId: string; post: { q: number; r: number } },
    lines: SellLine[],
    headers: Record<string, string> = {},
  ) => sell(server, kid, at.mapId, { ...at.post, kind: 'basket', lines }, headers);
  /** Item ids of the kid's pieces, oldest first. */
  const pieceIds = async (kid: PublicUser, itemId: string) =>
    (await pieces(kid, itemId)).map((p) => p.id);
  /** The kid's keep for an item, from the Sell tab. */
  const keepOf = async (server: FastifyInstance, kid: Player, mapId: string, itemId: string) =>
    (await viewOf(server, kid, mapId)).items.find((i) => i.itemId === itemId)?.keep ?? 0;

  it('sells whole lots for Heart Coins, taking and paying once against the sale', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, { timber: 40, shovel: 3 });
    const keep = await keepOf(server, kid, at.mapId, 'timber');
    expect(keep).toBeGreaterThan(0); // the Heart Charm's page is always open

    const before = await viewOf(server, kid, at.mapId);
    expect(before).toMatchObject({ balance: 0, soldToday: 0, cap: CAP, clothing: [] });
    // The patch's day ends at midnight in Denver (MST after Nov 1: UTC−7).
    expect(before.resetsAt).toBe('2026-11-05T07:00:00.000Z');
    // Only what the post buys: never the Shovel.
    expect(before.items.map((i) => i.itemId)).toEqual(['timber']);

    const res = await sellLots(server, kid, at, 'timber', 3);
    expect(res.statusCode, res.body).toBe(200);
    const sold = SellResponseSchema.parse(res.json());
    // A legacy one-line request (#655) answers in the legacy shape, not a basket's.
    expect((res.json() as { sold: object }).sold).toEqual({
      kind: 'item',
      itemId: 'timber',
      quantity: 3 * TIMBER.lot,
      coins: 3 * TIMBER.coins,
    });
    expect(sold.sell).toMatchObject({ balance: 3 * TIMBER.coins, soldToday: 3 * TIMBER.coins });
    expect(await bag(at.mapId, kid)).toEqual({ timber: 40 - 3 * TIMBER.lot, shovel: 3 });

    // One sale: the Timber and the Heart Coins, ledgered against the same id at the game's clock.
    const items = await saleItemRows(at.mapId);
    expect(items.map((r) => [r.itemId, r.delta])).toEqual([['timber', -3 * TIMBER.lot]]);
    expect(items[0]!.createdAt.getTime()).toBe(clock.getTime());
    expect(await heartRows(at.mapId, kid)).toEqual([
      { source: 'sell', refId: items[0]!.refId, amount: 3 * TIMBER.coins },
    ]);
  });

  it("keeps an open recipe's worth, refuses what the post doesn't buy, and moves nothing short", async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, { timber: 30, heartdust: 4, shovel: 2, greens: 2 });
    const keep = await keepOf(server, kid, at.mapId, 'timber');
    // Bag down to the keep plus a part lot: one more lot would dip below it.
    const spare = 30 - keep;
    const lots = Math.floor(spare / TIMBER.lot);
    expect(30).toBeGreaterThanOrEqual((lots + 1) * TIMBER.lot); // enough, just not with the keep
    const tooMany = await sellLots(server, kid, at, 'timber', lots + 1);
    expect(tooMany.statusCode).toBe(409);
    expect(errorOf(tooMany).message).toBe(
      `Hang on to ${String(keep)} Timber for your recipes! Try selling a little less.`,
    );
    for (const itemId of ['heartdust', 'shovel', 'jack-o-lantern-hearthfire', 'witch-dust']) {
      const res = await sellLots(server, kid, at, itemId, 1);
      expect(res.statusCode, itemId).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
    }
    const short = await sellLots(server, kid, at, 'greens', 1);
    expect(short.statusCode).toBe(409);
    expect(errorOf(short).message).toMatch(/more Greens/);
    expect(await bag(at.mapId, kid)).toEqual({ timber: 30, heartdust: 4, shovel: 2, greens: 2 });
    expect(await heartRows(at.mapId, kid)).toEqual([]);

    // Exactly down to the keep is fine.
    expect((await sellLots(server, kid, at, 'timber', lots)).statusCode).toBe(200);
    expect((await bag(at.mapId, kid))['timber']).toBe(30 - lots * TIMBER.lot);
  });

  it('stops at the day’s cap before anything moves, and sells again on the next patch day', async () => {
    const server = await start();
    const kid = await player();
    const lotsToCap = CAP / TIMBER.coins;
    const at = await patch(server, kid, { timber: TIMBER.lot * (lotsToCap + 4) + 10 });
    // Up to one lot short of the cap, in sales the request allows (at most 100 lots).
    for (let left = lotsToCap - 1; left > 0; left -= 100) {
      expect((await sellLots(server, kid, at, 'timber', Math.min(left, 100))).statusCode).toBe(200);
    }
    // Two lots would pass the cap by one: refused whole, not sold in part.
    const over = await sellLots(server, kid, at, 'timber', 2);
    expect(over.statusCode).toBe(409);
    expect(errorOf(over).message).toBe("Some of that won't fit today. Let's look again!");
    expect((await sellLots(server, kid, at, 'timber', 1)).statusCode).toBe(200);
    const done = await sellLots(server, kid, at, 'timber', 1);
    expect(done.statusCode).toBe(409);
    expect(errorOf(done).message).toBe("You've sold enough for today! Come back tomorrow. 🌙");
    const capped = await viewOf(server, kid, at.mapId);
    expect(capped).toMatchObject({ balance: CAP, soldToday: CAP });
    expect(capped.items[0]!.have).toBe(TIMBER.lot * 4 + 10);

    // 11:30 PM in Denver: still today. Just past midnight: a new day.
    clock.setTime(Date.parse('2026-11-05T06:30:00Z'));
    expect((await sellLots(server, kid, at, 'timber', 1)).statusCode).toBe(409);
    clock.setTime(Date.parse('2026-11-05T07:00:01Z'));
    expect((await viewOf(server, kid, at.mapId)).soldToday).toBe(0);
    expect((await sellLots(server, kid, at, 'timber', 1)).statusCode).toBe(200);
  });

  it('sells a spare piece of clothing, never the last free copy or an account-bound one', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, {});
    const [first, second, third] = await givePieces(kid, BEANIE, 3);
    await givePieces(kid, MILESTONE_HAT, 2);
    expect(CLOTHING_BY_ID.get(MILESTONE_HAT)?.tradable).toBe(false);

    // The milestone's hats aren't listed even with two.
    expect((await viewOf(server, kid, at.mapId)).clothing).toEqual([{ itemId: BEANIE, copies: 3 }]);
    const hat = await sellPiece(server, kid, at, MILESTONE_HAT);
    expect(hat.statusCode).toBe(400);
    expect(errorOf(hat).message).toBe("The post doesn't buy that one. It's a keeper!");

    const coins = SELL_RULES.clothing[CLOTHING_BY_ID.get(BEANIE)!.rarity];
    const res = await sellPiece(server, kid, at, BEANIE);
    expect(res.statusCode, res.body).toBe(200);
    expect(SellResponseSchema.parse(res.json()).sold).toEqual({
      kind: 'clothing',
      itemId: BEANIE,
      quantity: 1,
      coins,
    });
    // The newest spare goes; the first one stays.
    expect((await pieces(kid, BEANIE)).map((p) => p.id)).toEqual([first!.id, second!.id]);
    expect(third).toBeDefined();
    expect((await sellPiece(server, kid, at, BEANIE)).statusCode).toBe(200);
    const last = await sellPiece(server, kid, at, BEANIE);
    expect(last.statusCode).toBe(409);
    expect(errorOf(last).message).toBe("That's your only one! The post only takes spares.");
    expect((await pieces(kid, BEANIE)).map((p) => p.id)).toEqual([first!.id]);
    expect((await heartRows(at.mapId, kid)).map((r) => r.amount)).toEqual([coins, coins]);
    expect((await viewOf(server, kid, at.mapId)).clothing).toEqual([]);
  });

  it('keeps a piece held in an offer, or named by an open offer, out of the sale', async () => {
    const server = await start();
    const kid = await player();
    const mate = await player();
    const at = await patch(server, kid, {});
    await db.insert(mapMembers).values({ mapId: at.mapId, userId: mate.id, role: 'member' });
    const [a, b, c] = await givePieces(kid, BEANIE, 3);
    const offer = (from: PublicUser, to: PublicUser, status: 'open' | 'declined') =>
      offerOn(at.mapId, from, to, status);
    // Mine, held for an offer I sent: not free.
    const held = await offer(kid, mate, 'open');
    await db
      .insert(tradeLines)
      .values({ offerId: held, side: 'give', kind: 'clothing', clothingId: c!.id });
    await holdPiece(c!.id, held);
    // The newest free one, which a patch-mate's open offer wants.
    const wants = await offer(mate, kid, 'open');
    await db
      .insert(tradeLines)
      .values({ offerId: wants, side: 'want', kind: 'clothing', clothingId: b!.id });
    // An old answered offer that named the oldest: history only.
    const old = await offer(mate, kid, 'declined');
    await db
      .insert(tradeLines)
      .values({ offerId: old, side: 'want', kind: 'clothing', clothingId: a!.id });

    expect((await viewOf(server, kid, at.mapId)).clothing).toEqual([{ itemId: BEANIE, copies: 2 }]);
    expect((await sellPiece(server, kid, at, BEANIE)).statusCode).toBe(200);
    // The wanted one stays for its offer; the old offer's line just loses its piece.
    expect((await pieces(kid, BEANIE)).map((p) => p.id)).toEqual([b!.id, c!.id]);
    const oldLines = await db.query.tradeLines.findMany({
      where: (t, { eq }) => eq(t.offerId, old),
    });
    expect(oldLines.map((l) => l.clothingId)).toEqual([null]);

    // One free piece left (and it's wanted): the last free copy stays.
    expect((await sellPiece(server, kid, at, BEANIE)).statusCode).toBe(409);
    // Two free pieces, both wanted: nothing to sell.
    await holdPiece(c!.id, null);
    await db
      .insert(tradeLines)
      .values({ offerId: wants, side: 'want', kind: 'clothing', clothingId: c!.id });
    const wanted = await sellPiece(server, kid, at, BEANIE);
    expect(wanted.statusCode).toBe(409);
    expect(errorOf(wanted).message).toBe(
      'A patch-mate asked for that one in a trade! Answer their offer first.',
    );
    expect((await pieces(kid, BEANIE)).length).toBe(2);
  });

  it('needs a post the kid can use, a member of the patch, and not the Glade', async () => {
    const server = await start();
    const kid = await player();
    const stranger = await player();
    const at = await patch(server, kid, { timber: 30 }, false);
    expect((await sellLots(server, kid, at, 'timber', 1)).statusCode).toBe(403);
    const notPost = (await tilesOf(at.mapId)).find((t) => t.terrain !== 'trading-post')!;
    const notAPost = await sellLots(
      server,
      kid,
      { ...at, post: { q: notPost.q, r: notPost.r } },
      'timber',
      1,
    );
    expect(notAPost.statusCode).toBe(404);
    expect((await sellLots(server, stranger, at, 'timber', 1)).statusCode).toBe(404);
    expect((await call(server, 'GET', `/maps/${at.mapId}/posts/sell`, stranger)).statusCode).toBe(
      404,
    );
    await db.execute(`update maps set kind = 'tutorial' where id = '${at.mapId}'`);
    expect((await call(server, 'GET', `/maps/${at.mapId}/posts/sell`, kid)).statusCode).toBe(404);
    expect(await bag(at.mapId, kid)).toEqual({ timber: 30 });
  });

  it('replays a retried sale with the same Idempotency-Key instead of selling twice', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, { stone: 30 });
    const headers = { 'idempotency-key': 'sell-it-once' };
    const first = await sellLots(server, kid, at, 'stone', 2, headers);
    const again = await sellLots(server, kid, at, 'stone', 2, headers);
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json()).toEqual(first.json());
    const stone = SELL_RULES.items['stone']!;
    expect(await bag(at.mapId, kid)).toEqual({ stone: 30 - 2 * stone.lot });
    expect(await heartRows(at.mapId, kid)).toHaveLength(1);
  });

  it('never passes the cap, oversells or sells the last copy when taps race', async () => {
    const server = await start();
    const kid = await player();
    // Ten taps reach the cap, so twelve stay under the per-player rate limit.
    const lotsPerTap = CAP / (10 * TIMBER.coins);
    const taps = CAP / (lotsPerTap * TIMBER.coins) + 2;
    const at = await patch(server, kid, { timber: TIMBER.lot * lotsPerTap * taps + 10 });
    const results = await Promise.all(
      Array.from({ length: taps }, () => sellLots(server, kid, at, 'timber', lotsPerTap)),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 200)).toHaveLength(taps - 2);
    expect(codes.filter((c) => c === 409)).toHaveLength(2);
    expect((await viewOf(server, kid, at.mapId)).balance).toBe(CAP);
    expect((await bag(at.mapId, kid))['timber']).toBe(TIMBER.lot * lotsPerTap * 2 + 10);

    // Three copies, five taps: two sell, the last copy stays.
    await givePieces(kid, BEANIE, 3);
    clock.setTime(Date.parse('2026-11-05T08:00:00Z')); // a new day, room under the cap
    const pieceTaps = await Promise.all(
      Array.from({ length: 5 }, () => sellPiece(server, kid, at, BEANIE)),
    );
    expect(pieceTaps.filter((r) => r.statusCode === 200)).toHaveLength(2);
    expect(await pieces(kid, BEANIE)).toHaveLength(1);
  });

  it('shares nothing with the Glimmer swap', async () => {
    const server = await start();
    const kid = await player();
    const at = await patch(server, kid, { stone: 200, glimmer: 3 });
    for (let i = 0; i < GLIMMER_SWAP.dailyCap / GLIMMER_SWAP.get; i += 1) {
      const swap = await call(server, 'POST', `/maps/${at.mapId}/glimmer-swap`, kid, {
        ...at.post,
        itemId: 'stone',
      });
      expect(swap.statusCode, swap.body).toBe(200);
    }
    // Swapped out for the day, still free to sell; selling Glimmer doesn't count as a swap.
    expect((await sellLots(server, kid, at, 'stone', 2)).statusCode).toBe(200);
    expect((await sellLots(server, kid, at, 'glimmer', 1)).statusCode).toBe(200);
    const swapView = await call(server, 'GET', `/maps/${at.mapId}/glimmer-swap`, kid);
    expect(swapView.json()).toMatchObject({ swap: { swappedToday: GLIMMER_SWAP.dailyCap } });
    expect((await viewOf(server, kid, at.mapId)).soldToday).toBe(
      2 * SELL_RULES.items['stone']!.coins + SELL_RULES.items['glimmer']!.coins,
    );
  });

  describe('baskets (#655)', () => {
    const priceOf = (itemId: string) => SELL_RULES.clothing[CLOTHING_BY_ID.get(itemId)!.rarity];
    const STONE = SELL_RULES.items['stone']!;

    it('a basket sells every line and pays once against the sale id', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, { timber: 40, stone: 30 });
      const [beanie] = await givePieces(kid, BEANIE, 3);
      const [crown] = await givePieces(kid, CROWN, 4);
      const lines: SellLine[] = [
        { kind: 'item', itemId: 'timber', lots: 2 },
        { kind: 'item', itemId: 'stone', lots: 1 },
        { kind: 'clothing', itemId: BEANIE, count: 2 },
        { kind: 'clothing', itemId: CROWN, count: 3 },
      ];
      const res = await sellBasket(server, kid, at, lines);
      expect(res.statusCode, res.body).toBe(200);
      const { sold, sell } = SellBasketResponseSchema.parse(res.json());
      const coins = 2 * TIMBER.coins + STONE.coins + 2 * priceOf(BEANIE) + 3 * priceOf(CROWN);
      expect(sold).toEqual({
        lines: [
          { kind: 'item', itemId: 'timber', quantity: 2 * TIMBER.lot, coins: 2 * TIMBER.coins },
          { kind: 'item', itemId: 'stone', quantity: STONE.lot, coins: STONE.coins },
          { kind: 'clothing', itemId: BEANIE, quantity: 2, coins: 2 * priceOf(BEANIE) },
          { kind: 'clothing', itemId: CROWN, quantity: 3, coins: 3 * priceOf(CROWN) },
        ],
        quantity: 2 * TIMBER.lot + STONE.lot + 5,
        coins,
      });
      expect(sell).toMatchObject({ balance: coins, soldToday: coins, clothing: [] });
      expect(await bag(at.mapId, kid)).toEqual({
        timber: 40 - 2 * TIMBER.lot,
        stone: 30 - STONE.lot,
      });
      // The first of each stays.
      expect(await pieceIds(kid, BEANIE)).toEqual([beanie!.id]);
      expect(await pieceIds(kid, CROWN)).toEqual([crown!.id]);
      // One sale: a resource ledger row per item and one Heart Coin row, all on the sale id.
      const items = await saleItemRows(at.mapId);
      expect(items.map((r) => [r.itemId, r.delta]).sort()).toEqual([
        ['stone', -STONE.lot],
        ['timber', -2 * TIMBER.lot],
      ]);
      expect(new Set(items.map((r) => r.refId)).size).toBe(1);
      expect(await heartRows(at.mapId, kid)).toEqual([
        { source: 'sell', refId: items[0]!.refId, amount: coins },
      ]);
    });

    it('a basket that passes the cap moves nothing', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, { timber: 2000, stone: 300 });
      await givePieces(kid, BEANIE, 3);
      // More than a whole day pays: refused before the transaction.
      const huge = await sellBasket(server, kid, at, [
        { kind: 'item', itemId: 'timber', lots: 100 },
        { kind: 'item', itemId: 'stone', lots: CAP / STONE.coins - 100 / STONE.coins + 1 },
      ]);
      expect(huge.statusCode).toBe(400);
      expect(errorOf(huge)).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: "Some of that won't fit today. Let's look again!",
      });
      // Up to 3 coins of room.
      const lots = (CAP - 3) / TIMBER.coins;
      for (let left = lots; left > 0; left -= 100) {
        const res = await sellLots(server, kid, at, 'timber', Math.min(left, 100));
        expect(res.statusCode, res.body).toBe(200);
      }
      const timber = (await bag(at.mapId, kid))['timber'];
      // 1 + 2 × 2 = 5 coins in 3 coins of room: nothing goes, not even the part that fits.
      const over = await sellBasket(server, kid, at, [
        { kind: 'item', itemId: 'timber', lots: 1 },
        { kind: 'clothing', itemId: BEANIE, count: 2 },
      ]);
      expect(over.statusCode).toBe(409);
      expect(errorOf(over).message).toBe("Some of that won't fit today. Let's look again!");
      expect((await bag(at.mapId, kid))['timber']).toBe(timber);
      expect(await pieces(kid, BEANIE)).toHaveLength(3);
      expect((await viewOf(server, kid, at.mapId)).soldToday).toBe(CAP - 3);
      // Exactly the room fits; then the day is done.
      const fits = await sellBasket(server, kid, at, [
        { kind: 'item', itemId: 'timber', lots: 3 - priceOf(BEANIE) },
        { kind: 'clothing', itemId: BEANIE, count: 1 },
      ]);
      expect(fits.statusCode, fits.body).toBe(200);
      const done = await sellBasket(server, kid, at, [{ kind: 'item', itemId: 'stone', lots: 1 }]);
      expect(done.statusCode).toBe(409);
      expect(errorOf(done).message).toBe("You've sold enough for today! Come back tomorrow. 🌙");
      expect((await viewOf(server, kid, at.mapId)).soldToday).toBe(CAP);
    });

    it('a basket never leaves fewer than one free copy of a piece, across lines', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, { timber: 30 });
      await givePieces(kid, BEANIE, 3);
      await givePieces(kid, CROWN, 2);
      for (const lines of [
        [{ kind: 'clothing', itemId: BEANIE, count: 3 }],
        [
          { kind: 'item', itemId: 'timber', lots: 1 },
          { kind: 'clothing', itemId: BEANIE, count: 2 },
          { kind: 'clothing', itemId: CROWN, count: 2 },
        ],
      ] satisfies SellLine[][]) {
        const res = await sellBasket(server, kid, at, lines);
        expect(res.statusCode).toBe(409);
        expect(errorOf(res).message).toBe("That's your only one! The post only takes spares.");
      }
      expect(await bag(at.mapId, kid)).toEqual({ timber: 30 });
      expect(await pieces(kid, BEANIE)).toHaveLength(3);
      expect(await pieces(kid, CROWN)).toHaveLength(2);
      expect(await heartRows(at.mapId, kid)).toEqual([]);
      const ok = await sellBasket(server, kid, at, [
        { kind: 'clothing', itemId: BEANIE, count: 2 },
        { kind: 'clothing', itemId: CROWN, count: 1 },
      ]);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(await pieces(kid, BEANIE)).toHaveLength(1);
      expect(await pieces(kid, CROWN)).toHaveLength(1);
    });

    it('pieces held by, or named in, an open offer are skipped and a short line refuses the basket', async () => {
      const server = await start();
      const kid = await player();
      const mate = await player();
      const at = await patch(server, kid, { timber: 30 });
      await db.insert(mapMembers).values({ mapId: at.mapId, userId: mate.id, role: 'member' });
      const [a, b, c, d] = await givePieces(kid, BEANIE, 4);
      // c is held for my offer; a patch-mate's open offer wants b and d.
      const mine = await offerOn(at.mapId, kid, mate, 'open');
      await db
        .insert(tradeLines)
        .values({ offerId: mine, side: 'give', kind: 'clothing', clothingId: c!.id });
      await holdPiece(c!.id, mine);
      const wants = await offerOn(at.mapId, mate, kid, 'open');
      await db.insert(tradeLines).values([
        { offerId: wants, side: 'want', kind: 'clothing', clothingId: b!.id },
        { offerId: wants, side: 'want', kind: 'clothing', clothingId: d!.id },
      ]);
      // Three free, so two could go without the last copy, but only a is free to sell.
      const short = await sellBasket(server, kid, at, [
        { kind: 'item', itemId: 'timber', lots: 1 },
        { kind: 'clothing', itemId: BEANIE, count: 2 },
      ]);
      expect(short.statusCode).toBe(409);
      expect(errorOf(short).message).toBe(
        'A patch-mate asked for that one in a trade! Answer their offer first.',
      );
      expect(await bag(at.mapId, kid)).toEqual({ timber: 30 });
      expect(await pieces(kid, BEANIE)).toHaveLength(4);
      const one = await sellBasket(server, kid, at, [
        { kind: 'item', itemId: 'timber', lots: 1 },
        { kind: 'clothing', itemId: BEANIE, count: 1 },
      ]);
      expect(one.statusCode, one.body).toBe(200);
      expect(await pieceIds(kid, BEANIE)).toEqual([b!.id, c!.id, d!.id]);
    });

    it('the keep holds per item inside a basket', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, { timber: 30, stone: 30 });
      const keep = await keepOf(server, kid, at.mapId, 'timber');
      const lots = Math.floor((30 - keep) / TIMBER.lot);
      const res = await sellBasket(server, kid, at, [
        { kind: 'item', itemId: 'stone', lots: 1 },
        { kind: 'item', itemId: 'timber', lots: lots + 1 },
      ]);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).message).toBe(
        `Hang on to ${String(keep)} Timber for your recipes! Try selling a little less.`,
      );
      expect(await bag(at.mapId, kid)).toEqual({ timber: 30, stone: 30 });
      const ok = await sellBasket(server, kid, at, [
        { kind: 'item', itemId: 'stone', lots: 1 },
        { kind: 'item', itemId: 'timber', lots },
      ]);
      expect(ok.statusCode, ok.body).toBe(200);
    });

    it('a duplicate line is VALIDATION_FAILED before the transaction', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, { timber: 30, shovel: 2 });
      await givePieces(kid, BEANIE, 3);
      await givePieces(kid, MILESTONE_HAT, 2);
      const twice: SellLine[] = [
        { kind: 'item', itemId: 'timber', lots: 1 },
        { kind: 'item', itemId: 'timber', lots: 1 },
      ];
      // The route's schema refuses it; the service checks too.
      const res = await sellBasket(server, kid, at, twice);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_FAILED');
      const service = createPostSellService({ db, clock: () => clock });
      await expect(
        service.sellBasket(kid, at.mapId, { kind: 'basket', ...at.post, lines: twice }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      // One line the post won't buy refuses the lot.
      for (const bad of [
        { kind: 'item', itemId: 'shovel', lots: 1 },
        { kind: 'clothing', itemId: MILESTONE_HAT, count: 1 },
      ] satisfies SellLine[]) {
        const refused = await sellBasket(server, kid, at, [
          { kind: 'clothing', itemId: BEANIE, count: 1 },
          bad,
        ]);
        expect(refused.statusCode).toBe(400);
        expect(errorOf(refused).message).toBe("The post doesn't buy that one. It's a keeper!");
      }
      expect(await bag(at.mapId, kid)).toEqual({ timber: 30, shovel: 2 });
      expect(await pieces(kid, BEANIE)).toHaveLength(3);
      expect(await heartRows(at.mapId, kid)).toEqual([]);
    });

    it('the same Idempotency-Key replays the basket reply without a second ledger row', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, { stone: 30 });
      await givePieces(kid, BEANIE, 3);
      const headers = { 'idempotency-key': 'basket-once' };
      const lines: SellLine[] = [
        { kind: 'item', itemId: 'stone', lots: 2 },
        { kind: 'clothing', itemId: BEANIE, count: 1 },
      ];
      const first = await sellBasket(server, kid, at, lines, headers);
      const again = await sellBasket(server, kid, at, lines, headers);
      expect(first.statusCode, first.body).toBe(200);
      expect(again.statusCode).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.json()).toEqual(first.json());
      expect(await bag(at.mapId, kid)).toEqual({ stone: 30 - 2 * STONE.lot });
      expect(await pieces(kid, BEANIE)).toHaveLength(2);
      expect(await heartRows(at.mapId, kid)).toHaveLength(1);
    });

    it('racing baskets from two devices never oversell, over-pay or sell the last copy', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, { timber: 2000 });
      await givePieces(kid, BEANIE, 4);
      // Four copies: only one basket can take two and still leave one.
      const withPieces: SellLine[] = [
        { kind: 'item', itemId: 'timber', lots: 10 },
        { kind: 'clothing', itemId: BEANIE, count: 2 },
      ];
      const first = await Promise.all(
        Array.from({ length: 5 }, () => sellBasket(server, kid, at, withPieces)),
      );
      expect(first.filter((r) => r.statusCode === 200)).toHaveLength(1);
      expect(first.filter((r) => r.statusCode === 409)).toHaveLength(4);
      expect(await pieces(kid, BEANIE)).toHaveLength(2);
      // Then the cap: 30-lot baskets in what's left of the day's room.
      const sold = 10 * TIMBER.coins + 2 * priceOf(BEANIE);
      const room = CAP - sold;
      const fit = Math.floor(room / (30 * TIMBER.coins));
      const taps = await Promise.all(
        Array.from({ length: fit + 2 }, () =>
          sellBasket(server, kid, at, [{ kind: 'item', itemId: 'timber', lots: 30 }]),
        ),
      );
      expect(taps.filter((r) => r.statusCode === 200)).toHaveLength(fit);
      const balance = sold + fit * 30 * TIMBER.coins;
      expect((await viewOf(server, kid, at.mapId)).balance).toBe(balance);
      expect(await heartRows(at.mapId, kid)).toHaveLength(1 + fit);
      expect((await bag(at.mapId, kid))['timber']).toBe(2000 - (10 + 30 * fit) * TIMBER.lot);
    });
  });

  describe('lock order (tech spec §7)', () => {
    /** Holds `first`, starts the sale, and once it waits on us takes `then` too. */
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
    // Ids from this test's own rows and data, so inlining them is safe.
    const lockBag = (tx: Transaction, mapId: string, kid: PublicUser, itemId: string) =>
      tx.execute(
        `select item_id from inventories where map_id = '${mapId}' and user_id = '${kid.id}' and item_id = '${itemId}' for update`,
      );
    const lockPieces = (tx: Transaction, kid: PublicUser, itemId: string) =>
      tx.execute(
        `select id from clothing_owned where user_id = '${kid.id}' and item_id = '${itemId}' order by id for update`,
      );
    const lockHeart = (tx: Transaction, mapId: string, kid: PublicUser) =>
      createHeartCoinsRepo(tx).lockBalance(mapId, kid.id);

    it('takes the bag row before the Heart Coin balance (post-sell `sell`, #601 step 11 then 12b)', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, { timber: 30 });
      const res = await holdThen(
        (tx) => lockBag(tx, at.mapId, kid, 'timber'),
        () => sellLots(server, kid, at, 'timber', 1),
        (tx) => lockHeart(tx, at.mapId, kid),
      );
      expect(res.statusCode, res.body).toBe(200);
      expect(await heartRows(at.mapId, kid)).toHaveLength(1);
    });

    it('takes the pieces before the Heart Coin balance (post-sell `sell`, #601 step 10b then 12b)', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, {});
      await givePieces(kid, BEANIE, 2);
      const res = await holdThen(
        (tx) => lockPieces(tx, kid, BEANIE),
        () => sellPiece(server, kid, at, BEANIE),
        (tx) => lockHeart(tx, at.mapId, kid),
      );
      expect(res.statusCode, res.body).toBe(200);
      expect(await pieces(kid, BEANIE)).toHaveLength(1);
    });
    it('a basket takes the pieces before the bag rows, then the Heart Coin balance (post-sell `sellBasket`, #655 step 10b, 11, 12b)', async () => {
      const server = await start();
      const kid = await player();
      const at = await patch(server, kid, { timber: 30 });
      await givePieces(kid, BEANIE, 3);
      const lines: SellLine[] = [
        { kind: 'item', itemId: 'timber', lots: 1 },
        { kind: 'clothing', itemId: BEANIE, count: 1 },
      ];
      const piecesThenBag = await holdThen(
        (tx) => lockPieces(tx, kid, BEANIE),
        () => sellBasket(server, kid, at, lines),
        (tx) => lockBag(tx, at.mapId, kid, 'timber'),
      );
      expect(piecesThenBag.statusCode, piecesThenBag.body).toBe(200);
      const bagThenHeart = await holdThen(
        (tx) => lockBag(tx, at.mapId, kid, 'timber'),
        () => sellBasket(server, kid, at, lines),
        (tx) => lockHeart(tx, at.mapId, kid),
      );
      expect(bagThenHeart.statusCode, bagThenHeart.body).toBe(200);
      expect(await heartRows(at.mapId, kid)).toHaveLength(2);
      expect(await pieces(kid, BEANIE)).toHaveLength(1);
    });
  });
});
