import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  GAME_DATA,
  GatherResponseSchema,
  JobsViewSchema,
  TERRITORY_RULES,
  type PlayerBattle,
  type PlayerBattleAction,
  EXPLORE_RULES,
  ExploreTileResponseSchema,
  hexKey,
  hexNeighbors,
  JoinMapResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  SearchSpotResponseSchema,
  SquishyResponseSchema,
  type MapDetail,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, tileExplore, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { createTendingRepo } from '../territory/repo.js';
import { refreshHomesteads } from './homesteads.js';

/*
 * Exploring your land (#199): the explore view of a tile, searching its
 * spots (finds, the team's XP, tool wear, once each), a tile fully explored,
 * and homesteads joining, pausing when cut off, and resuming.
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
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

    // Joined again: counting carries on from where it stopped, +1 a cycle.
    await reconnect(mapId, me, first);
    clock.setTime(clock.getTime() + 0.6 * land);
    const work = await workOf();
    expect(work.readyCycles).toBe(2);
    const base = JobsViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/jobs`, me)).json(),
    ).spots.find((s) => s.q === second.q && s.r === second.r)!;
    expect(work.ready[greens]).toBe(2 * base.quantity);
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
          : { type: 'move', move: side.squishies[side.active]!.moves[0]! };
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
});
