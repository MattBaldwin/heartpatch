import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  createBattleContent,
  GAME_DATA,
  GROWTH_RULES,
  heartSeedOf,
  hexDistance,
  JOURNEY_RULES,
  journeyFor,
  MapResponseSchema,
  MapViewSchema,
  parseGameEventPayload,
  STARTERS,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { SERVER_GAME_DATA, serverBattleData } from '@heartpatch/shared/server';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, squishies, tileAttacks, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { createBattlesService } from '../battles/service.js';
import { newSessionToken } from '../auth/secrets.js';
import { createJourneyBattlePort, requirePostAccess } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
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
// 10:00 in Denver (MDT, UTC−6): the 08:00–11:59 spawn window.
const START = '2026-11-04T16:00:00Z';
const HERO = STARTERS.speciesIds[0]!;

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('journeys to trading posts (#270, needs DATABASE_URL)', () => {
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
    const username = `wanderer_${String((counter += 1))}`;
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
  const viewOf = async (server: FastifyInstance, kid: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/view`, kid);
    expect(res.statusCode, res.body).toBe(200);
    return MapViewSchema.parse(res.json());
  };
  const access = (mapId: string, kid: PublicUser, post: { q: number; r: number }) =>
    withTransaction(db, (tx) => requirePostAccess(tx, { mapId, userId: kid.id, post, at: clock }));

  it('sets off at the data’s level and team size, uses no try, and a lost journey costs nothing (acceptance)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 3);
    const { post, distance } = await nearestPost(mapId, kid);
    const expected = journeyFor(distance, JOURNEY_RULES, GROWTH_RULES.maxLevel);

    // The map view says how the kid reaches each post (#270's `MapView.posts`).
    const view = await viewOf(server, kid, mapId);
    expect(view.posts).toHaveLength(4);
    expect(view.posts!.find((p) => p.q === post.q && p.r === post.r)).toMatchObject({
      reach: 'journey',
      distance,
      level: expected.level,
      teamSize: expected.teamSize,
      visitUntil: null,
    });

    const res = await call(server, 'POST', `/maps/${mapId}/posts/journey`, kid, {
      q: post.q,
      r: post.r,
    });
    expect(res.statusCode, res.body).toBe(201);
    const battle = battleOf(res);
    expect(battle.kind).toBe('journey');
    expect(battle.terrain).toBe('trading-post');
    const trail = battle.view.sides.b.squishies;
    expect(trail.map((s) => s.id)).toEqual(
      Array.from({ length: expected.teamSize }, (_, i) => `trail-${String(i + 1)}`),
    );
    for (const s of trail) {
      expect(s.level).toBe(expected.level);
      expect(JOURNEY_RULES.trail).toContain(s.speciesId);
    }
    // Starting again resumes it (one battle at a time).
    const again = await call(server, 'POST', `/maps/${mapId}/posts/journey`, kid, {
      q: post.q,
      r: post.r,
    });
    expect(again.statusCode).toBe(200);
    expect(battleOf(again).id).toBe(battle.id);

    // Trail squishies can't be befriended.
    const charm = await act(server, kid, battle, { type: 'capture' });
    expect(charm.statusCode).toBe(409);

    // A journey uses no daily try and starts no tile cooldown.
    expect(await db.select().from(tileAttacks)).not.toContainEqual(
      expect.objectContaining({ mapId }),
    );

    // Run away: a loss, and nothing is lost but time.
    const fled = await act(server, kid, battle, { type: 'forfeit' });
    expect(fled.statusCode, fled.body).toBe(200);
    const [lost] = await journeysOf(mapId);
    expect(lost).toMatchObject({
      outcome: 'lost',
      distance,
      level: expected.level,
      teamSize: expected.teamSize,
      visitUntil: null,
    });
    const events = (await eventsOf(mapId)).map((e) => e.type);
    expect(events.slice(-2)).toEqual(['battle.ended', 'journey.ended']);
    expect(events).toContain('journey.started');
    expect(events.indexOf('journey.started')).toBe(events.indexOf('battle.started') + 1);
    await expect(access(mapId, kid, post)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // A retry in the same window meets the same team.
    const retry = battleOf(
      await call(server, 'POST', `/maps/${mapId}/posts/journey`, kid, { q: post.q, r: post.r }),
    );
    expect(retry.id).not.toBe(battle.id);
    expect(retry.view.sides.b.squishies.map((s) => [s.speciesId, s.level])).toEqual(
      trail.map((s) => [s.speciesId, s.level]),
    );
  });

  it('opens a visit pass for visitMinutes on a win, with XP and no coins (acceptance)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 60);
    const { post } = await nearestPost(mapId, kid);
    const battle = battleOf(
      await call(server, 'POST', `/maps/${mapId}/posts/journey`, kid, { q: post.q, r: post.r }),
    );
    const done = await playOut(server, kid, battle);
    expect(done.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
    // XP as a wild win; a journey pays no coins (a gate, not a farm).
    expect(done.rewards!.xp.length).toBeGreaterThan(0);
    const coins = await db.query.coinLedger.findMany({
      where: (t, { eq }) => eq(t.userId, kid.id),
    });
    expect(coins).toEqual([]);

    const [won] = await journeysOf(mapId);
    const until = new Date(clock.getTime() + JOURNEY_RULES.visitMinutes * MINUTE_MS);
    expect(won).toMatchObject({ outcome: 'won', visitUntil: until });
    const ended = (await eventsOf(mapId)).at(-1)!;
    expect(ended.type).toBe('journey.ended');
    const payload = parseGameEventPayload('journey.ended', ended.payload);
    expect(payload).toMatchObject({
      userId: kid.id,
      q: post.q,
      r: post.r,
      result: 'won',
      visitUntil: until.toISOString(),
    });
    // Only the player hears about it.
    expect(publicViewFor(PUBLIC_VIEWS, ended, { userId: kid.id })).toMatchObject({ result: 'won' });
    expect(
      publicViewFor(PUBLIC_VIEWS, ended, { userId: '00000000-0000-4000-8000-000000000000' }),
    ).toBeNull();

    // The pass: the post is open, and the map view shows it.
    await expect(access(mapId, kid, post)).resolves.toBeUndefined();
    const view = await viewOf(server, kid, mapId);
    expect(view.posts!.find((p) => p.q === post.q)?.visitUntil).toBe(until.toISOString());
    // No second journey while the pass is good.
    const twice = await call(server, 'POST', `/maps/${mapId}/posts/journey`, kid, {
      q: post.q,
      r: post.r,
    });
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice).message).toMatch(/already open/);

    // It runs out after visitMinutes.
    clock.setTime(until.getTime());
    await expect(access(mapId, kid, post)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (await viewOf(server, kid, mapId)).posts!.find((p) => p.q === post.q)?.visitUntil,
    ).toBeNull();
  });

  it('ends as no contest with no pass when the content is re-tuned mid-journey', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 3);
    const { post } = await nearestPost(mapId, kid);
    const battle = battleOf(
      await call(server, 'POST', `/maps/${mapId}/posts/journey`, kid, { q: post.q, r: post.r }),
    );
    const retuned = createBattlesService({
      db,
      clock: () => clock,
      journeys: createJourneyBattlePort(),
      content: createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA), {
        ...BATTLE_RULES,
        damage: { ...BATTLE_RULES.damage, flat: BATTLE_RULES.damage.flat + 1 },
      }),
    });
    expect((await retuned.get(kid, battle.id)).status).toBe('no-contest');
    const [journey] = await journeysOf(mapId);
    expect(journey).toMatchObject({ outcome: 'no-contest', visitUntil: null, endedAt: clock });
    const events = await eventsOf(mapId);
    expect(events.slice(-2).map((e) => e.type)).toEqual(['battle.ended', 'journey.ended']);
    expect(parseGameEventPayload('journey.ended', events.at(-1)!.payload)).toMatchObject({
      result: 'no-contest',
      visitUntil: null,
    });
    await expect(access(mapId, kid, post)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('needs no journey to a connected post (acceptance)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    const { post, seed } = await nearestPost(mapId, kid);
    // Claim a path: every neutral tile closer to the Heart Seed than the post
    // that's on the way, joined to home.
    const reach = hexDistance(seed, post);
    const path = (await tilesOf(mapId)).filter(
      (t) =>
        t.homeSlot === null &&
        t.terrain !== 'trading-post' &&
        hexDistance(seed, t) < reach &&
        hexDistance(t, post) + hexDistance(seed, t) === reach,
    );
    for (const t of path) {
      await db.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${t.id}'`);
    }
    const view = await viewOf(server, kid, mapId);
    expect(view.posts!.find((p) => p.q === post.q && p.r === post.r)).toMatchObject({
      reach: 'connected',
      distance: null,
      level: null,
      teamSize: null,
    });
    await expect(access(mapId, kid, post)).resolves.toBeUndefined();
    const res = await call(server, 'POST', `/maps/${mapId}/posts/journey`, kid, {
      q: post.q,
      r: post.r,
    });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).message).toMatch(/No journey needed/);
  });

  it('refuses a tile that isn’t a post, and a stranger', async () => {
    const server = await start();
    const kid = await player();
    const stranger = await player();
    const mapId = await patch(server, kid, 10);
    const meadow = (await tilesOf(mapId)).find((t) => t.terrain === 'meadow')!;
    const res = await call(server, 'POST', `/maps/${mapId}/posts/journey`, kid, {
      q: meadow.q,
      r: meadow.r,
    });
    expect(res.statusCode).toBe(404);
    await expect(access(mapId, kid, meadow)).rejects.toBeInstanceOf(AppError);
    const { post } = await nearestPost(mapId, kid);
    const nope = await call(server, 'POST', `/maps/${mapId}/posts/journey`, stranger, {
      q: post.q,
      r: post.r,
    });
    expect(nope.statusCode).toBe(404);
  });
});
