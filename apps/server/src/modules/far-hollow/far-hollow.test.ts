import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  COMMUNITY_RULES,
  FarHollowSearchResponseSchema,
  FarHollowTileViewSchema,
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
  type FarHollowTileView,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
} from '@heartpatch/shared';
import { FAR_HOLLOW_SECRETS } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { farHollowExplore, keepers, sessions, squishies, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';

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
  const tile = async (server: FastifyInstance, kid: Player, mapId: string, index: number) => {
    const res = await call(server, 'GET', `/maps/${mapId}/far-hollow/tiles/${String(index)}`, kid);
    expect(res.statusCode, res.body).toBe(200);
    return FarHollowTileViewSchema.parse(res.json());
  };
  const search = (
    server: FastifyInstance,
    kid: Player,
    mapId: string,
    body: { tile: number; spot: number },
  ) => call(server, 'POST', `/maps/${mapId}/far-hollow/search`, kid, body);
  const rowsOf = (kid: PublicUser) =>
    db.query.farHollowExplore.findMany({
      where: (t, { eq }) => eq(t.userId, kid.id),
      orderBy: (t, { asc }) => [asc(t.tileIndex)],
    });
  /** A hands-only spot not yet searched on a tile, if any. */
  const handsSpot = (t: FarHollowTileView) => t.spots.find((s) => s.tool === null && !s.done);

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
      season: { id: 'thanksgiving', name: 'Thanksgiving' },
      arrived: false,
      completedAt: null,
      nextSeason: { id: 'christmas', startsOn: '2026-12-01' },
      road: { distance: COMMUNITY_RULES.farHollow.distance, ...road },
    });
    expect(before.tiles.length).toBeGreaterThanOrEqual(COMMUNITY_RULES.farHollow.tiles.min);
    expect(before.tiles.every((t) => t.searched === 0 && t.total > 0)).toBe(true);
    // Nothing up close until I arrive.
    const shut = await call(server, 'GET', `/maps/${mapId}/far-hollow/tiles/0`, kid);
    expect(shut.statusCode).toBe(403);
    expect(errorOf(shut).message).toMatch(/far road/);

    // A post far from my land isn't open: the far road starts from one that is.
    const far = await call(server, 'POST', `/maps/${mapId}/far-hollow/journey`, kid, {
      q: post.q,
      r: post.r,
    });
    expect(far.statusCode).toBe(403);
    await openPost(server, kid, mapId);

    const res = await call(server, 'POST', `/maps/${mapId}/far-hollow/journey`, kid, {
      q: post.q,
      r: post.r,
    });
    expect(res.statusCode, res.body).toBe(201);
    const battle = battleOf(res);
    expect(battle.kind).toBe('journey');
    const trail = battle.view.sides.b.squishies;
    expect(trail).toHaveLength(road.teamSize);
    for (const s of trail) expect(s.level).toBe(road.level);
    const done = await playOut(server, kid, battle);
    expect(done.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });

    const roadRow = (await journeysOf(mapId)).at(-1)!;
    expect(roadRow).toMatchObject({ kind: 'far-hollow', outcome: 'won', visitUntil: null });
    const events = await eventsOf(mapId);
    expect(events.slice(-2).map((e) => e.type)).toEqual(['journey.ended', 'farHollow.entered']);
    expect(parseGameEventPayload('journey.ended', events.at(-2)!.payload)).toMatchObject({
      result: 'won',
      visitUntil: null,
      kind: 'far-hollow',
    });
    const entered = events.at(-1)!;
    expect(parseGameEventPayload('farHollow.entered', entered.payload)).toMatchObject({
      userId: kid.id,
      season: 'thanksgiving',
      year: 2026,
    });
    // Only I hear that I arrived.
    expect(publicViewFor(PUBLIC_VIEWS, entered, { userId: kid.id })).not.toBeNull();
    expect(publicViewFor(PUBLIC_VIEWS, entered, { userId: STRANGER })).toBeNull();

    // A row for each tile, and the view says I'm there.
    expect(await rowsOf(kid)).toHaveLength(before.tiles.length);
    expect(await view(server, kid, mapId)).toMatchObject({ arrived: true, tiles: before.tiles });
    // Once a season: the road is done.
    const again = await call(server, 'POST', `/maps/${mapId}/far-hollow/journey`, kid, {
      q: post.q,
      r: post.r,
    });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toMatch(/already in the far Hollow/);
  });

  it('searches each spot once for the better finds, a grey village tile with two echoes', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    const arrive = await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    expect(arrive.statusCode, arrive.body).toBe(201);

    const t = await tile(server, kid, mapId, 0);
    expect(t).toMatchObject({
      q: 0,
      r: 0,
      homestead: null,
      progress: { searched: 0 },
      community: { id: kid.id, name: COMMUNITY_RULES.farHollow.name, joy: 0 },
      farHollow: { index: 0, name: COMMUNITY_RULES.farHollow.name },
    });
    expect(t.community!.echoes).toHaveLength(COMMUNITY_RULES.farHollow.echoesPerTile);
    expect(t.community!.puzzle).toBeUndefined();
    // The same for every visit.
    expect(await tile(server, kid, mapId, 0)).toEqual(t);
    expect((await call(server, 'GET', `/maps/${mapId}/far-hollow/tiles/31`, kid)).statusCode).toBe(
      404,
    );

    const spot = handsSpot(t)!;
    const res = await call(server, 'POST', `/maps/${mapId}/far-hollow/search`, kid, {
      tile: 0,
      spot: spot.index,
    });
    expect(res.statusCode, res.body).toBe(200);
    const found = FarHollowSearchResponseSchema.parse(res.json());
    expect(found).toMatchObject({
      spot: spot.index,
      progress: { searched: 1, total: t.spots.length },
      explored: false,
      completed: false,
      joy: Math.round(100 / t.spots.length),
    });
    expect(
      (await tile(server, kid, mapId, 0)).spots.find((s) => s.index === spot.index)?.done,
    ).toBe(true);
    // Once a spot.
    const twice = await search(server, kid, mapId, { tile: 0, spot: spot.index });
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice).message).toMatch(/already searched/);
    // An explore search like any other: the Seeker track and lore pages count it.
    const searched = (await eventsOf(mapId)).filter((e) => e.type === 'explore.searched');
    expect(searched).toHaveLength(1);
    expect(parseGameEventPayload('explore.searched', searched[0]!.payload)).toMatchObject({
      userId: kid.id,
      terrain: t.terrain,
      spot: spot.index,
    });

    // A tool spot needs its tool.
    const tool = (
      await Promise.all(
        (await view(server, kid, mapId)).tiles.map((s) => tile(server, kid, mapId, s.index)),
      )
    )
      .flatMap((v) => v.spots.map((s) => ({ tile: v.farHollow.index, s })))
      .find(({ s }) => s.tool !== null);
    if (tool) {
      const need = await search(server, kid, mapId, { tile: tool.tile, spot: tool.s.index });
      expect(need.statusCode).toBe(409);
      expect(errorOf(need).message).toMatch(/You need a/);
    }

    // A spot that isn't there, and a stranger.
    expect((await search(server, kid, mapId, { tile: 0, spot: 30 })).statusCode).toBe(404);
    const stranger = await player();
    expect((await search(server, stranger, mapId, { tile: 0, spot: 0 })).statusCode).toBe(404);
  });

  it('closes after dark, like every Hollowed place', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    const spot = handsSpot(await tile(server, kid, mapId, 0))!;
    // 20:00 in Denver.
    clock.setTime(Date.parse('2026-11-05T03:00:00Z'));
    const shut = await call(server, 'GET', `/maps/${mapId}/far-hollow/tiles/0`, kid);
    expect(shut.statusCode).toBe(403);
    expect(errorOf(shut).message).toMatch(/after dark/);
    const res = await search(server, kid, mapId, { tile: 0, spot: spot.index });
    expect(res.statusCode).toBe(403);
    // The sheet still opens.
    expect((await view(server, kid, mapId)).arrived).toBe(true);
  });

  it('gives the season’s lore page and a gift on the very last spot, and the patch hears (acceptance)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    const near = FarHollowViewSchema.parse(
      (
        await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, { nearlyDone: true })
      ).json(),
    );
    const last = near.tiles.at(-1)!;
    expect(near.tiles.slice(0, -1).every((t) => t.searched === t.total)).toBe(true);
    expect(last.searched).toBe(last.total - 1);
    const lastTile = await tile(server, kid, mapId, last.index);
    const spot = lastTile.spots.find((s) => !s.done)!;
    // The last spot may want a tool: give one.
    if (spot.tool) {
      const items = { [spot.tool]: 1 };
      await withTransaction(db, (tx) =>
        grantItems(tx, { mapId, userId: kid.id }, items, 'dev-grant'),
      );
    }
    const res = await search(server, kid, mapId, { tile: last.index, spot: spot.index });
    expect(res.statusCode, res.body).toBe(200);
    const found = FarHollowSearchResponseSchema.parse(res.json());
    expect(found).toMatchObject({ explored: true, completed: true, joy: 100 });
    // The guaranteed page (a new kid has none of them) and the gift.
    expect(found.lore?.id).toBeDefined();
    if (found.lore && !FAR_HOLLOW_SECRETS.lorePages.includes(found.lore.id)) {
      // The roll found a page of its own: that one is the season's.
      expect(found.notable).toBe('lore');
    } else {
      expect(found.lore?.id).toBe(FAR_HOLLOW_SECRETS.lorePages[0]);
    }
    for (const [id, n] of Object.entries(FAR_HOLLOW_SECRETS.completionGift)) {
      expect(found.found[id]).toBeGreaterThanOrEqual(n);
    }

    const events = await eventsOf(mapId);
    const completed = events.find((e) => e.type === 'farHollow.completed')!;
    expect(parseGameEventPayload('farHollow.completed', completed.payload)).toMatchObject({
      userId: kid.id,
      season: 'thanksgiving',
      lorePage: found.lore!.id,
    });
    // The patch hears who brought the joy back, never what they found.
    expect(publicViewFor(PUBLIC_VIEWS, completed, { userId: STRANGER })).toEqual({
      userId: kid.id,
      season: 'thanksgiving',
    });
    const searched = events.filter((e) => e.type === 'explore.searched').at(-1)!;
    expect(parseGameEventPayload('explore.searched', searched.payload).lorePage).toBe(
      found.lore!.id,
    );
    // The lore consumer grants it from that search.
    const done = await view(server, kid, mapId);
    expect(done.completedAt).toBe(clock.toISOString());
    expect(done.tiles.every((t) => t.searched === t.total)).toBe(true);
  });

  it('is fresh next season: new tiles, no progress, and the far road again (acceptance)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, { nearlyDone: true });
    const thanksgiving = await view(server, kid, mapId);
    const oldRows = await rowsOf(kid);
    expect(oldRows.length).toBe(thanksgiving.tiles.length);

    // Christmas: a new far Hollow, not yet reached; last season's rows don't count.
    clock.setTime(Date.parse('2026-12-02T17:00:00Z'));
    const christmas = await view(server, kid, mapId);
    expect(christmas).toMatchObject({
      season: { id: 'christmas', name: 'Christmas' },
      arrived: false,
      completedAt: null,
      nextSeason: { id: 'new-year', startsOn: '2026-12-31' },
    });
    expect(christmas.tiles.every((t) => t.searched === 0)).toBe(true);
    expect(christmas.tiles).not.toEqual(thanksgiving.tiles);
    expect((await call(server, 'GET', `/maps/${mapId}/far-hollow/tiles/0`, kid)).statusCode).toBe(
      403,
    );

    // Arriving clears last season's rows.
    await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    const rows = await rowsOf(kid);
    expect(rows).toHaveLength(christmas.tiles.length);
    expect(new Set(rows.map((r) => r.seasonSeed)).size).toBe(1);
    expect(rows[0]!.seasonSeed).not.toBe(oldRows[0]!.seasonSeed);
    expect(await db.select().from(farHollowExplore)).not.toContainEqual(
      expect.objectContaining({ userId: kid.id, seasonSeed: oldRows[0]!.seasonSeed }),
    );
  });

  it('replays a search sent twice with one Idempotency-Key, and keeps the season’s seed secret', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid, 10);
    await call(server, 'POST', `/maps/${mapId}/dev/far-hollow`, kid, {});
    const spot = handsSpot(await tile(server, kid, mapId, 0))!;
    const send = () =>
      server.inject({
        method: 'POST',
        url: `/api/v1/maps/${mapId}/far-hollow/search`,
        headers: { ...HEADERS, 'idempotency-key': 'far-hollow-search-1' },
        cookies: { [SESSION_COOKIE]: kid.token },
        payload: { tile: 0, spot: spot.index },
      });
    const first = await send();
    const second = await send();
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect((await eventsOf(mapId)).filter((e) => e.type === 'explore.searched')).toHaveLength(1);
    // Nothing a kid can read names the seed.
    const [row] = await rowsOf(kid);
    for (const body of [
      JSON.stringify(await view(server, kid, mapId)),
      JSON.stringify(await tile(server, kid, mapId, 0)),
      first.body,
    ]) {
      expect(body).not.toContain(row!.seasonSeed);
    }
  });
});
