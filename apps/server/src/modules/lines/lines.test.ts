import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  combinePercents,
  JobsViewSchema,
  SquishyResponseSchema,
  hexKey,
  hexNeighbors,
  JoinMapResponseSchema,
  LinesViewSchema,
  LineTileResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  POWER_RULES,
  RAIL_RULES,
  TERRITORY_RULES,
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
import { buildings, keepers, sessions, tileLines, tileTending, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { productionAt } from '../buildings/production.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { grantItems } from '../inventory/service.js';
import { bigMove } from '../../../tests/big-move.js';
import { lineRefund } from './service.js';

/*
 * Clockwork Isle lines and power (#874 C2): laying, raising and taking up
 * wires and rails; one of each on a tile; the cut-off refusal; every other
 * patch type answering NOT_FOUND; a machine unpowered and repowered banking
 * only its powered minutes; lines and power lost with captured land.
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

describe.skipIf(!url)('wires, rails and power (needs DATABASE_URL)', () => {
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
    const username = `wirer_${String((counter += 1))}`;
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
  const lineOf = (res: LightMyRequestResponse) => LineTileResponseSchema.parse(res.json());
  const battleOf = (res: LightMyRequestResponse) => BattleResponseSchema.parse(res.json()).battle;

  /** A patch (Cozy, as the generator makes them today), with `others` joined. */
  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, { name: 'Wire Patch', timeZone: ZONE });
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
  /** A Clockwork Isle (#874): the map made as today, its type set as the create path will. */
  const makeClockwork = (mapId: string) =>
    db.execute(`update maps set patch_type = 'clockwork-isle' where id = '${mapId}'`);
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

  const line = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    h: Hex,
    kind: 'wire' | 'rail',
    action = '',
  ) => call(server, 'POST', `/maps/${mapId}/lines${action}`, who, { q: h.q, r: h.r, kind });
  const RULES = { travel: undefined, power: POWER_RULES, rails: RAIL_RULES };
  const refundOf = (kind: 'wire' | 'rail', level: number) =>
    lineRefund(kind, level, RULES as unknown as Parameters<typeof lineRefund>[2]);
  const linesOf = (mapId: string) =>
    db.query.tileLines.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });

  /** A building put straight in (its own command's checks aren't the point here). */
  async function put(mapId: string, who: Player, tile: Tile, buildingId: string, at = clock) {
    const [row] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: who.id,
        tileId: tile.id,
        buildingId,
        kind: 'works',
        spot: 0,
        placedAt: at,
        producedSince: at,
      })
      .returning({ id: buildings.id });
    return row!.id;
  }
  const buildingRow = async (id: string) =>
    (
      await createBuildingsRepo(db).listOnMap(
        (await db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!.mapId,
      )
    ).find((b) => b.id === id);

  it('has no wires or rails on a Cozy Patch or a Wild Isle', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const [, ring] = await lineFrom(mapId, kid);
    for (const step of [async () => undefined, () => makeWild(mapId)]) {
      await step();
      expect((await call(server, 'GET', `/maps/${mapId}/lines`, kid)).statusCode).toBe(404);
      for (const kind of ['wire', 'rail'] as const) {
        const res = await line(server, kid, mapId, ring!, kind);
        expect(res.statusCode).toBe(404);
        expect(errorOf(res).message).toBe('There are no wires or rails on this patch.');
      }
    }
  });

  it('lays a wire and a rail on one tile, raises the rail, and takes both up for half back', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeClockwork(mapId);
    await give(mapId, kid, { timber: 40, stone: 40, parts: 40 });
    const tiles = await lineFrom(mapId, kid);
    await own(mapId, tiles[2]!, kid.id);
    const at = tiles[2]!;

    const wire = await line(server, kid, mapId, at, 'wire');
    expect(wire.statusCode, wire.body).toBe(201);
    expect(lineOf(wire)).toMatchObject({ kind: 'wire', line: { level: 1 }, refund: {} });
    expect(lineOf(wire).items['parts']).toBe(40 - (POWER_RULES.wire.cost['parts'] ?? 0));
    const rail = await line(server, kid, mapId, at, 'rail');
    expect(rail.statusCode, rail.body).toBe(201);
    const again = await line(server, kid, mapId, at, 'rail');
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).message).toBe("There's a rail here already!");

    const raised = await line(server, kid, mapId, at, 'rail', '/upgrade');
    expect(raised.statusCode, raised.body).toBe(200);
    expect(lineOf(raised).line).toEqual({ level: 2 });
    const top = await line(server, kid, mapId, at, 'rail', '/upgrade');
    expect(top.statusCode).toBe(409);
    expect(errorOf(top).message).toBe('This rail is as tidy as it gets! ✨');
    const wireTop = await line(server, kid, mapId, at, 'wire', '/upgrade');
    expect(wireTop.statusCode).toBe(409);

    const view = LinesViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/lines`, kid)).json(),
    );
    // No Windmill yet: the wire carries nothing.
    expect(view.lines).toEqual([
      { q: at.q, r: at.r, kind: 'rail', ownerUserId: kid.id, level: 2 },
      { q: at.q, r: at.r, kind: 'wire', ownerUserId: kid.id, level: 1, powered: false },
    ]);
    const [built] = await eventsOf(mapId, 'line.built');
    expect(parseGameEventPayload('line.built', built!.payload)).toMatchObject({ kind: 'wire' });

    const railBack = await line(server, kid, mapId, at, 'rail', '/remove');
    expect(railBack.statusCode, railBack.body).toBe(200);
    expect(lineOf(railBack)).toMatchObject({ line: null, refund: refundOf('rail', 2) });
    const wireBack = await line(server, kid, mapId, at, 'wire', '/remove');
    expect(lineOf(wireBack)).toMatchObject({ line: null, refund: refundOf('wire', 1) });
    const both: Record<string, number> = { ...refundOf('rail', 2) };
    for (const [id, n] of Object.entries(refundOf('wire', 1))) both[id] = (both[id] ?? 0) + n;
    expect(await ledgerOf(mapId, kid.id, 'line-refund')).toEqual(both);
    expect(await linesOf(mapId)).toEqual([]);
    const gone = await line(server, kid, mapId, at, 'wire', '/remove');
    expect(gone.statusCode).toBe(404);
  });

  it("refuses land that's cut off from home, water and land that isn't mine", async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeClockwork(mapId);
    await give(mapId, kid, { timber: 40, parts: 40 });
    const tiles = await lineFrom(mapId, kid);
    // Mine, but with nothing joining it to home.
    await own(mapId, tiles[3]!, kid.id);
    const cut = await line(server, kid, mapId, tiles[3]!, 'wire');
    expect(cut.statusCode).toBe(403);
    expect(errorOf(cut).message).toBe("Lay wires from land that's joined up to home!");
    const notMine = await line(server, kid, mapId, tiles[4]!, 'rail');
    expect(notMine.statusCode).toBe(403);
    await db.execute(`update tiles set terrain = 'river' where id = '${tiles[1]!.id}'`);
    expect((await line(server, kid, mapId, tiles[1]!, 'wire')).statusCode).toBe(403);
  });

  it('a Sorter unpowered at T1 and repowered at T2 banks exactly its powered minutes', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeClockwork(mapId);
    await give(mapId, kid, { parts: 40 });
    const tiles = await lineFrom(mapId, kid);
    for (const t of tiles.slice(2, 5)) await own(mapId, t, kid.id);
    const T0 = new Date(clock);
    await put(mapId, kid, tiles[2]!, 'windmill');
    const sorter = await put(mapId, kid, tiles[4]!, 'sorter');
    // A wire between them joins the Sorter (next to it).
    expect((await line(server, kid, mapId, tiles[3]!, 'wire')).statusCode).toBe(201);
    expect((await buildingRow(sorter))?.unpoweredSince).toBeNull();
    const view = LinesViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/lines`, kid)).json(),
    );
    expect(view.lines[0]).toMatchObject({ kind: 'wire', powered: true });

    const T1 = new Date(T0.getTime() + 2 * HOUR_MS + 10 * 60_000);
    clock.setTime(T1.getTime());
    expect((await line(server, kid, mapId, tiles[3]!, 'wire', '/remove')).statusCode).toBe(200);
    expect((await buildingRow(sorter))?.unpoweredSince).toEqual(T1);
    const [off] = await eventsOf(mapId, 'building.unpowered');
    expect(parseGameEventPayload('building.unpowered', off!.payload)).toMatchObject({
      userId: kid.id,
      buildingRowId: sorter,
    });
    // While unpowered nothing more counts: still the cycles before T1.
    const mid = new Date(T1.getTime() + 4 * HOUR_MS);
    const during = productionAt((await buildingRow(sorter))!, mid, ZONE, null);
    const cycle = (during?.cycleSeconds ?? 0) * 1000;
    expect(cycle).toBeGreaterThan(0);
    expect(during?.progress.cycles).toBe(Math.floor((T1.getTime() - T0.getTime()) / cycle));

    const T2 = new Date(T1.getTime() + 5 * HOUR_MS);
    clock.setTime(T2.getTime());
    expect((await line(server, kid, mapId, tiles[3]!, 'wire')).statusCode).toBe(201);
    const back = (await buildingRow(sorter))!;
    expect(back.unpoweredSince).toBeNull();
    expect(back.producedSince).toEqual(new Date(T2.getTime() - (T1.getTime() - T0.getTime())));
    expect(await eventsOf(mapId, 'building.powered')).toHaveLength(1);
    const now = new Date(T2.getTime() + HOUR_MS + 40 * 60_000);
    const powered = T1.getTime() - T0.getTime() + (now.getTime() - T2.getTime());
    expect(productionAt(back, now, ZONE, null)?.progress.cycles).toBe(Math.floor(powered / cycle));
  });

  it("another owner's Windmill never powers my Sorter", async () => {
    const server = await start();
    const kid = await player();
    const rival = await player();
    const mapId = await patch(server, kid, [rival]);
    await makeClockwork(mapId);
    await give(mapId, kid, { parts: 40 });
    const tiles = await lineFrom(mapId, kid);
    await own(mapId, tiles[2]!, kid.id);
    await own(mapId, tiles[3]!, kid.id);
    await own(mapId, tiles[4]!, rival.id);
    await put(mapId, rival, tiles[4]!, 'windmill');
    const sorter = await put(mapId, kid, tiles[2]!, 'sorter');
    expect((await line(server, kid, mapId, tiles[3]!, 'wire')).statusCode).toBe(201);
    expect((await buildingRow(sorter))?.unpoweredSince).toEqual(clock);
  });

  it("lines come down with captured land, half back, and the loser's Sorter loses power", async () => {
    const server = await start();
    const kid = await player();
    const rival = await player();
    const mapId = await patch(server, kid, [rival]);
    await makeClockwork(mapId);
    const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
      level: 30,
      speciesId: 'emberbun',
    });
    expect(res.statusCode, res.body).toBe(201);
    clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);
    const tiles = await lineFrom(mapId, kid);
    for (const t of tiles.slice(2, 5)) await own(mapId, t, rival.id);
    // The rival's Windmill, wire and rail on the tile the kid wins; a Sorter
    // two tiles on, joined by a wire (laid as their own command would).
    await put(mapId, rival, tiles[2]!, 'windmill');
    const sorter = await put(mapId, rival, tiles[4]!, 'sorter');
    const lay = (t: Tile, kind: 'wire' | 'rail', level = 1) =>
      db
        .insert(tileLines)
        .values({ tileId: t.id, kind, mapId, ownerUserId: rival.id, level, builtAt: clock });
    await lay(tiles[2]!, 'wire');
    await lay(tiles[2]!, 'rail', 2);
    await lay(tiles[3]!, 'wire');

    const { q, r } = tiles[2]!;
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
    expect((await tilesOf(mapId)).find((t) => t.id === tiles[2]!.id)?.ownerUserId).toBe(kid.id);
    const left = await linesOf(mapId);
    expect(left.map((l) => [l.tileId, l.kind])).toEqual([[tiles[3]!.id, 'wire']]);
    const both: Record<string, number> = { ...refundOf('rail', 2) };
    for (const [id, n] of Object.entries(refundOf('wire', 1))) both[id] = (both[id] ?? 0) + n;
    expect(await ledgerOf(mapId, rival.id, 'line-refund')).toEqual(both);
    const removed = (await eventsOf(mapId, 'line.removed')).map((e) =>
      parseGameEventPayload('line.removed', e.payload),
    );
    expect(removed).toHaveLength(2);
    expect(removed.every((p) => p.lost === 'captured' && p.userId === rival.id)).toBe(true);
    // Its Windmill went with the land: the Sorter is cut off from the capture's instant.
    const row = await buildingRow(sorter);
    expect(row?.unpoweredSince).not.toBeNull();
    const [off] = await eventsOf(mapId, 'building.unpowered');
    expect(parseGameEventPayload('building.unpowered', off!.payload)).toMatchObject({
      userId: rival.id,
      buildingRowId: sorter,
    });
  });

  it("quickens a gatherer working a tile with its owner's rail, the better of rail and road", async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeClockwork(mapId);
    await give(mapId, kid, { timber: 40, stone: 40, parts: 40 });
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
    expect((await line(server, kid, mapId, node, 'rail')).statusCode).toBe(201);
    const rail = RAIL_RULES.levels[0]!.speedPercent;
    expect(await speedOf()).toBe(Math.max(100, combinePercents([before, rail])));
    // A Path (slower than a Rail) on the same tile changes nothing.
    expect(
      (await call(server, 'POST', `/maps/${mapId}/roads`, kid, { q: node.q, r: node.r }))
        .statusCode,
    ).toBe(201);
    expect(await speedOf()).toBe(Math.max(100, combinePercents([before, rail])));
  });
});
