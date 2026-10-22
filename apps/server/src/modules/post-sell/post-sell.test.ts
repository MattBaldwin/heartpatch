import {
  ApiErrorSchema,
  CLOTHING_BY_ID,
  GLIMMER_SWAP,
  HEART_COIN_RULES,
  heartSeedOf,
  hexDistance,
  MapResponseSchema,
  SELL_RULES,
  SellResponseSchema,
  SellViewResponseSchema,
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
    expect(sold.sold).toEqual({
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
    expect(errorOf(over).message).toBe("You've sold enough for today! Come back tomorrow. 🌙");
    expect((await sellLots(server, kid, at, 'timber', 1)).statusCode).toBe(200);
    expect((await sellLots(server, kid, at, 'timber', 1)).statusCode).toBe(409);
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
    const offer = async (from: PublicUser, to: PublicUser, status: 'open' | 'declined') => {
      const [row] = await db
        .insert(tradeOffers)
        .values({
          mapId: at.mapId,
          kind: 'trade',
          fromUserId: from.id,
          toUserId: to.id,
          status,
          createdAt: clock,
          expiresAt: new Date(clock.getTime() + DAY_MS),
        })
        .returning({ id: tradeOffers.id });
      return row!.id;
    };
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
  });
});
