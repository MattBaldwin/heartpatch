import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  communityReach,
  CLEARED_TERRAIN,
  GAME_DATA,
  GatherResponseSchema,
  JOB_RULES,
  JobsViewSchema,
  TERRITORY_RULES,
  type PlayerBattle,
  type PlayerBattleAction,
  EXPLORE_RULES,
  searchSpots,
  ExploreTileResponseSchema,
  hexDistance,
  hexKey,
  hexNeighbors,
  JoinMapResponseSchema,
  MapResponseSchema,
  MilestonesResponseSchema,
  MapViewSchema,
  SearchSpotResponseSchema,
  SolvePuzzleResponseSchema,
  SquishyResponseSchema,
  StartPuzzleResponseSchema,
  MEMORY_PUZZLES,
  makeRelight,
  puzzleSkinFor,
  relightBoard,
  relightDepth,
  relightSeed,
  type RelightMove,
  type HexKey,
  type MapDetail,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import {
  createDbClient,
  withTransaction,
  type Database,
  type DbClient,
  type Executor,
} from '../../db/client.js';
import { keepers, loreFound, sessions, tileExplore, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { createTendingRepo } from '../territory/repo.js';
import { backendPid, waitUntilBlockedBy } from '../../../tests/lock-waits.js';
import { runConsumer } from '../../jobs/consumers.js';
import { createMilestonesConsumer } from '../milestones/consumer.js';
import { refreshHomesteads } from './homesteads.js';
import { HOLLOWED_FINDS, PUZZLE_REWARDS } from '@heartpatch/shared/server';
import { createLoreConsumer } from '../lore/consumer.js';
import type { Rng } from '@heartpatch/shared';
import { createExploreService } from './service.js';
import { bigMove } from '../../../tests/big-move.js';

/*
 * Exploring your land (#199): the explore view of a tile, searching its
 * spots (finds, the team's XP, tool wear, once each), a tile fully explored,
 * and homesteads joining, pausing when cut off, and resuming.
 */

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
const ZONE = 'America/Denver';
const START = '2026-10-02T18:00:00Z';

interface Player extends PublicUser {
  token: string;
}

interface Tile {
  id: string;
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
  homeSlot: number | null;
  communityId: string | null;
}

describe.skipIf(!url)('exploring (needs DATABASE_URL)', () => {
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
    const username = `explorer_${String((counter += 1))}`;
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

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Explore Patch',
      timeZone: ZONE,
    });
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

  async function squishy(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, {
      level: 5,
      speciesId: 'puddlepuff',
    });
    expect(res.statusCode, res.body).toBe(201);
    return SquishyResponseSchema.parse(res.json()).squishy;
  }

  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));

  const tilesOf = async (mapId: string): Promise<Tile[]> =>
    db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });

  /** Makes a tile `who`'s meadow (every meadow spot is hands or a Shovel). */
  const ownMeadow = (tile: Tile, who: PublicUser | null) =>
    db.execute(
      `update tiles set owner_user_id = ${who ? `'${who.id}'` : 'null'}, terrain = 'meadow', node_resource = null where id = '${tile.id}'`,
    );

  /**
   * A line of land leading away from `who`'s home: `first` borders their home
   * ring, `second` borders `first` but not home.
   */
  async function lineFromHome(mapId: string, who: PublicUser) {
    const all = await tilesOf(mapId);
    const byKey = new Map(all.map((t) => [hexKey(t), t]));
    const home = all.filter((t) => t.ownerUserId === who.id && t.homeSlot !== null);
    const homeKeys = new Set(home.map(hexKey));
    const nearHome = (t: { q: number; r: number }) =>
      hexNeighbors(t).some((n) => homeKeys.has(hexKey(n)));
    for (const h of home) {
      for (const n of hexNeighbors(h)) {
        const first = byKey.get(hexKey(n));
        if (!first || first.homeSlot !== null) continue;
        const second = hexNeighbors(first)
          .map((m) => byKey.get(hexKey(m)))
          .find((t) => t && t.homeSlot === null && !nearHome(t) && hexKey(t) !== hexKey(first));
        if (second) return { first, second };
      }
    }
    throw new Error('no line of land from home');
  }

  const view = async (server: FastifyInstance, who: Player, mapId: string, t: Tile) => {
    const res = await call(
      server,
      'GET',
      `/maps/${mapId}/explore?q=${String(t.q)}&r=${String(t.r)}`,
      who,
    );
    expect(res.statusCode, res.body).toBe(200);
    return ExploreTileResponseSchema.parse(res.json());
  };
  const search = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    t: Tile,
    spot: number,
    key?: string,
  ) =>
    call(
      server,
      'POST',
      `/maps/${mapId}/explore/search`,
      who,
      { q: t.q, r: t.r, spot },
      key ? { 'idempotency-key': key } : {},
    );

  /** Searches every spot of a tile (with a Shovel for the mounds). */
  async function exploreAll(server: FastifyInstance, who: Player, mapId: string, t: Tile) {
    const spots = (await view(server, who, mapId, t)).spots;
    await give(mapId, who, { shovel: 20 });
    const found = [];
    for (const s of spots) {
      const res = await search(server, who, mapId, t, s.index);
      expect(res.statusCode, res.body).toBe(200);
      found.push(SearchSpotResponseSchema.parse(res.json()));
    }
    const last = found.at(-1);
    if (!last) throw new Error('a tile with no spots');
    return last;
  }

  const eventsOf = async (mapId: string, type: string) =>
    (
      await db.query.gameEvents.findMany({
        where: (e, { and, eq }) => and(eq(e.mapId, mapId), eq(e.type, type)),
        orderBy: (e, { asc }) => [asc(e.seq)],
      })
    ).map((e) => e.payload as Record<string, unknown>);

  it('shows my tile’s spots and searches them once each, for finds, XP and tool wear', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const pal = await squishy(server, me, mapId);
    const { first } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);

    const tile = await view(server, me, mapId, first);
    expect(tile.terrain).toBe('meadow');
    expect(tile.needs).toEqual(['shovel']);
    expect(tile.progress).toEqual({ searched: 0, total: tile.spots.length });
    expect(tile.spots.length).toBeGreaterThanOrEqual(8);
    expect(tile.tools.shovel).toBe(0);
    expect(tile.homestead).toBeNull();
    // The view never says what a spot holds.
    expect(JSON.stringify(tile)).not.toMatch(/stone|timber|heartdust|lore/);

    const hands = tile.spots.find((s) => s.tool === null)!;
    const res = await search(server, me, mapId, first, hands.index);
    expect(res.statusCode, res.body).toBe(200);
    const found = SearchSpotResponseSchema.parse(res.json());
    expect(found.progress).toEqual({ searched: 1, total: tile.spots.length });
    expect(found.tool).toBeNull();
    expect(found.xp).toEqual([{ squishyId: pal.id, xp: EXPLORE_RULES.xpPerSquishy }]);
    for (const [id, n] of Object.entries(found.found))
      expect(found.items[id] ?? 0).toBeGreaterThanOrEqual(n);
    const [event] = await eventsOf(mapId, 'explore.searched');
    expect(event).toMatchObject({
      userId: me.id,
      q: first.q,
      r: first.r,
      spot: hands.index,
      kind: hands.kind,
    });

    // Once each.
    const again = await search(server, me, mapId, first, hands.index);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toBe('You already searched there!');

    // A mound needs a Shovel, and digging wears it by one use.
    const mound = tile.spots.find((s) => s.tool === 'shovel')!;
    const noShovel = await search(server, me, mapId, first, mound.index);
    expect(noShovel.statusCode).toBe(409);
    expect(errorOf(noShovel).message).toBe('You need a Shovel for that! 🛠️');
    await give(mapId, me, { shovel: 20 });
    const dug = SearchSpotResponseSchema.parse(
      (await search(server, me, mapId, first, mound.index)).json(),
    );
    expect(dug.tool).toEqual({ id: 'shovel', usesLeft: 19 });
    expect(
      (await view(server, me, mapId, first)).spots
        .filter((s) => s.done)
        .map((s) => s.index)
        .sort(),
    ).toEqual([hands.index, mound.index].sort());
  });

  it('answers a retried search once (Idempotency-Key)', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { first } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    const hands = (await view(server, me, mapId, first)).spots.find((s) => s.tool === null)!;
    const one = await search(server, me, mapId, first, hands.index, 'search-once');
    const two = await search(server, me, mapId, first, hands.index, 'search-once');
    expect(two.statusCode).toBe(200);
    expect(two.json()).toEqual(one.json());
    expect(await eventsOf(mapId, 'explore.searched')).toHaveLength(1);
  });

  it('keeps you to your own land on a patch', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { first } = await lineFromHome(mapId, me);
    await ownMeadow(first, null);
    const res = await call(
      server,
      'GET',
      `/maps/${mapId}/explore?q=${String(first.q)}&r=${String(first.r)}`,
      me,
    );
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).message).toBe('You can only explore your own land.');
    const searchRes = await search(server, me, mapId, first, 0);
    expect(searchRes.statusCode).toBe(403);
  });

  it('joins a fully explored tile next to home, then the land beyond it, as homesteads', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { first, second } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    await ownMeadow(second, me);

    // Beyond first, second isn't next to home yet: explored, but not a homestead.
    const far = await exploreAll(server, me, mapId, second);
    expect(far.explored).toBe(true);
    expect(far.homestead).toBeNull();
    expect(await eventsOf(mapId, 'tile.explored')).toHaveLength(1);

    const near = await exploreAll(server, me, mapId, first);
    expect(near.explored).toBe(true);
    expect(near.homestead).toBe('joined');
    const joined = await eventsOf(mapId, 'homestead.joined');
    expect(joined).toHaveLength(1);
    expect(joined[0]!['tiles']).toEqual(
      expect.arrayContaining([
        { q: first.q, r: first.r },
        { q: second.q, r: second.r },
      ]),
    );
    expect((await view(server, me, mapId, second)).homestead).toBe('joined');

    // Everyone sees it on the map.
    const map = MapViewSchema.parse((await call(server, 'GET', `/maps/${mapId}/view`, me)).json());
    const onMap = (t: Tile) => map.tiles.find((x) => x.q === t.q && x.r === t.r)!;
    expect(onMap(first)).toMatchObject({ explored: true, homestead: 'joined' });
    expect(onMap(second)).toMatchObject({ explored: true, homestead: 'joined' });
  });

  it('pauses homesteads cut off by a capture and resumes them when it is won back', async () => {
    const server = await start();
    const me = await player();
    const rival = await player();
    const mapId = await patch(server, me, [rival]);
    const { first, second } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    await ownMeadow(second, me);
    await exploreAll(server, me, mapId, first);
    await exploreAll(server, me, mapId, second);

    // The rival takes the tile between: the one beyond is cut off.
    await db.execute(`update tiles set owner_user_id = '${rival.id}' where id = '${first.id}'`);
    clock.setTime(clock.getTime() + 60_000);
    const paused = await withTransaction(db, (tx) =>
      refreshHomesteads(tx, mapId, [rival.id, me.id], clock),
    );
    expect(paused.map((e) => [e.type, e.payload])).toEqual([
      ['homestead.paused', { userId: me.id, tiles: [{ q: second.q, r: second.r }] }],
    ]);
    expect((await view(server, me, mapId, second)).homestead).toBe('paused');
    const row = await db.query.tileExplore.findFirst({
      where: (t, { and, eq }) => and(eq(t.userId, me.id), eq(t.tileId, second.id)),
    });
    expect(row?.pausedAt?.toISOString()).toBe(clock.toISOString());

    // Won back: the tile is a homestead again at once, and the one beyond wakes.
    await db.execute(`update tiles set owner_user_id = '${me.id}' where id = '${first.id}'`);
    clock.setTime(clock.getTime() + 60_000);
    const resumed = await withTransaction(db, (tx) => refreshHomesteads(tx, mapId, [me.id], clock));
    expect(resumed.map((e) => [e.type, e.payload])).toEqual([
      ['homestead.resumed', { userId: me.id, tiles: [{ q: second.q, r: second.r }] }],
    ]);
    expect((await view(server, me, mapId, first)).homestead).toBe('joined');
    expect((await view(server, me, mapId, second)).homestead).toBe('joined');
    // Nothing changed: nothing to say.
    expect(await withTransaction(db, (tx) => refreshHomesteads(tx, mapId, [me.id], clock))).toEqual(
      [],
    );
  });

  it('keeps every player’s progress apart, and only the explored rows of one tile', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { first } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    const hands = (await view(server, me, mapId, first)).spots.find((s) => s.tool === null)!;
    await search(server, me, mapId, first, hands.index);
    const rows = await db.select().from(tileExplore);
    const mine = rows.filter((r) => r.userId === me.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      tileId: first.id,
      mapId,
      layout: EXPLORE_RULES.layout,
      completedAt: null,
    });
    expect(BATTLE_RULES.teamSize).toBeGreaterThan(0);
  });

  /** Cuts `second` off from `me`'s home: `first`, between them, becomes the rival's. */
  async function cutOff(mapId: string, me: Player, rival: Player, first: Tile) {
    await db.execute(`update tiles set owner_user_id = '${rival.id}' where id = '${first.id}'`);
    return withTransaction(db, (tx) => refreshHomesteads(tx, mapId, [rival.id, me.id], clock));
  }
  async function reconnect(mapId: string, me: Player, first: Tile) {
    await db.execute(`update tiles set owner_user_id = '${me.id}' where id = '${first.id}'`);
    return withTransaction(db, (tx) => refreshHomesteads(tx, mapId, [me.id], clock));
  }

  it('gives the Keeper +1 a gather on a homestead, and nothing while it naps', async () => {
    const server = await start();
    const me = await player();
    const rival = await player();
    const mapId = await patch(server, me, [rival]);
    const { first, second } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    await ownMeadow(second, me);
    await exploreAll(server, me, mapId, first);
    await exploreAll(server, me, mapId, second);
    await db.execute(
      `update tiles set node_resource = 'timber' where id in ('${first.id}', '${second.id}')`,
    );
    const timber = GAME_DATA.resources.find((r) => r.id === 'timber')!.gather!.quantity;

    const res = await call(server, 'POST', `/maps/${mapId}/gathers`, me, {
      q: first.q,
      r: first.r,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(GatherResponseSchema.parse(res.json()).gather.items['timber']).toBe(timber + 1);

    await cutOff(mapId, me, rival, first);
    const napping = await call(server, 'POST', `/maps/${mapId}/gathers`, me, {
      q: second.q,
      r: second.r,
    });
    expect(napping.statusCode).toBe(409);
    expect(errorOf(napping).message).toBe(
      'This homestead is napping. Join it back up to home first!',
    );
  });

  it('pays a gatherer on a homestead +1 a cycle and nothing while it is cut off', async () => {
    const server = await start();
    const me = await player();
    const rival = await player();
    const mapId = await patch(server, me, [rival]);
    const { first, second } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    await ownMeadow(second, me);
    await exploreAll(server, me, mapId, first);
    await exploreAll(server, me, mapId, second);
    const worker = await squishy(server, me, mapId);
    const assigned = await call(server, 'POST', `/maps/${mapId}/squishies/${worker.id}/job`, me, {
      job: 'gatherer',
      q: second.q,
      r: second.r,
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    const workOf = async () => {
      const jobs = JobsViewSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/jobs`, me)).json(),
      );
      return jobs.squishies.find((s) => s.squishy.id === worker.id)!.work!;
    };
    const land = (await workOf()).cycleSeconds * 1000;
    const greens = (await workOf()).resource;

    // One cycle done, then cut off: hours later, still one.
    clock.setTime(clock.getTime() + 1.5 * land);
    await cutOff(mapId, me, rival, first);
    clock.setTime(clock.getTime() + 6 * land);
    expect((await workOf()).readyCycles).toBe(1);
    expect((await workOf()).nextReadyAt).toBeNull();
    // A new gatherer can't start there while it naps.
    const helper = await squishy(server, me, mapId);
    const refused = await call(server, 'POST', `/maps/${mapId}/squishies/${helper.id}/job`, me, {
      job: 'gatherer',
      q: second.q,
      r: second.r,
    });
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).message).toBe(
      'This homestead is napping. Join it back up to home first!',
    );

    // Joined again: counting carries on from where it stopped, +1 a cycle.
    await reconnect(mapId, me, first);
    clock.setTime(clock.getTime() + 0.6 * land);
    const work = await workOf();
    expect(work.readyCycles).toBe(2);
    // Meadow land's own yield, +1 a cycle on a joined homestead.
    const yieldPerCycle = JOB_RULES.terrainYields.find((y) => y.terrain === 'meadow')!.quantity;
    expect(work.ready[greens]).toBe(2 * (yieldPerCycle + 1));
  });

  it('never lets a homestead fade (#194)', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { first, second } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    await ownMeadow(second, me);
    await exploreAll(server, me, mapId, first);
    const fading = await createTendingRepo(db).outerTiles(mapId, me.id);
    expect(fading.map((t) => t.id)).toContain(second.id);
    expect(fading.map((t) => t.id)).not.toContain(first.id);
  });

  it('pauses the homesteads a challenge cuts off (#203’s capture path)', async () => {
    const server = await start();
    const kid = await player();
    const rival = await player();
    const mapId = await patch(server, kid, [rival]);
    const { first, second } = await lineFromHome(mapId, rival);
    await ownMeadow(first, rival);
    await ownMeadow(second, rival);
    await exploreAll(server, rival, mapId, first);
    await exploreAll(server, rival, mapId, second);
    // The kid holds land next to `first` (not the rival's home, not `second`).
    const all = await tilesOf(mapId);
    const byKey = new Map(all.map((t) => [hexKey(t), t]));
    const foothold = hexNeighbors(first)
      .map((n) => byKey.get(hexKey(n)))
      .find((t) => t && t.homeSlot === null && t.id !== second.id && t.ownerUserId === null)!;
    await db.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${foothold.id}'`);
    const hero = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
      level: 40,
      speciesId: 'emberbun',
    });
    expect(hero.statusCode, hero.body).toBe(201);
    clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * 60 * 60 * 1000);

    const started = await call(server, 'POST', `/maps/${mapId}/attacks`, kid, {
      q: first.q,
      r: first.r,
    });
    expect(started.statusCode, started.body).toBe(201);
    let battle: PlayerBattle = BattleResponseSchema.parse(started.json()).battle;
    for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && battle.status === 'active'; i++) {
      const side = battle.view.sides[battle.mySide];
      const action: PlayerBattleAction =
        battle.view.phase.type === 'replace'
          ? { type: 'replace', slot: side.squishies.findIndex((s) => s.energy > 0) }
          : { type: 'move', move: bigMove(side.squishies[side.active]!) };
      const res = await call(server, 'POST', `/battles/${battle.id}/actions`, kid, {
        action,
        turn: battle.view.turn,
      });
      expect(res.statusCode, res.body).toBe(200);
      battle = BattleResponseSchema.parse(res.json()).battle;
    }
    expect(battle.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
    expect((await tilesOf(mapId)).find((t) => t.id === first.id)!.ownerUserId).toBe(kid.id);
    expect(await eventsOf(mapId, 'homestead.paused')).toEqual([
      { userId: rival.id, tiles: [{ q: second.q, r: second.r }] },
    ]);
    expect((await view(server, rival, mapId, second)).homestead).toBe('paused');
  });

  it('keeps a tile finished under an older layout finished, homestead and all (#335)', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { first, second } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    await ownMeadow(second, me);
    await exploreAll(server, me, mapId, first);
    await exploreAll(server, me, mapId, second);
    // A new kit for the terrain: the row under `first` was made with another layout.
    await db.execute(
      `update tile_explore set layout = ${String(EXPLORE_RULES.layout + 1)} where tile_id = '${first.id}'`,
    );
    const kept = await view(server, me, mapId, first);
    expect(kept.progress.searched).toBe(kept.progress.total);
    expect(kept.spots.every((s) => s.done)).toBe(true);
    expect(kept.homestead).toBe('joined');
    await give(mapId, me, { shovel: 20 });
    const res = await search(server, me, mapId, first, kept.spots[0]!.index);
    expect(res.statusCode, res.body).toBe(409);
    expect((await view(server, me, mapId, second)).homestead).toBe('joined');
    expect(await eventsOf(mapId, 'homestead.paused')).toEqual([]);
  });

  it('restarts a half-searched tile under an older layout', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { first } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    await give(mapId, me, { shovel: 20 });
    const half = await view(server, me, mapId, first);
    expect((await search(server, me, mapId, first, half.spots[0]!.index)).statusCode).toBe(200);
    await db.execute(
      `update tile_explore set layout = ${String(EXPLORE_RULES.layout + 1)} where tile_id = '${first.id}'`,
    );
    const fresh = await view(server, me, mapId, first);
    expect(fresh.progress.searched).toBe(0);
    expect((await search(server, me, mapId, first, half.spots[0]!.index)).statusCode).toBe(200);
  });

  it('restarts a converted tile, and pauses the land beyond it', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { first, second } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    await ownMeadow(second, me);
    await exploreAll(server, me, mapId, first);
    await exploreAll(server, me, mapId, second);
    // The row under `first` was made on another terrain.
    await db.execute(`update tile_explore set terrain = 'forest' where tile_id = '${first.id}'`);
    const fresh = await view(server, me, mapId, first);
    expect(fresh.progress.searched).toBe(0);
    await give(mapId, me, { shovel: 20 });
    const res = await search(server, me, mapId, first, fresh.spots[0]!.index);
    expect(res.statusCode, res.body).toBe(200);
    const found = SearchSpotResponseSchema.parse(res.json());
    expect(found.explored).toBe(false);
    expect(found.homestead).toBeNull();
    const rowOf = (tile: Tile) =>
      db.query.tileExplore.findFirst({
        where: (t, { and, eq }) => and(eq(t.userId, me.id), eq(t.tileId, tile.id)),
      });
    expect(await rowOf(first)).toMatchObject({
      layout: EXPLORE_RULES.layout,
      terrain: 'meadow',
      completedAt: null,
      joinedAt: null,
    });
    expect((await rowOf(second))?.pausedAt).not.toBeNull();
    expect(await eventsOf(mapId, 'homestead.paused')).toEqual([
      { userId: me.id, tiles: [{ q: second.q, r: second.r }] },
    ]);
  });

  it('locks the explored set before a stale row of it, in (user, tile) order (tech spec §7)', async () => {
    const server = await start();
    const me = await player();
    const mapId = await patch(server, me);
    const { first, second } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    await ownMeadow(second, me);
    await exploreAll(server, me, mapId, first);
    await exploreAll(server, me, mapId, second);
    // The stale row sorts after the other explored one.
    const [low, high] = [first, second].sort((a, b) => (a.id < b.id ? -1 : 1));
    // A converted tile's row is stale (a finished one under an older layout isn't, #335).
    await db.execute(`update tile_explore set terrain = 'forest' where tile_id = '${high!.id}'`);
    await give(mapId, me, { shovel: 20 });
    const spot = (await view(server, me, mapId, high!)).spots[0]!.index;
    const lockRowOf = (tx: Executor, tile: Tile) =>
      tx.execute(
        `select 1 from tile_explore where user_id = '${me.id}' and tile_id = '${tile.id}' for update`,
      );
    let searched: Promise<LightMyRequestResponse> | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(`set local lock_timeout = '10s'`);
      await lockRowOf(tx, low!);
      const pid = await backendPid(tx);
      searched = search(server, me, mapId, high!, spot);
      await waitUntilBlockedBy(db, pid);
      // The search waits on the lower row before it takes the stale one.
      await lockRowOf(tx, high!);
    });
    expect((await searched!).statusCode).toBe(200);
  });

  it('dev: makes a ready homestead next to home, where a Crafting Factory goes up at once (#295)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const made = await call(server, 'POST', `/maps/${mapId}/dev/homestead`, kid);
    expect(made.statusCode, made.body).toBe(201);
    const at = made.json<{ q: number; r: number }>();
    // It touches home, so the next homestead refresh keeps it joined (#429).
    expect(
      await withTransaction(db, (tx) => refreshHomesteads(tx, mapId, [kid.id], clock)),
    ).toEqual([]);
    await give(mapId, kid, { timber: 30, stone: 20 });
    const built = await call(server, 'POST', `/maps/${mapId}/buildings`, kid, {
      buildingId: 'crafting-factory',
      ...at,
      spot: 1,
    });
    expect(built.statusCode, built.body).toBe(201);
  });

  it('dev: a made homestead in the forest gets no Greens spot back at the next map read (#566)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    // Forest all round: a Greens spot grows back on one in four (#238).
    await db.execute(
      `update tiles set terrain = 'forest', node_resource = null where map_id = '${mapId}' and owner_user_id is null and terrain not in ('junipers-gap', 'trading-post')`,
    );
    const made = await call(server, 'POST', `/maps/${mapId}/dev/homestead`, kid);
    expect(made.statusCode, made.body).toBe(201);
    const at = made.json<{ q: number; r: number }>();
    // Opening the patch runs the extra-node pass (`seedExtraNodes`).
    expect((await call(server, 'GET', `/maps/${mapId}/view`, kid)).statusCode).toBe(200);
    const tile = await db.query.tiles.findFirst({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.q, at.q), eq(t.r, at.r)),
    });
    expect(tile).toMatchObject({ ownerUserId: kid.id, nodeResource: null });
    await give(mapId, kid, { timber: 30, stone: 20 });
    const built = await call(server, 'POST', `/maps/${mapId}/buildings`, kid, {
      buildingId: 'crafting-factory',
      ...at,
      spot: 1,
    });
    expect(built.statusCode, built.body).toBe(201);
  });

  it('dev: clears a homestead when nothing two steps from home can be cleared (#429)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    // A home deep in Old Forest: no free land around it that a tool clears.
    await db.execute(
      `update tiles set terrain = 'old-forest' where map_id = '${mapId}' and owner_user_id is null and terrain not in ('junipers-gap', 'trading-post')`,
    );
    const made = await call(server, 'POST', `/maps/${mapId}/dev/homestead`, kid);
    expect(made.statusCode, made.body).toBe(201);
    const at = made.json<{ q: number; r: number }>();
    // It touches home, so the next homestead refresh keeps it joined (#429).
    expect(
      await withTransaction(db, (tx) => refreshHomesteads(tx, mapId, [kid.id], clock)),
    ).toEqual([]);
    const tile = await db.query.tiles.findFirst({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.q, at.q), eq(t.r, at.r)),
    });
    expect(tile).toMatchObject({
      terrain: CLEARED_TERRAIN,
      ownerUserId: kid.id,
      nodeResource: null,
    });
    await give(mapId, kid, { timber: 30, stone: 20 });
    const built = await call(server, 'POST', `/maps/${mapId}/buildings`, kid, {
      buildingId: 'crafting-factory',
      ...at,
      spot: 1,
    });
    expect(built.statusCode, built.body).toBe(201);
  });

  it('dev: makes the land asked for, joined or not, and only a joined one clears (#242)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const make = async (joined: boolean) => {
      const made = await call(server, 'POST', `/maps/${mapId}/dev/homestead`, kid, {
        terrain: 'mountains',
        nodeResource: 'stone',
        joined,
      });
      expect(made.statusCode, made.body).toBe(201);
      return made.json<{ q: number; r: number }>();
    };
    // The owner's case: a fully explored mountain with a Stone pile that
    // hasn't joined home. A refresh leaves it so: it touches none of home.
    const away = await make(false);
    expect(
      await withTransaction(db, (tx) => refreshHomesteads(tx, mapId, [kid.id], clock)),
    ).toEqual([]);
    const view = MapViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/view`, kid)).json(),
    );
    const at = (h: { q: number; r: number }) => view.tiles.find((t) => t.q === h.q && t.r === h.r);
    expect(at(away)).toMatchObject({
      terrain: 'mountains',
      nodeResource: 'stone',
      ownerUserId: kid.id,
      explored: true,
      homestead: null,
    });
    await give(mapId, kid, { pickaxe: 2 });
    const refused = await call(server, 'POST', `/maps/${mapId}/clears`, kid, away);
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).message).toBe(
      'Clear land works on homesteads: land that touches your home 🏡. Explore the land between to join it up!',
    );
    // Joined, the same land clears with a Pickaxe.
    const near = await make(true);
    const cleared = await call(server, 'POST', `/maps/${mapId}/clears`, kid, near);
    expect(cleared.statusCode, cleared.body).toBe(201);
    // Made in this order (the e2e's), the joined one never touches the other,
    // so a refresh still leaves it unjoined (#242 review).
    expect(hexDistance(away, near)).toBeGreaterThan(1);
    expect(
      await withTransaction(db, (tx) => refreshHomesteads(tx, mapId, [kid.id], clock)),
    ).toEqual([]);
    // Napping: joined once, cut off since. A refresh leaves it napping, and
    // it won't clear until it's joined up again.
    const nap = await call(server, 'POST', `/maps/${mapId}/dev/homestead`, kid, {
      terrain: 'mountains',
      joined: 'napping',
    });
    expect(nap.statusCode, nap.body).toBe(201);
    const napAt = nap.json<{ q: number; r: number }>();
    expect(
      await withTransaction(db, (tx) => refreshHomesteads(tx, mapId, [kid.id], clock)),
    ).toEqual([]);
    const later = MapViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/view`, kid)).json(),
    );
    expect(later.tiles.find((t) => t.q === napAt.q && t.r === napAt.r)).toMatchObject({
      explored: true,
      homestead: 'paused',
    });
    const napping = await call(server, 'POST', `/maps/${mapId}/clears`, kid, napAt);
    expect(errorOf(napping).message).toBe(
      'This homestead is napping zZ. Join it back up to home first!',
    );
    // Asked for land that doesn't exist, it says so.
    const bad = await call(server, 'POST', `/maps/${mapId}/dev/homestead`, kid, {
      terrain: 'moon-cheese',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('dev: a made homestead has every real spot searched, so a search there is refused, not a 500 (#511)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const made = await call(server, 'POST', `/maps/${mapId}/dev/homestead`, kid, {
      terrain: 'lake',
    });
    expect(made.statusCode, made.body).toBe(201);
    const at = made.json<Tile>();
    const seen = await view(server, kid, mapId, at);
    expect(seen.homestead).toBe('joined');
    expect(seen.progress).toEqual({ searched: seen.spots.length, total: seen.spots.length });
    for (const s of seen.spots) {
      const res = await search(server, kid, mapId, at, s.index);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res).message).toBe('You already searched there!');
    }
    // Made again on a tile with a row left from before, the row is replaced.
    await db.execute(
      `update tile_explore set searched = 1, completed_at = null, joined_at = null where user_id = '${kid.id}'`,
    );
    await db.execute(
      `update tiles set owner_user_id = null, terrain = '${CLEARED_TERRAIN}' where map_id = '${mapId}' and q = ${String(at.q)} and r = ${String(at.r)}`,
    );
    const again = await call(server, 'POST', `/maps/${mapId}/dev/homestead`, kid, {
      terrain: 'lake',
    });
    expect(again.json()).toEqual(at);
    expect((await view(server, kid, mapId, at)).progress.searched).toBe(seen.spots.length);
  });

  it('a joined row short of spots drops its homestead on the next search instead of a 500 (#511)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const made = await call(server, 'POST', `/maps/${mapId}/dev/homestead`, kid, {
      terrain: 'lake',
    });
    const at = made.json<Tile>();
    // What the dev route used to write: finished and joined, but only the
    // first spot searched.
    await db.execute(
      `update tile_explore set searched = 1 where user_id = '${kid.id}' and completed_at is not null`,
    );
    await give(mapId, kid, { net: 5, shovel: 5 });
    const open = (await view(server, kid, mapId, at)).spots.find((s) => !s.done);
    expect(open).toBeDefined();
    const res = await search(server, kid, mapId, at, open!.index);
    expect(res.statusCode, res.body).toBe(200);
    const body = SearchSpotResponseSchema.parse(res.json());
    // Seven spots with two searched: not finished, so not a homestead.
    expect(body).toMatchObject({ explored: false, homestead: null });
  });

  it('counts each search towards the Seeker track (#199)', async () => {
    // Milestones judge membership at the event's game time (its database
    // time, shifted by the clock). Play on today's clock and have both
    // members join an hour back, as the milestones tests do, so clock skew
    // between the app and the database can't decide it.
    clock.setTime(Date.now());
    const server = await start();
    const me = await player();
    const friend = await player();
    const mapId = await patch(server, me, [friend]);
    await db.execute(
      `update map_members set joined_at = now() - interval '1 hour' where map_id = '${mapId}'`,
    );
    const { first } = await lineFromHome(mapId, me);
    await ownMeadow(first, me);
    // A meadow's layout comes from the map's random seed, and about 1 in 1,800
    // seeds gives a tile under two hand spots (#411). Pin the first seed that
    // gives this tile two, so the two searches below always exist.
    const handSpots = (seed: string) =>
      (
        searchSpots(seed, { q: first.q, r: first.r, terrain: 'meadow' }, EXPLORE_RULES) ?? []
      ).filter((s) => s.tool === null).length;
    let n = 0;
    while (handSpots(`seeker-${String(n)}`) < 2) n += 1;
    await db.execute(`update maps set seed = 'seeker-${String(n)}' where id = '${mapId}'`);
    const hands = (await view(server, me, mapId, first)).spots.filter((s) => s.tool === null);
    expect(hands.length).toBeGreaterThanOrEqual(2);
    for (const s of hands.slice(0, 2)) {
      expect((await search(server, me, mapId, first, s.index)).statusCode).toBe(200);
    }
    clock.setTime(Date.now());
    await runConsumer(db, createMilestonesConsumer({ clock: () => clock }), mapId);
    const res = await call(server, 'GET', '/milestones', me);
    const seeker = MilestonesResponseSchema.parse(res.json()).tracks.find(
      (t) => !t.hidden && t.id === 'seeker',
    );
    expect(seeker).toMatchObject({ name: 'Seeker', progress: 2 });
  });

  describe('grey village tiles (#306 2a)', () => {
    /** My land reaches my nearest grey village (the dev route); its square. */
    async function reachVillage(server: FastifyInstance, who: Player, mapId: string) {
      const res = await call(server, 'POST', `/maps/${mapId}/dev/hollowed-reach`, who);
      expect(res.statusCode, res.body).toBe(201);
      const square = res.json<{ q: number; r: number }>();
      return (await tilesOf(mapId)).find((t) => t.q === square.q && t.r === square.r)!;
    }

    /** A spot searched by hand on a tile, with every tool in the bag in case. */
    async function handSpot(server: FastifyInstance, who: Player, mapId: string, t: Tile) {
      await give(mapId, who, { shovel: 20, net: 20, rope: 20, lantern: 20 });
      const tile = await view(server, who, mapId, t);
      return { tile, spot: tile.spots.find((s) => s.tool === null) ?? tile.spots[0]! };
    }

    it('opens to anyone whose land touches the village, by day, with its joy and echoes', async () => {
      const server = await start();
      const me = await player();
      const mapId = await patch(server, me);
      const village = (await tilesOf(mapId)).find((t) => t.communityId !== null)!;
      // Not mine and not touching yet: the panel's own words.
      const away = await call(
        server,
        'GET',
        `/maps/${mapId}/explore?q=${village.q}&r=${village.r}`,
        me,
      );
      expect(away.statusCode).toBe(403);
      expect(errorOf(away).message).toBe('Claim land next to it to explore!');

      const square = await reachVillage(server, me, mapId);
      const { tile, spot } = await handSpot(server, me, mapId, square);
      expect(tile.progress).toEqual({ searched: 0, total: tile.spots.length });
      expect(tile.homestead).toBeNull();
      expect(tile.community).toMatchObject({ id: square.communityId, joy: 0 });
      expect(tile.community?.name).toMatch(/Hollow$/);
      expect(tile.community?.echoes).toHaveLength(1);
      // Never the village's seed or its cellar key's tile (rule 6).
      expect(JSON.stringify(tile)).not.toMatch(/seed|key/i);

      const res = await search(server, me, mapId, square, spot.index);
      expect(res.statusCode, res.body).toBe(200);
      const found = SearchSpotResponseSchema.parse(res.json());
      expect(found.progress.searched).toBe(1);
      expect(found.joy).toBe(Math.round(100 / tile.spots.length));
      expect(found.explored).toBe(false);
      expect(found.homestead).toBeNull();
      const again = await view(server, me, mapId, square);
      expect(again.community?.joy).toBe(found.joy);
      expect(again.community?.echoes).toEqual(tile.community?.echoes);
      expect(await eventsOf(mapId, 'explore.searched')).toHaveLength(1);
    });

    it('opens to each member by their own reach, never the patch’s', async () => {
      const server = await start();
      const me = await player();
      const friend = await player();
      const mapId = await patch(server, me, [friend]);
      const square = await reachVillage(server, me, mapId);
      const tiles = await tilesOf(mapId);
      const village = tiles.filter((t) => t.communityId === square.communityId);
      for (const who of [me, friend]) {
        const { reach } = communityReach(village, tiles, who.id);
        const res = await call(
          server,
          'GET',
          `/maps/${mapId}/explore?q=${String(square.q)}&r=${String(square.r)}`,
          who,
        );
        expect(res.statusCode, `${who.username}: ${String(reach)}`).toBe(
          reach === 'touching' ? 200 : 403,
        );
      }
      expect(communityReach(village, tiles, me.id).reach).toBe('touching');
    });

    it('never finishes: every spot searched is still no ✨ and no homestead', async () => {
      const server = await start();
      const me = await player();
      const mapId = await patch(server, me);
      const square = await reachVillage(server, me, mapId);
      const { tile } = await handSpot(server, me, mapId, square);
      let last = null;
      for (const s of tile.spots) {
        const res = await search(server, me, mapId, square, s.index);
        expect(res.statusCode, res.body).toBe(200);
        last = SearchSpotResponseSchema.parse(res.json());
      }
      expect(last).toMatchObject({ joy: 100, explored: false, homestead: null });
      expect(await eventsOf(mapId, 'tile.explored')).toHaveLength(0);
      const [row] = await db.query.tileExplore.findMany({
        where: (e, { and, eq }) => and(eq(e.userId, me.id), eq(e.tileId, square.id)),
      });
      expect(row?.completedAt).toBeNull();
    });

    it('shuts at night, and its spots refill each morning', async () => {
      const server = await start();
      const me = await player();
      const mapId = await patch(server, me);
      const square = await reachVillage(server, me, mapId);
      const { spot } = await handSpot(server, me, mapId, square);
      expect((await search(server, me, mapId, square, spot.index)).statusCode).toBe(200);
      expect((await search(server, me, mapId, square, spot.index)).statusCode).toBe(409);

      // 8 PM in Denver: after nightfall.
      clock.setTime(Date.parse('2026-10-03T02:00:00Z'));
      const night = await call(
        server,
        'GET',
        `/maps/${mapId}/explore?q=${square.q}&r=${square.r}`,
        me,
      );
      expect(night.statusCode).toBe(403);
      expect(errorOf(night).message).toBe('Too spooky after dark! Come back in the morning 🌙');
      expect((await search(server, me, mapId, square, spot.index)).statusCode).toBe(403);

      // 8 AM the next day: fresh spots, grey again.
      clock.setTime(Date.parse('2026-10-03T14:00:00Z'));
      const morning = await view(server, me, mapId, square);
      expect(morning.progress.searched).toBe(0);
      expect(morning.community?.joy).toBe(0);
      expect((await search(server, me, mapId, square, spot.index)).statusCode).toBe(200);
    });

    it('rolls the Hollowed find tables (more Heartdust)', async () => {
      const server = await start();
      const me = await player();
      const mapId = await patch(server, me);
      const square = await reachVillage(server, me, mapId);
      const { spot } = await handSpot(server, me, mapId, square);
      const rolled: unknown[] = [];
      const rng = {
        weighted: <T>(items: readonly T[]) => {
          rolled.push(items);
          return items[0]!;
        },
        next: () => 0.5,
        int: (min: number) => min,
        chance: () => false,
        pick: <T>(items: readonly T[]) => items[0]!,
      } as unknown as Rng;
      const service = createExploreService({ db, clock: () => clock, rng: () => rng });
      await service.search(me, mapId, { q: square.q, r: square.r, spot: spot.index });
      const table =
        HOLLOWED_FINDS.find((t) => t.kind === spot.kind && t.terrains?.includes(square.terrain)) ??
        HOLLOWED_FINDS.find((t) => t.kind === spot.kind && !t.terrains);
      expect(rolled[0]).toEqual(table!.finds);
    });

    describe('Relight the path (#306 PR 2b)', () => {
      const begin = (server: FastifyInstance, who: Player, mapId: string, t: Tile) =>
        call(server, 'POST', `/maps/${mapId}/explore/puzzle/start`, who, { q: t.q, r: t.r });
      const solve = (
        server: FastifyInstance,
        who: Player,
        mapId: string,
        t: Tile,
        body: { attempt: number; moves: readonly RelightMove[] },
        key?: string,
      ) =>
        call(
          server,
          'POST',
          `/maps/${mapId}/explore/puzzle`,
          who,
          { q: t.q, r: t.r, attempt: body.attempt, moves: body.moves },
          key ? { 'idempotency-key': key } : {},
        );
      /**
       * A new try, and its answer: the test rebuilds the try's board from
       * the Hollow's secret seed, as the server does, and checks it is the
       * board the start sent.
       */
      async function attemptOf(server: FastifyInstance, who: Player, mapId: string, t: Tile) {
        const res = await begin(server, who, mapId, t);
        expect(res.statusCode, res.body).toBe(200);
        const { attempt, board } = StartPuzzleResponseSchema.parse(res.json());
        const village = await db.query.communities.findFirst({
          where: (c, { eq: is }) => is(c.id, t.communityId!),
        });
        const { depth } = (await view(server, who, mapId, t)).community!.puzzle!;
        const puzzle = makeRelight(
          relightSeed(village!.seed, t, who.id, attempt),
          MEMORY_PUZZLES.relight[depth],
        );
        expect(relightBoard(puzzle)).toEqual(board);
        return { attempt, board, depth, moves: puzzle.solution };
      }
      const solvedBy = async (t: Tile) =>
        (
          await db.query.communityTiles.findFirst({
            where: (c, { eq: is }) => is(c.tileId, t.id),
          })
        )?.puzzleSolvedBy;
      const rowOf = (who: Player, t: Tile) =>
        db.query.tileExplore.findFirst({
          where: (x, { and, eq: is }) => and(is(x.userId, who.id), is(x.tileId, t.id)),
        });
      /** The fewest wild tiles from `who`'s land to `square`'s village become theirs, so it touches. */
      async function touchVillage(who: Player, mapId: string, square: Tile) {
        const tiles = await tilesOf(mapId);
        const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
        const village = new Set(
          tiles.filter((t) => t.communityId === square.communityId).map(hexKey),
        );
        const from = new Map<HexKey, HexKey | null>();
        let frontier = tiles.filter((t) => t.ownerUserId === who.id).map(hexKey);
        for (const k of frontier) from.set(k, null);
        let goal: HexKey | null = null;
        while (frontier.length > 0 && goal === null) {
          const next: HexKey[] = [];
          for (const k of frontier) {
            const at = byKey.get(k)!;
            if (hexNeighbors(at).some((n) => village.has(hexKey(n)))) {
              goal = k;
              break;
            }
            for (const n of hexNeighbors(at)) {
              const t = byKey.get(hexKey(n));
              if (!t || from.has(hexKey(t))) continue;
              if (t.ownerUserId !== null || t.communityId !== null || t.homeSlot !== null) continue;
              from.set(hexKey(t), k);
              next.push(hexKey(t));
            }
          }
          frontier = next;
        }
        for (let k = goal; k !== null; k = from.get(k) ?? null) {
          const t = byKey.get(k)!;
          if (t.ownerUserId === null) {
            await db.execute(`update tiles set owner_user_id = '${who.id}' where id = '${t.id}'`);
          }
        }
      }
      const findAll = (who: Player, pages: readonly string[]) =>
        db
          .insert(loreFound)
          .values(pages.map((pageId) => ({ userId: who.id, pageId, foundAt: new Date(START) })));

      it('shows a broken thing by terrain, and relighting it gives a lore page, once a tile', async () => {
        const server = await start();
        const me = await player();
        const mapId = await patch(server, me);
        const square = await reachVillage(server, me, mapId);
        const tile = await view(server, me, mapId, square);
        const puzzle = tile.community?.puzzle;
        const skin = puzzleSkinFor(square.terrain, MEMORY_PUZZLES);
        // The square is the Hollow's heart: the biggest board until The forgotten story lands.
        expect(puzzle).toMatchObject({ skin: skin.id, depth: 'heart', solved: false });
        // It stands clear of every spot (the Keeper walks round both).
        for (const s of tile.spots) {
          expect(Math.hypot(s.x - puzzle!.x, s.z - puzzle!.z)).toBeGreaterThan(0.25);
        }
        // The same for everyone, every time.
        expect((await view(server, me, mapId, square)).community?.puzzle).toEqual(puzzle);

        const { attempt, board, moves } = await attemptOf(server, me, mapId, square);
        expect(attempt).toBe(1);
        expect(board.size).toBe(MEMORY_PUZZLES.relight.heart.size);
        const res = await solve(server, me, mapId, square, { attempt, moves });
        expect(res.statusCode, res.body).toBe(200);
        const fixed = SolvePuzzleResponseSchema.parse(res.json());
        expect(fixed.puzzle).toEqual({ ...puzzle, solved: true });
        expect(fixed.recipe).toBeNull();
        expect(PUZZLE_REWARDS.lorePages).toContain(fixed.lore?.id);
        expect(fixed.lore?.title.length).toBeGreaterThan(0);
        expect(fixed.found).toEqual({});
        expect(await solvedBy(square)).toEqual([me.id]);
        expect((await rowOf(me, square))?.puzzleSolvedAt?.getTime()).toBe(clock.getTime());
        const [event] = await eventsOf(mapId, 'explore.puzzled');
        expect(event).toMatchObject({
          userId: me.id,
          q: square.q,
          r: square.r,
          communityId: square.communityId,
          skin: skin.id,
          depth: 'heart',
          attempt: 1,
          moves: moves.length,
          lorePage: fixed.lore!.id,
          recipe: null,
          items: {},
          notable: 'lore',
        });
        // The lore consumer grants the page.
        await runConsumer(db, createLoreConsumer({ clock: () => clock }), mapId);
        const found = await db.query.loreFound.findMany({
          where: (f, { eq: is }) => is(f.userId, me.id),
        });
        expect(found.map((f) => f.pageId)).toContain(fixed.lore!.id);

        expect((await view(server, me, mapId, square)).community?.puzzle?.solved).toBe(true);
        for (const again of [
          await solve(server, me, mapId, square, { attempt, moves }),
          await begin(server, me, mapId, square),
        ]) {
          expect(again.statusCode).toBe(409);
          expect(errorOf(again).message).toBe('You already fixed this one! ✨');
        }
        expect(await eventsOf(mapId, 'explore.puzzled')).toHaveLength(1);
      });

      it('sizes the board by how deep the tile is', async () => {
        const server = await start();
        const me = await player();
        const mapId = await patch(server, me);
        const square = await reachVillage(server, me, mapId);
        const tiles = await tilesOf(mapId);
        const village = tiles.filter((t) => t.communityId === square.communityId);
        for (const t of village.filter((v) => v.id !== square.id).slice(0, 3)) {
          const { depth, board } = await attemptOf(server, me, mapId, t);
          expect(depth).toBe(relightDepth(t, square, village));
          expect(board.size).toBe(MEMORY_PUZZLES.relight[depth].size);
        }
      });

      it('reshuffles every try, and takes only the latest try’s lit path', async () => {
        const server = await start();
        const me = await player();
        const mapId = await patch(server, me);
        const square = await reachVillage(server, me, mapId);
        // A search this morning, then tries: a try never touches the morning's searches.
        const spot = (await view(server, me, mapId, square)).spots.find((s) => s.tool === null)!;
        expect((await search(server, me, mapId, square, spot.index)).statusCode).toBe(200);
        const searchedAt = (await rowOf(me, square))!.updatedAt;
        const first = await attemptOf(server, me, mapId, square);
        const second = await attemptOf(server, me, mapId, square);
        expect([first.attempt, second.attempt]).toEqual([1, 2]);
        expect(second.board.cells).not.toEqual(first.board.cells);
        expect(await rowOf(me, square)).toMatchObject({ puzzleAttempt: 2, updatedAt: searchedAt });
        expect((await view(server, me, mapId, square)).progress.searched).toBe(1);

        const turnHeart = { type: 'turn' as const, at: second.board.heart };
        for (const [body, message] of [
          // An older try, even lit.
          [first, 'The path has shuffled! Try the new one.'],
          [{ attempt: 3, moves: second.moves }, 'The path has shuffled! Try the new one.'],
          // Dark, an illegal move, or one move past the limit.
          [{ attempt: 2, moves: [] }, "The light didn't reach every lantern. Try a new path!"],
          [
            { attempt: 2, moves: [turnHeart, ...second.moves] },
            "The light didn't reach every lantern. Try a new path!",
          ],
          [
            {
              attempt: 2,
              moves: [
                ...second.moves,
                ...Array.from({ length: second.board.limit - second.moves.length + 1 }, () => ({
                  type: 'turn' as const,
                  at: second.board.cells.findIndex((c) => c.kind === 'lantern'),
                })),
              ],
            },
            "The light didn't reach every lantern. Try a new path!",
          ],
        ] as const) {
          const res = await solve(server, me, mapId, square, body);
          expect(res.statusCode, JSON.stringify(body.moves.length)).toBe(409);
          expect(errorOf(res).message).toBe(message);
        }
        expect(await solvedBy(square)).toEqual([]);
        expect(await eventsOf(mapId, 'explore.puzzled')).toHaveLength(0);
        // The latest try, lit, within the limit.
        expect((await solve(server, me, mapId, square, second)).statusCode).toBe(200);
      });

      it('needs a try first, and the dev answer is that try’s', async () => {
        const server = await start();
        const me = await player();
        const mapId = await patch(server, me);
        const square = await reachVillage(server, me, mapId);
        const res = await solve(server, me, mapId, square, { attempt: 1, moves: [] });
        expect(res.statusCode).toBe(409);
        expect(errorOf(res).message).toBe('The path has shuffled! Try the new one.');
        // The dev answer (e2e and captures only) is the latest try's, and it lights the path.
        const answer = (body: { q: number; r: number }) =>
          call(server, 'POST', `/maps/${mapId}/dev/relight-answer`, me, body);
        expect((await answer({ q: square.q, r: square.r })).statusCode).toBe(409);
        const { moves } = await attemptOf(server, me, mapId, square);
        const dev = await answer({ q: square.q, r: square.r });
        expect(dev.json()).toEqual({ attempt: 1, moves });
        expect((await solve(server, me, mapId, square, { attempt: 1, moves })).statusCode).toBe(
          200,
        );
      });

      it('is each kid’s own: a friend gets their own board, and a retry is one solve', async () => {
        const server = await start();
        const me = await player();
        const friend = await player();
        const mapId = await patch(server, me, [friend]);
        const square = await reachVillage(server, me, mapId);
        await touchVillage(friend, mapId, square);
        const mine = await attemptOf(server, me, mapId, square);
        const theirs = await attemptOf(server, friend, mapId, square);
        expect(theirs.board.cells).not.toEqual(mine.board.cells);
        const first = await solve(server, me, mapId, square, mine, 'puzzle-key-1');
        const retry = await solve(server, me, mapId, square, mine, 'puzzle-key-1');
        expect(retry.statusCode).toBe(200);
        expect(retry.json()).toEqual(first.json());
        expect((await view(server, friend, mapId, square)).community?.puzzle?.solved).toBe(false);
        // My answer isn't theirs.
        expect((await solve(server, friend, mapId, square, mine)).statusCode).toBe(409);
        expect((await solve(server, friend, mapId, square, theirs)).statusCode).toBe(200);
        expect(await solvedBy(square)).toEqual([me.id, friend.id].sort());
        expect(await eventsOf(mapId, 'explore.puzzled')).toHaveLength(2);
      });

      it('lets two taps at once fix it only once', async () => {
        const server = await start();
        const me = await player();
        const mapId = await patch(server, me);
        const square = await reachVillage(server, me, mapId);
        const lit = await attemptOf(server, me, mapId, square);
        const both = await Promise.all([
          solve(server, me, mapId, square, lit),
          solve(server, me, mapId, square, lit),
        ]);
        expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
        expect(await solvedBy(square)).toEqual([me.id]);
      });

      it('never gives the same page twice, before the Lorebook has caught up', async () => {
        const server = await start();
        const me = await player();
        const mapId = await patch(server, me);
        const square = await reachVillage(server, me, mapId);
        const village = (await tilesOf(mapId)).filter((t) => t.communityId === square.communityId);
        const pages: (string | undefined)[] = [];
        // No lore consumer runs in between: every page comes from the events.
        for (const t of village.slice(0, PUZZLE_REWARDS.lorePages.length + 1)) {
          const res = await solve(server, me, mapId, t, await attemptOf(server, me, mapId, t));
          expect(res.statusCode, res.body).toBe(200);
          pages.push(SolvePuzzleResponseSchema.parse(res.json()).lore?.id);
        }
        const given = pages.filter((id) => id !== undefined);
        expect(new Set(given).size).toBe(given.length);
        expect([...given].sort()).toEqual([...PUZZLE_REWARDS.lorePages].sort());
        expect(pages.at(-1)).toBeUndefined();
      });

      it('gives a little Heartdust once every page is found', async () => {
        const server = await start();
        const me = await player();
        const mapId = await patch(server, me);
        const square = await reachVillage(server, me, mapId);
        await findAll(me, PUZZLE_REWARDS.lorePages);
        const res = await solve(
          server,
          me,
          mapId,
          square,
          await attemptOf(server, me, mapId, square),
        );
        expect(res.statusCode, res.body).toBe(200);
        const fixed = SolvePuzzleResponseSchema.parse(res.json());
        expect(fixed).toMatchObject({ lore: null, recipe: null, found: PUZZLE_REWARDS.fallback });
        for (const [id, n] of Object.entries(PUZZLE_REWARDS.fallback)) {
          expect(fixed.items[id]).toBe(n);
        }
        const [event] = await eventsOf(mapId, 'explore.puzzled');
        expect(event).toMatchObject({ lorePage: null, notable: 'heartdust' });
        const ledger = await db.query.resourceLedger.findMany({
          where: (l, { and, eq: is }) => and(is(l.userId, me.id), is(l.reason, 'explore')),
        });
        expect(ledger.map((l) => l.refId)).toEqual([event!['solveId']]);
      });

      it('can give a Rekindled recipe page through the PR 5 hook', async () => {
        const me = await player();
        const server = await start();
        const mapId = await patch(server, me);
        const square = await reachVillage(server, me, mapId);
        await findAll(me, PUZZLE_REWARDS.lorePages);
        const granted: unknown[] = [];
        const service = createExploreService({
          db,
          clock: () => clock,
          rekindled: {
            sealed: () => Promise.resolve([{ id: 'heart-tea', title: 'Heart Tea' }]),
            grant: (_tx, owner, pageId, refId) => {
              granted.push({ ...owner, pageId, refId });
              return Promise.resolve();
            },
          },
        });
        const { attempt, moves } = await attemptOf(server, me, mapId, square);
        const fixed = await service.solvePuzzle(me, mapId, {
          q: square.q,
          r: square.r,
          attempt,
          moves: [...moves],
        });
        expect(fixed).toMatchObject({
          lore: null,
          recipe: { id: 'heart-tea', title: 'Heart Tea' },
          found: {},
        });
        const [event] = await eventsOf(mapId, 'explore.puzzled');
        expect(event).toMatchObject({ recipe: 'heart-tea', lorePage: null, notable: null });
        expect(granted).toEqual([
          { mapId, userId: me.id, pageId: 'heart-tea', refId: event!['solveId'] },
        ]);
      });

      it('is shut at night and out of reach, and there is none on my own land', async () => {
        const server = await start();
        const me = await player();
        const mapId = await patch(server, me);
        // A new home never touches a village (they sit 3–5 steps out): out of reach.
        const village = (await tilesOf(mapId)).find((t) => t.communityId !== null)!;
        const away = await begin(server, me, mapId, village);
        expect(away.statusCode).toBe(403);
        expect(errorOf(away).message).toBe('Claim land next to it to explore!');
        const square = await reachVillage(server, me, mapId);
        const lit = await attemptOf(server, me, mapId, square);
        const { first } = await lineFromHome(mapId, me);
        await ownMeadow(first, me);
        for (const mine of [
          await begin(server, me, mapId, first),
          await solve(server, me, mapId, first, lit),
        ]) {
          expect(mine.statusCode).toBe(409);
          expect(errorOf(mine).message).toBe("There's nothing to fix here!");
        }
        // 8 PM in Denver: after nightfall.
        clock.setTime(Date.parse('2026-10-03T02:00:00Z'));
        expect((await begin(server, me, mapId, square)).statusCode).toBe(403);
        expect((await solve(server, me, mapId, square, lit)).statusCode).toBe(403);
        expect(await solvedBy(square)).toEqual([]);
      });
    });

    it('is still only for my own land when the tile isn’t a village', async () => {
      const server = await start();
      const me = await player();
      const mapId = await patch(server, me);
      const wild = (await tilesOf(mapId)).find(
        (t) => t.communityId === null && t.ownerUserId === null && t.terrain === 'meadow',
      )!;
      const res = await call(server, 'GET', `/maps/${mapId}/explore?q=${wild.q}&r=${wild.r}`, me);
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).message).toBe('You can only explore your own land.');
    });
  });
});
