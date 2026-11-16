import {
  BattleResponseSchema,
  BossVisitResponseSchema,
  CatalogResponseSchema,
  GAME_DATA,
  JoinMapResponseSchema,
  MapResponseSchema,
  replayBattle,
  type PlayerBattle,
  type PublicUser,
} from '@heartpatch/shared';
import {
  BOSS_EVENTS,
  SECRET_SPECIES,
  baseFormOf,
  bossVisitFor,
  bossWeekOf,
  type BossEventRules,
} from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, squishies, users } from '../../db/schema.js';
import { instantOfLocalDate, localDate } from '../../lib/time.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { createBattlesRepo, setupOf } from '../battles/repo.js';
import { defaultBattleContent } from '../battles/service.js';
import { newSessionToken } from '../auth/secrets.js';
import { EVOLUTION_STEPS } from '../care/service.js';
import { grantItems } from '../inventory/service.js';
import { BOSS_START, REAL_BAG_IS_REAL, REAL_BAG_RULES, bossHarness } from '../../../tests/boss.js';
import { BossLooksResponseSchema } from './routes.js';

const url = inject('testDatabaseUrl');
const errorOf = (res: { json: () => unknown }) =>
  (res.json() as { error: { message: string } }).error.message;
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE = 'America/Denver';
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
// Noon in Denver on Monday 16 Nov (MST, UTC−7): the start of a boss week.
const START = '2026-11-16T19:00:00Z';
const TEAM = GAME_DATA.species[0]!;
// A stand-in boss (#190 plan §8): an existing species, in tests only.
const BOSS = GAME_DATA.species.find((s) => s.id !== TEAM.id)!;
const RULES: BossEventRules = {
  ...BOSS_EVENTS,
  bag: [{ speciesId: BOSS.id, terrains: [GAME_DATA.terrains[0]!.id] }],
};

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('mini-boss visits and fights (#190b, needs DATABASE_URL)', () => {
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

  async function start(rules: BossEventRules = RULES) {
    // The mini-boss switch (#234) open: these tests are about the visits.
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, HP_MINI_BOSSES: 'on' });
    let sweep: ((only?: readonly string[]) => Promise<number>) | undefined;
    app = await buildApp({
      config,
      db,
      clock: () => clock,
      logger: false,
      bossRules: rules,
      onBoss: (service) => {
        sweep = service.sweep;
      },
    });
    return { server: app, sweep: sweep! };
  }

  async function player(): Promise<Player> {
    const username = `miniboss_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
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

  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, { name: 'Boss Patch', timeZone: ZONE });
    expect(res.statusCode, res.body).toBe(201);
    const map = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const join = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      expect(join.statusCode).toBe(201);
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

  /** A Partner at `partner` and, by default, two strong friends: the team. */
  async function grow(mapId: string, who: PublicUser, partner: number, friends = [100, 100]) {
    const rows = await db
      .insert(squishies)
      .values(
        [partner, ...friends].map((level) => ({
          mapId,
          ownerUserId: who.id,
          speciesId: TEAM.id,
          element: TEAM.element,
          feeling: TEAM.feeling,
          level,
        })),
      )
      .returning({ id: squishies.id });
    await db.execute(
      `update map_members set starter_squishy_id = '${rows[0]!.id}' where user_id = '${who.id}'`,
    );
  }

  /** Moves the clock a minute past this week's visit opening on the patch. */
  async function toVisit(mapId: string) {
    const map = await db.query.maps.findFirst({ where: (t, { eq }) => eq(t.id, mapId) });
    const week = bossWeekOf(localDate(clock, ZONE));
    const plan = bossVisitFor(map!.seed!, week, map!.longNightWeekday ?? null, RULES)!;
    const opensAt = instantOfLocalDate(
      { date: plan.opensOn, minute: RULES.opensAtHour * 60 },
      ZONE,
    );
    clock.setTime(opensAt.getTime() + 60_000);
    return { week, opensAt };
  }

  const visit = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/boss`, who);
    expect(res.statusCode, res.body).toBe(200);
    return BossVisitResponseSchema.parse(res.json()).boss;
  };
  const fight = (server: FastifyInstance, who: Player, mapId: string) =>
    call(server, 'POST', `/maps/${mapId}/boss/battle`, who);
  const act = async (
    server: FastifyInstance,
    who: Player,
    battle: PlayerBattle,
    action: object,
  ) => {
    const res = await call(server, 'POST', `/battles/${battle.id}/actions`, who, {
      action,
      turn: battle.view.turn,
    });
    expect(res.statusCode, res.body).toBe(200);
    return BattleResponseSchema.parse(res.json()).battle;
  };
  /** Plays every fighter's first move until the fight ends. */
  const playOut = async (server: FastifyInstance, who: Player, start: PlayerBattle) => {
    let battle = start;
    for (let round = 0; round < 100 && battle.status === 'active'; round++) {
      const side = battle.view.sides.a;
      const picks = (side.out ?? [])
        .filter((slot) => side.squishies[slot]!.energy > 0)
        .map((slot) => ({ slot, move: side.squishies[slot]!.moves[0]! }));
      battle = await act(server, who, battle, { type: 'team', picks });
    }
    return battle;
  };
  const minibossBattles = async (userId: string) =>
    db.query.battles.findMany({
      where: (t, { and, eq: is }) => and(is(t.playerUserId, userId), is(t.kind, 'miniboss')),
    });
  const appeared = async (mapId: string) =>
    (
      await db.query.gameEvents.findMany({
        where: (t, { and, eq: is }) => and(is(t.mapId, mapId), is(t.type, 'boss.appeared')),
      })
    ).length;

  it('stays away with an empty bag, and until some Partner is grown enough', async () => {
    const { server, sweep } = await start({ ...BOSS_EVENTS, bag: [] });
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 30);
    await toVisit(mapId);
    expect(await visit(server, owner, mapId)).toBeNull();
    expect(await sweep([mapId])).toBe(0);
    await app!.close();

    const again = await start();
    const small = await player();
    const smallMap = await patch(again.server, small);
    await grow(smallMap, small, RULES.minPartnerLevel - 1);
    await toVisit(smallMap);
    expect(await visit(again.server, small, smallMap)).toBeNull();
    expect(await appeared(smallMap)).toBe(0);
  });

  it('opens once, pins its tile, and never tells the patch which boss', async () => {
    const { server, sweep } = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 20);
    const before = await visit(server, owner, mapId);
    expect(before).toBeNull(); // Monday noon: before any visit's 16:00 opening
    const { week } = await toVisit(mapId);
    expect(await sweep([mapId])).toBe(1);
    expect(await sweep([mapId])).toBe(0);
    expect(await appeared(mapId)).toBe(1);
    const boss = (await visit(server, owner, mapId))!;
    expect(boss).toMatchObject({
      window: { id: week },
      species: null,
      state: 'here',
      triesLeftToday: RULES.triesPerDay,
    });
    expect(await appeared(mapId)).toBe(1);

    // The tile was neutral land, and stays pinned when it changes hands.
    const tile = await db.query.tiles.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.mapId, mapId), eq(t.q, boss.tile.q), eq(t.r, boss.tile.r)),
    });
    expect(tile).toMatchObject({ ownerUserId: null, homeSlot: null, communityId: null });
    expect(['trading-post', 'junipers-gap']).not.toContain(tile!.terrain);
    await db.execute(`update tiles set owner_user_id = '${owner.id}' where id = '${tile!.id}'`);
    expect((await visit(server, owner, mapId))!.tile).toEqual(boss.tile);

    // The event and its public view carry no species, schedule or bag.
    const [event] = await db.query.gameEvents.findMany({
      where: (t, { and, eq: is }) => and(is(t.mapId, mapId), is(t.type, 'boss.appeared')),
    });
    expect(Object.keys(event!.payload as object).sort()).toEqual(['endsAt', 'q', 'r', 'window']);
    const shown = publicViewFor(PUBLIC_VIEWS, event!, { userId: owner.id });
    expect(shown).not.toBeNull();
    expect(JSON.stringify(shown)).not.toContain(BOSS.id);
  });

  it('shows a too-small Keeper the boss, but no fight', async () => {
    const { server } = await start();
    const owner = await player();
    const little = await player();
    const mapId = await patch(server, owner, [little]);
    await grow(mapId, owner, 20);
    await grow(mapId, little, RULES.minPlayerLevel - 1);
    await toVisit(mapId);
    expect(await visit(server, little, mapId)).toMatchObject({
      species: BOSS.id,
      state: 'too-big',
      triesLeftToday: 0,
    });
    const res = await fight(server, little, mapId);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('Too big for now! Grow your team and come back.');
  });

  it('fights as a team, spends a try per fight and gives them back tomorrow', async () => {
    const { server } = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 20);
    const { week } = await toVisit(mapId);
    for (let i = 0; i < RULES.triesPerDay; i++) {
      const res = await fight(server, owner, mapId);
      expect(res.statusCode, res.body).toBe(201);
      const battle = BattleResponseSchema.parse(res.json()).battle;
      expect(battle.view.sides.a.out).toEqual([0, 1, 2]);
      expect(battle.view.sides.b.squishies).toHaveLength(1);
      // Met now: its name shows, and one try fewer is left.
      expect(await visit(server, owner, mapId)).toMatchObject({
        species: BOSS.id,
        triesLeftToday: RULES.triesPerDay - 1 - i,
      });
      // A one-on-one turn is refused in a team battle.
      const wrong = await call(server, 'POST', `/battles/${battle.id}/actions`, owner, {
        action: { type: 'move', move: battle.view.sides.a.squishies[0]!.moves[0] },
        turn: battle.view.turn,
      });
      expect(wrong.statusCode).toBe(409);
      const lost = await act(server, owner, battle, { type: 'forfeit' });
      expect(lost.status).toBe('finished');
    }
    const none = await fight(server, owner, mapId);
    expect(none.statusCode).toBe(409);
    expect(errorOf(none)).toBe('Phew, that’s enough stomping for today. Try again tomorrow!');
    const row = await db.query.bossEncounters.findFirst({
      where: (t, { eq }) => eq(t.userId, owner.id),
    });
    expect(row).toMatchObject({ windowId: week, wonBattleId: null });

    clock.setTime(clock.getTime() + DAY_MS / 2);
    const pinned = await db.query.bossWindows.findFirst({
      where: (t, { eq }) => eq(t.mapId, mapId),
    });
    if (clock < pinned!.endsAt && localDate(clock, ZONE) !== localDate(pinned!.opensAt, ZONE)) {
      expect((await visit(server, owner, mapId))!.triesLeftToday).toBe(RULES.triesPerDay);
    }
  });

  it('marks the boss seen when the fight starts: once, never caught, nothing else (#190g)', async () => {
    const { server } = await start();
    const owner = await player();
    const little = await player();
    const mapId = await patch(server, owner, [little]);
    await grow(mapId, owner, 20);
    await grow(mapId, little, RULES.minPlayerLevel - 1);
    await toVisit(mapId);
    const seenRows = (who: Player) =>
      db.query.speciesSeen.findMany({
        where: (t, { and, eq: is }) => and(is(t.mapId, mapId), is(t.userId, who.id)),
      });
    const catalog = async (who: Player) => {
      const res = await call(server, 'GET', `/maps/${mapId}/catalog`, who);
      expect(res.statusCode, res.body).toBe(200);
      return CatalogResponseSchema.parse(res.json()).catalog;
    };

    // Before the start: not met, so its name stays hidden.
    expect(await seenRows(owner)).toEqual([]);
    expect(await visit(server, owner, mapId)).toMatchObject({ species: null, state: 'here' });

    const first = await fight(server, owner, mapId);
    expect(first.statusCode, first.body).toBe(201);
    const [started] = await minibossBattles(owner.id);
    // One row for the boss's species and nothing else (the team's own species
    // isn't "met" by owning it), seen but never caught.
    const rows = await seenRows(owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      speciesId: BOSS.id,
      firstSeenAt: started!.startedAt,
      firstCaughtAt: null,
    });
    expect((await catalog(owner)).entries).toEqual([
      { speciesId: BOSS.id, firstSeenAt: started!.startedAt.toISOString(), firstCaughtAt: null },
    ]);
    expect(await visit(server, owner, mapId)).toMatchObject({ species: BOSS.id });

    // A second fight in the visit keeps the one row, and its first-seen time.
    const battle = BattleResponseSchema.parse(first.json()).battle;
    await act(server, owner, battle, { type: 'forfeit' });
    clock.setTime(clock.getTime() + 5 * 60_000);
    const again = await fight(server, owner, mapId);
    expect(again.statusCode, again.body).toBe(201);
    expect(await minibossBattles(owner.id)).toHaveLength(2);
    expect(await seenRows(owner)).toEqual(rows);

    // A Keeper too small to start is shown the name, display-only: no row.
    expect((await fight(server, little, mapId)).statusCode).toBe(409);
    expect(await seenRows(little)).toEqual([]);
    expect((await catalog(little)).entries).toEqual([]);
  });

  it('a win pays the mini-boss coins and ends the visit for that Keeper only', async () => {
    const { server } = await start();
    const owner = await player();
    const friend = await player();
    const mapId = await patch(server, owner, [friend]);
    await grow(mapId, owner, 20);
    await grow(mapId, friend, 20);
    await toVisit(mapId);
    const res = await fight(server, owner, mapId);
    expect(res.statusCode, res.body).toBe(201);
    const started = BattleResponseSchema.parse(res.json()).battle;
    expect(started.kind).toBe('miniboss');
    const battle = await playOut(server, owner, started);
    expect(battle.status).toBe('finished');
    expect(battle.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
    expect(battle.rewards?.coins).toEqual({ patch: 5, heart: 5 });
    // The sure bundle, in the bag and the ledger against this battle.
    expect(battle.rewards?.bundle).toEqual(RULES.bundle);
    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq: is }) => and(is(t.userId, owner.id), is(t.reason, 'boss')),
    });
    expect(Object.fromEntries(ledger.map((l) => [l.itemId, l.delta]))).toEqual(RULES.bundle);
    expect(ledger.every((l) => l.refId === battle.id)).toBe(true);

    expect((await visit(server, owner, mapId))!.state).toBe('beaten');
    const again = await fight(server, owner, mapId);
    expect(again.statusCode).toBe(409);
    expect((await visit(server, friend, mapId))!.state).toBe('here');

    // Rule 3: the stored setup (with its team format) and actions replay to the end.
    const row = (await createBattlesRepo(db).findBattle(battle.id))!;
    expect(row.state.format).toEqual({ a: 3, b: 1 });
    expect(replayBattle(defaultBattleContent(), setupOf(row), row.actions)).toEqual(row.state);
  });

  it('gives the try back when a fight ends as a no-contest', async () => {
    const { server } = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 20);
    await toVisit(mapId);
    const res = await fight(server, owner, mapId);
    expect(res.statusCode, res.body).toBe(201);
    const battle = BattleResponseSchema.parse(res.json()).battle;
    expect((await visit(server, owner, mapId))!.triesLeftToday).toBe(RULES.triesPerDay - 1);
    // A deploy retuned the game mid-fight: the battle ends as a no-contest.
    await db.execute(`update battles set content_hash = 'retuned' where id = '${battle.id}'`);
    const ended = await call(server, 'GET', `/battles/${battle.id}`, owner);
    expect(BattleResponseSchema.parse(ended.json()).battle.status).toBe('no-contest');
    expect((await visit(server, owner, mapId))!.triesLeftToday).toBe(RULES.triesPerDay);
  });

  it('two taps on the last try start one fight', async () => {
    const { server } = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 20);
    await toVisit(mapId);
    for (let i = 0; i < RULES.triesPerDay - 1; i++) {
      const res = await fight(server, owner, mapId);
      expect(res.statusCode, res.body).toBe(201);
      await act(server, owner, BattleResponseSchema.parse(res.json()).battle, { type: 'forfeit' });
    }
    const taps = await Promise.all([fight(server, owner, mapId), fight(server, owner, mapId)]);
    const ids = taps.map((tap) => {
      expect(tap.statusCode, tap.body).toBeLessThan(300);
      return BattleResponseSchema.parse(tap.json()).battle.id;
    });
    // The second tap resumes the first's fight: one battle, no try left over.
    expect(ids[0]).toBe(ids[1]);
    expect(taps.map((tap) => tap.statusCode).sort()).toEqual([200, 201]);
    const rows = await minibossBattles(owner.id);
    expect(rows).toHaveLength(RULES.triesPerDay);
    expect(rows.filter((row) => row.status === 'active')).toHaveLength(1);
    expect((await visit(server, owner, mapId))!.triesLeftToday).toBe(0);
  });

  it('ten minutes with no step is a leave: a loss, and the try is used', async () => {
    const { server } = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 20, [20, 20]);
    await toVisit(mapId);
    const res = await fight(server, owner, mapId);
    let battle = BattleResponseSchema.parse(res.json()).battle;
    const minute = 60_000;
    const get = async () =>
      BattleResponseSchema.parse((await call(server, 'GET', `/battles/${battle.id}`, owner)).json())
        .battle;
    // A step before the time is up starts the clock again.
    clock.setTime(clock.getTime() + (RULES.idleMinutes - 1) * minute);
    const side = battle.view.sides.a;
    battle = await act(server, owner, battle, {
      type: 'team',
      picks: (side.out ?? []).map((slot) => ({ slot, move: side.squishies[slot]!.moves[0]! })),
    });
    expect(battle.status).toBe('active');
    clock.setTime(clock.getTime() + (RULES.idleMinutes - 1) * minute);
    expect((await get()).status).toBe('active');
    clock.setTime(clock.getTime() + 2 * minute);
    const left = await get();
    expect(left.status).toBe('finished');
    expect(left.view.phase).toMatchObject({
      type: 'over',
      result: { winner: 'b', reason: 'forfeit' },
    });
    expect((await visit(server, owner, mapId))!.triesLeftToday).toBe(RULES.triesPerDay - 1);
  });

  it('on the visit’s last day, says enough for today without promising tomorrow', async () => {
    const { server } = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 20);
    const { opensAt } = await toVisit(mapId);
    // Two patch days on: the visit's last morning (it closes at the opening hour).
    clock.setTime(opensAt.getTime() + (RULES.windowHours - 6) * 3_600_000);
    for (let i = 0; i < RULES.triesPerDay; i++) {
      const res = await fight(server, owner, mapId);
      expect(res.statusCode, res.body).toBe(201);
      await act(server, owner, BattleResponseSchema.parse(res.json()).battle, { type: 'forfeit' });
    }
    const none = await fight(server, owner, mapId);
    expect(none.statusCode).toBe(409);
    expect(errorOf(none)).toBe('Phew, that’s enough stomping for today!');
  });

  it('resumes a fight going after the visit has closed', async () => {
    const { server } = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 20, [20, 20]);
    const { opensAt } = await toVisit(mapId);
    const endsAt = opensAt.getTime() + RULES.windowHours * 3_600_000;
    clock.setTime(endsAt - 5 * 60_000);
    const res = await fight(server, owner, mapId);
    expect(res.statusCode, res.body).toBe(201);
    const battle = BattleResponseSchema.parse(res.json()).battle;
    clock.setTime(endsAt + 60_000);
    expect(await visit(server, owner, mapId)).toBeNull();
    const again = await fight(server, owner, mapId);
    expect(again.statusCode, again.body).toBe(200);
    expect(BattleResponseSchema.parse(again.json()).battle.id).toBe(battle.id);
  });

  it('a scooted fight pays no coins and no bundle, and uses the try', async () => {
    const { server } = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    await grow(mapId, owner, 20, [20, 20]);
    await toVisit(mapId);
    const res = await fight(server, owner, mapId);
    let battle = BattleResponseSchema.parse(res.json()).battle;
    const side = battle.view.sides.a;
    battle = await act(server, owner, battle, {
      type: 'team',
      picks: (side.out ?? []).map((slot) => ({ slot, move: side.squishies[slot]!.moves[0]! })),
    });
    expect(battle.status).toBe('active');
    battle = await act(server, owner, battle, { type: 'forfeit' });
    expect(battle.view.phase).toMatchObject({ type: 'over', result: { reason: 'forfeit' } });
    expect(battle.rewards).not.toBeNull();
    expect(battle.rewards?.coins).toEqual({ patch: 0, heart: 0 });
    expect(battle.rewards?.bundle ?? null).toBeNull();
    expect((await visit(server, owner, mapId))!.triesLeftToday).toBe(RULES.triesPerDay - 1);
  });
});

const WEEK_MS = 7 * DAY_MS;
// Every ask a yes: the befriend test is about which form joins, not the odds.
const SURE_REAL: BossEventRules = {
  ...REAL_BAG_RULES,
  befriend: { ...REAL_BAG_RULES.befriend, basePercent: 100 },
};
const bagIds = REAL_BAG_RULES.bag.map((b) => b.speciesId);
const BOSS_LINE = SECRET_SPECIES.filter((s) => s.line === 'boss');

/*
 * The mini-boss switch (#234, `HP_MINI_BOSSES`) over the real bag: the four
 * bosses once lane 234b-1 fills it, four stand-ins until then
 * (`REAL_BAG_RULES`), so these pass unchanged either way.
 */
describe.skipIf(!url)('the mini-boss switch over the real bag (#234, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let h: ReturnType<typeof bossHarness>;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
    h = bossHarness(db, url!, 'bossswitch');
  });
  afterAll(() => client.close());
  afterEach(() => h.close());

  const windowsOf = (mapId: string) =>
    db.query.bossWindows.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => asc(t.opensAt),
    });
  const eventTypes = async (mapId: string) =>
    (await db.query.gameEvents.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) })).map(
      (e) => e.type,
    );

  it('off: behaves as an empty bag, with the bosses in it', async () => {
    await h.start(REAL_BAG_RULES, { miniBosses: 'off' });
    const kid = await h.player();
    const mapId = await h.patch(kid);
    await h.grow(mapId, kid, 20);
    await h.toVisit(mapId, REAL_BAG_RULES);

    const res = await h.call('GET', `/maps/${mapId}/boss`, kid);
    expect(res.statusCode, res.body).toBe(200);
    expect(BossVisitResponseSchema.parse(res.json()).boss).toBeNull();
    expect(await h.sweep([mapId])).toBe(0);
    const fight = await h.call('POST', `/maps/${mapId}/boss/battle`, kid);
    expect(fight.statusCode, fight.body).toBe(404);
    expect(errorOf(fight)).toBe('No big squishy around right now. Keep an eye out!');
    expect(await windowsOf(mapId)).toEqual([]);
    expect(await eventTypes(mapId)).not.toContain('boss.appeared');
  });

  it('testers: a boss visits only the patches a tester owns', async () => {
    const tester = await h.player();
    const other = await h.player();
    // Usernames are matched case-blind, as every switch's testers list.
    await h.start(REAL_BAG_RULES, {
      miniBosses: 'testers',
      testers: [tester.username.toUpperCase()],
    });
    const theirs = await h.patch(tester);
    const notTheirs = await h.patch(other);
    // The tester on someone else's patch doesn't open it: only the owner counts.
    await h.join(notTheirs, other, tester);
    for (const [mapId, who] of [
      [theirs, tester],
      [notTheirs, other],
    ] as const)
      await h.grow(mapId, who, 20);

    await h.toVisit(notTheirs, REAL_BAG_RULES);
    expect(await h.sweep([notTheirs])).toBe(0);
    for (const who of [other, tester]) {
      const res = await h.call('GET', `/maps/${notTheirs}/boss`, who);
      expect(BossVisitResponseSchema.parse(res.json()).boss).toBeNull();
    }
    expect(await windowsOf(notTheirs)).toEqual([]);

    await h.toVisit(theirs, REAL_BAG_RULES);
    expect(await h.sweep([theirs])).toBe(1);
    const res = await h.call('GET', `/maps/${theirs}/boss`, tester);
    expect(BossVisitResponseSchema.parse(res.json()).boss).not.toBeNull();
    const [window] = await windowsOf(theirs);
    expect(bagIds).toContain(window!.speciesId);
  });

  it('on: every boss in the bag visits before one comes back', async () => {
    await h.start(REAL_BAG_RULES, { miniBosses: 'on' });
    const kid = await h.player();
    const mapId = await h.patch(kid);
    await h.grow(mapId, kid, 20);
    // A shuffle bag per cycle: any 2n − 1 weeks in a row hold one whole cycle.
    const weeks = 2 * bagIds.length - 1;
    for (let week = 0; week < weeks; week++) {
      h.clock.setTime(Date.parse(BOSS_START) + week * WEEK_MS);
      await h.toVisit(mapId, REAL_BAG_RULES);
      expect(await h.sweep([mapId])).toBe(1);
    }
    const visited = (await windowsOf(mapId)).map((w) => w.speciesId);
    expect(visited).toHaveLength(weeks);
    expect(new Set(visited)).toEqual(new Set(bagIds));
    // Cut into cycles somewhere: no boss twice within one, and the whole one holds them all.
    const n = bagIds.length;
    const cycles = (offset: number) =>
      [
        visited.slice(0, offset),
        visited.slice(offset, offset + n),
        visited.slice(offset + n),
      ].filter((c) => c.length > 0);
    const fair = Array.from({ length: n }, (_, offset) => offset).some((offset) =>
      cycles(offset).every(
        (c) => new Set(c).size === c.length && (c.length < n || new Set(c).size === n),
      ),
    );
    expect(fair, visited.join(', ')).toBe(true);
  });

  it('on: the fight sends the boss it shows, drawable from public parts, and a friend joins as its first form', async () => {
    await h.start(SURE_REAL, { miniBosses: 'on' });
    const kid = await h.player();
    const mapId = await h.patch(kid);
    await h.grow(mapId, kid, 20);
    await h.toVisit(mapId, SURE_REAL);
    const started = await h.fight(kid, mapId);
    const bossId = (await windowsOf(mapId))[0]!.speciesId;
    expect(bagIds).toContain(bossId);

    // A secret boss's def rides with the battle (the client can't know it);
    // a public stand-in is in GAME_DATA already. Never another boss in the bag.
    const secret = SECRET_SPECIES.find((s) => s.id === bossId);
    const sent = started.speciesDefs.map((s) => s.id);
    if (secret) expect(sent).toContain(bossId);
    for (const id of bagIds) if (id !== bossId) expect(sent).not.toContain(id);
    const def = secret ?? GAME_DATA.species.find((s) => s.id === bossId)!;
    const bodies = new Set(GAME_DATA.bodies.map((b) => b.id));
    const parts = new Set(GAME_DATA.parts.map((p) => p.id));
    expect(bodies.has(def.visual.body), def.visual.body).toBe(true);
    for (const part of def.visual.parts) expect(parts.has(part), part).toBe(true);

    const won = await h.playOut(kid, started);
    expect(won.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
    await grantItems(db, { mapId, userId: kid.id }, { 'heart-charm': 3 }, 'dev-grant');
    const yes = await h.call('POST', `/battles/${won.id}/befriend`, kid, { ask: 1 });
    expect(yes.statusCode, yes.body).toBe(200);
    const { squishyId } = yes.json<{ squishyId: string }>();
    const friend = await db.query.squishies.findFirst({
      where: (t, { eq }) => eq(t.id, squishyId),
    });
    expect(friend?.speciesId).toBe(baseFormOf(bossId, EVOLUTION_STEPS));
  });

  it('a fight already going still finishes after the switch closes, and can still befriend', async () => {
    await h.start(SURE_REAL, { miniBosses: 'on' });
    const kid = await h.player();
    const mapId = await h.patch(kid);
    await h.grow(mapId, kid, 20);
    await h.toVisit(mapId, SURE_REAL);
    const started = await h.fight(kid, mapId);
    const at = h.clock.getTime();

    await h.close();
    h.clock.setTime(at);
    await h.start(SURE_REAL, { miniBosses: 'off' });
    // Closed: no visit to see, but the fight going comes back to its Keeper.
    const res = await h.call('GET', `/maps/${mapId}/boss`, kid);
    expect(BossVisitResponseSchema.parse(res.json()).boss).toBeNull();
    const again = await h.call('POST', `/maps/${mapId}/boss/battle`, kid);
    expect(again.statusCode, again.body).toBe(200);
    const resumed = BattleResponseSchema.parse(again.json()).battle;
    expect(resumed.id).toBe(started.id);
    const done = await h.playOut(kid, resumed);
    expect(done.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
    // The won fight can still be asked to be a friend: befriending isn't gated.
    await grantItems(db, { mapId, userId: kid.id }, { 'heart-charm': 3 }, 'dev-grant');
    const yes = await h.call('POST', `/battles/${done.id}/befriend`, kid, { ask: 1 });
    expect(yes.statusCode, yes.body).toBe(200);
    expect(yes.json<{ outcome: string }>().outcome).toBe('joined');
    // And a new one doesn't start.
    const next = await h.call('POST', `/maps/${mapId}/boss/battle`, kid);
    expect(next.statusCode, next.body).toBe(404);
  });

  it('the dev boss looks: only with dev tools, every boss-line look in public shapes', async () => {
    await h.start(REAL_BAG_RULES);
    const kid = await h.player();
    expect((await h.call('GET', '/dev/boss-looks', kid)).statusCode).toBe(404);
    await h.close();

    await h.start(REAL_BAG_RULES, { devTools: true });
    // Signed in, as every dev route.
    const stranger = { ...kid, token: 'not-a-session' };
    expect((await h.call('GET', '/dev/boss-looks', stranger)).statusCode).toBe(401);
    const res = await h.call('GET', '/dev/boss-looks', kid);
    expect(res.statusCode, res.body).toBe(200);
    const { looks } = BossLooksResponseSchema.parse(res.json());
    expect(looks.map((l) => l.id)).toEqual(BOSS_LINE.map((s) => s.id));
    const bodies = new Set(GAME_DATA.bodies.map((b) => b.id));
    const parts = new Set(GAME_DATA.parts.map((p) => p.id));
    for (const look of looks) {
      expect(bodies.has(look.visual.body), look.visual.body).toBe(true);
      for (const part of look.visual.parts) expect(parts.has(part), part).toBe(true);
    }
    // Once the bag is the real one, every boss in it has a look.
    if (REAL_BAG_IS_REAL) for (const id of bagIds) expect(looks.map((l) => l.id)).toContain(id);
  });
});
