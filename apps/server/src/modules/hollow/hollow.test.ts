import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  DevNightfallResponseSchema,
  HOLLOW_RULES,
  HollowResponseSchema,
  JoinMapResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  TutorialResponseSchema,
  type MapDetail,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
  type RescueGuardianRules,
} from '@heartpatch/shared';
import { RESCUE_GUARDIANS, SERVER_GAME_DATA } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, squishies, tileDefenders, users } from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesService } from '../battles/service.js';
import { createHollowConsumer } from './consumer.js';
import { createHollowService, type HollowService } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const MOONPUFF = SERVER_GAME_DATA.secretSpecies.find((s) => s.id === 'placeholder-moonpuff')!;
// Noon in Denver on Oct 2 (MDT, UTC−6): tonight's nightfall is 03:00Z on Oct 3.
const START = '2026-10-02T18:00:00Z';
const TONIGHT = '2026-10-02';
/** Weak shadows, so a strong squishy wins its rescue on first moves. */
const WEAK_SHADOWS: RescueGuardianRules = {
  ...RESCUE_GUARDIANS,
  count: 1,
  levelOffset: -40,
  levels: { min: 1, max: 100 },
};

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('the Hollow Man (needs DATABASE_URL)', () => {
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

  async function start(devTools = true): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: devTools ? 'true' : 'false',
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  /** The service on its own, with weak shadows (rescues the tests can win). */
  function hollowService(guardians: RescueGuardianRules = WEAK_SHADOWS): HollowService {
    const battles = createBattlesService({ db, clock: () => clock });
    return createHollowService({ db, clock: () => clock, battles, guardians });
  }

  async function player(): Promise<Player> {
    const username = `nightowl_${String((counter += 1))}`;
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

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player | null,
    payload?: object,
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;
  const battleOf = (res: LightMyRequestResponse) => BattleResponseSchema.parse(res.json()).battle;

  /** A patch for `owner` (and `others`, joined through invite → approve). */
  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Night Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
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

  const homeTilesOf = async (mapId: string, who: PublicUser) =>
    db.query.tiles.findMany({
      where: (t, { and, eq, isNotNull }) =>
        and(eq(t.mapId, mapId), eq(t.ownerUserId, who.id), isNotNull(t.homeSlot)),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });

  /** A building on `who`'s home (spot 1 of their first home tile, or `spot`). */
  async function build(
    mapId: string,
    who: PublicUser,
    buildingId: 'hearthfire' | 'cozy-meadow',
    options: { fuelledThrough?: string; spot?: number } = {},
  ) {
    const [tile] = await homeTilesOf(mapId, who);
    const [row] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: who.id,
        tileId: tile!.id,
        buildingId,
        kind: buildingId === 'hearthfire' ? 'hearthfire' : 'habitat',
        spot: options.spot ?? 1,
        fuelledThrough: options.fuelledThrough ?? null,
      })
      .returning({ id: buildings.id });
    return row!.id;
  }

  async function squishy(
    mapId: string,
    who: PublicUser,
    options: { level?: number; habitat?: string; state?: 'active' | 'hollowed' } = {},
  ) {
    const [row] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: who.id,
        speciesId: MOONPUFF.id,
        element: MOONPUFF.element,
        feeling: MOONPUFF.feeling,
        level: options.level ?? 5,
        habitatBuildingId: options.habitat ?? null,
        state: options.state ?? 'active',
      })
      .returning({ id: squishies.id });
    return row!.id;
  }

  /** Posts a squishy to stand watch on a tile (as if through `/defenders`). */
  async function standWatch(mapId: string, tileId: string, squishyId: string) {
    await db.insert(tileDefenders).values({ mapId, tileId, slot: 0, squishyId, assignedAt: clock });
  }

  /** A non-home tile, given to `who` (as if they'd claimed it). */
  async function landFor(mapId: string, who: PublicUser) {
    const tile = await db.query.tiles.findFirst({
      where: (t, { and, eq, isNull }) =>
        and(eq(t.mapId, mapId), isNull(t.homeSlot), isNull(t.ownerUserId)),
    });
    await db.execute(`update tiles set owner_user_id = '${who.id}' where id = '${tile!.id}'`);
    return tile!.id;
  }

  const stateOf = async (id: string) =>
    (await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!.state;
  const nightsOf = (mapId: string) =>
    db.query.hollowEvents.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const heartdustOf = async (mapId: string, who: PublicUser) =>
    (
      await db.query.inventories.findFirst({
        where: (t, { and, eq }) =>
          and(eq(t.mapId, mapId), eq(t.userId, who.id), eq(t.itemId, 'heartdust')),
      })
    )?.quantity ?? 0;
  const statusOf = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/hollow`, who);
    expect(res.statusCode, res.body).toBe(200);
    return HollowResponseSchema.parse(res.json()).hollow;
  };

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

  describe('nightfall', () => {
    it('takes one exposed squishy, never one behind a lit fire or on watch (acceptance)', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      // The kid's fire is lit tonight: everyone at home, housed or not, is safe.
      const meadow = await build(mapId, kid, 'cozy-meadow', { spot: 2 });
      await build(mapId, kid, 'hearthfire', { fuelledThrough: TONIGHT });
      const safe = [await squishy(mapId, kid), await squishy(mapId, kid, { habitat: meadow })];
      // The friend has no fire: two at home are exposed; one stands watch on their land.
      const exposed = [await squishy(mapId, friend), await squishy(mapId, friend)];
      const guard = await squishy(mapId, friend);
      await standWatch(mapId, await landFor(mapId, friend), guard);

      const hollow = hollowService();
      expect(await hollow.runNightfall(mapId, TONIGHT)).toEqual({ taken: 1 });

      for (const id of [...safe, guard]) expect(await stateOf(id)).toBe('active');
      const states = await Promise.all(exposed.map(stateOf));
      expect(states.filter((s) => s === 'hollowed')).toHaveLength(1);
      const taken = exposed[states.indexOf('hollowed')]!;

      const [night] = await nightsOf(mapId);
      expect(night).toMatchObject({ night: TONIGHT, ranAt: clock });
      expect(night!.outcomes).toEqual(
        expect.arrayContaining([
          { userId: kid.id, taken: null, exposed: 0, sheltered: 2 },
          { userId: friend.id, taken, exposed: 2, sheltered: 1 },
        ]),
      );
      // The habitat bed is kept while it's away (#18).
      const events = (await eventsOf(mapId)).slice(-2);
      expect(events.map((e) => e.type)).toEqual(['squishy.hollowed', 'hollow.nightfall']);
      const [hollowed, fell] = events;
      expect(parseGameEventPayload('squishy.hollowed', hollowed!.payload)).toEqual({
        userId: friend.id,
        squishyId: taken,
        night: TONIGHT,
      });
      // Everyone hears that night fell and who lost someone; only the owner hears which.
      expect(publicViewFor(PUBLIC_VIEWS, fell!, { userId: kid.id })).toEqual({
        night: TONIGHT,
        taken: [{ userId: friend.id }],
      });
      expect(publicViewFor(PUBLIC_VIEWS, hollowed!, { userId: kid.id })).toBeNull();
      expect(publicViewFor(PUBLIC_VIEWS, hollowed!, { userId: friend.id })).toMatchObject({
        squishyId: taken,
      });
    });

    it('runs once per map and night, however often it is asked (idempotent)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const ids = [await squishy(mapId, kid), await squishy(mapId, kid), await squishy(mapId, kid)];
      const hollow = hollowService();

      // Two jobs at once (a retry racing the first): one wins, the other waits and finds the row.
      const results = await Promise.all([
        hollow.runNightfall(mapId, TONIGHT),
        hollow.runNightfall(mapId, TONIGHT),
      ]);
      expect(results.filter((r) => r !== null)).toEqual([{ taken: 1 }]);
      const seq = (await eventsOf(mapId)).length;
      // A restart later the same night takes nothing more.
      expect(await hollow.runNightfall(mapId, TONIGHT)).toBeNull();
      expect(await nightsOf(mapId)).toHaveLength(1);
      expect(await eventsOf(mapId)).toHaveLength(seq);
      const states = await Promise.all(ids.map(stateOf));
      expect(states.filter((s) => s === 'hollowed')).toHaveLength(1);
      // The next night is its own: he only needs one more.
      expect(await hollow.runNightfall(mapId, '2026-10-03')).toEqual({ taken: 1 });
      expect((await Promise.all(ids.map(stateOf))).filter((s) => s === 'hollowed')).toHaveLength(2);
    });

    it('protects a night only while the fire has fuel for it', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      // Fuelled through tonight: tonight is safe, tomorrow it has gone out.
      await build(mapId, kid, 'hearthfire', { fuelledThrough: TONIGHT });
      const id = await squishy(mapId, kid);
      const hollow = hollowService();
      expect(await hollow.runNightfall(mapId, TONIGHT)).toEqual({ taken: 0 });
      expect(await stateOf(id)).toBe('active');
      expect(await hollow.runNightfall(mapId, '2026-10-03')).toEqual({ taken: 1 });
      expect(await stateOf(id)).toBe('hollowed');
    });

    it('takes nothing on a tutorial map (nothing can be lost in the tutorial)', async () => {
      const server = await start();
      const kid = await player();
      const res = await call(server, 'POST', '/tutorial/start', kid);
      expect(res.statusCode, res.body).toBe(201);
      const mapId = TutorialResponseSchema.parse(res.json()).tutorial.mapId!;
      const id = await squishy(mapId, kid);
      expect(await hollowService().runNightfall(mapId, TONIGHT)).toEqual({ taken: 0 });
      expect(await stateOf(id)).toBe('active');
      expect((await nightsOf(mapId))[0]!.outcomes).toEqual([
        { userId: kid.id, taken: null, exposed: 1, sheltered: 0 },
      ]);
    });

    it('falls at 21:00 map time, daylight saving included, once each night', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const hollow = hollowService();
      const dueHere = async () => (await hollow.dueNightfalls()).filter((d) => d.mapId === mapId);

      // The patch is new this afternoon: last night's nightfall isn't its own.
      expect(await dueHere()).toEqual([]);
      // 20:59 MDT: not yet. 21:00 MDT is 03:00Z.
      clock.setTime(Date.parse('2026-10-03T02:59:00Z'));
      expect(await dueHere()).toEqual([]);
      clock.setTime(Date.parse('2026-10-03T03:00:30Z'));
      expect(await dueHere()).toEqual([{ mapId, night: TONIGHT }]);
      await hollow.runNightfall(mapId, TONIGHT);
      expect(await dueHere()).toEqual([]);

      // Clocks go back on Nov 1: 21:00 MDT on Oct 31 is 03:00Z, 21:00 MST on Nov 1 is 04:00Z.
      clock.setTime(Date.parse('2026-11-01T03:00:30Z'));
      expect(await dueHere()).toEqual([{ mapId, night: '2026-10-31' }]);
      await hollow.runNightfall(mapId, '2026-10-31');
      clock.setTime(Date.parse('2026-11-02T03:30:00Z')); // 20:30 MST
      expect(await dueHere()).toEqual([]);
      clock.setTime(Date.parse('2026-11-02T04:00:30Z')); // 21:00 MST
      expect(await dueHere()).toEqual([{ mapId, night: '2026-11-01' }]);
    });
  });

  describe('the morning report', () => {
    it('tells each player what happened last night, gently', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      await build(mapId, kid, 'hearthfire', { fuelledThrough: TONIGHT });
      await squishy(mapId, kid);
      const taken = await squishy(mapId, friend);
      await hollowService().runNightfall(mapId, TONIGHT);

      // Next morning, 8:00 MDT.
      clock.setTime(Date.parse('2026-10-03T14:00:00Z'));
      const mine = await statusOf(server, friend, mapId);
      expect(mine.night).toEqual({ isNight: false, changesInMinutes: 13 * 60 });
      expect(mine.reports).toEqual([
        {
          night: TONIGHT,
          taken: { squishyId: taken, speciesId: MOONPUFF.id, nickname: null, inHollow: true },
          sheltered: 0,
        },
      ]);
      expect(mine.hollowed.map((s) => s.id)).toEqual([taken]);
      // Moonpuff is secret: the owner gets its row, since they've met it.
      expect(mine.speciesDefs.map((s) => s.id)).toEqual([MOONPUFF.id]);
      expect(mine.rescue).toEqual({
        heartdust: HOLLOW_RULES.rescue.heartdust,
        rewardsLeftToday: HOLLOW_RULES.rescue.rewardsPerDay,
      });

      const theirs = await statusOf(server, kid, mapId);
      expect(theirs.reports).toEqual([{ night: TONIGHT, taken: null, sheltered: 1 }]);
      expect(theirs.hollowed).toEqual([]);
      expect(theirs.speciesDefs).toEqual([]);
      // Nothing about the other player's squishies, seeds or shadows.
      expect(JSON.stringify(theirs)).not.toContain(taken);

      // It's night again from 21:00.
      clock.setTime(Date.parse('2026-10-04T03:30:00Z'));
      expect((await statusOf(server, kid, mapId)).night.isNight).toBe(true);
    });
  });

  describe('rescue', () => {
    it('wins a squishy back from the Hollow, fully restored, with Heartdust once a day (acceptance)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const meadow = await build(mapId, kid, 'cozy-meadow');
      await squishy(mapId, kid, { level: 40, habitat: meadow });
      const lost = await squishy(mapId, kid, { habitat: meadow, state: 'hollowed' });
      const lost2 = await squishy(mapId, kid, { state: 'hollowed' });
      const hollow = hollowService();

      const started = await hollow.rescue(kid, mapId, { squishyId: lost });
      expect(started.created).toBe(true);
      const battle = started.battle;
      expect(battle.kind).toBe('rescue');
      expect(battle.view.sides.b.controller).toEqual({ type: 'ai', policy: 'guardian' });
      expect(battle.view.sides.b.squishies.map((s) => s.id)).toEqual(['shadow-1']);
      // The squishy in the Hollow isn't on the team; the strong friend goes.
      expect(battle.view.sides.a.squishies.map((s) => s.id)).not.toContain(lost);
      expect(battle.seed).toBeNull();
      // Starting again resumes it (one battle at a time).
      expect((await hollow.rescue(kid, mapId, { squishyId: lost })).created).toBe(false);

      const done = await playOut(server, kid, battle);
      expect(done.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
      // Settled after commit by the `hollow` consumer.
      await runConsumer(db, createHollowConsumer(hollow), mapId);
      expect(await stateOf(lost)).toBe('active');
      // Back in its own bed.
      const back = await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, lost) });
      expect(back!.habitatBuildingId).toBe(meadow);
      expect(await heartdustOf(mapId, kid)).toBe(HOLLOW_RULES.rescue.heartdust);
      const ledger = await db.query.resourceLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.itemId, 'heartdust')),
      });
      expect(ledger).toMatchObject([{ reason: 'rescue', delta: HOLLOW_RULES.rescue.heartdust }]);
      const rescued = (await eventsOf(mapId)).at(-1)!;
      expect(rescued.type).toBe('squishy.rescued');
      expect(parseGameEventPayload('squishy.rescued', rescued.payload)).toEqual({
        userId: kid.id,
        squishyId: lost,
        battleId: battle.id,
        heartdust: HOLLOW_RULES.rescue.heartdust,
      });
      // The consumer runs each event once: running it again changes nothing.
      await runConsumer(db, createHollowConsumer(hollow), mapId);
      expect(await heartdustOf(mapId, kid)).toBe(HOLLOW_RULES.rescue.heartdust);

      // A second rescue the same day still brings them home, without the reward.
      const second = await hollow.rescue(kid, mapId, { squishyId: lost2 });
      await playOut(server, kid, second.battle);
      await runConsumer(db, createHollowConsumer(hollow), mapId);
      expect(await stateOf(lost2)).toBe('active');
      expect(await heartdustOf(mapId, kid)).toBe(HOLLOW_RULES.rescue.heartdust);
      expect((await statusOf(server, kid, mapId)).rescue.rewardsLeftToday).toBe(0);
    });

    it('leaves the squishy waiting in the Hollow after a lost rescue', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await squishy(mapId, kid, { level: 10 });
      const lost = await squishy(mapId, kid, { state: 'hollowed' });
      const hollow = hollowService();
      const { battle } = await hollow.rescue(kid, mapId, { squishyId: lost });
      const res = await act(server, kid, battle, { type: 'forfeit' });
      expect(res.statusCode).toBe(200);
      await runConsumer(db, createHollowConsumer(hollow), mapId);
      expect(await stateOf(lost)).toBe('hollowed');
      expect(await heartdustOf(mapId, kid)).toBe(0);
      const [row] = await db.query.hollowRescues.findMany({
        where: (t, { eq }) => eq(t.battleId, battle.id),
      });
      expect(row).toMatchObject({ outcome: 'lost', heartdust: 0, endedAt: clock });
      // They can always try again.
      expect((await hollow.rescue(kid, mapId, { squishyId: lost })).created).toBe(true);
    });

    it('lets the squishy help when everyone else is in the Hollow too', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const lost = await squishy(mapId, kid, { level: 40, state: 'hollowed' });
      const { battle } = await hollowService().rescue(kid, mapId, { squishyId: lost });
      expect(battle.view.sides.a.squishies.map((s) => s.id)).toEqual([lost]);
    });

    it('refuses squishies that are home already, or not yours, through the API', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      const home = await squishy(mapId, kid);
      const theirs = await squishy(mapId, friend, { state: 'hollowed' });

      const atHome = await call(server, 'POST', `/maps/${mapId}/rescues`, kid, { squishyId: home });
      expect(atHome.statusCode).toBe(409);
      expect(errorOf(atHome).message).toBe('That squishy is safe at home already!');
      const notMine = await call(server, 'POST', `/maps/${mapId}/rescues`, kid, {
        squishyId: theirs,
      });
      expect(notMine.statusCode).toBe(404);
      expect(await db.query.battles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) })).toEqual(
        [],
      );

      // Their own works, from anywhere (decision C): a rescue battle, no attempt used.
      const ok = await call(server, 'POST', `/maps/${mapId}/rescues`, friend, {
        squishyId: theirs,
      });
      expect(ok.statusCode, ok.body).toBe(201);
      expect(battleOf(ok).kind).toBe('rescue');
      expect(await db.query.tileAttacks.findMany()).not.toContainEqual(
        expect.objectContaining({ mapId }),
      );
    });
  });

  describe('dev nightfall', () => {
    it('makes the next night fall now, for playtesting (dev/test only)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await squishy(mapId, kid);
      await squishy(mapId, kid);

      const first = await call(server, 'POST', `/maps/${mapId}/dev/nightfall`, kid);
      expect(first.statusCode, first.body).toBe(200);
      expect(DevNightfallResponseSchema.parse(first.json())).toEqual({ night: TONIGHT, taken: 1 });
      const second = await call(server, 'POST', `/maps/${mapId}/dev/nightfall`, kid);
      expect(DevNightfallResponseSchema.parse(second.json())).toEqual({
        night: '2026-10-03',
        taken: 1,
      });
      const third = await call(server, 'POST', `/maps/${mapId}/dev/nightfall`, kid);
      expect(DevNightfallResponseSchema.parse(third.json())).toEqual({
        night: '2026-10-04',
        taken: 0,
      });
    });

    it("isn't there without the dev flag", async () => {
      const server = await start(false);
      const kid = await player();
      const mapId = await patch(server, kid);
      const res = await call(server, 'POST', `/maps/${mapId}/dev/nightfall`, kid);
      expect(res.statusCode).toBe(404);
    });
  });
});
