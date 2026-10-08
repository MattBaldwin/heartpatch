import {
  ApiErrorSchema,
  BOUTIQUE_RULES,
  BoutiqueResponseSchema,
  BuyClothingResponseSchema,
  CLOTHING,
  CLOTHING_BY_ID,
  type Boutique,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { stockFor } from './service.js';

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
const ZONE = 'America/Denver';
/** Noon in Denver, in the Halloween window (design doc §15). */
const START = '2026-10-02T18:00:00Z';

interface Player {
  id: string;
  token: string;
}

const priceOf = (itemId: string) => CLOTHING_BY_ID.get(itemId)!.boutiquePrice!;
const allOf = (boutique: Boutique) => [
  ...boutique.daily,
  ...boutique.seasonal.flatMap((rack) => rack.items),
];

describe.skipIf(!url)('Boutique (needs DATABASE_URL)', () => {
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

  async function player(timeZone = ZONE): Promise<Player> {
    const [user] = await db
      .insert(users)
      .values({
        username: `shopper_${String((counter += 1))}`,
        passwordHash: 'not-a-hash',
        birthYear: 2014,
        timeZone,
      })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 365 * DAY_MS) });
    return { id: user!.id, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    payload?: object,
    headers: Record<string, string> = {},
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...HEADERS, ...headers },
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function shop(server: FastifyInstance, who: Player): Promise<Boutique> {
    const res = await call(server, 'GET', '/boutique', who);
    expect(res.statusCode, res.body).toBe(200);
    return BoutiqueResponseSchema.parse(res.json()).boutique;
  }

  async function coins(server: FastifyInstance, who: Player, amount: number) {
    const res = await call(server, 'POST', '/dev/coins', who, { amount });
    expect(res.statusCode, res.body).toBe(201);
  }

  const buy = (server: FastifyInstance, who: Player, itemId: string, headers = {}) =>
    call(server, 'POST', '/boutique/buy', who, { itemId }, headers);

  const piecesOf = (userId: string) =>
    db.query.clothingOwned.findMany({ where: (t, { eq }) => eq(t.userId, userId) });
  const ledgerOf = (userId: string) =>
    db.query.coinLedger.findMany({ where: (t, { eq }) => eq(t.userId, userId) });

  /** The cached balance, after checking it equals the ledger's sum (tech spec §4). */
  async function balanceOf(userId: string): Promise<number> {
    const row = await db.query.coinBalances.findFirst({
      where: (t, { eq }) => eq(t.userId, userId),
    });
    const sum = (await ledgerOf(userId)).reduce((total, r) => total + r.amount, 0);
    expect(row?.balance ?? 0).toBe(sum);
    return sum;
  }

  describe('racks', () => {
    it("shows today's rack and the Halloween rack, priced from data", async () => {
      const server = await start();
      const kid = await player();
      const boutique = await shop(server, kid);
      expect(boutique.date).toBe('2026-10-02');
      // The next midnight in Denver (6 AM UTC, daylight time).
      expect(boutique.restocksAt).toBe('2026-10-03T06:00:00.000Z');
      expect(boutique.coins).toEqual({ balance: 0 });
      expect(boutique.daily).toHaveLength(BOUTIQUE_RULES.dailySlots);
      expect(boutique.seasonal.map((r) => r.seasonId)).toEqual(['halloween']);
      expect(boutique.seasonal[0]!.items).toHaveLength(BOUTIQUE_RULES.seasonalSlots);
      for (const item of boutique.daily) {
        expect(CLOTHING_BY_ID.get(item.itemId)!.season).toBeUndefined();
      }
      for (const item of boutique.seasonal[0]!.items) {
        expect(CLOTHING_BY_ID.get(item.itemId)!.season).toBe('halloween');
      }
      for (const item of allOf(boutique)) {
        expect(item).toEqual({ itemId: item.itemId, price: priceOf(item.itemId), owned: false });
      }
      // What the shared picker says for this player and day: nothing stored.
      const stock = stockFor(kid.id, '2026-10-02');
      expect(boutique.daily.map((i) => i.itemId)).toEqual(stock.daily);
    });

    it('keeps the racks all day and changes them at midnight in the account’s time zone', async () => {
      const server = await start();
      const kid = await player();
      const morning = await shop(server, kid);
      // 11:59 PM in Denver: the same day, the same racks.
      clock.setTime(Date.parse('2026-10-03T05:59:00Z'));
      expect(await shop(server, kid)).toEqual(morning);
      // Midnight there (not UTC's): a new day and new racks.
      clock.setTime(Date.parse('2026-10-03T06:00:00Z'));
      const next = await shop(server, kid);
      expect(next.date).toBe('2026-10-03');
      expect(next.restocksAt).toBe('2026-10-04T06:00:00.000Z');
      expect(next.daily.map((i) => i.itemId)).toEqual(stockFor(kid.id, '2026-10-03').daily);
      // Over a week the rack doesn't stay the same.
      const week = new Set<string>();
      for (let d = 1; d <= 7; d++) {
        week.add(stockFor(kid.id, `2026-10-0${String(d)}`).daily.join());
      }
      expect(week.size).toBeGreaterThan(1);
    });

    it('sells Halloween pieces only in the Halloween window', async () => {
      const server = await start();
      const kid = await player();
      // The 2026 window runs to Nov 9 (DECISIONS: extended for the launch).
      clock.setTime(Date.parse('2026-11-09T18:00:00Z'));
      expect((await shop(server, kid)).seasonal.map((r) => r.seasonId)).toEqual(['halloween']);
      clock.setTime(Date.parse('2026-11-10T18:00:00Z'));
      const after = await shop(server, kid);
      // Thanksgiving is on, but has nothing to sell yet: no rack.
      expect(after.seasonal).toEqual([]);
      expect(allOf(after).some((i) => CLOTHING_BY_ID.get(i.itemId)!.season)).toBe(false);
      // And a Halloween piece can't be bought out of season.
      await coins(server, kid, 500);
      const res = await buy(server, kid, 'witch-hat');
      expect(res.statusCode).toBe(409);
    });
  });

  describe('buying', () => {
    it('buys a piece: debit, the piece in the wardrobe, and owned on the rack', async () => {
      const server = await start();
      const kid = await player();
      await coins(server, kid, 300);
      const itemId = (await shop(server, kid)).daily[0]!.itemId;
      const res = await buy(server, kid, itemId);
      expect(res.statusCode, res.body).toBe(200);
      const { boutique, wardrobe } = BuyClothingResponseSchema.parse(res.json());
      expect(boutique.coins.balance).toBe(300 - priceOf(itemId));
      expect(boutique.daily.find((i) => i.itemId === itemId)?.owned).toBe(true);
      expect(wardrobe.owned).toContainEqual({ itemId, count: 1 });

      // One ledger row and one piece, tied together by the purchase.
      const spent = (await ledgerOf(kid.id)).filter((r) => r.source === 'boutique');
      expect(spent).toMatchObject([{ amount: -priceOf(itemId), mapId: null }]);
      expect(await piecesOf(kid.id)).toMatchObject([
        { itemId, source: 'boutique', refId: spent[0]!.refId, mapId: null },
      ]);
      expect(await balanceOf(kid.id)).toBe(300 - priceOf(itemId));
    });

    it('buys from the seasonal rack in season', async () => {
      const server = await start();
      const kid = await player();
      // The rack is random per player, and a whole costume can cost more than 300.
      const itemId = (await shop(server, kid)).seasonal[0]!.items[0]!.itemId;
      await coins(server, kid, priceOf(itemId));
      const res = await buy(server, kid, itemId);
      expect(res.statusCode, res.body).toBe(200);
      expect((await piecesOf(kid.id)).map((p) => p.itemId)).toEqual([itemId]);
    });

    it("says so kindly when there aren't enough coins, and changes nothing", async () => {
      const server = await start();
      const kid = await player();
      const itemId = (await shop(server, kid)).daily[0]!.itemId;
      await coins(server, kid, priceOf(itemId) - 1);
      const res = await buy(server, kid, itemId);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).message).toMatch(/^Not enough Patch Coins yet!/);
      expect(await piecesOf(kid.id)).toEqual([]);
      expect(await balanceOf(kid.id)).toBe(priceOf(itemId) - 1);
    });

    it("refuses what isn't on today's racks, or isn't sold at all", async () => {
      const server = await start();
      const kid = await player();
      await coins(server, kid, 500);
      const today = new Set(allOf(await shop(server, kid)).map((i) => i.itemId));
      const elsewhere = CLOTHING.find((i) => i.boutiquePrice !== undefined && !today.has(i.id))!;
      const off = await buy(server, kid, elsewhere.id);
      expect(off.statusCode).toBe(409);
      expect(errorOf(off).message).toMatch(/isn't on the racks today/);
      // A starter piece and a found-only legendary aren't for sale.
      expect((await buy(server, kid, 'sunny-cap')).statusCode).toBe(404);
      expect((await buy(server, kid, 'cloud-onesie')).statusCode).toBe(404);
      expect((await buy(server, kid, 'no-such-thing')).statusCode).toBe(404);
      expect(await piecesOf(kid.id)).toEqual([]);
      expect(await balanceOf(kid.id)).toBe(500);
    });

    it('sells a #261 costume for exactly its price, and never the Mythic Hollow Man', async () => {
      const server = await start();
      // Racks are per player: find one whose Halloween rack has a costume today.
      let kid = await player();
      const costumeOn = (who: Player) =>
        stockFor(who.id, '2026-10-02').seasonal[0]?.items.find(
          (id) => CLOTHING_BY_ID.get(id)?.slot === 'costume' && id !== 'ghost-sheet',
        );
      for (let i = 0; i < 40 && !costumeOn(kid); i++) kid = await player();
      const itemId = costumeOn(kid)!;
      expect(itemId).toBeDefined();
      const price = priceOf(itemId);
      expect(price).toBeGreaterThanOrEqual(120);
      await coins(server, kid, price);
      const res = await buy(server, kid, itemId);
      expect(res.statusCode, res.body).toBe(200);
      expect(BuyClothingResponseSchema.parse(res.json()).boutique.coins.balance).toBe(0);
      const spent = (await ledgerOf(kid.id)).filter((r) => r.source === 'boutique');
      expect(spent).toMatchObject([{ amount: -price }]);
      expect(await piecesOf(kid.id)).toMatchObject([{ itemId, refId: spent[0]!.refId }]);
      expect(await balanceOf(kid.id)).toBe(0);

      // The Hollow Man is found-only: never on a rack, and refused if asked for.
      await coins(server, kid, 500);
      for (let day = 1; day <= 31; day++) {
        const date = `2026-10-${String(day).padStart(2, '0')}`;
        const racks = stockFor(kid.id, date);
        expect([...racks.daily, ...racks.seasonal.flatMap((r) => r.items)]).not.toContain(
          'hollow-man-costume',
        );
      }
      expect((await buy(server, kid, 'hollow-man-costume')).statusCode).toBe(404);
      expect(await balanceOf(kid.id)).toBe(500);
    });

    it('refuses a piece the player already has, bought or found', async () => {
      const server = await start();
      const kid = await player();
      await coins(server, kid, 500);
      const [first, second] = (await shop(server, kid)).daily.map((i) => i.itemId);
      expect((await buy(server, kid, first!)).statusCode).toBe(200);
      const again = await buy(server, kid, first!);
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).message).toMatch(/already have that one/);
      // Found while playing (the dev grant stands in for a find).
      const found = await call(server, 'POST', '/dev/wardrobe/items', kid, { items: [second] });
      expect(found.statusCode).toBe(201);
      expect((await buy(server, kid, second!)).statusCode).toBe(409);
      expect(await balanceOf(kid.id)).toBe(500 - priceOf(first!));
    });

    it('replays a retried purchase with the same Idempotency-Key instead of buying twice', async () => {
      const server = await start();
      const kid = await player();
      await coins(server, kid, 300);
      const itemId = (await shop(server, kid)).daily[0]!.itemId;
      const headers = { 'idempotency-key': 'buy-it-once' };
      const first = await buy(server, kid, itemId, headers);
      const again = await buy(server, kid, itemId, headers);
      expect(first.statusCode).toBe(200);
      expect(again.statusCode).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.json()).toEqual(first.json());
      expect(await piecesOf(kid.id)).toHaveLength(1);
      expect(await balanceOf(kid.id)).toBe(300 - priceOf(itemId));
    });

    it('never overspends or doubles up when taps race', async () => {
      const server = await start();
      const kid = await player();
      const racks = await shop(server, kid);
      const [a, b, c] = racks.daily.map((i) => i.itemId);
      // Never enough for the dearest piece plus the cheapest one.
      const prices = [a!, b!, c!].map(priceOf);
      const budget = Math.max(...prices) + Math.min(...prices) - 1;
      await coins(server, kid, budget);

      // Ten taps at once: each piece four times over.
      const taps = [a, b, c, a, b, c, a, b, c, a].map((id) => buy(server, kid, id!));
      const results = await Promise.all(taps);
      const ok = results.filter((r) => r.statusCode === 200);
      expect(results.every((r) => r.statusCode === 200 || r.statusCode === 409)).toBe(true);
      const pieces = await piecesOf(kid.id);
      // No piece twice, never below zero, and the ledger matches what was handed over.
      expect(new Set(pieces.map((p) => p.itemId)).size).toBe(pieces.length);
      expect(pieces).toHaveLength(ok.length);
      const spent = pieces.reduce((total, p) => total + priceOf(p.itemId), 0);
      expect(spent).toBeLessThanOrEqual(budget);
      expect(await balanceOf(kid.id)).toBe(budget - spent);
      expect(pieces.length).toBeGreaterThanOrEqual(1);
      expect(pieces.length).toBeLessThanOrEqual(prices.filter((p) => p <= budget).length);
    });

    it("keeps each player's coins their own", async () => {
      const server = await start();
      const [kid, sibling] = [await player(), await player()];
      await coins(server, kid, 300);
      const itemId = (await shop(server, sibling)).daily[0]!.itemId;
      const res = await buy(server, sibling, itemId);
      expect(res.statusCode).toBe(409);
      expect(await balanceOf(kid.id)).toBe(300);
      expect(await piecesOf(sibling.id)).toEqual([]);
    });
  });
});
