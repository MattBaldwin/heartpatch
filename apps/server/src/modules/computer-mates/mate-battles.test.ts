import {
  BATTLE_RULES,
  BattleResponseSchema,
  BattleResultSchema,
  BattleRewardsSchema,
  ChallengeResponseSchema,
  ChallengesResponseSchema,
  CHALLENGE_RULES,
  hexDistance,
  hexKey,
  hexNeighbors,
  LIVE_BATTLE_RULES,
  TERRITORY_RULES,
  MapResponseSchema,
  SquishyResponseSchema,
  type PlayerBattle,
  type PlayerBattleAction,
} from '@heartpatch/shared';
import {
  claimableTiles,
  COMPUTER_MATES,
  type ComputerMatesSecrets,
} from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { sideBRefId } from '../../lib/side-b-ref.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesService } from '../battles/service.js';
import { createFencesRepo } from '../fences/repo.js';
import { heartSeedOf } from '../maps/depart.js';
import { createTerritoryRepo, type TerritoryTileRow } from '../territory/repo.js';
import { createTerritoryService, createTileBattlePort } from '../territory/service.js';
import { computerChallenge, createComputerMateSteps } from './intents.js';
import { createComputerMatesRepo } from './repo.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** 09:00 in the patch's time zone (America/Chicago, CDT): far from the quiet hours. */
const START = '2026-10-10T14:00:00Z';
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
/** Our own uuids only, so raw SQL is safe. */
const uuid = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
};

/** Mates that only ever challenge (no claims, fires, trades, gifts or guards), at `levelOffset`. */
const challengers = (levelOffset: number): ComputerMatesSecrets => ({
  rules: { ...COMPUTER_MATES.rules, fireEveryTiles: 1000 },
  personas: COMPUTER_MATES.personas.map((p) => ({
    ...p,
    levelOffset,
    weights: { claim: 0, trade: 0, gift: 0, guard: 0, challenge: 1 },
  })),
});
/** Their team ends up far above the kid's: a sure mate win. */
const STRONG = challengers(40);
/** Their team stays at level 1: a sure loss against a level-40 guard. */
const WEAK = challengers(-100);

describe.skipIf(!url)('computer patch-mates battle (#386e, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let clock = new Date(START);
  let counter = 0;
  /**
   * Whether the mates see the kid online (their step's `isOnline`): a mate
   * challenges only a kid who is (#823 ruling). Kept apart from the
   * battles' `online` so a test can have the kid "here" for the mates
   * without a "Defend now?" prompt.
   */
  let seesKid = true;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock = new Date(START);
    seesKid = true;
  });

  /** A kid alone on their patch with computer friends on: three mates. */
  async function soloPatch() {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_SIGNUP_CODE: 'mate-battles-code',
      HP_COMPUTER_MATES: 'on',
      HP_DEV_SQUISHY_GRANTS: 'true',
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    const username = `matebattler_${String((counter += 1))}_${String(Date.now() % 100000)}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014 })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const cookies = { [SESSION_COOKIE]: token };
    const made = await app.inject({
      method: 'POST',
      url: '/api/v1/maps',
      headers: HEADERS,
      cookies,
      payload: { name: 'Mate Battle Hollow', timeZone: 'America/Chicago' },
    });
    expect(made.statusCode, made.body).toBe(201);
    const map = MapResponseSchema.parse(made.json()).map;
    const on = await app.inject({
      method: 'POST',
      url: `/api/v1/maps/${map.id}/computer-mates`,
      headers: HEADERS,
      cookies,
      payload: { enabled: true },
    });
    expect(on.statusCode, on.body).toBe(200);
    const mates = await db.query.computerMates.findMany({
      where: (t, { eq }) => eq(t.mapId, map.id),
      orderBy: (t, { asc }) => [asc(t.userId)],
    });
    expect(mates.length).toBe(3);
    const kid = { id: user!.id, username };
    return { kid, cookies, mapId: map.id, mates: mates.map((m) => m.userId) };
  }

  const call = (
    cookies: Record<string, string>,
    method: 'GET' | 'POST',
    path: string,
    payload?: object,
  ) =>
    app!.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies,
      ...(payload ? { payload } : {}),
    });

  /** A dev squishy for the kid (`HP_DEV_SQUISHY_GRANTS`). */
  const grant = async (cookies: Record<string, string>, mapId: string, level: number) => {
    const res = await call(cookies, 'POST', `/maps/${mapId}/dev/squishies`, {
      speciesId: 'puddlepuff',
      level,
    });
    expect(res.statusCode, res.body).toBe(201);
    return SquishyResponseSchema.parse(res.json()).squishy;
  };

  const setLevel = (userId: string, level: number) =>
    db.execute(
      `update squishies set level = ${String(level)} where owner_user_id = '${uuid(userId)}'`,
    );

  /** The kid joined long enough ago to be past the new-player shield (or `at`). */
  const setJoinedAt = (mapId: string, userId: string, at: Date) =>
    db.execute(
      `update map_members set joined_at = '${at.toISOString()}' where map_id = '${uuid(mapId)}' and user_id = '${uuid(userId)}'`,
    );

  const battleRowOf = async (battleId: string) =>
    (await db.query.battles.findFirst({ where: (t, { eq }) => eq(t.id, battleId) }))!;
  const rewardsOf = async (battleId: string) =>
    BattleRewardsSchema.parse((await battleRowOf(battleId)).rewards);
  const resultOf = async (battleId: string) =>
    BattleResultSchema.parse((await battleRowOf(battleId)).result);
  const ledgerOf = async (refId: string) => ({
    patch: (await db.query.coinLedger.findMany({ where: (t, { eq }) => eq(t.refId, refId) })).map(
      (r) => [r.userId, r.amount],
    ),
    heart: (
      await db.query.heartCoinLedger.findMany({ where: (t, { eq }) => eq(t.refId, refId) })
    ).map((r) => [r.userId, r.amount]),
  });
  /** Everything a mate could have been credited, anywhere. */
  const mateCredits = async (mateId: string) => ({
    patch: await db.query.coinLedger.findMany({ where: (t, { eq }) => eq(t.userId, mateId) }),
    heart: await db.query.heartCoinLedger.findMany({ where: (t, { eq }) => eq(t.userId, mateId) }),
    clothing: await db.query.clothingOwned.findMany({ where: (t, { eq }) => eq(t.userId, mateId) }),
    seen: await db.query.speciesSeen.findMany({ where: (t, { eq }) => eq(t.userId, mateId) }),
  });
  const noCredits = { patch: [], heart: [], clothing: [], seen: [] };
  const mateBattles = (mateId: string) =>
    db.query.battles.findMany({ where: (t, { eq }) => eq(t.playerUserId, mateId) });
  const attacksOn = (tileId: string) =>
    db.query.tileAttacks.findMany({ where: (t, { eq }) => eq(t.tileId, tileId) });
  const stepOf = async (userId: string) =>
    (await db.query.computerMates.findFirst({ where: (t, { eq }) => eq(t.userId, userId) }))!;

  /** The kid's move (or send-out) in the battle they see. */
  const nextAction = (b: PlayerBattle): PlayerBattleAction => {
    const side = b.view.sides[b.mySide];
    return b.view.phase.type === 'replace'
      ? {
          type: 'replace',
          slot: side.squishies.findIndex((s, slot) => slot !== side.active && s.energy > 0),
        }
      : { type: 'move', move: side.squishies[side.active]!.moves[0]! };
  };

  /** Battles and territory sharing the test database, the way the app wires them. */
  function services(
    secrets: ComputerMatesSecrets,
    online: (userId: string) => boolean = () => false,
  ) {
    const isOnline = (_mapId: string, userId: string) => online(userId);
    const battles = createBattlesService({
      db,
      clock: () => clock,
      isOnline,
      tileBattles: createTileBattlePort(),
    });
    const territory = createTerritoryService({ db, clock: () => clock, battles, isOnline });
    const steps = createComputerMateSteps({
      db,
      clock: () => clock,
      secrets,
      territory,
      battles,
      isOnline: (_mapId, userId) => seesKid || online(userId),
    });
    return { battles, steps, territory };
  }

  /** Runs one step of `mate` right now. */
  async function mateStep(
    steps: ReturnType<typeof createComputerMateSteps>,
    mapId: string,
    mate: string,
  ) {
    const repo = createComputerMatesRepo(db);
    await repo.setNextActAt(mate, clock);
    await repo.stampSeen(mapId, clock);
    const result = await steps.act(mate, (await stepOf(mate)).step);
    expect(result).not.toBeNull();
    return result!;
  }

  const claimable = (t: TerritoryTileRow) =>
    t.ownerUserId === null && claimableTiles([{ ...t, restored: false }]).length === 1;

  /**
   * The tile setup for a mate's challenge: the kid (past their shield) holds
   * T, a claimable tile touching one mate's home ring only and more than 2
   * from the kid's Heart Seed, plus `extra` other outer tiles away from
   * every mate. `guard`: the kid's level-40 squishy on watch on T.
   */
  async function challengeSetup(options: { extra?: number; guard?: boolean } = {}) {
    const patch = await soloPatch();
    const { kid, mapId, mates, cookies } = patch;
    await setJoinedAt(mapId, kid.id, new Date(clock.getTime() - 3 * DAY_MS));
    const territory = createTerritoryRepo(db);
    const tiles = await territory.listTiles(mapId);
    const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
    const kidSeed = heartSeedOf(
      tiles.filter((t) => t.ownerUserId === kid.id && t.homeSlot !== null),
    );
    const ownerNear = (t: TerritoryTileRow) =>
      new Set(hexNeighbors(t).map((n) => byKey.get(hexKey(n))?.ownerUserId ?? null));
    let found: { mate: string; target: TerritoryTileRow } | null = null;
    for (const mate of mates) {
      const target = tiles
        .filter(claimable)
        .filter((t) => hexDistance(t, kidSeed) > 2)
        .find((t) => {
          const near = ownerNear(t);
          return near.has(mate) && mates.every((m) => m === mate || !near.has(m));
        });
      if (target) {
        found = { mate, target };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { mate, target } = found!;
    const mateTiles = tiles.filter((t) => t.ownerUserId !== null && mates.includes(t.ownerUserId));
    const farFromMates = (t: TerritoryTileRow, d: number) =>
      mateTiles.every((m) => hexDistance(m, t) >= d) && hexDistance(t, target) >= d;
    const pool = tiles.filter((t) => claimable(t) && t.id !== target.id);
    const extras = [
      ...pool.filter((t) => farFromMates(t, 3)),
      ...pool.filter((t) => !farFromMates(t, 3) && farFromMates(t, 2)),
    ].slice(0, options.extra ?? 5);
    expect(extras.length).toBe(options.extra ?? 5);
    await territory.setOwner(target.id, kid.id);
    for (const t of extras) await territory.setOwner(t.id, kid.id);
    let guard: string | null = null;
    if (options.guard) {
      guard = (await grant(cookies, mapId, 40)).id;
      await territory.replaceDefenders(mapId, target.id, [guard], clock);
    }
    return { ...patch, mate, target, extras, guard, kidSeed, tiles };
  }

  it('a friendly against a computer mate starts without a socket, plays AI picks, and pays coins for 3 wins a day in total', async () => {
    const { kid, cookies, mapId, mates } = await soloPatch();
    await grant(cookies, mapId, 40);
    for (const mate of mates) await setLevel(mate, 1);
    const [a, b, c] = mates as [string, string, string];
    const won: { battleId: string; rewards: Awaited<ReturnType<typeof rewardsOf>> }[] = [];
    for (const mate of [a, b, c, a]) {
      clock = new Date(clock.getTime() + 11 * MINUTE_MS);
      // No socket anywhere: the mate is always here.
      const sent = await call(cookies, 'POST', `/maps/${mapId}/challenges`, { toUserId: mate });
      expect(sent.statusCode, sent.body).toBe(201);
      const { challenge } = ChallengeResponseSchema.parse(sent.json());
      expect(challenge).toMatchObject({ status: 'accepted', toUserId: mate });
      const battleId = challenge.battleId!;
      expect(battleId).toMatch(UUID);
      const live = await db.query.liveBattles.findFirst({
        where: (t, { eq }) => eq(t.battleId, battleId),
      });
      expect(live?.bUserId).toBe(mate);

      // The kid alone picks: each pick plays the turn at once.
      let battle = BattleResponseSchema.parse(
        (await call(cookies, 'GET', `/battles/${battleId}`)).json(),
      ).battle;
      expect(battle.mySide).toBe('a');
      expect(battle.view.sides.b.controller.type).toBe('ai');
      for (let i = 0; i < 2 * BATTLE_RULES.maxTurns && battle.status === 'active'; i++) {
        const turn = battle.view.turn;
        const res = await call(cookies, 'POST', `/battles/${battleId}/actions`, {
          action: nextAction(battle),
          turn,
        });
        expect(res.statusCode, res.body).toBe(200);
        battle = BattleResponseSchema.parse(res.json()).battle;
        if (battle.status === 'active' && battle.view.phase.type === 'turn') {
          expect(battle.view.turn).toBeGreaterThan(turn);
        }
      }
      expect(battle.status).toBe('finished');
      const result = await resultOf(battleId);
      expect(result.winner).toBe('a');
      expect(result.reason).not.toBe('forfeit');
      won.push({ battleId, rewards: await rewardsOf(battleId) });
    }

    for (const [i, { battleId, rewards }] of won.entries()) {
      // The mate earns nothing, win or lose.
      expect(rewards.b).toBeNull();
      const ledger = await ledgerOf(battleId);
      expect(ledger.patch.every(([userId]) => userId === kid.id)).toBe(true);
      expect(ledger.heart.every(([userId]) => userId === kid.id)).toBe(true);
      expect(await ledgerOf(sideBRefId(battleId))).toEqual({ patch: [], heart: [] });
      expect(rewards.xp.length).toBeGreaterThan(0);
      expect(rewards.xp.some((x) => x.xp > 0)).toBe(true);
      if (i < CHALLENGE_RULES.paidWinsPerDayVsComputers) {
        expect(rewards.unpaid).toBeNull();
        expect(rewards.coins!.patch).toBeGreaterThan(0);
        expect(ledger.patch).toEqual([[kid.id, rewards.coins!.patch]]);
      } else {
        // Three wins over all the mates together, then XP only, said as the computer cap.
        expect(rewards.unpaid).toBe('computer-cap');
        expect(rewards.coins).toEqual({ patch: 0, heart: 0 });
        expect(ledger).toEqual({ patch: [], heart: [] });
      }
    }
    for (const mate of mates) {
      expect(await mateCredits(mate)).toEqual(noCredits);
    }
  }, 60_000);

  it('a computer mate says Not now! when it has no team free', async () => {
    const { cookies, mapId, mates } = await soloPatch();
    await grant(cookies, mapId, 40);
    const [mate] = mates as [string];
    await db.execute(
      `update squishies set state = 'hollowed' where owner_user_id = '${uuid(mate)}'`,
    );
    const sent = await call(cookies, 'POST', `/maps/${mapId}/challenges`, { toUserId: mate });
    expect(sent.statusCode, sent.body).toBe(201);
    const { challenge } = ChallengeResponseSchema.parse(sent.json());
    expect(challenge).toMatchObject({ status: 'declined', battleId: null, toUserId: mate });
    const answered = await db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'challenge.answered')),
    });
    expect(answered.map((e) => [e.actorUserId, (e.payload as { answer: string }).answer])).toEqual([
      [mate, 'not-now'],
    ]);
    expect(await db.query.battles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) })).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ kind: 'friendly' })]),
    );
    expect(
      await db.query.liveBattles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) }),
    ).toEqual([]);
  });

  it('the challenges view lists computer mates as here', async () => {
    const { cookies, mapId, mates } = await soloPatch();
    const res = await call(cookies, 'GET', `/maps/${mapId}/challenges`);
    expect(res.statusCode, res.body).toBe(200);
    const view = ChallengesResponseSchema.parse(res.json());
    expect(view.online.map((m) => m.userId).sort()).toEqual([...mates].sort());
    for (const m of view.online) expect(m.inBattle).toBe(false);
  });

  it('a computer challenge nobody defends plays itself and credits side a nothing', async () => {
    const { kid, mapId, mate, target } = await challengeSetup();
    const { steps } = services(STRONG);
    const result = await mateStep(steps, mapId, mate);
    expect(result).toMatchObject({ intent: 'challenge', applied: true });

    const [battle] = await mateBattles(mate);
    expect(battle).toMatchObject({ kind: 'rival-tile', status: 'finished' });
    const res = await resultOf(battle!.id);
    expect(res.winner).toBe('a');
    const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, target.id) });
    expect(tile?.ownerUserId).toBe(mate);
    const [attack] = await attacksOn(target.id);
    expect(attack).toMatchObject({ attackerUserId: mate, defenderUserId: kid.id });
    expect(attack!.outcome).not.toBe('active');

    const rewards = await rewardsOf(battle!.id);
    expect(rewards.xp).toEqual([]);
    expect(rewards.coins).toEqual({ patch: 0, heart: 0 });
    expect(await ledgerOf(battle!.id)).toEqual({ patch: [], heart: [] });
    expect(await mateCredits(mate)).toEqual(noCredits);
  });

  it('a held defence against a computer mate pays the #728 reward once', async () => {
    const { kid, mapId, mate, target } = await challengeSetup({ guard: true });
    const { steps } = services(WEAK);
    const result = await mateStep(steps, mapId, mate);
    expect(result).toMatchObject({ intent: 'challenge', applied: true });

    const [battle] = await mateBattles(mate);
    expect(battle).toMatchObject({ kind: 'rival-tile', status: 'finished' });
    expect((await resultOf(battle!.id)).winner).toBe('b');
    const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, target.id) });
    expect(tile?.ownerUserId).toBe(kid.id);

    const rewards = await rewardsOf(battle!.id);
    expect(rewards.b?.userId).toBe(kid.id);
    const coins = rewards.b!.coins!;
    expect(coins.patch).toBeGreaterThan(0);
    expect(coins.heart).toBeGreaterThan(0);
    expect(await ledgerOf(sideBRefId(battle!.id))).toEqual({
      patch: [[kid.id, coins.patch]],
      heart: [[kid.id, coins.heart]],
    });
    expect(rewards.xp).toEqual([]);
    expect(await ledgerOf(battle!.id)).toEqual({ patch: [], heart: [] });
    expect(await mateCredits(mate)).toEqual(noCredits);
  });

  it('Defend now? from a computer mate: not now plays it out, yes plays live with instant AI picks', async () => {
    for (const answer of ['not-now', 'yes'] as const) {
      const { kid, mapId, mate, target } = await challengeSetup({ guard: true });
      const { steps, battles } = services(WEAK, (userId) => userId === kid.id);
      const result = await mateStep(steps, mapId, mate);
      expect(result).toMatchObject({ intent: 'challenge', applied: true });

      const [battle] = await mateBattles(mate);
      expect(battle).toMatchObject({ kind: 'rival-tile', status: 'active' });
      const [prompt] = await db.query.challenges.findMany({
        where: (t, { and, eq }) => and(eq(t.battleId, battle!.id), eq(t.kind, 'defense')),
      });
      expect(prompt).toMatchObject({ status: 'pending', fromUserId: mate, toUserId: kid.id });
      // The mate comes back just after the window, to play it out then.
      const nextAct = (await stepOf(mate)).nextActAt!;
      expect(nextAct.getTime()).toBeLessThanOrEqual(
        clock.getTime() + LIVE_BATTLE_RULES.defensePromptSeconds * 1000 + MINUTE_MS,
      );

      const answered = await battles.answerDefense(kid, prompt!.id, answer);
      if (answer === 'not-now') {
        expect(answered.battle).toBeNull();
        expect((await battleRowOf(battle!.id)).status).toBe('finished');
        expect((await resultOf(battle!.id)).winner).toBe('b');
      } else {
        let mine = answered.battle!;
        expect(mine.mySide).toBe('b');
        expect(mine.view.sides.a.controller.type).toBe('ai');
        for (let i = 0; i < 2 * BATTLE_RULES.maxTurns && mine.status === 'active'; i++) {
          const turn = mine.view.turn;
          mine = await battles.act(kid, mine.id, { action: nextAction(mine), turn });
          // No waiting for the mate: the turn played on the kid's pick.
          if (mine.status === 'active' && mine.view.phase.type === 'turn') {
            expect(mine.view.turn).toBeGreaterThan(turn);
          }
        }
        expect(mine.status).toBe('finished');
        expect((await resultOf(battle!.id)).winner).toBe('b');
      }
      const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, target.id) });
      expect(tile?.ownerUserId).toBe(kid.id);
      expect(await mateCredits(mate)).toEqual(noCredits);
      await app?.close();
      app = undefined;
      clock = new Date(START);
    }
  }, 60_000);

  it('a live defence the kid walks away from plays out on the deadlines and the mate steps on', async () => {
    const { kid, mapId, mate, target } = await challengeSetup({ guard: true });
    const { steps, battles } = services(WEAK, (userId) => userId === kid.id);
    expect(await mateStep(steps, mapId, mate)).toMatchObject({
      intent: 'challenge',
      applied: true,
    });
    const [battle] = await mateBattles(mate);
    const prompt = await db.query.challenges.findFirst({
      where: (t, { and, eq }) => and(eq(t.battleId, battle!.id), eq(t.kind, 'defense')),
    });
    const answered = await battles.answerDefense(kid, prompt!.id, 'yes');
    expect(answered.battle?.status).toBe('active');

    // The kid closes the app: nothing touches the battle for well past the
    // abandon time. Side `a` is the AI, which can't forfeit, so the live
    // deadlines cover the kid's picks instead, and the mate's next step
    // settles them without throwing.
    clock = new Date(clock.getTime() + (TERRITORY_RULES.abandonMinutes + 60) * MINUTE_MS);
    await mateStep(steps, mapId, mate);
    const row = await battleRowOf(battle!.id);
    expect(row.status).toBe('finished');
    const result = await resultOf(battle!.id);
    expect(result.winner).toBe('b');
    expect(result.reason).not.toBe('forfeit');
    const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, target.id) });
    expect(tile?.ownerUserId).toBe(kid.id);
    // The kid's live defence is paid under the usual rules; the mate earns nothing.
    const rewards = await rewardsOf(battle!.id);
    expect(rewards.b?.userId).toBe(kid.id);
    expect(rewards.b?.unpaid ?? null).toBeNull();
    expect(rewards.b!.coins!.patch).toBeGreaterThan(0);
    expect(await mateCredits(mate)).toEqual(noCredits);
    // And the kid can still read it.
    expect((await battles.get(kid, battle!.id)).status).toBe('finished');
  }, 60_000);

  it('a mate holding its own tile against a kid earns no XP and no coins', async () => {
    const { kid, cookies, mapId, mates } = await soloPatch();
    await setJoinedAt(mapId, kid.id, new Date(clock.getTime() - 3 * DAY_MS));
    const [mate] = mates as [string];
    await setJoinedAt(mapId, mate, new Date(clock.getTime() - 3 * DAY_MS));
    const territoryRepo = createTerritoryRepo(db);
    const tiles = await territoryRepo.listTiles(mapId);
    const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
    const kidHome = tiles.filter((t) => t.ownerUserId === kid.id && t.homeSlot !== null);
    // A claimable tile touching the kid's home ring becomes the mate's.
    const target = kidHome
      .flatMap((h) => hexNeighbors(h).map((n) => byKey.get(hexKey(n))))
      .find((t): t is TerritoryTileRow => t !== undefined && claimable(t));
    expect(target).toBeDefined();
    await territoryRepo.setOwner(target!.id, mate);
    const mateTeam = await db.query.squishies.findMany({
      where: (t, { eq }) => eq(t.ownerUserId, mate),
    });
    const guard = mateTeam[0]!;
    await db.execute(`update squishies set level = 40 where id = '${uuid(guard.id)}'`);
    await territoryRepo.replaceDefenders(mapId, target!.id, [guard.id], clock);
    const before = (await db.query.squishies.findFirst({
      where: (t, { eq }) => eq(t.id, guard.id),
    }))!;
    await grant(cookies, mapId, 1);

    const { battles, territory } = services(WEAK);
    const started = await territory.attack(kid, mapId, { q: target!.q, r: target!.r });
    let mine = started.battle;
    for (let i = 0; i < 2 * BATTLE_RULES.maxTurns && mine.status === 'active'; i++) {
      mine = await battles.act(kid, mine.id, { action: nextAction(mine), turn: mine.view.turn });
    }
    expect(mine.status).toBe('finished');
    expect((await resultOf(mine.id)).winner).toBe('b');
    const rewards = await rewardsOf(mine.id);
    expect(rewards.b).toBeNull();
    expect(await ledgerOf(sideBRefId(mine.id))).toEqual({ patch: [], heart: [] });
    expect(await mateCredits(mate)).toEqual(noCredits);
    const after = (await db.query.squishies.findFirst({
      where: (t, { eq }) => eq(t.id, guard.id),
    }))!;
    expect(after.xp).toBe(before.xp);
  }, 60_000);

  it('the contested-tile guard holds: a mate never challenges a tile already under attack', async () => {
    const { kid, mapId, mates, mate, target, tiles } = await challengeSetup({ guard: true });
    const { steps, battles } = services(WEAK, (userId) => userId === kid.id);
    expect(await mateStep(steps, mapId, mate)).toMatchObject({
      intent: 'challenge',
      applied: true,
    });
    const [battle] = await mateBattles(mate);
    expect(battle?.status).toBe('active');

    // A second mate gets a tile touching T and nothing else of the kid's.
    const other = mates.find((m) => m !== mate)!;
    const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
    const kidLand = new Set(
      (await createTerritoryRepo(db).listTiles(mapId))
        .filter((t) => t.ownerUserId === kid.id)
        .map((t) => t.id),
    );
    const beside = hexNeighbors(target)
      .map((n) => byKey.get(hexKey(n)))
      .find(
        (t) =>
          t !== undefined &&
          claimable(t) &&
          hexNeighbors(t).every((n) => {
            const near = byKey.get(hexKey(n));
            return !near || near.id === target.id || !kidLand.has(near.id);
          }),
      );
    expect(beside).toBeDefined();
    await createTerritoryRepo(db).setOwner(beside!.id, other);

    // While the first challenge waits on "Defend now?", T is contested.
    const second = await mateStep(steps, mapId, other);
    expect(second.intent).not.toBe('challenge');
    expect(await attacksOn(target.id)).toHaveLength(1);
    expect(await mateBattles(other)).toEqual([]);

    // Once it's over (and T's cooldown has passed) the same mate may.
    const prompt = await db.query.challenges.findFirst({
      where: (t, { and, eq }) => and(eq(t.battleId, battle!.id), eq(t.kind, 'defense')),
    });
    await battles.answerDefense(kid, prompt!.id, 'not-now');
    clock = new Date(clock.getTime() + 4 * HOUR_MS + 5 * MINUTE_MS);
    expect(await mateStep(steps, mapId, other)).toMatchObject({
      intent: 'challenge',
      applied: true,
    });
    expect(await attacksOn(target.id)).toHaveLength(2);
  });

  describe('a challenge is refused in Off, during the kid’s shield, in quiet hours, under minKidTiles, past the weekly cap, and on a fenced tile', () => {
    /** One refused step (no new battle), then the same step allowed once `undo` lifts the rule. */
    async function refusedThenAllowed(
      setup: Awaited<ReturnType<typeof challengeSetup>>,
      undo: () => Promise<void> | void,
    ) {
      const { mapId, mate } = setup;
      const { steps } = services(WEAK);
      const before = (await mateBattles(mate)).length;
      const refused = await mateStep(steps, mapId, mate);
      expect(refused.intent === 'challenge' && refused.applied).toBe(false);
      expect(await mateBattles(mate)).toHaveLength(before);
      await undo();
      const allowed = await mateStep(steps, mapId, mate);
      expect(allowed).toMatchObject({ intent: 'challenge', applied: true });
      expect(await mateBattles(mate)).toHaveLength(before + 1);
    }

    it('the kid is away (only a kid online right now, #823 ruling)', async () => {
      const setup = await challengeSetup({ guard: true });
      seesKid = false;
      await refusedThenAllowed(setup, () => {
        seesKid = true;
      });
    });

    it('PvP Off', async () => {
      const setup = await challengeSetup({ guard: true });
      await db.execute(`update maps set pvp_mode = 'off' where id = '${uuid(setup.mapId)}'`);
      await refusedThenAllowed(setup, async () => {
        await db.execute(`update maps set pvp_mode = 'gentle' where id = '${uuid(setup.mapId)}'`);
      });
    });

    it('the kid’s new-player shield', async () => {
      const setup = await challengeSetup({ guard: true });
      await setJoinedAt(setup.mapId, setup.kid.id, clock);
      await refusedThenAllowed(setup, async () => {
        await setJoinedAt(setup.mapId, setup.kid.id, new Date(clock.getTime() - 3 * DAY_MS));
      });
    });

    it('quiet hours', async () => {
      const setup = await challengeSetup({ guard: true });
      // 23:00 patch time.
      clock = new Date('2026-10-11T04:00:00Z');
      await refusedThenAllowed(setup, () => {
        // 09:00 the next morning.
        clock = new Date('2026-10-11T14:00:00Z');
      });
    });

    it('under minKidTiles', async () => {
      const setup = await challengeSetup({ guard: true, extra: COMPUTER_MATES.rules.minKidTiles });
      // T and minKidTiles - 2 more: one short.
      const [spare] = setup.extras.splice(-2);
      const territory = createTerritoryRepo(db);
      const hand = setup.extras.at(-1)!;
      await db.execute(`update tiles set owner_user_id = null where id = '${uuid(spare!.id)}'`);
      await db.execute(`update tiles set owner_user_id = null where id = '${uuid(hand.id)}'`);
      const held = (await territory.listTiles(setup.mapId)).filter(
        (t) => t.ownerUserId === setup.kid.id && t.homeSlot === null,
      );
      expect(held).toHaveLength(COMPUTER_MATES.rules.minKidTiles - 1);
      await refusedThenAllowed(setup, () => territory.setOwner(spare!.id, setup.kid.id));
    });

    it('a tile the kid has fenced all round (#823 ruling: fences hold computer friends off)', async () => {
      const setup = await challengeSetup({ guard: true });
      const { mapId, mate, kid, target } = setup;
      // Every edge of T, so every border edge is fenced whatever the neighbours.
      const fences = createFencesRepo(db);
      for (const edge of [0, 1, 2, 3, 4, 5]) {
        await fences.insertFence({
          mapId,
          ownerUserId: kid.id,
          tileId: target.id,
          edge,
          buildingId: 'emberwood-palisade',
          hp: 70,
          builtAt: clock,
        });
      }
      expect(await fences.listOnTile(target.id)).toHaveLength(6);
      // Past the policy, straight to territory: `challengeCheck`'s own fence
      // recheck (real `fence_segments` rows, under the locks) refuses it.
      const { territory } = services(WEAK);
      await expect(
        territory.attackAsComputer(
          { id: mate, username: '' },
          mapId,
          { q: target.q, r: target.r },
          computerChallenge(COMPUTER_MATES.personas[0]!, WEAK.rules, () => true),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await mateBattles(mate)).toEqual([]);
      // And the step's view never picks it; with the fence gone it does.
      await refusedThenAllowed(setup, async () => {
        await db.execute(`delete from fence_segments where tile_id = '${uuid(target.id)}'`);
      });
      expect(await attacksOn(target.id)).toHaveLength(1);
    });

    it('past the weekly cap (Gentle: 2)', async () => {
      const setup = await challengeSetup({ guard: true });
      const { mapId, mate } = setup;
      const { steps } = services(WEAK);
      const cap = COMPUTER_MATES.rules.challengesPerPatchWeek.gentle;
      for (let i = 0; i < cap; i++) {
        if (i > 0) clock = new Date(clock.getTime() + 4 * HOUR_MS + 5 * MINUTE_MS);
        expect(await mateStep(steps, mapId, mate)).toMatchObject({
          intent: 'challenge',
          applied: true,
        });
      }
      // Both held, so the loss cap never bit; T's cooldown has passed again.
      clock = new Date(clock.getTime() + 4 * HOUR_MS + 5 * MINUTE_MS);
      // Past the policy, straight to territory: the server's own recheck
      // (`challengeCheck`, under the tile and challenge locks) refuses it.
      const { territory } = services(WEAK);
      await expect(
        territory.attackAsComputer(
          { id: mate, username: '' },
          mapId,
          { q: setup.target.q, r: setup.target.r },
          computerChallenge(COMPUTER_MATES.personas[0]!, WEAK.rules, () => true),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await mateBattles(mate)).toHaveLength(cap);
      await refusedThenAllowed(setup, () => {
        clock = new Date(clock.getTime() + 7 * DAY_MS);
      });
      const finished = await mateBattles(mate);
      expect(finished).toHaveLength(cap + 1);
      for (const b of finished) expect(b.status).toBe('finished');
    });
  });
});
