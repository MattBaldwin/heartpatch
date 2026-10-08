import {
  ApiErrorSchema,
  BATTLE_RULES,
  CARE_RULES,
  BattleResponseSchema,
  DevNightfallResponseSchema,
  HOLLOW_RULES,
  hexDistance,
  HollowResponseSchema,
  JoinMapResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  TutorialResponseSchema,
  type MapDetail,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
  type HollowRules,
  type RescueGuardianRules,
} from '@heartpatch/shared';
import { RESCUE_GUARDIANS, SERVER_GAME_DATA } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import {
  battles,
  buildings,
  keepers,
  sessions,
  squishies,
  tileAttacks,
  tileDefenders,
  users,
} from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesService } from '../battles/service.js';
import { setDevDropChance } from '../wardrobe/drops.js';
import { createHollowConsumer } from './consumer.js';
import { homesteadOf, refreshHomesteads } from '../explore/homesteads.js';
import { createTendingRepo } from '../territory/repo.js';
import { createLandTending } from '../territory/tending.js';
import { createHollowService, type HollowService } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
/** A secret squishy: the owner's Hollow status carries its row since they've met it (rule 6). */
const SECRET = SERVER_GAME_DATA.secretSpecies[0]!;
// Noon in Denver on Oct 2 (MDT, UTC−6): tonight's nightfall is 01:00Z on Oct 3.
const START = '2026-10-02T18:00:00Z';
const TONIGHT = '2026-10-02';
/** The shipped grace, then one strike every night (the shipped curve rolls for it). */
const GRACE_THEN_ONE: HollowRules = {
  ...HOLLOW_RULES,
  strength: {
    ...HOLLOW_RULES.strength,
    nights: [
      { from: 1, stage: 'watching', chances: [] },
      { from: 3, stage: 'curious', chances: [100] },
    ],
  },
};
/**
 * No first-night grace, and one strike every night (#277's curve has its own
 * tests below): a patch made this afternoon can lose a squishy tonight.
 */
const NO_GRACE: HollowRules = {
  ...HOLLOW_RULES,
  graceNights: 0,
  strength: { ...HOLLOW_RULES.strength, nights: [{ from: 1, stage: 'curious', chances: [100] }] },
};
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
    setDevDropChance(null);
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

  /**
   * The service on its own, with weak shadows (rescues the tests can win) and
   * no first-night grace unless asked, so a patch made this afternoon can
   * lose a squishy tonight (the grace has its own tests).
   */
  function hollowService(
    guardians: RescueGuardianRules = WEAK_SHADOWS,
    rules: HollowRules = NO_GRACE,
  ): HollowService {
    const battles = createBattlesService({ db, clock: () => clock });
    return createHollowService({ db, clock: () => clock, battles, guardians, rules });
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
        speciesId: SECRET.id,
        element: SECRET.element,
        feeling: SECRET.feeling,
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

  /**
   * Land of `who`'s out on the map, at least 3 tiles from anyone's land
   * already out there, so no fire on other land reaches it.
   */
  async function farLand(mapId: string, who: PublicUser) {
    const all = await db.query.tiles.findMany({
      where: (t, { and, eq, isNull }) => and(eq(t.mapId, mapId), isNull(t.homeSlot)),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
    const held = all.filter((t) => t.ownerUserId !== null);
    const tile = all.find(
      (t) => t.ownerUserId === null && held.every((h) => hexDistance(h, t) >= 3),
    )!;
    await db.execute(`update tiles set owner_user_id = '${who.id}' where id = '${tile.id}'`);
    return tile.id;
  }

  /** Puts a squishy to work (a gatherer) on a tile: it sleeps out there. Our own uuids. */
  const work = (squishyId: string, tileId: string) =>
    db.execute(
      `update squishies set work_tile_id = '${tileId}', work_since = '${clock.toISOString()}', work_started_at = '${clock.toISOString()}' where id = '${squishyId}'`,
    );

  /**
   * A squishy out in the dark: a gatherer on its own far land with no fire
   * (home is always safe, owner decision 2026-10-07). `tileId` puts it on
   * that land instead.
   */
  async function dark(
    mapId: string,
    who: PublicUser,
    options: { tileId?: string; level?: number } = {},
  ): Promise<string> {
    const id = await squishy(
      mapId,
      who,
      options.level === undefined ? {} : { level: options.level },
    );
    await work(id, options.tileId ?? (await farLand(mapId, who)));
    return id;
  }

  /** A lit fire on `tileId` (out on land), fuelled through `fuelledThrough`. */
  async function fireOn(mapId: string, who: PublicUser, tileId: string, fuelledThrough: string) {
    await db.insert(buildings).values({
      mapId,
      ownerUserId: who.id,
      tileId,
      buildingId: 'hearthfire',
      kind: 'hearthfire',
      spot: 0,
      fuelledThrough,
    });
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
    it('takes one exposed squishy, never one behind a lit fire or on watch in its light (acceptance)', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      // Home is always safe, housed or not; the kid's gatherer works land with a lit fire.
      const meadow = await build(mapId, kid, 'cozy-meadow', { spot: 2 });
      const lit = await farLand(mapId, kid);
      await fireOn(mapId, kid, lit, TONIGHT);
      const safe = [
        await squishy(mapId, kid, { habitat: meadow }),
        await dark(mapId, kid, { tileId: lit }),
      ];
      // The friend's two gatherers are out in the dark; one more stands watch
      // on their land, by a lit fire (guards need its light too, owner decision 2026-10-07).
      const exposed = [await dark(mapId, friend), await dark(mapId, friend)];
      const guard = await squishy(mapId, friend);
      const post = await farLand(mapId, friend);
      await fireOn(mapId, friend, post, TONIGHT);
      await standWatch(mapId, post, guard);

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
          expect.objectContaining({ userId: kid.id, taken: [], exposed: 0, sheltered: 2 }),
          expect.objectContaining({ userId: friend.id, taken: [taken], exposed: 2, sheltered: 1 }),
        ]),
      );
      const events = (await eventsOf(mapId)).slice(-2);
      expect(events.map((e) => e.type)).toEqual(['squishy.hollowed', 'hollow.nightfall']);
      const [hollowed, fell] = events;
      expect(parseGameEventPayload('squishy.hollowed', hollowed!.payload)).toEqual({
        userId: friend.id,
        squishyId: taken,
        night: TONIGHT,
      });
      // Everyone hears that night fell and who lost someone; only the owner hears which.
      // …and everyone sees his walk on each Keeper's border (#277, Q7).
      expect(publicViewFor(PUBLIC_VIEWS, fell!, { userId: kid.id })).toMatchObject({
        night: TONIGHT,
        taken: [{ userId: friend.id }],
        walks: expect.arrayContaining([
          expect.objectContaining({ userId: kid.id }),
          expect.objectContaining({ userId: friend.id }),
        ]) as unknown,
      });
      expect(JSON.stringify(publicViewFor(PUBLIC_VIEWS, fell!, { userId: kid.id }))).not.toContain(
        taken,
      );
      expect(publicViewFor(PUBLIC_VIEWS, hollowed!, { userId: kid.id })).toBeNull();
      expect(publicViewFor(PUBLIC_VIEWS, hollowed!, { userId: friend.id })).toMatchObject({
        squishyId: taken,
      });
    });

    it('takes a guard on watch in the dark, who leaves the watch; never one in a fire’s light or at home (#202)', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      // Guards on watch need a lit fire's reach (owner decision 2026-10-07):
      // one out in the dark, one by a lit fire, one on a home tile.
      const darkPost = await farLand(mapId, kid);
      const litPost = await farLand(mapId, kid);
      await fireOn(mapId, kid, litPost, '2026-10-04');
      const [home] = await homeTilesOf(mapId, kid);
      const inTheDark = await squishy(mapId, kid);
      const byTheFire = await squishy(mapId, kid);
      const atHome = await squishy(mapId, kid);
      await standWatch(mapId, darkPost, inTheDark);
      await standWatch(mapId, litPost, byTheFire);
      await standWatch(mapId, home!.id, atHome);
      // The nudge says so before night falls.
      expect((await statusOf(server, kid, mapId)).fireHint).toBe(true);

      clock.setTime(Date.parse('2026-10-04T18:00:00Z')); // past the first-night grace
      expect(await hollowService().runNightfall(mapId, '2026-10-04')).toEqual({ taken: 1 });
      expect(await stateOf(inTheDark)).toBe('hollowed');
      for (const id of [byTheFire, atHome]) expect(await stateOf(id)).toBe('active');
      const [night] = await nightsOf(mapId);
      expect(night!.outcomes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: kid.id, taken: [inTheDark], exposed: 1, sheltered: 2 }),
        ]),
      );
      // Taken, it left the watch in the same nightfall: its tile falls back to
      // its land's guardians. The others stay on watch.
      const posted = await db.query.tileDefenders.findMany({
        where: (t, { eq }) => eq(t.mapId, mapId),
      });
      expect(posted.map((d) => d.squishyId).sort()).toEqual([byTheFire, atHome].sort());
      // …and every map hears its post is empty now, as posting and jobs say.
      const changed = (await eventsOf(mapId)).filter((e) => e.type === 'defenders.changed');
      const darkTile = (await db.query.tiles.findFirst({
        where: (t, { eq }) => eq(t.id, darkPost),
      }))!;
      expect(changed.map((e) => e.payload)).toEqual([
        { userId: kid.id, q: darkTile.q, r: darkTile.r, count: 0, squishyIds: [] },
      ]);
    });

    it('keeps a gatherer safe under a fire on captured land, and not one beyond it (#202)', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      // Two of the kid's outer tiles, far apart; a lit fire stands on the first.
      const wild = await db.query.tiles.findMany({
        where: (t, { and, eq, isNull }) =>
          and(eq(t.mapId, mapId), isNull(t.homeSlot), isNull(t.ownerUserId)),
        orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
      });
      const lit = wild[0]!;
      const far = wild.find((t) => hexDistance(t, lit) >= 3)!;
      await db.execute(
        `update tiles set owner_user_id = '${kid.id}' where id in ('${lit.id}', '${far.id}')`,
      );
      await db.insert(buildings).values({
        mapId,
        ownerUserId: kid.id,
        tileId: lit.id,
        buildingId: 'hearthfire',
        kind: 'hearthfire',
        spot: 0,
        fuelledThrough: TONIGHT,
      });
      // Gatherers on both (as if through `/job`): our own uuids, so raw SQL is safe.
      const work = (squishyId: string, tileId: string) =>
        db.execute(
          `update squishies set work_tile_id = '${tileId}', work_since = '${clock.toISOString()}', work_started_at = '${clock.toISOString()}' where id = '${squishyId}'`,
        );
      const near = await squishy(mapId, kid);
      const out = await squishy(mapId, kid);
      await work(near, lit.id);
      await work(out, far.id);
      // No fire at home, and home is safe anyway: the Heart Seed (owner decision 2026-10-07).
      const atHome = await squishy(mapId, kid);

      expect(await hollowService().runNightfall(mapId, TONIGHT)).toEqual({ taken: 1 });
      const [night] = await nightsOf(mapId);
      expect(night!.outcomes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: kid.id, exposed: 1, sheltered: 2 }),
        ]),
      );
      expect(await stateOf(near)).toBe('active');
      expect(await stateOf(atHome)).toBe('active');
      expect(await stateOf(out)).toBe('hollowed');
    });

    it('runs once per map and night, however often it is asked (idempotent)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const ids = [await dark(mapId, kid), await dark(mapId, kid), await dark(mapId, kid)];
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
      // Fuelled through tonight: tonight its land is safe, tomorrow it has gone out.
      const land = await farLand(mapId, kid);
      await fireOn(mapId, kid, land, TONIGHT);
      const ids = [
        await dark(mapId, kid, { tileId: land }),
        await dark(mapId, kid, { tileId: land }),
      ];
      const hollow = hollowService();
      expect(await hollow.runNightfall(mapId, TONIGHT)).toEqual({ taken: 0 });
      for (const id of ids) expect(await stateOf(id)).toBe('active');
      expect(await hollow.runNightfall(mapId, '2026-10-03')).toEqual({ taken: 1 });
      const states = await Promise.all(ids.map(stateOf));
      expect(states.filter((s) => s === 'hollowed')).toHaveLength(1);
    });

    it('keeps everyone at home safe with no fire at all (the Heart Seed, owner decision 2026-10-07)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const meadow = await build(mapId, kid, 'cozy-meadow', { spot: 2 });
      const ids = [await squishy(mapId, kid), await squishy(mapId, kid, { habitat: meadow })];
      expect(await hollowService().runNightfall(mapId, TONIGHT)).toEqual({ taken: 0 });
      for (const id of ids) expect(await stateOf(id)).toBe('active');
      expect((await nightsOf(mapId))[0]!.outcomes).toEqual([
        expect.objectContaining({ userId: kid.id, taken: [], exposed: 0, sheltered: 2 }),
      ]);
    });

    it('takes nothing on a tutorial map (nothing can be lost in the tutorial)', async () => {
      const server = await start();
      const kid = await player();
      const res = await call(server, 'POST', '/tutorial/start', kid);
      expect(res.statusCode, res.body).toBe(201);
      const mapId = TutorialResponseSchema.parse(res.json()).tutorial.mapId!;
      const id = await squishy(mapId, kid);
      // The night is the tutorial's own step (#24): the sweep never runs it.
      expect((await hollowService().dueNightfalls()).map((d) => d.mapId)).not.toContain(mapId);
      expect(await hollowService().runNightfall(mapId, TONIGHT)).toEqual({ taken: 0 });
      expect(await stateOf(id)).toBe('active');
      // He only watches in the Glade (#277): no strike, no walk.
      expect((await nightsOf(mapId))[0]!.outcomes).toEqual([
        expect.objectContaining({ stage: 'watching', walk: [], reclaimed: [] }),
      ]);
      // Both at home (the Glade friend too), safe by the Heart Seed.
      expect((await nightsOf(mapId))[0]!.outcomes).toEqual([
        expect.objectContaining({ userId: kid.id, taken: [], exposed: 0, sheltered: 2 }),
      ]);
    });

    it('skips a player for their first two nightfalls after joining (first-night grace)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      // A friend joins at 6:55 PM, with a squishy and no fire.
      clock.setTime(Date.parse('2026-10-03T00:55:00Z'));
      const friend = await player();
      const res = await call(server, 'GET', `/maps/${mapId}`, kid);
      const code = MapResponseSchema.parse(res.json()).map.admin!.invite!.code;
      const join = await call(server, 'POST', '/maps/join', friend, { code });
      const request = JoinMapResponseSchema.parse(join.json()).request;
      await call(server, 'POST', `/maps/${mapId}/requests/${request.id}/approve`, kid);
      // Two each (he never takes a last friend), none behind a fire.
      const theirs = [await dark(mapId, friend), await dark(mapId, friend)];
      // The kid joined at noon: tonight is their first grace night too.
      const mine = [await dark(mapId, kid), await dark(mapId, kid)];
      const hollow = hollowService(WEAK_SHADOWS, GRACE_THEN_ONE);

      // Tonight (5 minutes later) and tomorrow: nothing taken from either, the dark still counted.
      clock.setTime(Date.parse('2026-10-03T01:00:30Z'));
      expect(await hollow.runNightfall(mapId, TONIGHT)).toEqual({ taken: 0 });
      expect(await hollow.runNightfall(mapId, '2026-10-03')).toEqual({ taken: 0 });
      const [night] = await nightsOf(mapId);
      expect(night!.outcomes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: friend.id, taken: [], exposed: 2, sheltered: 0 }),
        ]),
      );
      const hollowedOf = async (ids: string[]) =>
        (await Promise.all(ids.map(stateOf))).filter((s) => s === 'hollowed').length;
      expect(await hollowedOf([...theirs, ...mine])).toBe(0);
      // The third nightfall is a normal night: one from each.
      expect(await hollow.runNightfall(mapId, '2026-10-04')).toEqual({ taken: 2 });
      expect(await hollowedOf(theirs)).toBe(1);
      expect(await hollowedOf(mine)).toBe(1);
    });

    it('counts the grace from joining, so a later joiner keeps theirs while others do not', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid);
      const mine = [await dark(mapId, kid), await dark(mapId, kid)];
      // Two days on, a friend joins (game clock).
      clock.setTime(Date.parse('2026-10-04T18:00:00Z'));
      const res = await call(server, 'GET', `/maps/${mapId}`, kid);
      const code = MapResponseSchema.parse(res.json()).map.admin!.invite!.code;
      const join = await call(server, 'POST', '/maps/join', friend, { code });
      const request = JoinMapResponseSchema.parse(join.json()).request;
      await call(server, 'POST', `/maps/${mapId}/requests/${request.id}/approve`, kid);
      const theirs = await dark(mapId, friend);
      expect(
        await hollowService(WEAK_SHADOWS, GRACE_THEN_ONE).runNightfall(mapId, '2026-10-04'),
      ).toEqual({ taken: 1 });
      expect((await Promise.all(mine.map(stateOf))).filter((s) => s === 'hollowed')).toHaveLength(
        1,
      );
      expect(await stateOf(theirs)).toBe('active');
    });

    it('falls at 19:00 map time, daylight saving included, once each night (#277)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const hollow = hollowService();
      const dueHere = async () => (await hollow.dueNightfalls()).filter((d) => d.mapId === mapId);

      // The patch is new this afternoon: last night's nightfall isn't its own.
      expect(await dueHere()).toEqual([]);
      // 18:59 MDT: not yet. 19:00 MDT is 01:00Z.
      clock.setTime(Date.parse('2026-10-03T00:59:00Z'));
      expect(await dueHere()).toEqual([]);
      clock.setTime(Date.parse('2026-10-03T01:00:30Z'));
      expect(await dueHere()).toEqual([{ mapId, night: TONIGHT }]);
      await hollow.runNightfall(mapId, TONIGHT);
      expect(await dueHere()).toEqual([]);

      // Clocks go back on Nov 1: 19:00 MDT on Oct 31 is 01:00Z, 19:00 MST on Nov 1 is 02:00Z.
      clock.setTime(Date.parse('2026-11-01T01:00:30Z'));
      expect(await dueHere()).toEqual([{ mapId, night: '2026-10-31' }]);
      await hollow.runNightfall(mapId, '2026-10-31');
      clock.setTime(Date.parse('2026-11-02T01:30:00Z')); // 18:30 MST
      expect(await dueHere()).toEqual([]);
      clock.setTime(Date.parse('2026-11-02T02:00:30Z')); // 19:00 MST
      expect(await dueHere()).toEqual([{ mapId, night: '2026-11-01' }]);
    });
  });

  describe('the Hollow Man grows bolder (#277, owner decisions 2026-10-08)', () => {
    /** Three strikes every night (the shipped curve's night 14 with a raised multiplier). */
    const BOLDEST: HollowRules = {
      ...NO_GRACE,
      strength: {
        ...HOLLOW_RULES.strength,
        nights: [{ from: 1, stage: 'boldest', chances: [100, 100, 100] }],
      },
    };
    const ownerOf = async (tileId: string) =>
      (await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, tileId) }))!.ownerUserId;
    const outcomeOf = async (mapId: string, who: PublicUser) =>
      ((await nightsOf(mapId))[0]!.outcomes as { userId: string; reclaimed: unknown[] }[]).find(
        (o) => o.userId === who.id,
      )!;
    /** Patches start gentle (one strike at most): these tests turn challenges on. */
    const pvpOn = (mapId: string) =>
      db.execute(`update maps set pvp_mode = 'on' where id = '${mapId}'`);
    /** `count` gatherers, each out on its own dark land. */
    async function darkLand(mapId: string, who: PublicUser, count: number) {
      const tiles: string[] = [];
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const tile = await farLand(mapId, who);
        tiles.push(tile);
        ids.push(await dark(mapId, who, { tileId: tile }));
      }
      return { tiles, ids };
    }

    it('strikes up to three times: takes all but the last friend, wins back the farthest dark land, which goes wild', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await pvpOn(mapId);
      const { tiles, ids } = await darkLand(mapId, kid, 4);
      // A fire that's gone out stands on one of them: it comes down with the land.
      await fireOn(mapId, kid, tiles[0]!, '2026-10-01');
      const hollow = hollowService(WEAK_SHADOWS, BOLDEST);

      expect(await hollow.runNightfall(mapId, TONIGHT)).toEqual({ taken: 3 });
      const states = await Promise.all(ids.map(stateOf));
      expect(states.filter((s) => s === 'hollowed')).toHaveLength(3);
      const outcome = await outcomeOf(mapId, kid);
      // The cap: three tiles, the farthest from home, recorded and announced.
      expect(outcome).toMatchObject({ strikes: 3, stage: 'boldest' });
      expect(outcome.reclaimed).toHaveLength(3);
      const fell = (await eventsOf(mapId)).at(-1)!;
      expect(fell.type).toBe('hollow.nightfall');
      expect(parseGameEventPayload('hollow.nightfall', fell.payload).walks).toEqual([
        expect.objectContaining({ userId: kid.id, stage: 'boldest', reclaimed: outcome.reclaimed }),
      ]);
      // Still theirs until the reclaim step runs.
      for (const tile of tiles) expect(await ownerOf(tile)).toBe(kid.id);

      expect(await hollow.reclaim(mapId, TONIGHT)).toEqual({ wild: 3 });
      const owners = await Promise.all(tiles.map(ownerOf));
      expect(owners.filter((o) => o === null)).toHaveLength(3);
      const events = await eventsOf(mapId);
      const rewilded = events.filter((e) => e.type === 'tile.rewilded');
      expect(rewilded.map((e) => parseGameEventPayload('tile.rewilded', e.payload))).toEqual([
        expect.objectContaining({ userId: kid.id, cause: 'hollow' }),
      ]);
      // A retry finds the land gone and does nothing more.
      expect(await hollow.reclaim(mapId, TONIGHT)).toEqual({ wild: 0 });

      // The morning report says what came back.
      clock.setTime(Date.parse('2026-10-03T14:00:00Z'));
      const [report] = (await statusOf(server, kid, mapId)).reports;
      expect(report).toMatchObject({ stage: 'boldest' });
      expect(report!.taken).toHaveLength(3);
      expect(report!.reclaimed).toHaveLength(3);
      expect(report!.walk.filter((p) => p.kind === 'strike').length).toBeGreaterThanOrEqual(3);
      // The fire came down if its land was won back.
      const fires = (await ownerOf(tiles[0]!)) === null ? 1 : 0;
      expect(report!.lostBuildings).toEqual({ fires, fences: 0, trainingGrounds: 0 });
      expect(
        await db.query.buildings.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) }),
      ).toHaveLength(1 - fires);
    });

    it('wins back a dark homestead too, which keeps its explore progress (#199)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await pvpOn(mapId);
      const { tiles } = await darkLand(mapId, kid, 1);
      const tile = (await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, tiles[0]!) }))!;
      // Fully explored and joined: a homestead (untended land never fades it).
      await db.execute(
        `insert into tile_explore (user_id, tile_id, map_id, layout, terrain, searched, spot_count, completed_at, joined_at)
         values ('${kid.id}', '${tile.id}', '${mapId}', 1, '${tile.terrain}', 7, 3, '${clock.toISOString()}', '${clock.toISOString()}')`,
      );
      const hollow = hollowService(WEAK_SHADOWS, BOLDEST);
      await hollow.runNightfall(mapId, TONIGHT);
      expect((await outcomeOf(mapId, kid)).reclaimed).toEqual([{ q: tile.q, r: tile.r }]);
      expect(await hollow.reclaim(mapId, TONIGHT)).toEqual({ wild: 1 });
      expect(await ownerOf(tile.id)).toBeNull();
      // Winning it back later makes it a homestead again at once: the row stays.
      const [row] = (await db.execute(
        `select completed_at from tile_explore where tile_id = '${tile.id}' and user_id = '${kid.id}'`,
      )) as unknown as { completed_at: unknown }[];
      expect(row?.completed_at).not.toBeNull();
    });

    it('skips land mid-fight, pauses homesteads cut off from home, and never rewilds land won back since', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid); // gentle: one strike a night
      const home = await homeTilesOf(mapId, kid);
      const seed = { q: home[3]!.q, r: home[3]!.r };
      const all = await db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
      // A chain out from home: A next to the home ring, B one tile further.
      const a = all.find(
        (t) =>
          t.homeSlot === null &&
          t.ownerUserId === null &&
          hexDistance(t, seed) === 2 &&
          all.some(
            (b) =>
              b.homeSlot === null &&
              b.ownerUserId === null &&
              hexDistance(b, seed) === 3 &&
              hexDistance(b, t) === 1,
          ),
      )!;
      const b = all.find(
        (t) =>
          t.homeSlot === null &&
          t.ownerUserId === null &&
          hexDistance(t, seed) === 3 &&
          hexDistance(t, a) === 1,
      )!;
      for (const t of [a, b]) {
        await db.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${t.id}'`);
        // Both explored and joined: homesteads.
        await db.execute(
          `insert into tile_explore (user_id, tile_id, map_id, layout, terrain, searched, spot_count, completed_at, joined_at)
           values ('${kid.id}', '${t.id}', '${mapId}', 1, '${t.terrain}', 7, 3, '${clock.toISOString()}', '${clock.toISOString()}')`,
        );
      }
      // B, the farthest, is in a battle's cooldown: he can't win it back tonight.
      const [battle] = await db
        .insert(battles)
        .values({
          mapId,
          kind: 'tile',
          playerUserId: kid.id,
          seed: 's',
          contentHash: 'c',
          setup: {},
          state: {},
        })
        .returning({ id: battles.id });
      await db.insert(tileAttacks).values({
        mapId,
        tileId: b.id,
        attackerUserId: kid.id,
        battleId: battle!.id,
        startedAt: clock,
        cooldownUntil: new Date(clock.getTime() + DAY_MS),
        lastActionAt: clock,
      });
      const hollow = hollowService(WEAK_SHADOWS, BOLDEST);
      await hollow.runNightfall(mapId, TONIGHT);
      expect((await outcomeOf(mapId, kid)).reclaimed).toEqual([{ q: a.q, r: a.r }]);
      expect(await hollow.reclaim(mapId, TONIGHT)).toEqual({ wild: 1 });
      expect(await ownerOf(a.id)).toBeNull();
      // B is cut off from home: it pauses (#199), and everyone hears so.
      const exploreOf = async (tileId: string) =>
        (await db.query.tileExplore.findFirst({
          where: (t, { and, eq }) => and(eq(t.tileId, tileId), eq(t.userId, kid.id)),
        }))!;
      expect((await exploreOf(b.id)).pausedAt).not.toBeNull();
      const paused = (await eventsOf(mapId)).filter((e) => e.type === 'homestead.paused');
      expect(paused.map((e) => e.payload)).toEqual([
        { userId: kid.id, tiles: [{ q: b.q, r: b.r }] },
      ]);
      // A keeps its explore progress: won back, it's a homestead again at once.
      expect((await exploreOf(a.id)).joinedAt).not.toBeNull();
      clock.setTime(clock.getTime() + 60_000);
      await db.transaction(async (tx) => {
        await tx.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${a.id}'`);
        await createTendingRepo(tx).claim(mapId, a.id, clock);
        await refreshHomesteads(tx, mapId, [kid.id], clock);
      });
      expect(homesteadOf(await exploreOf(a.id))).toBe('joined');
      expect(homesteadOf(await exploreOf(b.id))).toBe('joined');
      expect(
        (await db.query.tileTending.findFirst({ where: (t, { eq }) => eq(t.tileId, a.id) }))!
          .claimedAt,
      ).toEqual(clock);
      // A retry of tonight's step leaves the land won back alone.
      expect(await hollow.reclaim(mapId, TONIGHT)).toEqual({ wild: 0 });
      expect(await ownerOf(a.id)).toBe(kid.id);
    });

    it('strikes at most once a night on a gentle patch, whatever the curve', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await db.execute(`update maps set pvp_mode = 'gentle' where id = '${mapId}'`);
      await darkLand(mapId, kid, 3);
      const hollow = hollowService(WEAK_SHADOWS, BOLDEST);
      expect(await hollow.runNightfall(mapId, TONIGHT)).toEqual({ taken: 1 });
      expect((await outcomeOf(mapId, kid)).reclaimed).toHaveLength(1);
    });

    it('does nothing at 0 % "Hollow Man strength", and the percent never passes the cap', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await pvpOn(mapId);
      await darkLand(mapId, kid, 3);
      await db.execute(`update maps set hollow_strength_percent = 0 where id = '${mapId}'`);
      const hollow = hollowService(WEAK_SHADOWS, BOLDEST);
      expect(await hollow.runNightfall(mapId, TONIGHT)).toEqual({ taken: 0 });
      // Turned off, he only watches: no strike, no walk, and every view says so.
      expect(await outcomeOf(mapId, kid)).toMatchObject({
        reclaimed: [],
        strikes: 0,
        stage: 'watching',
        walk: [],
      });
      const fell = (await eventsOf(mapId)).at(-1)!;
      expect(parseGameEventPayload('hollow.nightfall', fell.payload).walks).toEqual([
        { userId: kid.id, stage: 'watching', reclaimed: [], walk: [] },
      ]);
      // Noon on Oct 5, the kid's night 4: the shipped curve says Curious,
      // but turned off he only watches.
      clock.setTime(Date.parse('2026-10-05T18:00:00Z'));
      expect((await statusOf(server, kid, mapId)).tonight).toMatchObject({
        night: '2026-10-05',
        stage: 'watching',
      });
      await db.execute(`update maps set hollow_strength_percent = 100 where id = '${mapId}'`);
      expect((await statusOf(server, kid, mapId)).tonight.stage).toBe('curious');
      clock.setTime(Date.parse(START));
      await db.execute(`update maps set hollow_strength_percent = 300 where id = '${mapId}'`);
      expect(await hollow.runNightfall(mapId, '2026-10-03')).toEqual({ taken: 2 });
    });

    it('keeps land claimed since the last nightfall safe on its first night (guardrail b)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const { tiles, ids } = await darkLand(mapId, kid, 2);
      // Both claimed this afternoon, as a capture records it.
      for (const tile of tiles) {
        await db.execute(
          `insert into tile_tending (tile_id, map_id, tended_at, claimed_at) values ('${tile}', '${mapId}', '${clock.toISOString()}', '${clock.toISOString()}')`,
        );
      }
      const hollow = hollowService(WEAK_SHADOWS, BOLDEST);
      expect(await hollow.runNightfall(mapId, TONIGHT)).toEqual({ taken: 0 });
      expect((await outcomeOf(mapId, kid)).reclaimed).toEqual([]);
      for (const id of ids) expect(await stateOf(id)).toBe('active');
      // The next night they're ordinary dark land.
      expect(await hollow.runNightfall(mapId, '2026-10-03')).toEqual({ taken: 1 });
    });

    it('skips dark land no fire could ever light while nodes block fires (Q5, until #242)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const { tiles } = await darkLand(mapId, kid, 1);
      const tile = (await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, tiles[0]!) }))!;
      // Every tile within the farthest fire's reach has a node in its middle.
      const near = (
        await db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) })
      ).filter((t) => t.homeSlot === null && hexDistance(t, tile) <= 2);
      for (const t of near) {
        await db.execute(`update tiles set node_resource = 'timber' where id = '${t.id}'`);
      }
      expect(await hollowService(WEAK_SHADOWS, BOLDEST).runNightfall(mapId, TONIGHT)).toBeTruthy();
      expect((await outcomeOf(mapId, kid)).reclaimed).toEqual([]);
      // Once nodes can be cleared (#242), it's ordinary dark land.
      const cleared: HollowRules = {
        ...BOLDEST,
        strength: { ...BOLDEST.strength, nodesBlockFires: false },
      };
      await hollowService(WEAK_SHADOWS, cleared).runNightfall(mapId, '2026-10-03');
      const [latest] = (await nightsOf(mapId)).sort((a, b) => (a.night < b.night ? 1 : -1));
      expect(
        (latest!.outcomes as { userId: string; reclaimed: unknown[] }[]).find(
          (o) => o.userId === kid.id,
        )!.reclaimed,
      ).toEqual([{ q: tile.q, r: tile.r }]);
    });

    it('shares one cap a night with untended land going wild (Q6)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await pvpOn(mapId);
      const { tiles } = await darkLand(mapId, kid, 5);
      const hollow = hollowService(WEAK_SHADOWS, BOLDEST);
      await hollow.runNightfall(mapId, TONIGHT);
      expect(await hollow.reclaim(mapId, TONIGHT)).toEqual({ wild: 3 });
      // The two left are long untended, but the night's cap is spent.
      for (const tile of tiles) {
        await db.execute(
          `insert into tile_tending (tile_id, map_id, tended_at) values ('${tile}', '${mapId}', '2026-01-01T00:00:00Z') on conflict (tile_id) do update set tended_at = excluded.tended_at`,
        );
      }
      const land = createLandTending({ db, clock: () => clock });
      expect(await land.nightfall(mapId, TONIGHT)).toEqual({ wild: 0 });
      expect((await Promise.all(tiles.map(ownerOf))).filter((o) => o === kid.id)).toHaveLength(2);
    });
  });

  describe('the morning report', () => {
    it('tells each player what happened last night, gently', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      await squishy(mapId, kid);
      // Two in the dark (he never takes a last friend): one of them is taken.
      const darkOnes = [await dark(mapId, friend), await dark(mapId, friend)];
      await hollowService().runNightfall(mapId, TONIGHT);
      const states = await Promise.all(darkOnes.map(stateOf));
      const taken = darkOnes[states.indexOf('hollowed')]!;
      expect(states.filter((s) => s === 'hollowed')).toHaveLength(1);

      // Next morning, 8:00 MDT.
      clock.setTime(Date.parse('2026-10-03T14:00:00Z'));
      const mine = await statusOf(server, friend, mapId);
      expect(mine.night).toEqual({ isNight: false, changesInMinutes: 11 * 60 });
      // Tonight's show: nightfall at 19:00 MDT, the strike half an hour on (#277).
      expect(mine.tonight).toEqual({
        night: '2026-10-03',
        stage: 'watching',
        nightfallAt: '2026-10-04T01:00:00.000Z',
        strikeAt: '2026-10-04T01:30:00.000Z',
      });
      expect(mine.reports).toEqual([
        {
          night: TONIGHT,
          taken: [{ squishyId: taken, speciesId: SECRET.id, nickname: null, inHollow: true }],
          sheltered: 0,
          exposed: 2,
          // The dark land his gatherers worked: farthest from home, won back (#277).
          reclaimed: [{ q: expect.any(Number) as unknown, r: expect.any(Number) as unknown }],
          stage: 'curious',
          walk: expect.arrayContaining([expect.objectContaining({ kind: 'strike' })]) as unknown,
          lostBuildings: { fires: 0, fences: 0, trainingGrounds: 0 },
        },
      ]);
      expect(mine.hollowed.map((s) => s.id)).toEqual([taken]);
      // It's secret: the owner gets its row, since they've met it.
      expect(mine.speciesDefs.map((s) => s.id)).toEqual([SECRET.id]);
      expect(mine.rescue).toEqual({
        heartdust: HOLLOW_RULES.rescue.heartdust,
        rewardsLeftToday: HOLLOW_RULES.rescue.rewardsPerDay,
      });

      const theirs = await statusOf(server, kid, mapId);
      expect(theirs.reports).toEqual([
        expect.objectContaining({
          night: TONIGHT,
          taken: [],
          sheltered: 1,
          exposed: 0,
          reclaimed: [],
        }),
      ]);
      expect(theirs.hollowed).toEqual([]);
      expect(theirs.speciesDefs).toEqual([]);
      // Nothing about the other player's squishies, seeds or shadows.
      expect(JSON.stringify(theirs)).not.toContain(taken);

      // It's night again from 19:00 (21:30 MDT here), and the show is about tonight.
      clock.setTime(Date.parse('2026-10-04T03:30:00Z'));
      expect((await statusOf(server, kid, mapId)).night.isNight).toBe(true);
    });
  });

  describe('the fire hint', () => {
    it('nudges a new player to light a fire while one of theirs sleeps in the dark, until his first visit', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      // Joined at noon on Oct 2: grace for Oct 2 and 3, his first visit on Oct 4.
      const mapId = await patch(server, kid, [friend]);
      // Everyone at home is safe (owner decision 2026-10-07): nothing to nudge about.
      await squishy(mapId, kid);
      expect((await statusOf(server, kid, mapId)).fireHint).toBe(false);
      // A gatherer out on dark land: light a fire there.
      const land = await farLand(mapId, kid);
      await dark(mapId, kid, { tileId: land });
      expect((await statusOf(server, kid, mapId)).fireHint).toBe(true);
      clock.setTime(Date.parse('2026-10-04T18:00:00Z')); // noon Oct 4: tonight is the first visit
      expect((await statusOf(server, kid, mapId)).fireHint).toBe(true);
      clock.setTime(Date.parse('2026-10-05T18:00:00Z')); // past it: no more nudging
      expect((await statusOf(server, kid, mapId)).fireHint).toBe(false);

      // A fire lit for tonight on that land ends it early; one that's gone out doesn't.
      clock.setTime(Date.parse(START));
      await fireOn(mapId, kid, land, '2026-10-01');
      expect((await statusOf(server, kid, mapId)).fireHint).toBe(true);
      await db.execute(
        `update buildings set fuelled_through = '${TONIGHT}' where tile_id = '${land}'`,
      );
      expect((await statusOf(server, kid, mapId)).fireHint).toBe(false);
      // Nothing of the friend's is out in the dark.
      expect((await statusOf(server, friend, mapId)).fireHint).toBe(false);
    });

    it('keeps nudging while he leaves my last friend in the dark, past the grace', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const land = await farLand(mapId, kid);
      await dark(mapId, kid, { tileId: land });
      const hollow = hollowService(WEAK_SHADOWS, HOLLOW_RULES);
      // Grace nights, then a real one: one friend in the dark, spared (owner decision 2026-10-05).
      for (const night of [TONIGHT, '2026-10-03', '2026-10-04']) {
        expect(await hollow.runNightfall(mapId, night)).toEqual({ taken: 0 });
      }
      clock.setTime(Date.parse('2026-10-05T18:00:00Z')); // noon Oct 5: the grace is over
      const status = await statusOf(server, kid, mapId);
      expect(status.reports[0]).toMatchObject({ night: '2026-10-04', taken: [], exposed: 1 });
      expect(status.fireHint).toBe(true);
      // A fire lit for tonight on its land ends it.
      await fireOn(mapId, kid, land, '2026-10-05');
      expect((await statusOf(server, kid, mapId)).fireHint).toBe(false);
    });

    it('never nudges on a tutorial map (nothing can be lost there)', async () => {
      const server = await start();
      const kid = await player();
      const res = await call(server, 'POST', '/tutorial/start', kid);
      const mapId = TutorialResponseSchema.parse(res.json()).tutorial.mapId!;
      expect((await statusOf(server, kid, mapId)).fireHint).toBe(false);
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
      // Every rewarded rescue finds a little thank-you to wear (#43's `rescue` drops).
      setDevDropChance(100);

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
      // Back in its own bed, and fully content again (#19), from the rescue on.
      const back = await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, lost) });
      expect(back!.habitatBuildingId).toBe(meadow);
      expect(back).toMatchObject({
        contentmentAtLastCare: CARE_RULES.maxContentment,
        lastCaredAt: clock,
      });
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
      const found = () =>
        db.query.clothingOwned.findMany({ where: (t, { eq }) => eq(t.userId, kid.id) });
      expect(await found()).toMatchObject([{ source: 'rescue', mapId }]);
      // The consumer runs each event once: running it again changes nothing.
      await runConsumer(db, createHollowConsumer(hollow), mapId);
      expect(await heartdustOf(mapId, kid)).toBe(HOLLOW_RULES.rescue.heartdust);

      // A second rescue the same day still brings them home, without the reward.
      const second = await hollow.rescue(kid, mapId, { squishyId: lost2 });
      await playOut(server, kid, second.battle);
      await runConsumer(db, createHollowConsumer(hollow), mapId);
      expect(await stateOf(lost2)).toBe('active');
      expect(await heartdustOf(mapId, kid)).toBe(HOLLOW_RULES.rescue.heartdust);
      // …and finds no clothing either (decision C: not a farm).
      expect(await found()).toHaveLength(1);
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
      await dark(mapId, kid);
      await dark(mapId, kid);

      const fall = async () => {
        const res = await call(server, 'POST', `/maps/${mapId}/dev/nightfall`, kid);
        expect(res.statusCode, res.body).toBe(200);
        return DevNightfallResponseSchema.parse(res.json());
      };
      // The real rules: two nights of first-night grace, then he grows bolder
      // (25 %, 50 %, 75 %, then sure on night 6, #277), but never takes the
      // last friend (owner decision 2026-10-05): exactly one of the two goes.
      expect(await fall()).toEqual({ night: TONIGHT, taken: 0 });
      expect(await fall()).toEqual({ night: '2026-10-03', taken: 0 });
      let taken = 0;
      for (const night of ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']) {
        const fell = await fall();
        expect(fell.night).toBe(night);
        taken += fell.taken;
      }
      expect(taken).toBe(1);
      expect(await fall()).toEqual({ night: '2026-10-08', taken: 0 });
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
