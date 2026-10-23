import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  COMMUNITY_RULES,
  FarHollowViewSchema,
  GAME_DATA,
  GROWTH_RULES,
  heartSeedOf,
  hexDistance,
  JOURNEY_RULES,
  journeyFor,
  MapResponseSchema,
  parseGameEventPayload,
  STARTERS,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import {
  farHollowRooms,
  farHollowState,
  keepers,
  sessions,
  squishies,
  users,
} from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';

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
// 10:00 in Denver (MDT, UTC−6): the 08:00–11:59 spawn window.
const START = '2026-11-04T16:00:00Z';
const HERO = STARTERS.speciesIds[0]!;

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('the far Hollow (#306 PR 6, needs DATABASE_URL)', () => {
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
    const username = `faraway_${String((counter += 1))}`;
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
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });
  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;
  const battleOf = (res: LightMyRequestResponse) => BattleResponseSchema.parse(res.json()).battle;
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

  /** A patch for `kid`, with one squishy of `level` on their team. */
  async function patch(server: FastifyInstance, kid: Player, level: number) {
    const res = await call(server, 'POST', '/maps', kid, {
      name: 'Trail Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const mapId = MapResponseSchema.parse(res.json()).map.id;
    const species = GAME_DATA.species.find((s) => s.id === HERO)!;
    await db.insert(squishies).values({
      mapId,
      ownerUserId: kid.id,
      speciesId: HERO,
      element: species.element,
      feeling: species.feeling,
      level,
    });
    return mapId;
  }

  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });

  /** The kid's nearest trading post and its distance from their land. */
  async function nearestPost(mapId: string, kid: PublicUser) {
    const tiles = await tilesOf(mapId);
    const mine = tiles.filter((t) => t.ownerUserId === kid.id);
    const posts = tiles.filter((t) => t.terrain === 'trading-post');
    const near = (p: (typeof posts)[number]) => Math.min(...mine.map((m) => hexDistance(m, p)));
    const post = [...posts].sort((a, b) => near(a) - near(b))[0]!;
    return {
      post,
      distance: near(post),
      seed: heartSeedOf(mine.filter((t) => t.homeSlot !== null))!,
    };
  }

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const journeysOf = (mapId: string) =>
    db.query.journeys.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.startedAt)],
    });
  const STRANGER = '00000000-0000-4000-8000-000000000000';
  const view = async (server: FastifyInstance, kid: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/far-hollow`, kid);
    expect(res.statusCode, res.body).toBe(200);
    return FarHollowViewSchema.parse(res.json());
  };
  const stateOf = (kid: PublicUser) =>
    db.query.farHollowState.findMany({ where: (t, { eq }) => eq(t.userId, kid.id) });

  /** Wins a journey to the kid's nearest post, so it's open to them (a visit pass). */
  async function openPost(server: FastifyInstance, kid: Player, mapId: string) {
    const { post } = await nearestPost(mapId, kid);
    const res = await call(server, 'POST', `/maps/${mapId}/posts/journey`, kid, {
      q: post.q,
      r: post.r,
    });
    expect(res.statusCode, res.body).toBe(201);
    const done = await playOut(server, kid, battleOf(res));
    expect(done.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
    return post;
  }

  it('takes the far road from an open post: a distance-6 trail, and a win is an arrival, not a pass (acceptance)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 60);
    const { post } = await nearestPost(mapId, kid);
    const road = journeyFor(
      COMMUNITY_RULES.farHollow.distance,
      JOURNEY_RULES,
      GROWTH_RULES.maxLevel,
    );

    // Before: a far Hollow this season, not yet reached.
    const before = await view(server, kid, mapId);
    expect(before).toMatchObject({
      name: COMMUNITY_RULES.farHollow.name,
      // Halloween 2026 holds to Nov 9, though Thanksgiving's window starts Nov 3.
      season: { id: 'halloween', name: 'Halloween' },
      arrived: false,
      completedAt: null,
      nextSeason: { id: 'thanksgiving', startsOn: '2026-11-10' },
      road: { distance: COMMUNITY_RULES.farHollow.distance, ...road },
    });
    expect(await stateOf(kid)).toHaveLength(0);

    // A post far from my land isn't open: the far road starts from one that is.
    const far = await call(server, 'POST', `/maps/${mapId}/far-hollow/journey`, kid, {
      q: post.q,
      r: post.r,
    });
    expect(far.statusCode).toBe(403);
    await openPost(server, kid, mapId);

    // Sent with an Idempotency-Key, as the app does: a retry replays the 201,
    // which tells the app it started this battle (its win card names the far Hollow).
    const setOff = () =>
      server.inject({
        method: 'POST',
        url: `/api/v1/maps/${mapId}/far-hollow/journey`,
        headers: { ...HEADERS, 'idempotency-key': 'far-road-1' },
        cookies: { [SESSION_COOKIE]: kid.token },
        payload: { q: post.q, r: post.r },
      });
    const res = await setOff();
    expect(res.statusCode, res.body).toBe(201);
    const replay = await setOff();
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const battle = battleOf(res);
    expect(battleOf(replay).id).toBe(battle.id);
    expect(battle.kind).toBe('journey');
    const trail = battle.view.sides.b.squishies;
    expect(trail).toHaveLength(road.teamSize);
    for (const s of trail) expect(s.level).toBe(road.level);
    const done = await playOut(server, kid, battle);
    expect(done.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });

    const roadRow = (await journeysOf(mapId)).at(-1)!;
    expect(roadRow).toMatchObject({ kind: 'far-hollow', outcome: 'won', visitUntil: null });
    const events = await eventsOf(mapId);
    expect(events.slice(-2).map((e) => e.type)).toEqual(['journey.ended', 'journey.arrived']);
    expect(parseGameEventPayload('journey.ended', events.at(-2)!.payload)).toMatchObject({
      result: 'won',
      visitUntil: null,
      kind: 'far-hollow',
    });
    const entered = events.at(-1)!;
    expect(parseGameEventPayload('journey.arrived', entered.payload)).toMatchObject({
      userId: kid.id,
      season: 'halloween',
      year: 2026,
    });
    // Only I hear that I arrived.
    expect(publicViewFor(PUBLIC_VIEWS, entered, { userId: kid.id })).not.toBeNull();
    expect(publicViewFor(PUBLIC_VIEWS, entered, { userId: STRANGER })).toBeNull();

    // The season's state row, at the front door, and the view says I'm there.
    expect(await stateOf(kid)).toEqual([
      expect.objectContaining({
        mapId,
        keys: 0,
        currentRoom: null,
        lastLitRoom: null,
        completedAt: null,
        arrivedAt: clock,
      }),
    ]);
    expect(await view(server, kid, mapId)).toMatchObject({ arrived: true, completedAt: null });
    // Once a season: the road is done.
    const again = await call(server, 'POST', `/maps/${mapId}/far-hollow/journey`, kid, {
      q: post.q,
      r: post.r,
    });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toMatch(/already in the far Hollow/);
  });

  it('takes the far road at any hour, night too (owner decision of 2026-10-23)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    // My land reaches a post (dev), so it stays open all evening.
    expect((await call(server, 'POST', `/maps/${mapId}/dev/posts/connect`, kid)).statusCode).toBe(
      200,
    );
    const { post: near } = await nearestPost(mapId, kid);
    // 20:00 in Denver.
    clock.setTime(Date.parse('2026-11-05T03:00:00Z'));
    const res = await call(server, 'POST', `/maps/${mapId}/far-hollow/journey`, kid, {
      q: near.q,
      r: near.r,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(battleOf(res).kind).toBe('journey');
  });

  it('keeps Halloween 2026’s far Hollow to Nov 9, then Thanksgiving’s is fresh (#306 6b)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    const [halloween] = await stateOf(kid);
    // Nov 9, 23:00 in Denver: still Halloween's house, still arrived.
    clock.setTime(Date.parse('2026-11-10T06:00:00Z'));
    expect(await view(server, kid, mapId)).toMatchObject({
      season: { id: 'halloween' },
      arrived: true,
    });
    // Nov 10: Thanksgiving's far Hollow, a fresh seed, not yet reached.
    clock.setTime(Date.parse('2026-11-10T17:00:00Z'));
    expect(await view(server, kid, mapId)).toMatchObject({
      season: { id: 'thanksgiving' },
      arrived: false,
      house: null,
      nextSeason: { id: 'christmas', startsOn: '2026-12-01' },
    });
    await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    const rows = await stateOf(kid);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.seasonSeed).not.toBe(halloween!.seasonSeed);
  });

  it('stays open after dark once I’ve arrived (owner decision 1), and needs a member', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    const arrive = await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    expect(arrive.statusCode, arrive.body).toBe(201);
    expect(FarHollowViewSchema.parse(arrive.json()).arrived).toBe(true);
    // 20:00 in Denver.
    clock.setTime(Date.parse('2026-11-05T03:00:00Z'));
    expect((await view(server, kid, mapId)).arrived).toBe(true);
    // Arriving twice is still one row.
    await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    expect(await stateOf(kid)).toHaveLength(1);
    const stranger = await player();
    expect((await call(server, 'GET', `/maps/${mapId}/far-hollow`, stranger)).statusCode).toBe(404);
  });

  it('is fresh next season: no progress, last season’s rows gone, and the far road again (acceptance)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    const [old] = await stateOf(kid);
    // A room row of last season's (#306 6b writes them).
    await db.insert(farHollowRooms).values({
      userId: kid.id,
      mapId,
      seasonSeed: old!.seasonSeed,
      roomId: 'front-hall',
      fixed: 1,
    });

    // Christmas: a new far Hollow, not yet reached; last season's rows don't count.
    clock.setTime(Date.parse('2026-12-02T17:00:00Z'));
    expect(await view(server, kid, mapId)).toMatchObject({
      season: { id: 'christmas', name: 'Christmas' },
      arrived: false,
      completedAt: null,
      // Christmas keeps Dec 31; New Year takes over on the 1st.
      nextSeason: { id: 'new-year', startsOn: '2027-01-01' },
    });

    // Arriving clears last season's rows, state and rooms alike.
    await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    const rows = await stateOf(kid);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.seasonSeed).not.toBe(old!.seasonSeed);
    expect(await db.select().from(farHollowState)).not.toContainEqual(
      expect.objectContaining({ userId: kid.id, seasonSeed: old!.seasonSeed }),
    );
    expect(await db.select().from(farHollowRooms)).not.toContainEqual(
      expect.objectContaining({ userId: kid.id }),
    );
  });

  it('keeps the season’s seed secret', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    const arrived = await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    const [row] = await stateOf(kid);
    for (const body of [JSON.stringify(await view(server, kid, mapId)), arrived.body]) {
      expect(body).not.toContain(row!.seasonSeed);
    }
  });
});
