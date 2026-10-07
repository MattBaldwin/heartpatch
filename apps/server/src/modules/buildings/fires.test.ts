import {
  ApiErrorSchema,
  FuelAllResponseSchema,
  HollowResponseSchema,
  HomeResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  RemoveBuildingResponseSchema,
  hexDistance,
  hexKey,
  parseGameEventPayload,
  type HomeResponse,
  type MapView,
  type MyBuilding,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, users } from '../../db/schema.js';
import { mapLocalTime } from '../../lib/time.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { litSafeTiles } from './hearthfire.js';
import { relayoutHomes } from './layout.js';
import { createBuildingsRepo } from './repo.js';

/*
 * Hearthfires on captured land (#202) and typed spots (#204): building,
 * fuelling, upgrading and taking down a fire out on owned land, one a tile,
 * Fuel all fires, a leaver's fires, and moving old homes into typed spots.
 * Capture and land going wild have their tests with territory.
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const ZONE = 'America/Denver';
/** Oct 2, 6:00 AM in Denver, before nightfall. */
const START = '2026-10-02T12:00:00Z';
const PLENTY = { timber: 80, stone: 80, emberwood: 40, glimmer: 4 };

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('fires on captured land (needs DATABASE_URL)', () => {
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
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `firekeeper_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
    });
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

  async function newMap(server: FastifyInstance, who: Player, friend?: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, { name: 'Fire Patch', timeZone: ZONE });
    expect(res.statusCode).toBe(201);
    const map = MapResponseSchema.parse(res.json()).map;
    if (friend) {
      const join = await call(server, 'POST', '/maps/join', friend, {
        code: map.admin!.invite!.code,
      });
      expect(join.statusCode).toBe(201);
      const detail = MapResponseSchema.parse(
        (await call(server, 'GET', `/maps/${map.id}`, who)).json(),
      ).map;
      const approve = `/maps/${map.id}/requests/${detail.admin!.requests[0]!.id}/approve`;
      expect((await call(server, 'POST', approve, who)).statusCode).toBe(204);
    }
    return map.id;
  }

  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));

  async function home(server: FastifyInstance, who: Player, mapId: string): Promise<HomeResponse> {
    const res = await call(server, 'GET', `/maps/${mapId}/home`, who);
    expect(res.statusCode).toBe(200);
    return HomeResponseSchema.parse(res.json());
  }

  async function view(server: FastifyInstance, who: Player, mapId: string): Promise<MapView> {
    return MapViewSchema.parse((await call(server, 'GET', `/maps/${mapId}/view`, who)).json());
  }

  /** Neutral outer tiles handed to `who` (as if claimed): `count` without a node, and one with. */
  async function land(mapId: string, who: Player, count: number) {
    const wild = await db.query.tiles.findMany({
      where: (t, { and, eq, isNull }) =>
        and(eq(t.mapId, mapId), isNull(t.homeSlot), isNull(t.ownerUserId)),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
    const plain = wild.filter((t) => t.nodeResource === null).slice(0, count);
    const node = wild.find((t) => t.nodeResource !== null)!;
    for (const t of [...plain, node]) {
      await db.execute(`update tiles set owner_user_id = '${who.id}' where id = '${t.id}'`);
    }
    return { plain, node };
  }

  const place = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    body: { buildingId: string; q: number; r: number; spot: number },
  ) => call(server, 'POST', `/maps/${mapId}/buildings`, who, body);

  async function placed(
    server: FastifyInstance,
    who: Player,
    mapId: string,
    body: { buildingId: string; q: number; r: number; spot: number },
  ): Promise<MyBuilding> {
    const res = await place(server, who, mapId, body);
    expect(res.statusCode, res.body).toBe(201);
    return HomeResponseSchema.parse(res.json()).buildings.find(
      (b) => b.q === body.q && b.r === body.r && b.spot === body.spot,
    )!;
  }

  const fire = (t: { q: number; r: number }) => ({
    buildingId: 'hearthfire',
    q: t.q,
    r: t.r,
    spot: 0,
  });
  const fuel = (server: FastifyInstance, who: Player, mapId: string, id: string, nights: number) =>
    call(server, 'POST', `/maps/${mapId}/buildings/${id}/fuel`, who, { nights });
  const fuelAll = (server: FastifyInstance, who: Player, mapId: string) =>
    call(server, 'POST', `/maps/${mapId}/buildings/fuel-all`, who);
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  it('builds, fuels, upgrades and takes down a fire on captured land, and everyone sees it', async () => {
    const server = await start();
    const [kid, friend] = [await player(), await player()];
    const mapId = await newMap(server, kid, friend);
    await give(mapId, kid, PLENTY);
    const { plain } = await land(mapId, kid, 1);
    const tile = plain[0]!;

    const lit = await placed(server, kid, mapId, fire(tile));
    expect(lit).toMatchObject({ buildingId: 'hearthfire', level: 1, safeRadius: 1, lit: false });
    expect((await fuel(server, kid, mapId, lit.id, 3)).statusCode).toBe(200);
    const up = await call(server, 'POST', `/maps/${mapId}/buildings/${lit.id}/upgrade`, kid);
    expect(up.statusCode, up.body).toBe(200);
    expect(
      HomeResponseSchema.parse(up.json()).buildings.find((b) => b.id === lit.id),
    ).toMatchObject({ level: 2, safeRadius: 2, nightsLeft: 3, lit: true });

    // On the shared map, like guards.
    const shown = (await view(server, friend, mapId)).tiles.find(
      (t) => t.q === tile.q && t.r === tile.r,
    )!;
    expect(shown.buildings).toEqual([
      expect.objectContaining({ id: lit.id, spot: 0, lit: true, safeRadius: 2 }),
    ]);

    // Its light reaches 2 tiles round it (homes are safe on their own).
    const fires = await createBuildingsRepo(db).listOnMap(mapId);
    const safe = litSafeTiles(fires, [], mapLocalTime(clock, ZONE));
    expect(safe.has(hexKey(tile))).toBe(true);
    expect(
      [...safe].every((key) => {
        const [q, r] = key.split(',').map(Number);
        return hexDistance({ q: q!, r: r! }, tile) <= 2;
      }),
    ).toBe(true);

    // Take it down: half of what it cost (build and upgrade) plus unburned fuel.
    const before = (await home(server, kid, mapId)).items;
    const down = await call(server, 'POST', `/maps/${mapId}/buildings/${lit.id}/remove`, kid);
    expect(down.statusCode).toBe(200);
    expect(RemoveBuildingResponseSchema.parse(down.json()).refund).toEqual({
      timber: 7,
      stone: 7,
      emberwood: 3,
    });
    const after = (await home(server, kid, mapId)).items;
    expect(after['emberwood']).toBe((before['emberwood'] ?? 0) + 3);
  });

  it('allows one fire a tile, on your own land, in its middle (server and database)', async () => {
    const server = await start();
    const [kid, friend] = [await player(), await player()];
    const mapId = await newMap(server, kid, friend);
    await give(mapId, kid, PLENTY);
    await give(mapId, friend, PLENTY);
    const { plain, node } = await land(mapId, kid, 2);

    const first = await placed(server, kid, mapId, fire(plain[0]!));
    // A second fire on that tile: refused before the spot check. The database
    // backs it up: fires stand only in the middle, and a tile has one middle
    // (`buildings_tile_id_spot_key`).
    const again = await place(server, kid, mapId, { ...fire(plain[0]!), spot: 0 });
    expect(again.statusCode).toBe(409);
    await expect(
      db.insert(buildings).values({
        mapId,
        ownerUserId: kid.id,
        tileId: (await db.query.buildings.findFirst({
          where: (t, { eq }) => eq(t.id, first.id),
        }))!.tileId,
        buildingId: 'jack-o-lantern-hearthfire',
        kind: 'hearthfire',
        spot: 0,
      }),
    ).rejects.toThrow();
    // Only the middle, and not a node's.
    const ring = await place(server, kid, mapId, { ...fire(plain[1]!), spot: 2 });
    expect(errorOf(ring).message).toBe('Hearthfires go in the middle of a tile!');
    const onNode = await place(server, kid, mapId, fire(node));
    expect(errorOf(onNode).message).toBe(
      'The middle of this tile is taken. A fire next door can reach it!',
    );
    // Not someone else's land, not wild land, and no habitats out here.
    const notMine = await place(server, friend, mapId, fire(plain[1]!));
    expect(notMine.statusCode).toBe(403);
    expect(errorOf(notMine).message).toBe('You can only build on your own land.');
    const meadow = await place(server, kid, mapId, {
      buildingId: 'cozy-meadow',
      q: plain[1]!.q,
      r: plain[1]!.r,
      spot: 1,
    });
    expect(errorOf(meadow).message).toBe('You can only build on your home base.');
    // An outer fire stays put.
    const move = await call(server, 'POST', `/maps/${mapId}/buildings/${first.id}/move`, kid, {
      q: plain[1]!.q,
      r: plain[1]!.r,
      spot: 0,
    });
    expect(errorOf(move).message).toMatch(/stays where it is/);
    // Another of my tiles takes its own fire.
    expect((await placed(server, kid, mapId, fire(plain[1]!))).id).toBeDefined();
  });

  it('fuels every fire at once, lowest first, and stops when the bag runs out', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await give(mapId, kid, { timber: 30, stone: 30, emberwood: 6 });
    const { plain } = await land(mapId, kid, 3);
    const ids = [];
    for (const t of plain) ids.push((await placed(server, kid, mapId, fire(t))).id);
    expect((await fuel(server, kid, mapId, ids[0]!, 4)).statusCode).toBe(200);
    // Bag: 2 Emberwood; nights 4 / 0 / 0. Lowest first: the two empty fires get one each.
    const short = await fuelAll(server, kid, mapId);
    expect(short.statusCode, short.body).toBe(200);
    const res = FuelAllResponseSchema.parse(short.json());
    expect(res).toMatchObject({ fires: 2, nights: 2, short: true });
    const nights = (id: string) => res.home.buildings.find((b) => b.id === id)!.nightsLeft;
    expect(ids.map(nights)).toEqual([4, 1, 1]);
    expect(res.home.items['emberwood'] ?? 0).toBe(0);
    const fueled = (await eventsOf(mapId)).filter((e) => e.type === 'building.fueled');
    expect(fueled).toHaveLength(3);

    // An empty bag: the usual "You need … first!", nothing changes.
    const empty = await fuelAll(server, kid, mapId);
    expect(empty.statusCode).toBe(409);
    expect(errorOf(empty).message).toMatch(/^You need 1 more/);

    // Enough for everything: every fire full, and then there's nothing to do.
    await give(mapId, kid, { emberwood: 20 });
    const full = FuelAllResponseSchema.parse((await fuelAll(server, kid, mapId)).json());
    expect(full).toMatchObject({ fires: 3, nights: 1 + 4 + 4, short: false });
    expect(full.home.items['emberwood']).toBe(11);
    const done = await fuelAll(server, kid, mapId);
    expect(errorOf(done).message).toBe('All your fires are full! Come back after a night or two.');
  });

  it('says so when there are no fires to fuel', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const res = await fuelAll(server, kid, mapId);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).message).toBe('You have no fires to fuel yet. Build one first!');
  });

  it("gives a leaver's outer fire back like a lost one, with an event", async () => {
    const server = await start();
    const [kid, friend] = [await player(), await player()];
    const mapId = await newMap(server, kid, friend);
    await give(mapId, friend, { timber: 10, stone: 10, emberwood: 2 });
    const { plain } = await land(mapId, friend, 1);
    const lit = await placed(server, friend, mapId, fire(plain[0]!));
    expect((await fuel(server, friend, mapId, lit.id, 2)).statusCode).toBe(200);

    expect((await call(server, 'POST', `/maps/${mapId}/leave`, friend)).statusCode).toBe(204);
    expect(await db.query.buildings.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) })).toEqual(
      [],
    );
    const bag = await db.query.inventories.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, friend.id)),
    });
    expect(Object.fromEntries(bag.map((b) => [b.itemId, b.quantity]))).toMatchObject({
      timber: 7,
      stone: 7,
      emberwood: 2,
    });
    const removed = (await eventsOf(mapId)).find((e) => e.type === 'building.removed')!;
    expect(parseGameEventPayload('building.removed', removed.payload)).toMatchObject({
      buildingRowId: lit.id,
      refund: { timber: 2, stone: 2, emberwood: 2 },
      lost: 'left',
    });
  });

  it('packs up home fires with everything back, and moves misplaced buildings, once (#202, #204)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const { tiles } = await home(server, kid, mapId);
    const [ring, ring2] = tiles.filter((t) => !t.heartSeed);
    const tileId = async (t: { q: number; r: number }) =>
      (await db.query.tiles.findFirst({
        where: (x, { and, eq }) => and(eq(x.mapId, mapId), eq(x.q, t.q), eq(x.r, t.r)),
      }))!.id;
    // Built before today's rules: a habitat in a middle (its node's), a
    // level-2 fire at home with two nights of fuel, and a Jack-o'-Lantern
    // fire beside it on the same home tile (main allowed one of each per
    // home, on any spot): migration 0027 adds no index they could break.
    const old = (
      buildingId: string,
      kind: string,
      tile: string,
      spot: number,
      extra: { level?: number; fuelledThrough?: string } = {},
    ) =>
      db
        .insert(buildings)
        .values({ mapId, ownerUserId: kid.id, tileId: tile, buildingId, kind, spot, ...extra })
        .returning({ id: buildings.id })
        .then(([row]) => row!.id);
    const den = await old('ember-den', 'habitat', await tileId(ring!), 0);
    const hearth = await old('hearthfire', 'hearthfire', await tileId(ring2!), 3, {
      level: 2,
      fuelledThrough: '2026-10-03',
    });
    const lantern = await old('jack-o-lantern-hearthfire', 'hearthfire', await tileId(ring2!), 4);

    const errors: unknown[] = [];
    // It scans every patch in the database (other tests' too), so only this
    // patch's rows and events are checked.
    await Promise.all([
      relayoutHomes(
        db,
        () => clock,
        (_owner, err) => errors.push(err),
      ),
      relayoutHomes(
        db,
        () => clock,
        (_owner, err) => errors.push(err),
      ),
    ]);
    expect(errors).toEqual([]);
    const rowOf = (id: string) =>
      db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.id, id) });
    expect((await rowOf(den))?.spot).toBe(1);
    expect(await rowOf(hearth)).toBeUndefined();
    expect(await rowOf(lantern)).toBeUndefined();
    // Everything back, whole: both levels' cost, its fuel, and the carved pumpkin.
    const refund = { timber: 15, stone: 15, emberwood: 2, 'jack-o-lantern-hearthfire': 1 };
    const bag = await db.query.inventories.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
    });
    expect(Object.fromEntries(bag.map((b) => [b.itemId, b.quantity]))).toEqual(refund);
    // The morning report's one-time note.
    const status = await call(server, 'GET', `/maps/${mapId}/hollow`, kid);
    expect(HollowResponseSchema.parse(status.json()).hollow.homeFirePacked).toEqual({
      refund,
      at: clock.toISOString(),
    });
    const events = await eventsOf(mapId);
    const packed = events.filter((e) => e.type === 'building.removed');
    expect(packed.map((e) => parseGameEventPayload('building.removed', e.payload).lost)).toEqual([
      'packed',
      'packed',
    ]);
    expect(events.filter((e) => e.type === 'building.moved')).toHaveLength(1);
    // Run again: nothing left to do here.
    await relayoutHomes(
      db,
      () => clock,
      () => undefined,
    );
    expect(await eventsOf(mapId)).toHaveLength(events.length);
  });
});
