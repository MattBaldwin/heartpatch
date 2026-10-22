import {
  BATTLE_RULES,
  BattleResponseSchema,
  CareResponseSchema,
  HEART_COIN_RULES,
  HeartCoinsResponseSchema,
  hexKey,
  hexNeighbors,
  MapResponseSchema,
  STARTERS,
  TutorialResponseSchema,
  type MapDetail,
  type PlayerBattle,
  type PlayerBattleAction,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, squishies, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { bigMove } from '../../../tests/big-move.js';
import { creditHeartCoins, spendHeartCoins, trySpendHeartCoins } from './service.js';

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
// The account lives in Denver; the patch keeps Tokyo time (15 hours ahead).
const ACCOUNT_ZONE = 'America/Denver';
const PATCH_ZONE = 'Asia/Tokyo';
// Noon in Tokyo on 2026-10-03 (still 2026-10-02 in Denver).
const START = '2026-10-03T03:00:00Z';
const STARTER = STARTERS.speciesIds[0]!;

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('Heart Coins (needs DATABASE_URL)', () => {
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
    const username = `hearty_${String(process.pid)}_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ACCOUNT_ZONE })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 365 * DAY_MS) });
    return { id: user!.id, username, token };
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

  async function patch(server: FastifyInstance, owner: Player, timeZone = PATCH_ZONE) {
    const res = await call(server, 'POST', '/maps', owner, { name: 'Heart Patch', timeZone });
    expect(res.statusCode, res.body).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
    return map.id;
  }

  const ledgerOf = (mapId: string, userId: string) =>
    db.query.heartCoinLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
      orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
    });

  const balanceRow = (mapId: string, userId: string) =>
    db.query.heartCoinBalances.findFirst({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
    });

  /** The cached balance, after checking it equals the ledger's sum (tech spec §4). */
  async function balanceOf(mapId: string, userId: string): Promise<number> {
    const row = await balanceRow(mapId, userId);
    const sum = (await ledgerOf(mapId, userId)).reduce((total, r) => total + r.amount, 0);
    expect(row?.balance ?? 0).toBe(sum);
    return sum;
  }

  async function heartCoinsOf(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'GET', `/maps/${mapId}/heart-coins`, who);
    expect(res.statusCode, res.body).toBe(200);
    return HeartCoinsResponseSchema.parse(res.json()).heartCoins;
  }

  const credit = (
    who: Player,
    mapId: string,
    source: 'battle' | 'capture' | 'care' | 'sell' | 'dev-grant',
    amount: number,
    refId = uuidv7(),
  ) =>
    withTransaction(db, (tx) =>
      creditHeartCoins(tx, { source, refId, mapId, userId: who.id, amount, at: clock }),
    );

  const upkeep = (who: Player, mapId: string, amount: number, refId = uuidv7()) => ({
    source: 'upkeep' as const,
    refId,
    mapId,
    userId: who.id,
    amount,
    at: clock,
  });

  describe('creditHeartCoins', () => {
    it('pays once per source event, however often or however fast it is retried', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const refId = uuidv7();
      expect(await credit(kid, mapId, 'battle', 2, refId)).toEqual({ credited: 2, balance: 2 });
      // Five retries at once wait on the balance lock and each find it paid.
      const retries = await Promise.all(
        Array.from({ length: 5 }, () => credit(kid, mapId, 'battle', 2, refId)),
      );
      expect(retries.map((r) => r.credited)).toEqual([0, 0, 0, 0, 0]);
      expect(await ledgerOf(mapId, kid.id)).toHaveLength(1);
      expect(await balanceOf(mapId, kid.id)).toBe(2);
    });

    it('caps each source per patch day, in the patch’s time zone (not the account’s)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const cap = HEART_COIN_RULES.dailyCaps.battle;
      // Up to the cap, then the last one is cut short, then nothing.
      const credited = [];
      for (const size of [cap - 3, 5, 5]) {
        credited.push((await credit(kid, mapId, 'battle', size)).credited);
      }
      expect(credited).toEqual([cap - 3, 3, 0]);
      // Each capped source has its own cap; a dev grant has none.
      expect((await credit(kid, mapId, 'capture', 4)).credited).toBe(4);
      expect((await credit(kid, mapId, 'sell', 4)).credited).toBe(4);
      expect((await credit(kid, mapId, 'dev-grant', 500)).credited).toBe(500);

      // 11:59 PM in Tokyo is still the same patch day…
      clock.setTime(Date.parse('2026-10-03T14:59:00Z'));
      expect((await credit(kid, mapId, 'battle', 5)).credited).toBe(0);
      // …and midnight there starts a new one, though it's still 2026-10-03
      // morning in Denver, the account's zone.
      clock.setTime(Date.parse('2026-10-03T15:00:00Z'));
      expect((await credit(kid, mapId, 'battle', 5)).credited).toBe(5);
      const days = (await ledgerOf(mapId, kid.id)).map((r) => r.day);
      expect(days.at(0)).toBe('2026-10-03');
      expect(days.at(-1)).toBe('2026-10-04');
      expect(await balanceOf(mapId, kid.id)).toBe(cap + 4 + 4 + 500 + 5);
    });

    it('keeps two patches apart: two balances and two sets of caps', async () => {
      const server = await start();
      const kid = await player();
      const one = await patch(server, kid);
      const two = await patch(server, kid);
      const cap = HEART_COIN_RULES.dailyCaps.capture;
      expect((await credit(kid, one, 'capture', cap)).credited).toBe(cap);
      expect((await credit(kid, one, 'capture', 1)).credited).toBe(0);
      // The other patch's cap is untouched, and its coins stay there.
      expect((await credit(kid, two, 'capture', 3)).credited).toBe(3);
      expect(await balanceOf(one, kid.id)).toBe(cap);
      expect(await balanceOf(two, kid.id)).toBe(3);
      expect((await heartCoinsOf(server, kid, one)).balance).toBe(cap);
      expect((await heartCoinsOf(server, kid, two)).balance).toBe(3);
    });

    it('pays nothing on the Tutorial Glade, and takes no lock for it', async () => {
      const server = await start();
      const kid = await player();
      const started = await call(server, 'POST', '/tutorial/start', kid);
      const glade = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
      expect(await credit(kid, glade, 'battle', 2)).toEqual({ credited: 0, balance: null });
      expect(await balanceRow(glade, kid.id)).toBeUndefined();
      expect((await heartCoinsOf(server, kid, glade)).balance).toBe(0);
    });

    it('credits nothing for nothing, and takes no lock for it', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      expect(await credit(kid, mapId, 'battle', 0)).toEqual({ credited: 0, balance: null });
      expect(await balanceRow(mapId, kid.id)).toBeUndefined();
    });

    it('refuses a player who is not on the patch (the member key)', async () => {
      const server = await start();
      const kid = await player();
      const stranger = await player();
      const mapId = await patch(server, kid);
      // No route gets here (battles and care check membership first, and
      // leaving is a status change), so this is the database fact itself.
      await expect(credit(stranger, mapId, 'battle', 2)).rejects.toMatchObject({
        cause: { code: '23503', constraint_name: 'heart_coin_balances_member_fk' },
      });
      expect(await balanceRow(mapId, stranger.id)).toBeUndefined();
    });
  });

  describe('spending', () => {
    it('refuses an overdraw and changes nothing, and charges each morning once', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await credit(kid, mapId, 'dev-grant', 10);

      // Short: null (the upkeep loop pauses), or CONFLICT, with nothing written.
      expect(
        await withTransaction(db, (tx) => trySpendHeartCoins(tx, upkeep(kid, mapId, 11))),
      ).toBe(null);
      const short = withTransaction(db, (tx) => spendHeartCoins(tx, upkeep(kid, mapId, 11)));
      await expect(short).rejects.toBeInstanceOf(AppError);
      await expect(short).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await ledgerOf(mapId, kid.id)).toHaveLength(1);

      // Enough: paid, and the same morning again changes nothing.
      const refId = uuidv7();
      const spend = () =>
        withTransaction(db, (tx) => trySpendHeartCoins(tx, upkeep(kid, mapId, 6, refId)));
      expect(await spend()).toBe(4);
      expect(await spend()).toBe(4);
      const rows = await ledgerOf(mapId, kid.id);
      expect(rows.map((r) => [r.source, r.amount])).toEqual([
        ['dev-grant', 10],
        ['upkeep', -6],
      ]);
      expect(await balanceOf(mapId, kid.id)).toBe(4);
      // Spending isn't earning: today's capped earnings don't go down.
      expect(await heartCoinsOf(server, kid, mapId)).toMatchObject({
        balance: 4,
        today: { battle: 0, capture: 0, care: 0, sell: 0 },
      });
    });
  });

  describe('GET /maps/:mapId/heart-coins', () => {
    it('shows the balance, today’s earnings by source against the caps, and the patch’s midnight', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      expect(await heartCoinsOf(server, kid, mapId)).toEqual({
        balance: 0,
        today: { battle: 0, capture: 0, care: 0, sell: 0 },
        caps: HEART_COIN_RULES.dailyCaps,
        // Midnight in Tokyo.
        resetsAt: '2026-10-03T15:00:00.000Z',
      });
      await credit(kid, mapId, 'battle', 3);
      await credit(kid, mapId, 'care', 1);
      await credit(kid, mapId, 'dev-grant', 40);
      const view = await heartCoinsOf(server, kid, mapId);
      expect(view.balance).toBe(44);
      expect(view.today).toEqual({ battle: 3, capture: 0, care: 1, sell: 0 });
      // A new patch day starts the bars again; the balance stays.
      clock.setTime(Date.parse('2026-10-03T15:00:00Z'));
      const tomorrow = await heartCoinsOf(server, kid, mapId);
      expect(tomorrow.balance).toBe(44);
      expect(tomorrow.today).toEqual({ battle: 0, capture: 0, care: 0, sell: 0 });
    });

    it('is only for the patch’s members, and only signed in', async () => {
      const server = await start();
      const kid = await player();
      const stranger = await player();
      const mapId = await patch(server, kid);
      const theirs = await call(server, 'GET', `/maps/${mapId}/heart-coins`, stranger);
      expect(theirs.statusCode).toBe(404);
      const anon = await server.inject({
        method: 'GET',
        url: `/api/v1/maps/${mapId}/heart-coins`,
        headers: HEADERS,
      });
      expect(anon.statusCode).toBe(401);
    });

    it('hands out Heart Coins on the dev route', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const res = await call(server, 'POST', `/maps/${mapId}/dev/heart-coins`, kid, { amount: 40 });
      expect(res.statusCode, res.body).toBe(201);
      expect(HeartCoinsResponseSchema.parse(res.json()).heartCoins.balance).toBe(40);
      expect(await ledgerOf(mapId, kid.id)).toMatchObject([{ source: 'dev-grant', amount: 40 }]);
    });
  });

  describe('earning in play', () => {
    const battleOf = (res: LightMyRequestResponse): PlayerBattle =>
      BattleResponseSchema.parse(res.json()).battle;

    async function grant(server: FastifyInstance, who: Player, mapId: string, level: number) {
      const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, {
        level,
        speciesId: STARTER,
      });
      expect(res.statusCode, res.body).toBe(201);
    }

    const act = (
      server: FastifyInstance,
      who: Player,
      b: PlayerBattle,
      action: PlayerBattleAction,
    ) => call(server, 'POST', `/battles/${b.id}/actions`, who, { action, turn: b.view.turn });

    /** Plays the player's first move every turn until the battle ends. */
    async function playOut(server: FastifyInstance, who: Player, battle: PlayerBattle) {
      let current = battle;
      for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && current.status === 'active'; i++) {
        const side = current.view.sides[current.mySide];
        const action: PlayerBattleAction =
          current.view.phase.type === 'replace'
            ? { type: 'replace', slot: side.squishies.findIndex((s) => s.energy > 0) }
            : { type: 'move', move: bigMove(side.squishies[side.active]!) };
        const res = await act(server, who, current, action);
        expect(res.statusCode, res.body).toBe(200);
        current = battleOf(res);
      }
      expect(current.status).toBe('finished');
      return current;
    }

    const wildFight = async (server: FastifyInstance, who: Player, mapId: string) =>
      battleOf(
        await call(server, 'POST', `/maps/${mapId}/dev/battles`, who, { opponent: { level: 1 } }),
      );

    it('pays a wild win once, beside its Patch Coins, and nothing for a loss', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await grant(server, kid, mapId, 40);
      const won = await playOut(server, kid, await wildFight(server, kid, mapId));
      expect(won.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
      expect(await ledgerOf(mapId, kid.id)).toMatchObject([
        { source: 'battle', refId: won.id, amount: HEART_COIN_RULES.battleWin.wild },
      ]);
      const patchCoins = await db.query.coinLedger.findMany({
        where: (t, { eq }) => eq(t.userId, kid.id),
      });
      expect(patchCoins.map((r) => [r.source, r.refId])).toEqual([['battle', won.id]]);

      // A retried finish is refused, and running home pays nothing.
      expect((await act(server, kid, won, { type: 'forfeit' })).statusCode).toBe(409);
      const ran = await act(server, kid, await wildFight(server, kid, mapId), { type: 'forfeit' });
      expect(battleOf(ran).view.phase).toMatchObject({ result: { winner: 'b' } });
      expect(await balanceOf(mapId, kid.id)).toBe(HEART_COIN_RULES.battleWin.wild);
    });

    it('pays for claiming a tile, on top of the win', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await grant(server, kid, mapId, 40);
      const all = await db.query.tiles.findMany({
        where: (t, { eq }) => eq(t.mapId, mapId),
        orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
      });
      const mine = new Set(all.filter((t) => t.ownerUserId === kid.id).map(hexKey));
      const target = all.find(
        (t) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          hexNeighbors(t).some((n) => mine.has(hexKey(n))),
      )!;
      const battle = battleOf(
        await call(server, 'POST', `/maps/${mapId}/attacks`, kid, { q: target.q, r: target.r }),
      );
      await playOut(server, kid, battle);
      expect((await ledgerOf(mapId, kid.id)).map((r) => [r.source, r.amount])).toEqual([
        ['battle', HEART_COIN_RULES.battleWin.tile],
        ['capture', HEART_COIN_RULES.capture.tile],
      ]);
    });

    it('pays nothing for a win on the Tutorial Glade, though Patch Coins come', async () => {
      const server = await start();
      const kid = await player();
      const started = await call(server, 'POST', '/tutorial/start', kid);
      const glade = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
      await grant(server, kid, glade, 40);
      await playOut(server, kid, await wildFight(server, kid, glade));
      expect(await ledgerOf(glade, kid.id)).toEqual([]);
      const patchCoins = await db.query.coinLedger.findMany({
        where: (t, { eq }) => eq(t.userId, kid.id),
      });
      expect(patchCoins.map((r) => r.source)).toEqual(['battle']);
    });

    it('pays a full-value care action, once each, up to the patch day’s cap', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const [row] = await db
          .insert(squishies)
          .values({
            mapId,
            ownerUserId: kid.id,
            speciesId: STARTER,
            element: 'fire',
            feeling: 'cozy',
          })
          .returning({ id: squishies.id });
        ids.push(row!.id);
      }
      const care = (id: string, action: string) =>
        call(server, 'POST', `/maps/${mapId}/squishies/${id}/care`, kid, { action });
      // Three full actions a squishy (pet, play, pet again past the debounce):
      // twelve coins' worth, past the cap of ten.
      for (const id of ids) {
        for (const action of ['pet', 'play']) expect((await care(id, action)).statusCode).toBe(200);
      }
      clock.setTime(clock.getTime() + 11_000);
      for (const id of ids) {
        expect(CareResponseSchema.parse((await care(id, 'pet')).json()).result.full).toBe(true);
      }
      const log = await db.query.careLog.findMany({ where: (t, { eq }) => eq(t.userId, kid.id) });
      const paid = await ledgerOf(mapId, kid.id);
      expect(paid.every((r) => r.source === 'care' && r.amount === 1)).toBe(true);
      expect(new Set(paid.map((r) => r.refId)).size).toBe(paid.length);
      expect(paid.every((r) => log.some((l) => l.id === r.refId && l.full))).toBe(true);
      expect(await balanceOf(mapId, kid.id)).toBe(HEART_COIN_RULES.dailyCaps.care);
      // The cap goes by the patch's day: Tokyo's midnight opens it again.
      clock.setTime(Date.parse('2026-10-03T15:00:30Z'));
      expect((await care(ids[0]!, 'pet')).statusCode).toBe(200);
      expect(await balanceOf(mapId, kid.id)).toBe(HEART_COIN_RULES.dailyCaps.care + 1);
    });
  });
});
