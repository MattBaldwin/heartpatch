import {
  ApiErrorSchema,
  GAME_DATA,
  HOLLOW_RULES,
  HollowResponseSchema,
  hexDistance,
  isTradingPost,
  JoinMapResponseSchema,
  LongNightResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  PatchStatsSchema,
  type HollowRules,
  type MapDetail,
  type PublicUser,
} from '@heartpatch/shared';
import { LONG_NIGHT_GAP_TABLE } from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, squishies, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesService } from '../battles/service.js';
import { createHollowService } from '../hollow/service.js';
import { createLongNightRepo } from './repo.js';
import { longNightNightHash } from './service.js';
import type { LongNightSwitch } from './switch.js';

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
// Noon in Denver on Saturday 31 Oct (MDT, UTC−6): the night's nightfall is
// 01:00Z on 1 Nov, and the patch's weekday is Saturday by default.
const START = '2026-10-31T18:00:00Z';
const SATURDAY = '2026-10-31';
const NIGHTFALL = '2026-11-01T01:00:00.000Z';
const AFTER_NIGHTFALL = '2026-11-01T01:05:00Z';
/** No first-night grace, and one certain strike every night, as the Hollow's own tests. */
const NO_GRACE: HollowRules = {
  ...HOLLOW_RULES,
  graceNights: 0,
  strength: { ...HOLLOW_RULES.strength, nights: [{ from: 1, stage: 'curious', chances: [100] }] },
};
const SPECIES = GAME_DATA.species[0]!;
const ON: LongNightSwitch = { mode: 'on', testers: [] };
const OFF: LongNightSwitch = { mode: 'off', testers: [] };

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('the Long Night, server resolve (#727c, needs DATABASE_URL)', () => {
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

  async function start(longNight: 'off' | 'testers' | 'on' = 'on', testers = '') {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_LONG_NIGHT: longNight,
      HP_LONG_NIGHT_TESTERS: testers,
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  /** The Hollow on its own: no grace, a certain strike, and the switch as asked. */
  const hollowService = (longNight: LongNightSwitch = ON, rules: HollowRules = NO_GRACE) =>
    createHollowService({
      db,
      clock: () => clock,
      battles: createBattlesService({ db, clock: () => clock }),
      rules,
      longNight,
    });

  async function player(): Promise<Player> {
    const username = `longnight_${String((counter += 1))}`;
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

  /** A patch for `owner` (and `others`, joined through invite → approve). */
  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Long Night Patch',
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

  /** A gatherer out on far land of `who`'s with no fire (he takes it), and one at home. */
  async function dark(mapId: string, who: PublicUser) {
    const all = await db.query.tiles.findMany({
      where: (t, { and, eq, isNull }) => and(eq(t.mapId, mapId), isNull(t.homeSlot)),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
    const held = all.filter((t) => t.ownerUserId !== null);
    const tile = all.find(
      (t) =>
        t.ownerUserId === null &&
        t.nodeResource === null &&
        !isTradingPost(t) &&
        t.communityId === null &&
        held.every((h) => hexDistance(h, t) >= 3),
    )!;
    await db.execute(`update tiles set owner_user_id = '${who.id}' where id = '${tile.id}'`);
    // A friend safe at home too: he never takes a Keeper's last squishy.
    await db.insert(squishies).values({
      mapId,
      ownerUserId: who.id,
      speciesId: SPECIES.id,
      element: SPECIES.element,
      feeling: SPECIES.feeling,
      level: 5,
    });
    const [row] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: who.id,
        speciesId: SPECIES.id,
        element: SPECIES.element,
        feeling: SPECIES.feeling,
        level: 5,
        workTileId: tile.id,
        workSince: clock,
        workStartedAt: clock,
      })
      .returning({ id: squishies.id });
    return row!.id;
  }

  /** A lit Hearthfire at `who`'s home, fuelled through `fuelledThrough`. */
  async function fire(mapId: string, who: PublicUser, fuelledThrough: string, spot = 1) {
    const tile = await db.query.tiles.findFirst({
      where: (t, { and, eq, isNotNull }) =>
        and(eq(t.mapId, mapId), eq(t.ownerUserId, who.id), isNotNull(t.homeSlot)),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
    await db.insert(buildings).values({
      mapId,
      ownerUserId: who.id,
      tileId: tile!.id,
      buildingId: 'hearthfire',
      kind: 'hearthfire',
      spot,
      fuelledThrough,
    });
  }

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const nightOf = (mapId: string) =>
    db.query.longNights.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const statusOf = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/hollow`, who);
    expect(res.statusCode, res.body).toBe(200);
    return { body: res.body, hollow: HollowResponseSchema.parse(res.json()).hollow };
  };

  /** Night falls on Saturday. */
  async function saturdayNight(mapId: string, longNight: LongNightSwitch = ON) {
    clock.setTime(Date.parse(AFTER_NIGHTFALL));
    return hollowService(longNight).runNightfall(mapId, SATURDAY);
  }

  it('a held Long Night writes its row and both events in nightfall, and the Gap opens', async () => {
    const server = await start();
    const kid = await player();
    const friend = await player();
    const mapId = await patch(server, kid, [friend]);
    // Nothing of theirs in the dark: he takes nothing. The friend lit more fuel.
    await fire(mapId, kid, '2026-11-01');
    await fire(mapId, friend, '2026-11-03');

    expect(await saturdayNight(mapId)).toEqual({ taken: 0 });

    const [row] = await nightOf(mapId);
    expect(row).toMatchObject({
      night: SATURDAY,
      held: true,
      keeperOfNightUserId: friend.id,
      contentHash: longNightNightHash(NO_GRACE),
    });
    expect(row!.seed.length).toBeGreaterThan(0);
    expect(row!.strikeAt.toISOString()).toBe(
      new Date(Date.parse(NIGHTFALL) + HOLLOW_RULES.show.prowlMinutes * 60_000).toISOString(),
    );
    expect(row!.gapOpensAt!.toISOString()).toBe(row!.strikeAt.toISOString());
    expect(row!.gapClosesAt!.getTime() - row!.gapOpensAt!.getTime()).toBe(DAY_MS);
    const outcomes = (await createLongNightRepo(db).latest(mapId))!.outcomes;
    const gapSpecies = new Set(LONG_NIGHT_GAP_TABLE.entries.map((e) => e.species));
    for (const o of outcomes) {
      // The patch's 100 % times the secret multiplier.
      expect(o.percent).toBe(300);
      expect(o.held).toBe(true);
      expect(gapSpecies.has(o.gapSpeciesId!)).toBe(true);
      expect(o.gapClaimedAt).toBeNull();
    }
    expect(outcomes.find((o) => o.userId === friend.id)).toMatchObject({
      firesLit: 1,
      fuelNights: 4,
    });

    // hollow.nightfall (with `longNight`), then longnight.resolved, then gap.opened.
    const events = await eventsOf(mapId);
    const types = events.map((e) => e.type);
    const fell = types.lastIndexOf('hollow.nightfall');
    expect(types.slice(fell)).toEqual(['hollow.nightfall', 'longnight.resolved', 'gap.opened']);
    expect(parseGameEventPayload('hollow.nightfall', events[fell]!.payload).longNight).toEqual({
      held: true,
      heldBy: [kid.id, friend.id].sort(),
      keeperOfNight: friend.id,
      gapClosesAt: row!.gapClosesAt!.toISOString(),
    });
    expect(parseGameEventPayload('gap.opened', events[fell + 2]!.payload)).toEqual({
      night: SATURDAY,
      closesAt: row!.gapClosesAt!.toISOString(),
    });

    // A rerun is a no-op: the night's row is claimed.
    expect(await saturdayNight(mapId)).toBeNull();
    expect(await nightOf(mapId)).toHaveLength(1);

    // While the Gap is open, the status shows it and that I have an encounter.
    clock.setTime(row!.gapOpensAt!.getTime() + 60_000);
    const { hollow } = await statusOf(server, kid, mapId);
    expect(hollow.longNight).toEqual({
      weekday: 6,
      tonight: true,
      nextAt: '2026-11-08T02:00:00.000Z',
      gap: {
        night: SATURDAY,
        opensAt: row!.gapOpensAt!.toISOString(),
        closesAt: row!.gapClosesAt!.toISOString(),
        available: true,
      },
    });
    // After it closes, it's gone.
    clock.setTime(row!.gapClosesAt!.getTime());
    expect((await statusOf(server, kid, mapId)).hollow.longNight?.gap).toBeNull();

    // The `night` crown.
    const stats = await call(server, 'GET', `/maps/${mapId}/stats`, kid);
    expect(PatchStatsSchema.parse(stats.json()).keeperOfTheNight).toEqual({
      userId: friend.id,
      night: SATURDAY,
    });
  });

  it("a Long Night he breaks opens no Gap, and the strength stays the server's", async () => {
    const server = await start();
    const kid = await player();
    const friend = await player();
    const mapId = await patch(server, kid, [friend]);
    await dark(mapId, friend);

    expect(await saturdayNight(mapId)).toEqual({ taken: 1 });
    const [row] = await nightOf(mapId);
    expect(row).toMatchObject({
      held: false,
      gapOpensAt: null,
      gapClosesAt: null,
      keeperOfNightUserId: null,
    });
    const outcomes = (await createLongNightRepo(db).latest(mapId))!.outcomes;
    // A Keeper who joined today and has only watched since is counted.
    expect(outcomes.find((o) => o.userId === friend.id)?.counted).toBe(true);
    expect(outcomes.map((o) => [o.userId, o.held, o.gapSpeciesId])).toEqual(
      [
        [kid.id, true, null],
        [friend.id, false, null],
      ].sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    );
    const events = await eventsOf(mapId);
    expect(events.map((e) => e.type)).not.toContain('gap.opened');
    const resolved = events.find((e) => e.type === 'longnight.resolved')!;
    const fell = events.find((e) => e.type === 'hollow.nightfall')!;
    expect(parseGameEventPayload('longnight.resolved', resolved.payload)).toMatchObject({
      held: false,
      heldBy: [kid.id],
    });
    expect(parseGameEventPayload('longnight.resolved', resolved.payload).outcomes).toHaveLength(2);

    // Rule 6: nothing client-bound carries the outcomes, the percent or a Gap species.
    const secret = /outcomes|percent|gapSpeciesId|strengthMultiplier/;
    for (const event of [resolved, fell]) {
      const view = publicViewFor(PUBLIC_VIEWS, event, { userId: kid.id });
      expect(view).not.toBeNull();
      expect(JSON.stringify(view)).not.toMatch(secret);
    }
    expect(publicViewFor(PUBLIC_VIEWS, resolved, { userId: kid.id })).toEqual({
      night: SATURDAY,
      held: false,
      heldBy: [kid.id],
      keeperOfNight: null,
    });
    const { body } = await statusOf(server, kid, mapId);
    expect(body).not.toMatch(secret);
    const stats = await call(server, 'GET', `/maps/${mapId}/stats`, kid);
    expect(stats.body).not.toMatch(secret);
    expect(PatchStatsSchema.parse(stats.json()).keeperOfTheNight).toBeNull();
  });

  it("a Keeper away two weeks doesn't count, and can't break the hold", async () => {
    const server = await start();
    const kid = await player();
    const friend = await player();
    const mapId = await patch(server, kid, [friend]);
    await dark(mapId, friend);
    // They joined three weeks ago, and their last move on the patch was then too.
    const then = new Date(Date.parse(START) - 21 * DAY_MS);
    await db.execute(
      `update game_events set created_at = '${then.toISOString()}' where actor_user_id = '${friend.id}'`,
    );
    await db.execute(
      `update map_members set joined_at = '${then.toISOString()}' where user_id = '${friend.id}'`,
    );

    await saturdayNight(mapId);
    const [row] = await nightOf(mapId);
    expect(row!.held).toBe(true);
    const outcomes = (await createLongNightRepo(db).latest(mapId))!.outcomes;
    const away = outcomes.find((o) => o.userId === friend.id)!;
    expect(away).toMatchObject({ counted: false, held: false });
    // Plan + owner answer Q4: every Keeper in the outcomes gets an encounter.
    expect(away.gapSpeciesId).not.toBeNull();
    expect(outcomes.find((o) => o.userId === kid.id)).toMatchObject({ counted: true, held: true });
  });

  it('an ordinary night, Off, the switch off or a patch at 0 % write no Long Night', async () => {
    const server = await start();
    const kid = await player();
    const ordinary = await patch(server, kid);
    // Friday is no Long Night on a Saturday patch.
    clock.setTime(Date.parse('2026-10-31T01:05:00Z'));
    expect(await hollowService().runNightfall(ordinary, '2026-10-30')).not.toBeNull();
    expect(await nightOf(ordinary)).toEqual([]);

    const off = await patch(server, kid);
    await db.execute(`update maps set long_night_weekday = null where id = '${off}'`);
    await saturdayNight(off);
    expect(await nightOf(off)).toEqual([]);

    const switchedOff = await patch(server, kid);
    await saturdayNight(switchedOff, OFF);
    expect(await nightOf(switchedOff)).toEqual([]);
    const fell = (await eventsOf(switchedOff)).find((e) => e.type === 'hollow.nightfall')!;
    expect(parseGameEventPayload('hollow.nightfall', fell.payload).longNight).toBeUndefined();

    const zero = await patch(server, kid);
    await db.execute(`update maps set hollow_strength_percent = 0 where id = '${zero}'`);
    await saturdayNight(zero);
    expect(await nightOf(zero)).toEqual([]);
  });

  it('testers: only a patch with a tester gets the Long Night', async () => {
    const tester = await player();
    const kid = await player();
    const server = await start('testers', tester.username.toUpperCase());
    const theirs = await patch(server, kid, [tester]);
    const plain = await patch(server, kid);
    const testers: LongNightSwitch = { mode: 'testers', testers: [tester.username] };
    await saturdayNight(theirs, testers);
    await saturdayNight(plain, testers);
    expect(await nightOf(theirs)).toHaveLength(1);
    expect(await nightOf(plain)).toEqual([]);
    expect((await statusOf(server, kid, theirs)).hollow.longNight).toBeDefined();
    expect((await statusOf(server, kid, plain)).hollow.longNight).toBeUndefined();
  });

  it('a Long Night rolls the same strikes as an ordinary night at the scaled percent', async () => {
    // Uncertain chances, so the strike counts depend on the seed.
    const rules: HollowRules = {
      ...NO_GRACE,
      strength: {
        ...NO_GRACE.strength,
        nights: [{ from: 1, stage: 'curious', chances: [30, 30, 30] }],
      },
    };
    const server = await start();
    const keepers = [await player(), await player(), await player(), await player()];
    const mapId = await patch(server, keepers[0]!, keepers.slice(1));
    const strikesOf = async () =>
      (await db.query.hollowEvents.findFirst({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.night, SATURDAY)),
      }))!.outcomes as { userId: string; strikes: number }[];

    clock.setTime(Date.parse(AFTER_NIGHTFALL));
    await hollowService(ON, rules).runNightfall(mapId, SATURDAY);
    const longNight = await strikesOf();
    expect(await nightOf(mapId)).toHaveLength(1);
    // The same night again as an ordinary one at 300 % (the patch's 100 % × 3).
    await db.execute(`delete from hollow_events where map_id = '${mapId}'`);
    await db.execute(`update maps set hollow_strength_percent = 300 where id = '${mapId}'`);
    await hollowService(OFF, rules).runNightfall(mapId, SATURDAY);
    const ordinary = await strikesOf();
    const counts = (o: { userId: string; strikes: number }[]) =>
      o.map(({ userId, strikes }) => [userId, strikes]);
    expect(counts(ordinary)).toEqual(counts(longNight));
  });

  it('a patch at 0 % shows no countdown: no Night comes there', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await db.execute(`update maps set hollow_strength_percent = 0 where id = '${mapId}'`);
    expect((await statusOf(server, kid, mapId)).hollow.longNight).toEqual({
      weekday: 6,
      tonight: false,
      nextAt: null,
      gap: null,
    });
  });

  it('status before the Night: the countdown, and no Gap', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    // Wednesday noon in Denver: Saturday's 7 PM is still MDT.
    clock.setTime(Date.parse('2026-10-28T18:00:00Z'));
    expect((await statusOf(server, kid, mapId)).hollow.longNight).toEqual({
      weekday: 6,
      tonight: false,
      nextAt: NIGHTFALL,
      gap: null,
    });
    // Saturday afternoon: tonight's the Night.
    clock.setTime(Date.parse(START));
    expect((await statusOf(server, kid, mapId)).hollow.longNight).toMatchObject({
      tonight: true,
      nextAt: NIGHTFALL,
    });
    // Switched off: left out of the reply, and of map details.
    await app!.close();
    const off = await start('off');
    const { body, hollow } = await statusOf(off, kid, mapId);
    expect(hollow.longNight).toBeUndefined();
    expect(body).not.toContain('longNight');
    const details = MapResponseSchema.parse((await call(off, 'GET', `/maps/${mapId}`, kid)).json());
    expect(details.map.longNightWeekday).toBeUndefined();
  });

  it('the owner sets the weekday or Off; members and switched-off patches cannot', async () => {
    const server = await start();
    const owner = await player();
    const kid = await player();
    const mapId = await patch(server, owner, [kid]);

    const set = await call(server, 'POST', `/maps/${mapId}/long-night`, owner, { weekday: 3 });
    expect(set.statusCode, set.body).toBe(200);
    expect(LongNightResponseSchema.parse(set.json())).toEqual({ longNightWeekday: 3 });
    expect(await createLongNightRepo(db).weekday(mapId)).toBe(3);
    const updated = (await eventsOf(mapId)).filter((e) => e.type === 'map.updated').at(-1)!;
    expect(parseGameEventPayload('map.updated', updated.payload)).toMatchObject({
      longNightWeekday: 3,
    });
    expect(publicViewFor(PUBLIC_VIEWS, updated, { userId: kid.id })).toMatchObject({
      longNightWeekday: 3,
    });
    const details = MapResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}`, kid)).json(),
    );
    expect(details.map.longNightWeekday).toBe(3);

    // The same day again writes nothing new.
    const seq = (await eventsOf(mapId)).length;
    await call(server, 'POST', `/maps/${mapId}/long-night`, owner, { weekday: 3 });
    expect(await eventsOf(mapId)).toHaveLength(seq);

    const offRes = await call(server, 'POST', `/maps/${mapId}/long-night`, owner, {
      weekday: null,
    });
    expect(LongNightResponseSchema.parse(offRes.json())).toEqual({ longNightWeekday: null });
    expect(await createLongNightRepo(db).weekday(mapId)).toBeNull();

    const member = await call(server, 'POST', `/maps/${mapId}/long-night`, kid, { weekday: 6 });
    expect(member.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(member.json()).error.code).toBe('FORBIDDEN');
    for (const weekday of [7, -1, 2.5, 'sat']) {
      const bad = await call(server, 'POST', `/maps/${mapId}/long-night`, owner, { weekday });
      expect(bad.statusCode).toBe(400);
    }

    await app!.close();
    const off = await start('off');
    const hidden = await call(off, 'POST', `/maps/${mapId}/long-night`, owner, { weekday: 6 });
    expect(hidden.statusCode).toBe(404);
  });

  it('a mid-week weekday move never brings two Nights in one week', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await saturdayNight(mapId);
    // Moved to Wednesday: 4 Nov is within 6 nights of Saturday's.
    await call(server, 'POST', `/maps/${mapId}/long-night`, kid, { weekday: 3 });
    clock.setTime(Date.parse('2026-11-05T02:05:00Z'));
    await hollowService().runNightfall(mapId, '2026-11-04');
    expect((await nightOf(mapId)).map((n) => n.night)).toEqual([SATURDAY]);
    clock.setTime(Date.parse('2026-11-04T18:00:00Z'));
    expect((await statusOf(server, kid, mapId)).hollow.longNight).toMatchObject({
      weekday: 3,
      tonight: false,
      // The Wednesday after (MST from 1 Nov: 7 PM is 02:00Z).
      nextAt: '2026-11-12T02:00:00.000Z',
    });
  });
});
