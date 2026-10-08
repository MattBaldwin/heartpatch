import {
  BATTLE_RULES,
  BattleResponseSchema,
  CARE_RULES,
  CareResponseSchema,
  checkCoinRules,
  COIN_RULES,
  CoinsResponseSchema,
  hexKey,
  hexNeighbors,
  JoinMapResponseSchema,
  MapResponseSchema,
  STARTERS,
  TERRITORY_RULES,
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
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { creditCoins } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
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
// Noon in Denver: a whole account day either side to move around in.
const START = '2026-10-02T18:00:00Z';
const STARTER = STARTERS.speciesIds[0]!;
const UUID = /^[0-9a-f-]{36}$/;
const uuid = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
};

interface Player {
  id: string;
  username: string;
  token: string;
}

it('has coin rules that pass their checks', () => {
  expect(checkCoinRules(COIN_RULES)).toEqual([]);
  expect(checkCoinRules({ ...COIN_RULES, battleWin: { wild: -1 } }).join('\n')).toMatch(
    /battleWin/,
  );
  expect(checkCoinRules({ ...COIN_RULES, dailyCaps: { battle: 0, capture: 1 } })).not.toEqual([]);
});

describe.skipIf(!url)('Patch Coins (needs DATABASE_URL)', () => {
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
    const username = `saver_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
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

  const battleOf = (res: LightMyRequestResponse): PlayerBattle =>
    BattleResponseSchema.parse(res.json()).battle;

  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, { name: 'Coin Patch', timeZone: ZONE });
    expect(res.statusCode, res.body).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const join = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      const request = JoinMapResponseSchema.parse(join.json()).request;
      const ok = await call(
        server,
        'POST',
        `/maps/${map.id}/requests/${request.id}/approve`,
        owner,
      );
      expect(ok.statusCode).toBe(204);
    }
    return map.id;
  }

  async function grant(server: FastifyInstance, who: Player, mapId: string, level: number) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, {
      level,
      speciesId: STARTER,
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  const act = (server: FastifyInstance, who: Player, b: PlayerBattle, action: PlayerBattleAction) =>
    call(server, 'POST', `/battles/${b.id}/actions`, who, { action, turn: b.view.turn });

  /** Plays the player's first move every turn until the battle ends. */
  async function playOut(server: FastifyInstance, who: Player, battle: PlayerBattle) {
    let current = battle;
    for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && current.status === 'active'; i++) {
      const side = current.view.sides[current.mySide];
      const action: PlayerBattleAction =
        current.view.phase.type === 'replace'
          ? { type: 'replace', slot: side.squishies.findIndex((s) => s.energy > 0) }
          : { type: 'move', move: side.squishies[side.active]!.moves[0]! };
      const res = await act(server, who, current, action);
      expect(res.statusCode, res.body).toBe(200);
      current = battleOf(res);
    }
    expect(current.status).toBe('finished');
    return current;
  }

  /** A wild battle against a level-1 squishy (the dev route). */
  const wildFight = async (server: FastifyInstance, who: Player, mapId: string) =>
    battleOf(
      await call(server, 'POST', `/maps/${mapId}/dev/battles`, who, { opponent: { level: 1 } }),
    );

  /** Neutral, non-home tiles next to `who`'s land, in (q, r) order. */
  async function edgeOf(mapId: string, who: Player) {
    const all = await db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
    const mine = new Set(all.filter((t) => t.ownerUserId === who.id).map(hexKey));
    return all.filter(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        hexNeighbors(t).some((n) => mine.has(hexKey(n))),
    );
  }
  const setOwner = (tileId: string, userId: string) =>
    db.execute(`update tiles set owner_user_id = '${uuid(userId)}' where id = '${uuid(tileId)}'`);

  const ledgerOf = (userId: string) =>
    db.query.coinLedger.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
      orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
    });

  const balanceRow = (userId: string) =>
    db.query.coinBalances.findFirst({ where: (t, { eq }) => eq(t.userId, userId) });

  /** The cached balance, after checking it equals the ledger's sum (tech spec §4). */
  async function balanceOf(userId: string): Promise<number> {
    const row = await balanceRow(userId);
    const sum = (await ledgerOf(userId)).reduce((total, r) => total + r.amount, 0);
    expect(row?.balance ?? 0).toBe(sum);
    return sum;
  }

  async function coinsOf(server: FastifyInstance, who: Player): Promise<number> {
    const res = await call(server, 'GET', '/coins', who);
    expect(res.statusCode).toBe(200);
    return CoinsResponseSchema.parse(res.json()).coins.balance;
  }

  const credit = (
    who: Player,
    source: 'battle' | 'capture' | 'milestone',
    amount: number,
    refId = uuidv7(),
  ) =>
    withTransaction(db, (tx) =>
      creditCoins(tx, { source, refId, userId: who.id, mapId: null, amount, at: clock }),
    );

  describe('creditCoins', () => {
    it('pays once per source event, however often or however fast it is retried', async () => {
      const kid = await player();
      const refId = uuidv7();
      const first = await credit(kid, 'milestone', 25, refId);
      expect(first).toEqual({ credited: 25, balance: 25 });
      // Five retries at once wait on the balance lock and each find it paid.
      const retries = await Promise.all(
        Array.from({ length: 5 }, () => credit(kid, 'milestone', 25, refId)),
      );
      expect(retries.map((r) => r.credited)).toEqual([0, 0, 0, 0, 0]);
      expect(await ledgerOf(kid.id)).toHaveLength(1);
      expect(await balanceOf(kid.id)).toBe(25);
    });

    it('caps battle and capture coins per account day, in the account’s time zone', async () => {
      const kid = await player();
      const cap = COIN_RULES.dailyCaps.battle;
      // Up to the cap, then the last one is cut short, then nothing.
      const sizes = [cap - 3, 5, 5];
      const credited = [];
      for (const size of sizes) credited.push((await credit(kid, 'battle', size)).credited);
      expect(credited).toEqual([cap - 3, 3, 0]);
      // Another source has its own cap; milestones have none.
      expect((await credit(kid, 'capture', 4)).credited).toBe(4);
      expect((await credit(kid, 'milestone', 500)).credited).toBe(500);
      expect(await ledgerOf(kid.id)).toHaveLength(4);

      // 11:59 PM in Denver is still the same account day…
      clock.setTime(Date.parse('2026-10-03T05:59:00Z'));
      expect((await credit(kid, 'battle', 5)).credited).toBe(0);
      // …and midnight there starts a new one (it's 6 AM in UTC).
      clock.setTime(Date.parse('2026-10-03T06:00:00Z'));
      expect((await credit(kid, 'battle', 5)).credited).toBe(5);
      const days = (await ledgerOf(kid.id)).map((r) => r.day);
      expect(days.at(0)).toBe('2026-10-02');
      expect(days.at(-1)).toBe('2026-10-03');
      expect(await balanceOf(kid.id)).toBe(cap + 4 + 500 + 5);
    });

    it('credits nothing for nothing, and takes no lock for it', async () => {
      const kid = await player();
      expect(await credit(kid, 'battle', 0)).toEqual({ credited: 0, balance: null });
      expect(await balanceRow(kid.id)).toBeUndefined();
    });
  });

  describe('battles', () => {
    it('pays a wild win once, and nothing for a loss', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await grant(server, kid, mapId, 40);
      const won = await playOut(server, kid, await wildFight(server, kid, mapId));
      expect(won.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
      expect(await ledgerOf(kid.id)).toMatchObject([
        { source: 'battle', refId: won.id, amount: COIN_RULES.battleWin.wild, mapId },
      ]);
      expect(await coinsOf(server, kid)).toBe(COIN_RULES.battleWin.wild);

      // A retried finish pays nothing more: the battle refuses the move…
      expect((await act(server, kid, won, { type: 'forfeit' })).statusCode).toBe(409);
      // …and paying the same battle again finds it paid.
      const again = await withTransaction(db, (tx) =>
        creditCoins(tx, {
          source: 'battle',
          refId: won.id,
          userId: kid.id,
          mapId,
          amount: COIN_RULES.battleWin.wild,
          at: clock,
        }),
      );
      expect(again.credited).toBe(0);

      // Running home is a loss: no coins.
      const ran = await act(server, kid, await wildFight(server, kid, mapId), { type: 'forfeit' });
      expect(battleOf(ran).view.phase).toMatchObject({ result: { winner: 'b' } });
      expect(await ledgerOf(kid.id)).toHaveLength(1);
      expect(await balanceOf(kid.id)).toBe(COIN_RULES.battleWin.wild);
    });

    it('pays for befriending a wild squishy, on top of the win', async () => {
      const server = await start();
      const kid = await player();
      // The Glade: a Heart Charm always works there (tutorialOverrides).
      const started = await call(server, 'POST', '/tutorial/start', kid);
      const mapId = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
      await grant(server, kid, mapId, 40);
      const items = await call(server, 'POST', `/maps/${mapId}/dev/items`, kid, {
        items: { 'heart-charm': 1 },
      });
      expect(items.statusCode, items.body).toBe(201);
      const battle = await wildFight(server, kid, mapId);
      const done = battleOf(await act(server, kid, battle, { type: 'capture' }));
      expect(done.view.phase).toMatchObject({ result: { reason: 'captured' } });
      const ledger = await ledgerOf(kid.id);
      expect(ledger.map((r) => [r.source, r.refId, r.amount])).toEqual([
        ['battle', battle.id, COIN_RULES.battleWin.wild],
        ['capture', battle.id, COIN_RULES.capture.wild],
      ]);
      expect(await balanceOf(kid.id)).toBe(COIN_RULES.battleWin.wild + COIN_RULES.capture.wild);
    });

    it('pays for claiming a tile', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await grant(server, kid, mapId, 40);
      const [target] = await edgeOf(mapId, kid);
      const battle = battleOf(
        await call(server, 'POST', `/maps/${mapId}/attacks`, kid, { q: target!.q, r: target!.r }),
      );
      await playOut(server, kid, battle);
      expect((await ledgerOf(kid.id)).map((r) => [r.source, r.amount])).toEqual([
        ['battle', COIN_RULES.battleWin.tile],
        ['capture', COIN_RULES.capture.tile],
      ]);
    });

    it('pays Gentle’s share for picking on a much smaller player', async () => {
      const server = await start();
      const kid = await player();
      const rival = await player();
      const mapId = await patch(server, kid, [rival]);
      await grant(server, kid, mapId, 40);
      clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);
      // The rival holds one tile next to the kid, who holds lots more land.
      const [near, ...rest] = await edgeOf(mapId, kid);
      await setOwner(near!.id, rival.id);
      for (const tile of rest.slice(0, 6)) await setOwner(tile.id, kid.id);
      const battle = battleOf(
        await call(server, 'POST', `/maps/${mapId}/attacks`, kid, { q: near!.q, r: near!.r }),
      );
      const done = await playOut(server, kid, battle);
      expect(done.rewards?.percent).toBe(TERRITORY_RULES.gentle.rewardPercent);
      const share = (coins: number) =>
        Math.floor((coins * TERRITORY_RULES.gentle.rewardPercent) / 100);
      expect((await ledgerOf(kid.id)).map((r) => [r.source, r.amount])).toEqual([
        ['battle', share(COIN_RULES.battleWin['rival-tile'])],
        ['capture', share(COIN_RULES.capture.tile)],
      ]);
    });
  });

  describe('care', () => {
    async function squishy(mapId: string, who: Player): Promise<string> {
      const [row] = await db
        .insert(squishies)
        .values({
          mapId,
          ownerUserId: who.id,
          speciesId: STARTER,
          element: 'fire',
          feeling: 'cozy',
        })
        .returning({ id: squishies.id });
      return row!.id;
    }

    const care = (
      server: FastifyInstance,
      who: Player,
      mapId: string,
      id: string,
      action: string,
      headers: Record<string, string> = {},
    ) => call(server, 'POST', `/maps/${mapId}/squishies/${id}/care`, who, { action }, headers);

    it('pays out exactly what the care log records, up to its daily cap', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push(await squishy(mapId, kid));
      // Three full actions a squishy (pet, play, pet again past the debounce):
      // twelve coins' worth, past the cap of ten.
      for (const id of ids) {
        for (const action of ['pet', 'play']) {
          const res = await care(server, kid, mapId, id, action);
          expect(res.statusCode, res.body).toBe(200);
        }
      }
      clock.setTime(clock.getTime() + 11_000);
      for (const id of ids) {
        const res = await care(server, kid, mapId, id, 'pet');
        expect(CareResponseSchema.parse(res.json()).result.full).toBe(true);
      }

      const log = await db.query.careLog.findMany({ where: (t, { eq }) => eq(t.userId, kid.id) });
      const paid = await ledgerOf(kid.id);
      expect(log.reduce((total, r) => total + r.coins, 0)).toBe(CARE_RULES.dailyCoinCap);
      // One ledger row per care action that earned something, for what it earned.
      expect(paid.map((r) => [r.source, r.refId, r.amount, r.mapId]).sort()).toEqual(
        log
          .filter((r) => r.coins > 0)
          .map((r) => ['care', r.id, r.coins, mapId])
          .sort(),
      );
      expect(await balanceOf(kid.id)).toBe(CARE_RULES.dailyCoinCap);
    });

    it('pays a retried care action once (Idempotency-Key)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const id = await squishy(mapId, kid);
      const headers = { 'idempotency-key': 'pet-once' };
      const first = await care(server, kid, mapId, id, 'pet', headers);
      const again = await care(server, kid, mapId, id, 'pet', headers);
      expect(first.statusCode).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(await ledgerOf(kid.id)).toHaveLength(1);
      expect(await coinsOf(server, kid)).toBe(CARE_RULES.coinsPerFullAction);
    });
  });

  it('hands out coins on the dev route, and shows a new player 0', async () => {
    const server = await start();
    const kid = await player();
    expect(await coinsOf(server, kid)).toBe(0);
    const res = await call(server, 'POST', '/dev/coins', kid, { amount: 40 });
    expect(res.statusCode, res.body).toBe(201);
    expect(CoinsResponseSchema.parse(res.json()).coins.balance).toBe(40);
    expect(await coinsOf(server, kid)).toBe(40);
    expect(await ledgerOf(kid.id)).toMatchObject([{ source: 'dev-grant', amount: 40 }]);
    // Nothing else can read it.
    const anon = await server.inject({ method: 'GET', url: '/api/v1/coins', headers: HEADERS });
    expect(anon.statusCode).toBe(401);
    expect(await ledgerOf(kid.id)).toHaveLength(1);
  });
});
