import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  combinePercents,
  HOME_BASE_RULES,
  hexKey,
  hexNeighbors,
  JobsViewSchema,
  JoinMapResponseSchema,
  LandTendingResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  roadRefund,
  roadSpent,
  RoadsViewSchema,
  RoadTileResponseSchema,
  SquishyResponseSchema,
  TERRITORY_RULES,
  TRAVEL_RULES,
  type Hex,
  type MapDetail,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, tileRoads, tileTending, users } from '../../db/schema.js';
import { localDate } from '../../lib/time.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { refreshSupply } from '../territory/supply.js';
import { createLandTending } from '../territory/tending.js';
import { bigMove } from '../../../tests/big-move.js';

/*
 * Wild Isle roads, reach and supply (#621 W1-5a): laying, raising and taking
 * up a road; reach along roads and refusals on water; land cut off from
 * home stranding, joining up again and going wild at nightfall; a road lost
 * with its tile; a gatherer's pace on a road; a Cozy Patch untouched.
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
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
const PLENTY = { timber: 80, stone: 80, glimmer: 6 };
const DIRECTIONS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

interface Player extends PublicUser {
  token: string;
}

interface Tile {
  id: string;
  q: number;
  r: number;
  ownerUserId: string | null;
  homeSlot: number | null;
  terrain: string;
  nodeResource: string | null;
  communityId: string | null;
}

describe.skipIf(!url)('roads, reach and supply (needs DATABASE_URL)', () => {
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
    const username = `roader_${String((counter += 1))}`;
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

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;
  const roadOf = (res: LightMyRequestResponse) => RoadTileResponseSchema.parse(res.json());
  const battleOf = (res: LightMyRequestResponse) => BattleResponseSchema.parse(res.json()).battle;

  /** A patch (Cozy, as the generator makes them today), with `others` joined. */
  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, { name: 'Road Patch', timeZone: ZONE });
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

  const makeWild = (mapId: string) =>
    db.execute(`update maps set patch_type = 'wild-isle' where id = '${mapId}'`);
  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));
  const tilesOf = async (mapId: string): Promise<Tile[]> =>
    db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  /** Hands a tile to `userId` (null: neutral) as a claim would: owned and tended now. */
  async function own(mapId: string, tile: Tile, userId: string | null) {
    await db.execute(
      `update tiles set owner_user_id = ${userId === null ? 'null' : `'${userId}'`} where id = '${tile.id}'`,
    );
    if (userId === null) return;
    await db
      .insert(tileTending)
      .values({ tileId: tile.id, mapId, tendedAt: clock, claimedAt: clock })
      .onConflictDoUpdate({
        target: tileTending.tileId,
        set: { tendedAt: clock, strandedSince: null },
      });
  }
  const strandedOf = async (tileId: string) =>
    (await db.query.tileTending.findFirst({ where: (t, { eq }) => eq(t.tileId, tileId) }))
      ?.strandedSince ?? null;
  const eventsOf = (mapId: string, type: string) =>
    db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, type)),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const ledgerOf = async (mapId: string, userId: string, reason: string) => {
    const rows = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.mapId, mapId), eq(t.userId, userId), eq(t.reason, reason)),
    });
    const total: Record<string, number> = {};
    for (const r of rows) total[r.itemId] = (total[r.itemId] ?? 0) + r.delta;
    return total;
  };
  const negate = (items: Record<string, number>) =>
    Object.fromEntries(Object.entries(items).map(([id, n]) => [id, -n]));

  /**
   * A straight line of tiles out from `who`'s Heart Seed: `line[k]` is k
   * steps away (`line[1]` is in the home ring). Every tile on it is plain
   * neutral land past the ring.
   */
  async function lineFrom(mapId: string, who: Player, length = 6): Promise<Tile[]> {
    const tiles = await tilesOf(mapId);
    const at = new Map(tiles.map((t) => [hexKey(t), t]));
    const home = tiles.filter((t) => t.ownerUserId === who.id && t.homeSlot !== null);
    const homeKeys = new Set(home.map(hexKey));
    const seed = home.find((t) => hexNeighbors(t).every((n) => homeKeys.has(hexKey(n))))!;
    for (const d of DIRECTIONS) {
      const line = Array.from({ length: length + 1 }, (_, k) =>
        at.get(hexKey({ q: seed.q + d.q * k, r: seed.r + d.r * k })),
      );
      const ok = line.every(
        (t, k) =>
          t !== undefined &&
          (k <= 1 ||
            (t.ownerUserId === null &&
              t.homeSlot === null &&
              t.communityId === null &&
              t.terrain !== 'trading-post')),
      );
      if (ok) return line as Tile[];
    }
    throw new Error('no clear line out of home');
  }

  const road = (server: FastifyInstance, who: Player, mapId: string, h: Hex, action = '') =>
    call(server, 'POST', `/maps/${mapId}/roads${action}`, who, { q: h.q, r: h.r });

  it('has no roads on a Cozy Patch', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const [, ring] = await lineFrom(mapId, kid);
    expect((await call(server, 'GET', `/maps/${mapId}/roads`, kid)).statusCode).toBe(404);
    const res = await road(server, kid, mapId, ring!);
    expect(res.statusCode).toBe(404);
    expect(errorOf(res).message).toBe('There are no roads on this patch.');
  });

  it('lays a Path, raises it to a Paved road, and takes it up for half back', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeWild(mapId);
    await give(mapId, kid, PLENTY);
    const line = await lineFrom(mapId, kid);
    await own(mapId, line[2]!, kid.id);

    const built = await road(server, kid, mapId, line[2]!);
    expect(built.statusCode, built.body).toBe(201);
    expect(roadOf(built)).toMatchObject({ road: { level: 1 }, refund: {} });
    expect(roadOf(built).items['timber']).toBe(PLENTY.timber - 4);
    const view = RoadsViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/roads`, kid)).json(),
    );
    expect(view.roads).toEqual([{ q: line[2]!.q, r: line[2]!.r, ownerUserId: kid.id, level: 1 }]);
    const [event] = await eventsOf(mapId, 'road.built');
    expect(parseGameEventPayload('road.built', event!.payload)).toMatchObject({ level: 1 });

    expect(roadOf(await road(server, kid, mapId, line[2]!, '/upgrade')).road).toEqual({ level: 2 });
    expect(roadOf(await road(server, kid, mapId, line[2]!, '/upgrade')).road).toEqual({ level: 3 });
    const top = await road(server, kid, mapId, line[2]!, '/upgrade');
    expect(top.statusCode).toBe(409);
    expect(errorOf(top).message).toBe('This road is as fancy as it gets! ✨');
    expect(await ledgerOf(mapId, kid.id, 'road')).toEqual(negate(roadSpent(3, TRAVEL_RULES)));

    const removed = await road(server, kid, mapId, line[2]!, '/remove');
    expect(removed.statusCode, removed.body).toBe(200);
    const refund = roadRefund(3, TRAVEL_RULES, HOME_BASE_RULES);
    expect(roadOf(removed)).toMatchObject({ road: null, refund });
    expect(await ledgerOf(mapId, kid.id, 'road-refund')).toEqual(refund);
    expect(await db.query.tileRoads.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) })).toEqual(
      [],
    );
  });

  it('refuses water, land that isn’t mine, a second road and a road that isn’t there', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeWild(mapId);
    await give(mapId, kid, PLENTY);
    const line = await lineFrom(mapId, kid);
    await own(mapId, line[2]!, kid.id);
    await db.execute(
      `update tiles set terrain = 'river', node_resource = null where id = '${line[3]!.id}'`,
    );

    const water = await road(server, kid, mapId, line[3]!);
    expect(water.statusCode).toBe(403);
    expect(errorOf(water).message).toBe("You can't lay a road on water. A bridge would do it!");
    expect((await road(server, kid, mapId, line[4]!)).statusCode).toBe(403);
    expect((await road(server, kid, mapId, line[2]!, '/upgrade')).statusCode).toBe(404);
    expect((await road(server, kid, mapId, line[2]!)).statusCode).toBe(201);
    const again = await road(server, kid, mapId, line[2]!);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toBe("There's already a road here!");
  });

  it('strands land cut off from home, joins it up along a road, and lets it go wild', async () => {
    const server = await start();
    const kid = await player();
    const rival = await player();
    const mapId = await patch(server, kid, [rival]);
    await makeWild(mapId);
    await give(mapId, kid, PLENTY);
    const line = await lineFrom(mapId, kid);
    for (const k of [2, 4, 5]) await own(mapId, line[k]!, kid.id);
    await own(mapId, line[3]!, rival.id);

    // Laying a road works the supply line out: (4) and (5) are cut off.
    expect((await road(server, kid, mapId, line[2]!)).statusCode).toBe(201);
    expect(await strandedOf(line[4]!.id)).toEqual(clock);
    expect(await strandedOf(line[5]!.id)).toEqual(clock);
    expect(await strandedOf(line[2]!.id)).toBeNull();
    const [stranded] = await eventsOf(mapId, 'tile.stranded');
    expect(parseGameEventPayload('tile.stranded', stranded!.payload)).toEqual({
      userId: kid.id,
      tiles: [line[4]!, line[5]!].map(({ q, r }) => ({ q, r })),
    });
    const tending = LandTendingResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/territory/tending`, kid)).json(),
    ).tending;
    const wildAt = new Date(clock.getTime() + TRAVEL_RULES.stranded.afterHours * HOUR_MS);
    expect(tending.stranded).toEqual(
      [line[4]!, line[5]!].map(({ q, r }) => ({
        q,
        r,
        since: clock.toISOString(),
        wildAt: wildAt.toISOString(),
      })),
    );
    const cut = await road(server, kid, mapId, line[4]!);
    expect(cut.statusCode).toBe(403);
    expect(errorOf(cut).message).toMatch(/cut off from home/);

    // A Road reaches two steps, across the rival's tile: joined up again.
    expect((await road(server, kid, mapId, line[2]!, '/upgrade')).statusCode).toBe(200);
    expect(await strandedOf(line[4]!.id)).toBeNull();
    expect(await strandedOf(line[5]!.id)).toBeNull();
    expect(await eventsOf(mapId, 'tile.supplied')).toHaveLength(1);

    // Taken up again: cut off, and past `afterHours` it goes wild at nightfall.
    expect((await road(server, kid, mapId, line[2]!, '/remove')).statusCode).toBe(200);
    clock.setTime(wildAt.getTime() + HOUR_MS);
    const land = createLandTending({ db, clock: () => clock });
    expect(await land.nightfall(mapId, localDate(clock, ZONE))).toEqual({ wild: 2 });
    const after = await tilesOf(mapId);
    for (const k of [4, 5]) expect(after.find((t) => t.id === line[k]!.id)?.ownerUserId).toBeNull();
    const [rewilded] = await eventsOf(mapId, 'tile.rewilded');
    expect(parseGameEventPayload('tile.rewilded', rewilded!.payload)).toMatchObject({
      userId: kid.id,
      cause: 'stranded',
    });
  });

  it('claims along a road’s reach, and never water', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeWild(mapId);
    await give(mapId, kid, PLENTY);
    const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
      level: 20,
      speciesId: 'emberbun',
    });
    expect(res.statusCode, res.body).toBe(201);
    const line = await lineFrom(mapId, kid);
    await own(mapId, line[2]!, kid.id);
    const attack = (h: Hex) =>
      call(server, 'POST', `/maps/${mapId}/attacks`, kid, { q: h.q, r: h.r });

    const far = await attack(line[4]!);
    expect(far.statusCode).toBe(403);
    expect(errorOf(far).message).toBe("That's past your roads. Lay a path closer first!");
    await db.execute(
      `update tiles set terrain = 'river', node_resource = null where id = '${line[3]!.id}'`,
    );
    const water = await attack(line[3]!);
    expect(water.statusCode).toBe(403);
    expect(errorOf(water).message).toBe("Water's in the way. Build a bridge!");
    await db.execute(`update tiles set terrain = 'meadow' where id = '${line[3]!.id}'`);

    expect((await road(server, kid, mapId, line[2]!)).statusCode).toBe(201);
    expect((await road(server, kid, mapId, line[2]!, '/upgrade')).statusCode).toBe(200);
    const claim = await attack(line[4]!);
    expect(claim.statusCode, claim.body).toBe(201);
  });

  it('a road comes down with its captured tile, half back to its owner', async () => {
    const server = await start();
    const kid = await player();
    const rival = await player();
    const mapId = await patch(server, kid, [rival]);
    await makeWild(mapId);
    await give(mapId, rival, PLENTY);
    const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
      level: 30,
      speciesId: 'emberbun',
    });
    expect(res.statusCode, res.body).toBe(201);
    clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);
    const line = await lineFrom(mapId, kid);
    await own(mapId, line[2]!, rival.id);
    // The rival's road there (laid as their own command would, on their land).
    await db.insert(tileRoads).values({
      tileId: line[2]!.id,
      mapId,
      ownerUserId: rival.id,
      level: 2,
      builtAt: clock,
    });

    const { q, r } = line[2]!;
    const started = await call(server, 'POST', `/maps/${mapId}/attacks`, kid, { q, r });
    expect(started.statusCode, started.body).toBe(201);
    let battle: PlayerBattle = battleOf(started);
    for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && battle.status === 'active'; i++) {
      const side = battle.view.sides[battle.mySide];
      const action: PlayerBattleAction =
        battle.view.phase.type === 'replace'
          ? { type: 'replace', slot: side.squishies.findIndex((s) => s.energy > 0) }
          : { type: 'move', move: bigMove(side.squishies[side.active]!) };
      const step = await call(server, 'POST', `/battles/${battle.id}/actions`, kid, {
        action,
        turn: battle.view.turn,
      });
      expect(step.statusCode, step.body).toBe(200);
      battle = battleOf(step);
    }
    const after = await tilesOf(mapId);
    expect(after.find((t) => t.id === line[2]!.id)?.ownerUserId).toBe(kid.id);
    expect(await db.query.tileRoads.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) })).toEqual(
      [],
    );
    const refund = roadRefund(2, TRAVEL_RULES, HOME_BASE_RULES);
    expect(await ledgerOf(mapId, rival.id, 'road-refund')).toEqual(refund);
    const [removed] = await eventsOf(mapId, 'road.removed');
    expect(parseGameEventPayload('road.removed', removed!.payload)).toMatchObject({
      userId: rival.id,
      lost: 'captured',
      refund,
    });
  });

  it('quickens a gatherer working a tile with its owner’s road', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeWild(mapId);
    await give(mapId, kid, PLENTY);
    const node = (await tilesOf(mapId)).find(
      (t) => t.ownerUserId === kid.id && t.homeSlot !== null && t.nodeResource === 'timber',
    )!;
    const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
      level: 3,
      speciesId: 'emberbun',
    });
    const pet = SquishyResponseSchema.parse(granted.json()).squishy;
    const job = await call(server, 'POST', `/maps/${mapId}/squishies/${pet.id}/job`, kid, {
      job: 'gatherer',
      q: node.q,
      r: node.r,
    });
    expect(job.statusCode, job.body).toBe(200);
    const speedOf = async () =>
      JobsViewSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/jobs`, kid)).json(),
      ).squishies.find((s) => s.squishy.id === pet.id)!.work!.speedPercent;
    const before = await speedOf();
    expect((await road(server, kid, mapId, node)).statusCode).toBe(201);
    const path = TRAVEL_RULES.roads.levels[0]!.speedPercent;
    expect(await speedOf()).toBe(Math.max(100, combinePercents([before, path])));
  });

  it('never strands a Cozy Patch', async () => {
    const server = await start();
    const kid = await player();
    const rival = await player();
    const mapId = await patch(server, kid, [rival]);
    const line = await lineFrom(mapId, kid);
    for (const k of [2, 4, 5]) await own(mapId, line[k]!, kid.id);
    await own(mapId, line[3]!, rival.id);
    const events = await withTransaction(db, (tx) =>
      refreshSupply(tx, mapId, [kid.id, rival.id], clock, { wait: true }),
    );
    expect(events).toEqual([]);
    for (const k of [4, 5]) expect(await strandedOf(line[k]!.id)).toBeNull();
    // Nightfall leaves that land alone: it was tended today.
    const land = createLandTending({ db, clock: () => clock });
    clock.setTime(clock.getTime() + 7 * DAY_MS);
    expect(await land.nightfall(mapId, localDate(clock, ZONE))).toEqual({ wild: 0 });
  });
});
