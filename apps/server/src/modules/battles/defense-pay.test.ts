import {
  BATTLE_RULES,
  BattleResponseSchema,
  COIN_RULES,
  GROWTH_RULES,
  HEART_COIN_RULES,
  hexKey,
  hexNeighbors,
  JoinMapResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  RaidReplayResponseSchema,
  RaidReportResponseSchema,
  SquishyResponseSchema,
  TERRITORY_RULES,
  type PlayerBattle,
  type PlayerBattleAction,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { creditCoins } from '../coins/service.js';
import { creditHeartCoins } from '../heart-coins/service.js';
import { createRaidsConsumer } from '../raids/consumer.js';
import { createBattlesRepo } from './repo.js';
import { sideBRefId } from './service.js';
import { bigMove } from '../../../tests/big-move.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const ORIGIN = 'http://localhost:5173';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const START = '2026-10-10T18:00:00Z';
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
const UUID = /^[0-9a-f-]{36}$/;
const uuid = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
};
const DEFENSE_PATCH = COIN_RULES.defenseWin['rival-tile'];
const DEFENSE_HEART = HEART_COIN_RULES.defenseWin['rival-tile'];

describe('side b’s coin key (#728)', () => {
  it('sideBRefId is stable and differs from the battle id', () => {
    const battleId = uuidv7();
    expect(sideBRefId(battleId)).toBe(sideBRefId(battleId));
    expect(sideBRefId(battleId)).not.toBe(battleId);
    expect(sideBRefId(battleId)).toMatch(UUID);
    expect(sideBRefId(uuidv7())).not.toBe(sideBRefId(battleId));
  });
});

interface Player {
  id: string;
  token: string;
}

describe.skipIf(!url)('a won defence pays the defender (#728, needs DATABASE_URL)', () => {
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
      PUBLIC_ORIGIN: ORIGIN,
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `paykid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, token };
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

  const battleOf = (res: LightMyRequestResponse) => {
    expect(res.statusCode, res.body).toBeLessThan(300);
    return BattleResponseSchema.parse(res.json()).battle;
  };

  /**
   * Lee (the challenger) and Sam (the defender) on Lee's patch. Sam holds
   * the tile next to Lee's land, past the new-player shield, with `guard`
   * on watch (or nobody, so the land's guardians stand in). Sam is never
   * online, so nobody is asked "Defend now?": the AI plays side b.
   */
  async function rivals(
    server: FastifyInstance,
    options: { leeLevel: number; guardLevel: number; watch?: boolean },
  ) {
    const [lee, sam] = [await player(), await player()];
    const res = await call(server, 'POST', '/maps', lee, {
      name: 'Defence Pay Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const map = MapResponseSchema.parse(res.json()).map;
    const joined = await call(server, 'POST', '/maps/join', sam, {
      code: map.admin!.invite!.code,
    });
    const request = JoinMapResponseSchema.parse(joined.json()).request;
    const ok = await call(server, 'POST', `/maps/${map.id}/requests/${request.id}/approve`, lee);
    expect(ok.statusCode, ok.body).toBe(204);
    const grant = async (who: Player, level: number, speciesId: string) => {
      const granted = await call(server, 'POST', `/maps/${map.id}/dev/squishies`, who, {
        speciesId,
        level,
      });
      expect(granted.statusCode, granted.body).toBe(201);
      return SquishyResponseSchema.parse(granted.json()).squishy;
    };
    const hero = await grant(lee, options.leeLevel, 'emberbun');
    const guard = await grant(sam, options.guardLevel, 'puddlepuff');
    clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);

    const tiles = await db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, map.id),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
    const mine = new Set(tiles.filter((t) => t.ownerUserId === lee.id).map(hexKey));
    const edge = tiles.filter(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        hexNeighbors(t).some((n) => mine.has(hexKey(n))),
    );
    const near = edge[0]!;
    // Our own uuids, so raw SQL is safe.
    await db.execute(
      `update tiles set owner_user_id = '${uuid(sam.id)}' where id = '${uuid(near.id)}'`,
    );
    if (options.watch !== false) {
      const watch = await call(server, 'POST', `/maps/${map.id}/defenders`, sam, {
        q: near.q,
        r: near.r,
        squishyIds: [guard.id],
      });
      expect(watch.statusCode, watch.body).toBe(200);
    }
    return { lee, sam, mapId: map.id, near, edge: edge.slice(1), guard, hero };
  }

  const attack = async (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    h: { q: number; r: number },
  ) => {
    const battle = battleOf(
      await call(server, 'POST', `/maps/${mapId}/attacks`, who, { q: h.q, r: h.r }),
    );
    expect(battle.kind).toBe('rival-tile');
    expect(battle.defensePrompt).toBeUndefined();
    return battle;
  };
  const act = (server: FastifyInstance, who: Player, b: PlayerBattle, action: PlayerBattleAction) =>
    call(server, 'POST', `/battles/${b.id}/actions`, who, { action, turn: b.view.turn });
  const nextAction = (b: PlayerBattle): PlayerBattleAction => {
    const side = b.view.sides[b.mySide];
    return b.view.phase.type === 'replace'
      ? { type: 'replace', slot: side.squishies.findIndex((s) => s.energy > 0) }
      : { type: 'move', move: bigMove(side.squishies[side.active]!) };
  };

  /** Plays the challenger's big move every turn until the battle ends. */
  async function playOut(server: FastifyInstance, who: Player, battle: PlayerBattle) {
    let current = battle;
    for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && current.status === 'active'; i++) {
      current = battleOf(await act(server, who, current, nextAction(current)));
    }
    expect(current.status).toBe('finished');
    return current;
  }

  const resultOf = (b: PlayerBattle) => {
    if (b.view.phase.type !== 'over') throw new Error('the battle is not over');
    return b.view.phase.result;
  };
  /** The stored rewards (side a's view of the row, with `b` in it). */
  const rewardsOf = async (battleId: string) =>
    (await createBattlesRepo(db).findBattle(battleId))!.rewards!;
  const ledgerOf = async (refId: string) => ({
    patch: await db.query.coinLedger.findMany({ where: (t, { eq }) => eq(t.refId, refId) }),
    heart: await db.query.heartCoinLedger.findMany({ where: (t, { eq }) => eq(t.refId, refId) }),
  });
  const squishyOf = async (id: string) =>
    (await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
  const endedOf = async (mapId: string, battleId: string) => {
    const events = await db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'battle.ended')),
    });
    const payloads = events.map((e) => parseGameEventPayload('battle.ended', e.payload));
    return payloads.find((p) => p.battleId === battleId)!;
  };
  const raidsOf = async (server: FastifyInstance, who: Player, mapId: string) => {
    await runConsumer(db, createRaidsConsumer(), mapId);
    const res = await call(server, 'GET', `/maps/${mapId}/raids`, who);
    expect(res.statusCode, res.body).toBe(200);
    return RaidReportResponseSchema.parse(res.json()).report.raids;
  };
  /** A strong guard against a weak challenger: the land holds. */
  async function hold(
    server: FastifyInstance,
    lee: Player,
    mapId: string,
    near: { q: number; r: number },
  ) {
    const done = await playOut(server, lee, await attack(server, lee, mapId, near));
    expect(resultOf(done)).toMatchObject({ winner: 'b' });
    expect(resultOf(done).reason).not.toBe('forfeit');
    return done;
  }

  it('a won AI defence awards side b’s guards XP and pays the defender 3 + 3', async () => {
    const server = await start();
    const { lee, sam, mapId, near, guard } = await rivals(server, { leeLevel: 2, guardLevel: 60 });
    const before = await squishyOf(guard.id);
    const started = await attack(server, lee, mapId, near);
    expect(started.view.sides.b.controller).toEqual({ type: 'ai', policy: 'balanced' });
    const done = await playOut(server, lee, started);
    const result = resultOf(done);
    expect(result).toMatchObject({ winner: 'b' });
    expect(result.reason).not.toBe('forfeit');
    const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, near.id) });
    expect(tile?.ownerUserId).toBe(sam.id);

    const base = result.xp.find((a) => a.side === 'b' && a.squishyId === guard.id)!.xp;
    expect(base).toBeGreaterThan(0);
    const rewards = await rewardsOf(done.id);
    // Lee lost: nothing credited to side a.
    expect(rewards.coins).toEqual({ patch: 0, heart: 0 });
    expect(rewards.b).toMatchObject({
      userId: sam.id,
      fullXpResetAt: null,
      coins: { patch: DEFENSE_PATCH, heart: DEFENSE_HEART },
      unpaid: null,
    });
    expect(DEFENSE_PATCH).toBe(3);
    expect(DEFENSE_HEART).toBe(3);
    expect(rewards.b!.xp.map((x) => x.squishyId)).toEqual([guard.id]);
    const granted = rewards.b!.xp[0]!.xp;
    // Care × habitat (100–175%), never a share.
    expect(granted).toBeGreaterThanOrEqual(base);
    expect(granted).toBeLessThanOrEqual(Math.floor((base * 175) / 100));

    // One credit each, keyed side b's ref, never the battle id.
    const ref = sideBRefId(done.id);
    const ledger = await ledgerOf(ref);
    expect(ledger.patch).toMatchObject([
      { userId: sam.id, source: 'battle', amount: DEFENSE_PATCH, mapId },
    ]);
    expect(ledger.heart).toMatchObject([
      { userId: sam.id, source: 'battle', amount: DEFENSE_HEART, mapId },
    ]);
    const leeLedger = await ledgerOf(done.id);
    expect(leeLedger.patch).toEqual([]);
    expect(leeLedger.heart).toEqual([]);

    const ended = await endedOf(mapId, done.id);
    expect(ended.defender).toEqual({ userId: sam.id, xp: [{ squishyId: guard.id, xp: granted }] });

    const after = await squishyOf(guard.id);
    expect(after.level > before.level || after.xp > before.xp).toBe(true);
    expect(after.ownerUserId).toBe(sam.id);
  });

  it('a lost defence awards side b nothing', async () => {
    const server = await start();
    const { lee, sam, mapId, near, guard } = await rivals(server, { leeLevel: 60, guardLevel: 2 });
    const before = await squishyOf(guard.id);
    const done = await playOut(server, lee, await attack(server, lee, mapId, near));
    expect(resultOf(done)).toMatchObject({ winner: 'a' });
    const rewards = await rewardsOf(done.id);
    expect(rewards.b).toBeNull();
    expect(await ledgerOf(sideBRefId(done.id))).toEqual({ patch: [], heart: [] });
    expect((await endedOf(mapId, done.id)).defender).toBeUndefined();
    const after = await squishyOf(guard.id);
    expect({ level: after.level, xp: after.xp }).toEqual({ level: before.level, xp: before.xp });
    const raid = (await raidsOf(server, sam, mapId)).find((r) => r.battleId === done.id);
    expect(raid?.earned).toBeNull();
  });

  it('guardians standing in earn no XP and pay no coins', async () => {
    const server = await start();
    // Sam's level-60 squishy stays home; the guardians fight at its floor.
    const { lee, sam, mapId, near } = await rivals(server, {
      leeLevel: 2,
      guardLevel: 60,
      watch: false,
    });
    const started = await attack(server, lee, mapId, near);
    expect(started.view.sides.b.controller).toEqual({ type: 'ai', policy: 'guardian' });
    const done = await playOut(server, lee, started);
    expect(resultOf(done)).toMatchObject({ winner: 'b' });
    expect(resultOf(done).reason).not.toBe('forfeit');
    // The engine gives the guardians XP, but nobody is there to take it.
    expect(resultOf(done).xp.some((a) => a.side === 'b' && a.xp > 0)).toBe(true);

    const rewards = await rewardsOf(done.id);
    expect(rewards.b).toEqual({
      userId: sam.id,
      xp: [],
      fullXpResetAt: null,
      coins: null,
      unpaid: 'guardians',
    });
    expect(await ledgerOf(sideBRefId(done.id))).toEqual({ patch: [], heart: [] });
    expect((await endedOf(mapId, done.id)).defender).toEqual({ userId: sam.id, xp: [] });
    const raid = (await raidsOf(server, sam, mapId)).find((r) => r.battleId === done.id);
    expect(raid?.earned).toBeNull();
  });

  it('a scooted challenger pays the defender XP but no coins', async () => {
    const server = await start();
    const { lee, sam, mapId, near, guard } = await rivals(server, { leeLevel: 20, guardLevel: 20 });
    const started = await attack(server, lee, mapId, near);
    const played = battleOf(await act(server, lee, started, nextAction(started)));
    expect(played.status, 'one turn should leave both standing').toBe('active');
    expect(played.view.turn).toBeGreaterThan(0);
    const done = battleOf(await act(server, lee, played, { type: 'forfeit' }));
    expect(resultOf(done)).toMatchObject({ winner: 'b', reason: 'forfeit' });

    const base = resultOf(done).xp.find((a) => a.side === 'b' && a.squishyId === guard.id)!.xp;
    expect(base).toBeGreaterThanOrEqual(BATTLE_RULES.xp.minimum);
    const rewards = await rewardsOf(done.id);
    expect(rewards.b).toMatchObject({ userId: sam.id, coins: null, unpaid: 'scooted' });
    expect(rewards.b!.xp.map((x) => x.squishyId)).toEqual([guard.id]);
    expect(rewards.b!.xp[0]!.xp).toBeGreaterThanOrEqual(base);
    expect(await ledgerOf(sideBRefId(done.id))).toEqual({ patch: [], heart: [] });
    // The raid log shows the XP and no coins.
    const raid = (await raidsOf(server, sam, mapId)).find((r) => r.battleId === done.id);
    expect(raid?.earned).toEqual({ xp: rewards.b!.xp[0]!.xp, patch: 0, heart: 0 });
  });

  it('a scoot at turn 0 pays the defender nothing', async () => {
    const server = await start();
    const { lee, sam, mapId, near, guard } = await rivals(server, { leeLevel: 20, guardLevel: 20 });
    const before = await squishyOf(guard.id);
    const started = await attack(server, lee, mapId, near);
    const done = battleOf(await act(server, lee, started, { type: 'forfeit' }));
    expect(resultOf(done)).toMatchObject({ winner: 'b', reason: 'forfeit', turns: 0 });
    const rewards = await rewardsOf(done.id);
    expect(rewards.b).toEqual({
      userId: sam.id,
      xp: [],
      fullXpResetAt: null,
      coins: null,
      unpaid: 'scooted',
    });
    expect(await ledgerOf(sideBRefId(done.id))).toEqual({ patch: [], heart: [] });
    const after = await squishyOf(guard.id);
    expect({ level: after.level, xp: after.xp }).toEqual({ level: before.level, xp: before.xp });
  });

  it('Gentle’s share scales the challenger, never the defender', async () => {
    const server = await start();
    const { lee, sam, mapId, near, guard, edge } = await rivals(server, {
      leeLevel: 2,
      guardLevel: 60,
    });
    // Lee has lots of land, Sam one tile: picking on a much smaller player (Gentle, the default).
    for (const tile of edge.slice(0, 8)) {
      await db.execute(
        `update tiles set owner_user_id = '${uuid(lee.id)}' where id = '${uuid(tile.id)}'`,
      );
    }
    const done = await hold(server, lee, mapId, near);
    const rewards = await rewardsOf(done.id);
    expect(rewards.percent).toBe(TERRITORY_RULES.gentle.rewardPercent);
    expect(rewards.percent).toBeLessThan(100);
    const base = resultOf(done).xp.find((a) => a.side === 'b' && a.squishyId === guard.id)!.xp;
    // Not halved: at least the full base (care × habitat is 100–175%).
    expect(rewards.b!.xp[0]!.xp).toBeGreaterThanOrEqual(base);
    expect(rewards.b).toMatchObject({
      userId: sam.id,
      coins: { patch: DEFENSE_PATCH, heart: DEFENSE_HEART },
      unpaid: null,
    });
  });

  it('a defender past the battle cap gets XP and rewards.b.coins shows the credited 0', async () => {
    const server = await start();
    const { lee, sam, mapId, near, guard } = await rivals(server, { leeLevel: 2, guardLevel: 60 });
    // Sam has already earned today's battle coins in both currencies.
    await withTransaction(db, async (tx) => {
      const at = new Date(clock);
      const patch = await creditCoins(tx, {
        source: 'battle',
        refId: uuidv7(),
        userId: sam.id,
        mapId,
        amount: COIN_RULES.dailyCaps.battle,
        at,
      });
      const heart = await creditHeartCoins(tx, {
        source: 'battle',
        refId: uuidv7(),
        userId: sam.id,
        mapId,
        amount: HEART_COIN_RULES.dailyCaps.battle,
        at,
      });
      expect(patch.credited).toBe(COIN_RULES.dailyCaps.battle);
      expect(heart.credited).toBe(HEART_COIN_RULES.dailyCaps.battle);
    });
    const done = await hold(server, lee, mapId, near);
    const rewards = await rewardsOf(done.id);
    expect(rewards.b).toMatchObject({
      userId: sam.id,
      coins: { patch: 0, heart: 0 },
      unpaid: null,
    });
    expect(rewards.b!.xp.map((x) => x.squishyId)).toEqual([guard.id]);
    expect(rewards.b!.xp[0]!.xp).toBeGreaterThan(0);
    expect(await ledgerOf(sideBRefId(done.id))).toEqual({ patch: [], heart: [] });
    const raid = (await raidsOf(server, sam, mapId)).find((r) => r.battleId === done.id);
    expect(raid?.earned).toEqual({ xp: rewards.b!.xp[0]!.xp, patch: 0, heart: 0 });
  });

  it('a defender’s guard past 7 wins today gets 10% (holds count)', async () => {
    const server = await start();
    const { lee, sam, mapId, near, guard } = await rivals(server, { leeLevel: 2, guardLevel: 60 });
    const first = await hold(server, lee, mapId, near);
    const repo = createBattlesRepo(db);
    expect((await repo.winsToday(mapId, [guard.id], clock)).get(guard.id)).toBe(1);
    // Six more holds today, as copies of the first finished battle.
    const falloff = GROWTH_RULES.battleXpFalloff!;
    const full = falloff.fullWinsPerDay;
    await db.execute(
      `insert into battles
       select (jsonb_populate_record(null::battles, to_jsonb(b) || jsonb_build_object('id', gen_random_uuid()))).*
       from battles b, generate_series(1, ${String(full - 1)})
       where b.id = '${uuid(first.id)}'`,
    );
    expect((await repo.winsToday(mapId, [guard.id], clock)).get(guard.id)).toBe(full);

    // Past the tile's cooldown, still the same patch day.
    clock.setTime(clock.getTime() + (TERRITORY_RULES.cooldownHours + 1) * HOUR_MS);
    const done = await hold(server, lee, mapId, near);
    const base = resultOf(done).xp.find((a) => a.side === 'b' && a.squishyId === guard.id)!.xp;
    const cut = Math.floor((base * falloff.afterPercent) / 100);
    const rewards = await rewardsOf(done.id);
    expect(rewards.b!.xp.map((x) => x.squishyId)).toEqual([guard.id]);
    const granted = rewards.b!.xp[0]!.xp;
    expect(granted).toBeGreaterThanOrEqual(cut);
    expect(granted).toBeLessThanOrEqual(Math.floor((cut * 175) / 100));
    expect(granted).toBeLessThan(base);
    expect(rewards.b!.fullXpResetAt).not.toBeNull();
    // Side a's falloff is its own: Lee lost, nothing cut there.
    expect(rewards.fullXpResetAt).toBeNull();
    // Coins still pay (under the caps).
    expect(rewards.b!.coins).toEqual({ patch: DEFENSE_PATCH, heart: DEFENSE_HEART });
    expect(sam.id).toBe(rewards.b!.userId);
  });

  it('Raid.earned comes from battles.rewards.b; null for old rows and for a guardian hold', async () => {
    const server = await start();
    const { lee, sam, mapId, near } = await rivals(server, { leeLevel: 2, guardLevel: 60 });
    const done = await hold(server, lee, mapId, near);
    const rewards = await rewardsOf(done.id);
    const raid = (await raidsOf(server, sam, mapId)).find((r) => r.battleId === done.id);
    expect(raid?.earned).toEqual({
      xp: rewards.b!.xp.reduce((sum, x) => sum + x.xp, 0),
      patch: DEFENSE_PATCH,
      heart: DEFENSE_HEART,
    });

    // A row from before #728 has no `b` (nor `coins`).
    await db.execute(
      `update battles set rewards = rewards - 'b' - 'coins' where id = '${uuid(done.id)}'`,
    );
    const old = (await raidsOf(server, sam, mapId)).find((r) => r.battleId === done.id);
    expect(old?.earned).toBeNull();

    // Land the guardians held alone.
    const second = await rivals(server, { leeLevel: 2, guardLevel: 60, watch: false });
    const guarded = await playOut(
      server,
      second.lee,
      await attack(server, second.lee, second.mapId, second.near),
    );
    expect(resultOf(guarded)).toMatchObject({ winner: 'b' });
    const guardianRaid = (await raidsOf(server, second.sam, second.mapId)).find(
      (r) => r.battleId === guarded.id,
    );
    expect(guardianRaid).toBeDefined();
    expect(guardianRaid?.earned).toBeNull();
  });

  it('PlayerBattle.rewards for side b is the reshaped rewards.b', async () => {
    const server = await start();
    const { lee, sam, mapId, near } = await rivals(server, { leeLevel: 2, guardLevel: 60 });
    const done = await hold(server, lee, mapId, near);
    const stored = await rewardsOf(done.id);
    const raid = (await raidsOf(server, sam, mapId)).find((r) => r.battleId === done.id)!;
    const res = await call(server, 'GET', `/maps/${mapId}/raids/${raid.id}/replay`, sam);
    expect(res.statusCode, res.body).toBe(200);
    const { end } = RaidReplayResponseSchema.parse(res.json()).replay;
    expect(end.mySide).toBe('b');
    expect(end.rewards).toEqual({
      xp: stored.b!.xp,
      percent: 100,
      fullXpResetAt: stored.b!.fullXpResetAt,
      coins: stored.b!.coins,
      b: stored.b,
    });
    // Side a still sees its own stored rewards.
    expect(done.rewards?.percent).toBe(stored.percent);
    expect(done.rewards?.coins).toEqual({ patch: 0, heart: 0 });
  });

  it('a replayed finish credits nothing twice', async () => {
    const server = await start();
    const { lee, sam, mapId, near } = await rivals(server, { leeLevel: 2, guardLevel: 60 });
    const done = await hold(server, lee, mapId, near);
    const ref = sideBRefId(done.id);
    // The same credits again, as a retried finish would make them.
    await withTransaction(db, async (tx) => {
      const at = new Date(clock);
      const base = { source: 'battle' as const, refId: ref, userId: sam.id, mapId, at };
      expect((await creditCoins(tx, { ...base, amount: DEFENSE_PATCH })).credited).toBe(0);
      expect((await creditHeartCoins(tx, { ...base, amount: DEFENSE_HEART })).credited).toBe(0);
    });
    const ledger = await ledgerOf(ref);
    expect(ledger.patch).toHaveLength(1);
    expect(ledger.heart).toHaveLength(1);
    // A finished battle takes no more actions.
    const again = await act(server, lee, done, { type: 'forfeit' });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
    expect(await ledgerOf(ref)).toEqual(ledger);
  });
});
