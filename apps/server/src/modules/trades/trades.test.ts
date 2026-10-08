import {
  ApiErrorSchema,
  GAME_DATA,
  heartSeedOf,
  hexDistance,
  JoinMapResponseSchema,
  MapResponseSchema,
  STARTERS,
  TRADE_RULES,
  TradesResponseSchema,
  type PublicUser,
  type SendOfferRequest,
  type TradeLine,
} from '@heartpatch/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import type { GameEvent } from '../../db/game-events.js';
import {
  clothingOwned,
  inventories,
  keepers,
  mailbox,
  mapMembers,
  resourceLedger,
  sessions,
  squishies,
  squishyAccessories,
  tradeLedger,
  tradeOffers,
  users,
} from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { createWardrobeRepo, insertClothing, WORN } from '../wardrobe/repo.js';
import { createTradesRepo } from './repo.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const START = '2026-11-04T16:00:00Z';
const HERO = STARTERS.speciesIds[0]!;
// A tradable hat, an account-bound one (a milestone's), and a squishy accessory.
const HAT = 'pom-pom-beanie';
const BOUND = 'explorers-hat';
const ACCESSORY = 'snuggle-scarf';

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('trades, gifts and the mailbox (#271, needs DATABASE_URL)', () => {
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
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, HP_DEV_SQUISHY_GRANTS: 'true' });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `trader_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
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
  const tradesOf = (res: LightMyRequestResponse) => TradesResponseSchema.parse(res.json()).trades;

  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });

  /**
   * Joins the kid's land to their nearest trading post: claims the neutral
   * tiles on the straight way from their Heart Seed (#270's test path).
   */
  async function connect(mapId: string, kid: PublicUser) {
    const tiles = await tilesOf(mapId);
    const mine = tiles.filter((t) => t.ownerUserId === kid.id);
    const seed = heartSeedOf(mine.filter((t) => t.homeSlot !== null))!;
    const posts = tiles.filter((t) => t.terrain === 'trading-post');
    const post = [...posts].sort((a, b) => hexDistance(seed, a) - hexDistance(seed, b))[0]!;
    const reach = hexDistance(seed, post);
    const path = tiles.filter(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        t.terrain !== 'trading-post' &&
        hexDistance(seed, t) < reach &&
        hexDistance(t, post) + hexDistance(seed, t) === reach,
    );
    for (const t of path) {
      await db.execute(sql`update tiles set owner_user_id = ${kid.id} where id = ${t.id}`);
    }
    return { q: post.q, r: post.r };
  }

  /** A squishy for `kid` (resting at home). */
  async function pet(mapId: string, kid: PublicUser, level = 5, speciesId = HERO) {
    const species = GAME_DATA.species.find((s) => s.id === speciesId)!;
    const [row] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: kid.id,
        speciesId,
        element: species.element,
        feeling: species.feeling,
        level,
      })
      .returning({ id: squishies.id });
    return row!.id;
  }

  const grant = (mapId: string, kid: PublicUser, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: kid.id }, items, 'dev-grant'));

  async function piece(kid: PublicUser, itemId: string) {
    await insertClothing(db, {
      userId: kid.id,
      itemId,
      source: 'dev-grant',
      refId: null,
      mapId: null,
      at: clock,
    });
    const rows = await db
      .select({ id: clothingOwned.id })
      .from(clothingOwned)
      .where(and(eq(clothingOwned.userId, kid.id), eq(clothingOwned.itemId, itemId)));
    return rows.at(-1)!.id;
  }

  /** Lee owns a patch; Sam (and anyone else) joins it. Both reach a post. */
  async function patch(server: FastifyInstance, lee: Player, ...others: Player[]) {
    const res = await call(server, 'POST', '/maps', lee, {
      name: 'Swap Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const map = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const joined = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      expect(joined.statusCode, joined.body).toBe(201);
      const request = JoinMapResponseSchema.parse(joined.json()).request;
      const ok = await call(server, 'POST', `/maps/${map.id}/requests/${request.id}/approve`, lee);
      expect(ok.statusCode, ok.body).toBe(204);
    }
    const posts = new Map<string, { q: number; r: number }>();
    for (const kid of [lee, ...others]) posts.set(kid.id, await connect(map.id, kid));
    return { mapId: map.id, postOf: (kid: PublicUser) => posts.get(kid.id)! };
  }

  const bag = async (mapId: string, kid: PublicUser) => {
    const rows = await db
      .select({ itemId: inventories.itemId, quantity: inventories.quantity })
      .from(inventories)
      .where(and(eq(inventories.mapId, mapId), eq(inventories.userId, kid.id)));
    return Object.fromEntries(rows.filter((r) => r.quantity > 0).map((r) => [r.itemId, r.quantity]));
  };
  const squishyRow = async (id: string) =>
    (await db.select().from(squishies).where(eq(squishies.id, id)))[0]!;
  const pieceRow = async (id: string) =>
    (await db.select().from(clothingOwned).where(eq(clothingOwned.id, id)))[0]!;
  const eventsOf = async (mapId: string) =>
    (await db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    })) as unknown as GameEvent[];
  const tradeEvents = async (mapId: string) =>
    (await eventsOf(mapId)).filter((e) => /^(trade|gift|mailbox)\./.test(e.type));
  const ledgerOf = (offerId: string) =>
    db.select().from(tradeLedger).where(eq(tradeLedger.offerId, offerId));

  /** Every bag equals the sum of its ledger rows (tech spec §4). */
  async function reconcile(mapId: string) {
    const rows = await db
      .select({
        userId: resourceLedger.userId,
        itemId: resourceLedger.itemId,
        total: sql<number>`sum(${resourceLedger.delta})::int`,
      })
      .from(resourceLedger)
      .where(eq(resourceLedger.mapId, mapId))
      .groupBy(resourceLedger.userId, resourceLedger.itemId);
    const held = await db
      .select({ userId: inventories.userId, itemId: inventories.itemId, quantity: inventories.quantity })
      .from(inventories)
      .where(eq(inventories.mapId, mapId));
    const key = (r: { userId: string; itemId: string }) => `${r.userId}/${r.itemId}`;
    const balances = new Map(held.map((r) => [key(r), r.quantity]));
    for (const r of rows) expect(balances.get(key(r)) ?? 0, key(r)).toBe(r.total);
  }

  const offer = (
    server: FastifyInstance,
    mapId: string,
    from: Player,
    at: { q: number; r: number },
    body: Omit<SendOfferRequest, 'q' | 'r'>,
    headers?: Record<string, string>,
  ) => call(server, 'POST', `/maps/${mapId}/trades`, from, { ...at, ...body }, headers);

  const viewFor = (event: GameEvent, kid: PublicUser) =>
    publicViewFor(PUBLIC_VIEWS, event, { userId: kid.id });

  it('holds the sender’s side, and a yes moves both sides at once (acceptance)', async () => {
    const server = await start();
    const [lee, sam, kai] = [await player(), await player(), await player()];
    const { mapId, postOf } = await patch(server, lee, sam, kai);
    const pip = await pet(mapId, lee, 7);
    await pet(mapId, lee, 4); // stays home
    const fizz = await pet(mapId, sam, 6);
    await pet(mapId, sam, 3);
    await grant(mapId, lee, { timber: 10 });
    await grant(mapId, sam, { stone: 5 });
    const hat = await piece(lee, HAT);
    const scarf = await piece(lee, ACCESSORY);
    await createWardrobeRepo(db).saveOutfit(lee.id, { preset: WORN, name: null, wearing: [HAT] }, clock);
    await db.insert(squishyAccessories).values({ squishyId: pip, userId: lee.id, itemId: ACCESSORY });
    const give: TradeLine[] = [
      { kind: 'squishy', squishyId: pip },
      { kind: 'item', itemId: 'timber', quantity: 3 },
      { kind: 'clothing', clothingId: hat },
    ];
    const want: TradeLine[] = [
      { kind: 'squishy', squishyId: fizz },
      { kind: 'item', itemId: 'stone', quantity: 2 },
    ];

    const sent = await offer(server, mapId, lee, postOf(lee), {
      kind: 'trade',
      toUserId: sam.id,
      give,
      want,
      noteId: null,
    });
    expect(sent.statusCode, sent.body).toBe(201);
    const [open] = tradesOf(sent).offers;
    expect(open).toMatchObject({ kind: 'trade', fromUserId: lee.id, toUserId: sam.id, status: 'open' });
    expect(Date.parse(open!.expiresAt) - Date.parse(open!.createdAt)).toBe(
      TRADE_RULES.offerDays * DAY_MS,
    );
    // Escrow: Pip waits in-trade, the timber left the bag, the hat is held
    // and came off Lee's Keeper (no other hat left).
    expect((await squishyRow(pip)).state).toBe('in-trade');
    expect(await bag(mapId, lee)).toEqual({ timber: 7 });
    expect((await pieceRow(hat)).heldByOfferId).toBe(open!.id);
    expect((await createWardrobeRepo(db).listOutfits(lee.id)).find((o) => o.preset === WORN)?.wearing).toEqual([]);
    // Sam sees it waiting.
    const samView = tradesOf(await call(server, 'GET', `/maps/${mapId}/trades`, sam));
    expect(samView.offers.map((o) => o.id)).toEqual([open!.id]);
    expect(samView.offers[0]!.give[0]).toMatchObject({ kind: 'squishy', speciesId: HERO, level: 7 });

    const yes = await call(server, 'POST', `/maps/${mapId}/trades/${open!.id}/accept`, sam, postOf(sam));
    expect(yes.statusCode, yes.body).toBe(200);
    // Lee's side lands with Sam now: resting, no accessory, met.
    expect(await squishyRow(pip)).toMatchObject({ ownerUserId: sam.id, state: 'active', teamSlot: null });
    expect(await db.select().from(squishyAccessories).where(eq(squishyAccessories.squishyId, pip))).toEqual([]);
    expect(await pieceRow(hat)).toMatchObject({ userId: sam.id, heldByOfferId: null });
    expect(await bag(mapId, sam)).toEqual({ stone: 3, timber: 3 });
    // Sam's side waits in Lee's mailbox.
    expect(await squishyRow(fizz)).toMatchObject({ ownerUserId: lee.id, state: 'in-trade' });
    expect(await bag(mapId, lee)).toEqual({ timber: 7 });
    const leeView = tradesOf(await call(server, 'GET', `/maps/${mapId}/trades`, lee));
    expect(leeView.offers).toEqual([]);
    expect(leeView.mailbox).toHaveLength(1);
    expect(leeView.mailbox[0]).toMatchObject({ kind: 'trade', fromUserId: sam.id, pickedUpAt: null });

    const picked = await call(server, 'POST', `/maps/${mapId}/mailbox/pickup`, lee, postOf(lee));
    expect(picked.statusCode, picked.body).toBe(200);
    expect(tradesOf(picked).mailbox).toEqual([]);
    expect(await squishyRow(fizz)).toMatchObject({ ownerUserId: lee.id, state: 'active' });
    expect(await bag(mapId, lee)).toEqual({ stone: 2, timber: 7 });
    // A second pickup finds nothing more.
    const again = await call(server, 'POST', `/maps/${mapId}/mailbox/pickup`, lee, postOf(lee));
    expect(again.statusCode).toBe(200);
    expect(await bag(mapId, lee)).toEqual({ stone: 2, timber: 7 });
    // The scarf stays with Lee (an accessory never changes hands).
    expect((await pieceRow(scarf)).userId).toBe(lee.id);

    await reconcile(mapId);
    expect((await ledgerOf(open!.id)).map((r) => r.event).sort()).toEqual(
      ['accepted', 'offered', 'picked-up'],
    );
    const events = await tradeEvents(mapId);
    expect(events.map((e) => e.type)).toEqual(['trade.offered', 'trade.answered', 'mailbox.pickedUp']);
    // Kai hears only that Lee and Sam traded, never what.
    const [offered, answered, pickup] = events;
    expect(viewFor(offered!, kai)).toBeNull();
    expect(viewFor(offered!, sam)).toEqual({ offerId: open!.id, kind: 'trade', fromUserId: lee.id, toUserId: sam.id });
    expect(viewFor(answered!, kai)).toEqual({ fromUserId: lee.id, toUserId: sam.id, answer: 'accepted' });
    expect(viewFor(answered!, lee)).toMatchObject({ offerId: open!.id });
    expect(viewFor(pickup!, sam)).toBeNull();
    expect(viewFor(pickup!, lee)).toMatchObject({ userId: lee.id });
  });

  it('sends a gift to the mailbox, and members hear of it when it’s picked up', async () => {
    const server = await start();
    const [lee, sam, kai] = [await player(), await player(), await player()];
    const { mapId, postOf } = await patch(server, lee, sam, kai);
    await pet(mapId, lee);
    await grant(mapId, lee, { timber: 4 });
    const sent = await offer(server, mapId, lee, postOf(lee), {
      kind: 'gift',
      toUserId: sam.id,
      give: [{ kind: 'item', itemId: 'timber', quantity: 4 }],
      want: [],
      noteId: 'thank-you',
    });
    expect(sent.statusCode, sent.body).toBe(201);
    const giftId = tradesOf(sent).offers[0]!.id;
    const samView = tradesOf(await call(server, 'GET', `/maps/${mapId}/trades`, sam));
    expect(samView.mailbox).toMatchObject([{ kind: 'gift', fromUserId: lee.id, offerId: giftId }]);
    // A gift isn't "accepted": it's picked up.
    const accept = await call(server, 'POST', `/maps/${mapId}/trades/${giftId}/accept`, sam, postOf(sam));
    expect(accept.statusCode).toBe(409);
    expect((await call(server, 'POST', `/maps/${mapId}/mailbox/pickup`, sam, postOf(sam))).statusCode).toBe(200);
    expect(await bag(mapId, sam)).toEqual({ timber: 4 });
    const [row] = await db.select().from(tradeOffers).where(eq(tradeOffers.id, giftId));
    expect(row!.status).toBe('accepted');
    const gift = (await tradeEvents(mapId)).find((e) => e.type === 'gift.pickedUp')!;
    expect(viewFor(gift, kai)).toEqual({ fromUserId: lee.id, toUserId: sam.id });
    await reconcile(mapId);
  });

  it('refuses what can’t go: starters, busy squishies, the last friend, tools, account-bound pieces, coins (acceptance)', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const stranger = await player();
    const { mapId, postOf } = await patch(server, lee, sam);
    const partner = await pet(mapId, lee);
    const pip = await pet(mapId, lee);
    const onTeam = await pet(mapId, lee);
    await db.update(squishies).set({ teamSlot: 0 }).where(eq(squishies.id, onTeam));
    await db.update(mapMembers).set({ starterSquishyId: partner }).where(
      and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, lee.id)),
    );
    const samOnly = await pet(mapId, sam);
    await grant(mapId, lee, { timber: 3, shovel: 1 });
    const bound = await piece(lee, BOUND);
    const at = postOf(lee);
    const tryOffer = async (body: Partial<SendOfferRequest>, to: PublicUser = sam) =>
      offer(server, mapId, lee, at, {
        kind: 'trade',
        toUserId: to.id,
        give: [{ kind: 'item', itemId: 'timber', quantity: 1 }],
        want: [{ kind: 'item', itemId: 'stone', quantity: 1 }],
        ...body,
      } as Omit<SendOfferRequest, 'q' | 'r'>);
    await grant(mapId, sam, { stone: 1 });

    const cases: [Partial<SendOfferRequest>, number, RegExp][] = [
      [{ give: [{ kind: 'squishy', squishyId: partner }] }, 409, /first squishy/],
      [{ give: [{ kind: 'squishy', squishyId: onTeam }] }, 409, /resting/],
      [{ give: [{ kind: 'item', itemId: 'shovel', quantity: 1 }] }, 409, /can't be traded/],
      [{ give: [{ kind: 'clothing', clothingId: bound }] }, 409, /can't be traded/],
      [{ give: [{ kind: 'item', itemId: 'timber', quantity: 9 }] }, 409, /isn't there/],
      [{ want: [{ kind: 'squishy', squishyId: samOnly }] }, 409, /Keep at least one/],
      [{ kind: 'gift' }, 409, /just for giving/],
      [{ noteId: 'not-a-note' }, 400, /note/],
    ];
    for (const [body, status, message] of cases) {
      const res = await tryOffer(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(status);
      expect(errorOf(res).message).toMatch(message);
    }
    // Coins are never a line.
    const coins = await tryOffer({ give: [{ kind: 'coins', quantity: 5 } as unknown as TradeLine] });
    expect(coins.statusCode).toBe(400);
    // Patch-mates only; never yourself.
    expect((await tryOffer({}, stranger)).statusCode).toBe(404);
    expect((await tryOffer({}, lee)).statusCode).toBe(400);
    // Pip alone is fine, then one offer per pair at a time.
    expect((await tryOffer({ give: [{ kind: 'squishy', squishyId: pip }] })).statusCode).toBe(201);
    const twice = await tryOffer({});
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice).message).toMatch(/One at a time/);
    // Nothing moved for a refusal.
    expect(await bag(mapId, lee)).toEqual({ shovel: 1, timber: 3 });
    expect((await squishyRow(partner)).state).toBe('active');
    await reconcile(mapId);
  });

  it('needs the post (connected or a pass), except to say no or cancel', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const { mapId, postOf } = await patch(server, lee, sam);
    await pet(mapId, lee);
    await grant(mapId, lee, { timber: 2 });
    await grant(mapId, sam, { stone: 2 });
    const far = (await tilesOf(mapId)).find(
      (t) => t.terrain === 'trading-post' && (t.q !== postOf(lee).q || t.r !== postOf(lee).r) &&
        (t.q !== postOf(sam).q || t.r !== postOf(sam).r),
    )!;
    const body = {
      kind: 'trade' as const,
      toUserId: sam.id,
      give: [{ kind: 'item' as const, itemId: 'timber', quantity: 1 }],
      want: [{ kind: 'item' as const, itemId: 'stone', quantity: 1 }],
    };
    expect((await offer(server, mapId, lee, { q: far.q, r: far.r }, body)).statusCode).toBe(403);
    const sent = await offer(server, mapId, lee, postOf(lee), body);
    const id = tradesOf(sent).offers[0]!.id;
    const accept = await call(server, 'POST', `/maps/${mapId}/trades/${id}/accept`, sam, { q: far.q, r: far.r });
    expect(accept.statusCode).toBe(403);
    // Saying no works anywhere, and everything goes straight back.
    expect((await call(server, 'POST', `/maps/${mapId}/trades/${id}/decline`, sam)).statusCode).toBe(200);
    expect(await bag(mapId, lee)).toEqual({ timber: 2 });
    const leeView = tradesOf(await call(server, 'GET', `/maps/${mapId}/trades`, lee));
    expect(leeView.returns).toMatchObject([{ kind: 'return', offerId: id, fromUserId: lee.id }]);
    // A cancelled offer goes back too, and can't be answered after.
    const second = tradesOf(await offer(server, mapId, lee, postOf(lee), body)).offers[0]!.id;
    expect((await call(server, 'POST', `/maps/${mapId}/trades/${second}/cancel`, sam)).statusCode).toBe(404);
    expect((await call(server, 'POST', `/maps/${mapId}/trades/${second}/cancel`, lee)).statusCode).toBe(200);
    const late = await call(server, 'POST', `/maps/${mapId}/trades/${second}/accept`, sam, postOf(sam));
    expect(late.statusCode).toBe(409);
    expect(await bag(mapId, lee)).toEqual({ timber: 2 });
    expect((await tradeEvents(mapId)).map((e) => e.type)).toEqual([
      'trade.offered',
      'trade.answered',
      'trade.offered',
      'trade.cancelled',
    ]);
    await reconcile(mapId);
  });

  it('sends an unanswered offer home when it runs out, once (lazy expiry)', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const { mapId, postOf } = await patch(server, lee, sam);
    await pet(mapId, lee);
    const pip = await pet(mapId, lee);
    const hat = await piece(lee, HAT);
    const sent = await offer(server, mapId, lee, postOf(lee), {
      kind: 'gift',
      toUserId: sam.id,
      give: [{ kind: 'squishy', squishyId: pip }, { kind: 'clothing', clothingId: hat }],
      want: [],
    });
    const id = tradesOf(sent).offers[0]!.id;
    clock.setTime(clock.getTime() + TRADE_RULES.offerDays * DAY_MS);
    // Two reads at once: one expiry.
    const [a, b] = await Promise.all([
      call(server, 'GET', `/maps/${mapId}/trades`, sam),
      call(server, 'GET', `/maps/${mapId}/trades`, lee),
    ]);
    expect(tradesOf(a).mailbox).toEqual([]);
    expect(tradesOf(b).returns).toHaveLength(1);
    expect(await squishyRow(pip)).toMatchObject({ ownerUserId: lee.id, state: 'active' });
    expect(await pieceRow(hat)).toMatchObject({ userId: lee.id, heldByOfferId: null });
    expect((await ledgerOf(id)).filter((r) => r.event === 'expired')).toHaveLength(1);
    // A repeat of the same step writes nothing (the ledger's unique key, nulls not distinct).
    await createTradesRepo(db).ledger({ mapId, offerId: id, event: 'expired', actorUserId: null, at: clock });
    expect((await ledgerOf(id)).filter((r) => r.event === 'expired')).toHaveLength(1);
    expect((await tradeEvents(mapId)).filter((e) => e.type === 'trade.expired')).toHaveLength(1);
    expect(await db.select().from(mailbox).where(and(eq(mailbox.offerId, id), eq(mailbox.kind, 'gift')))).toEqual([]);
  });

  it('calls off every open offer when the owner turns trading off, or a player leaves', async () => {
    const server = await start();
    const [lee, sam, kai] = [await player(), await player(), await player()];
    const { mapId, postOf } = await patch(server, lee, sam, kai);
    await grant(mapId, sam, { timber: 5 });
    await grant(mapId, kai, { stone: 5 });
    const gift = (from: Player, to: Player, itemId: string) =>
      offer(server, mapId, from, postOf(from), {
        kind: 'gift',
        toUserId: to.id,
        give: [{ kind: 'item', itemId, quantity: 2 }],
        want: [],
      });
    expect((await gift(sam, kai, 'timber')).statusCode).toBe(201);
    expect((await gift(kai, sam, 'stone')).statusCode).toBe(201);
    // Only the owner flips the switch.
    expect((await call(server, 'POST', `/maps/${mapId}/trading`, sam, { tradingEnabled: false })).statusCode).toBe(403);
    const off = await call(server, 'POST', `/maps/${mapId}/trading`, lee, { tradingEnabled: false });
    expect(off.statusCode, off.body).toBe(200);
    expect(await bag(mapId, sam)).toEqual({ timber: 5 });
    expect(await bag(mapId, kai)).toEqual({ stone: 5 });
    expect((await gift(sam, kai, 'timber')).statusCode).toBe(409);
    const updated = (await eventsOf(mapId)).filter((e) => e.type === 'map.updated').at(-1)!;
    expect(updated.payload).toMatchObject({ tradingEnabled: false });

    // Back on; Kai sends again, then leaves: it goes back.
    expect((await call(server, 'POST', `/maps/${mapId}/trading`, lee, { tradingEnabled: true })).statusCode).toBe(200);
    expect((await gift(kai, sam, 'stone')).statusCode).toBe(201);
    expect(await bag(mapId, kai)).toEqual({ stone: 3 });
    expect((await call(server, 'POST', `/maps/${mapId}/leave`, kai)).statusCode).toBe(204);
    expect(await bag(mapId, kai)).toEqual({ stone: 5 });
    const reasons = (await tradeEvents(mapId))
      .filter((e) => e.type === 'trade.cancelled')
      .map((e) => (e.payload as { reason: string }).reason);
    expect(reasons).toEqual(['trading-off', 'trading-off', 'left']);
    await reconcile(mapId);
  });

  it('sends once for a retried tap (Idempotency-Key)', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const { mapId, postOf } = await patch(server, lee, sam);
    await grant(mapId, lee, { timber: 4 });
    const body = {
      kind: 'gift' as const,
      toUserId: sam.id,
      give: [{ kind: 'item' as const, itemId: 'timber', quantity: 2 }],
      want: [],
    };
    const key = { 'idempotency-key': 'gift-tap-1' };
    const first = await offer(server, mapId, lee, postOf(lee), body, key);
    const second = await offer(server, mapId, lee, postOf(lee), body, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await bag(mapId, lee)).toEqual({ timber: 2 });
    expect(await db.select().from(tradeOffers).where(eq(tradeOffers.mapId, mapId))).toHaveLength(1);
  });
});
