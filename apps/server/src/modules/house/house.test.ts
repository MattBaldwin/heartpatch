import {
  ApiErrorSchema,
  HomeResponseSchema,
  HouseViewSchema,
  MapResponseSchema,
  TutorialResponseSchema,
  type HouseView,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { buildings, houseResidents, keepers, sessions, squishies, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { makeHomestead } from '../../../tests/homestead.js';
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
/** Oct 2, noon UTC: before nightfall, so tonight is Oct 2 on a UTC patch. */
const START = '2026-10-02T12:00:00Z';

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)("the Keeper's house, PR A (needs DATABASE_URL)", () => {
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

  async function start(env: Record<string, string> = { HP_HOUSE: 'on' }): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, ...env });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `housekeeper_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'UTC' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
    });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
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

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, { name: 'House Patch', timeZone: 'UTC' });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function join(server: FastifyInstance, owner: Player, friend: Player, mapId: string) {
    const detail = () =>
      call(server, 'GET', `/maps/${mapId}`, owner).then(
        (res) => MapResponseSchema.parse(res.json()).map,
      );
    const code = (await detail()).admin!.invite!.code;
    expect((await call(server, 'POST', '/maps/join', friend, { code })).statusCode).toBe(201);
    const requestId = (await detail()).admin!.requests[0]!.id;
    expect(
      (await call(server, 'POST', `/maps/${mapId}/requests/${requestId}/approve`, owner))
        .statusCode,
    ).toBe(204);
  }

  async function house(server: FastifyInstance, who: Player, mapId: string): Promise<HouseView> {
    const res = await call(server, 'GET', `/maps/${mapId}/house`, who);
    expect(res.statusCode, res.body).toBe(200);
    return HouseViewSchema.parse(res.json());
  }

  /** The player's home tiles, Heart Seed first. */
  async function homeTiles(mapId: string, who: Player) {
    const rows = await db.query.tiles.findMany({
      where: (t, { and, eq, isNotNull }) =>
        and(eq(t.mapId, mapId), eq(t.ownerUserId, who.id), isNotNull(t.homeSlot)),
    });
    expect(rows).toHaveLength(7);
    return rows;
  }

  async function build(
    mapId: string,
    who: Player,
    tileId: string,
    spot: number,
    buildingId: string,
    kind: string,
    fuelledThrough: string | null = null,
  ) {
    await db
      .insert(buildings)
      .values({ mapId, ownerUserId: who.id, tileId, buildingId, kind, spot, fuelledThrough });
  }

  const row = (view: HouseView, kind: string) =>
    view.next!.requirements.find((r) => r.kind === kind)!;

  it('is NOT_FOUND for everyone while the switch is off, and leaves the home without a house', async () => {
    const server = await start({});
    const kid = await player();
    const mapId = await newMap(server, kid);
    const res = await call(server, 'GET', `/maps/${mapId}/house`, kid);
    expect(res.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(res.json()).error.message).toBe("We couldn't find that patch.");
    const home = HomeResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/home`, kid)).json(),
    );
    expect(home.house).toBeUndefined();
  });

  it('shows the house only to testers while the switch is on testers', async () => {
    const tester = await player();
    const kid = await player();
    const server = await start({
      HP_HOUSE: 'testers',
      HP_HOUSE_TESTERS: tester.username.toUpperCase(),
    });
    const mapId = await newMap(server, tester);
    await join(server, tester, kid, mapId);
    expect((await house(server, tester, mapId)).level).toBe(1);
    expect((await call(server, 'GET', `/maps/${mapId}/house`, kid)).statusCode).toBe(404);
    const homeOf = async (who: Player) =>
      HomeResponseSchema.parse((await call(server, 'GET', `/maps/${mapId}/home`, who)).json())
        .house;
    expect(await homeOf(tester)).toEqual({ level: 1 });
    expect(await homeOf(kid)).toBeUndefined();
  });

  it('starts everyone at level 1 with the Snug, and shows what the Playroom needs', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const view = await house(server, kid, mapId);
    expect(view).toMatchObject({ level: 1, levelName: 'The Snug', exterior: 'hut', final: false });
    expect(view.rooms.map((r) => [r.id, r.beds, r.residents])).toEqual([['snug', 2, []]]);
    expect(view.next).toMatchObject({
      level: 2,
      name: 'The Playroom',
      room: { id: 'playroom', beds: 2 },
      final: false,
      cost: { timber: 30, stone: 20 },
      unlocked: false,
      affordable: false,
    });
    // The Seed cap is the first row, and level 2 is open to every Seed.
    expect(view.next!.requirements[0]).toMatchObject({
      kind: 'heartSeedLevel',
      group: 'seed',
      have: 1,
      need: 1,
      done: true,
      line: 'Grow your Heart Seed to level 1 🌱',
    });
    // A new Keeper's home ring is tended land: 7 of the 8 tiles.
    expect(row(view, 'tilesTended')).toMatchObject({ have: 7, need: 8, done: false });
    expect(view.items).toEqual({ timber: 0, stone: 0 });
  });

  it("counts habitats and tonight's lit fires from the server, never the client", async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const [a, b, c] = await homeTiles(mapId, kid);
    await build(mapId, kid, a!.id, 1, 'cozy-meadow', 'habitat');
    await build(mapId, kid, b!.id, 1, 'ember-den', 'habitat');
    await build(mapId, kid, c!.id, 0, 'hearthfire', 'hearthfire', '2026-09-30'); // burnt out
    let view = await house(server, kid, mapId);
    expect(row(view, 'buildingsBuilt')).toMatchObject({ have: 2, need: 2, done: true });
    expect(row(view, 'litFires')).toMatchObject({ have: 0, done: false });
    await db.execute(
      `update buildings set fuelled_through = '2026-10-05' where map_id = '${mapId}'`,
    );
    view = await house(server, kid, mapId);
    expect(row(view, 'litFires')).toMatchObject({ have: 1, done: true });
  });

  it("says affordable once the bag covers the cost, and shows only the cost's items", async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId, userId: kid.id }, { timber: 30, stone: 25, glimmer: 3 }, 'dev-grant'),
    );
    const view = await house(server, kid, mapId);
    expect(view.next!.affordable).toBe(true);
    expect(view.items).toEqual({ timber: 30, stone: 25 });
  });

  /** A happy squishy that lives in the Snug (C moves them in; A2 seeds the row). */
  async function resident(mapId: string, who: Player, contentment = 100) {
    const [row] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: who.id,
        speciesId: 'puddlepuff',
        element: 'water',
        feeling: 'silly',
        contentment,
        contentmentSince: clock,
        contentmentAtLastCare: contentment,
        lastCaredAt: clock,
      })
      .returning({ id: squishies.id });
    await db.insert(houseResidents).values({
      squishyId: row!.id,
      mapId,
      userId: who.id,
      roomId: 'snug',
      movedInAt: clock,
    });
    return row!.id;
  }

  /** Meets every Playroom requirement and fills the bag with its cost. */
  async function readyForPlayroom(mapId: string, who: Player) {
    const [a, b, c] = await homeTiles(mapId, who);
    await build(mapId, who, a!.id, 1, 'cozy-meadow', 'habitat');
    await build(mapId, who, b!.id, 1, 'ember-den', 'habitat');
    await build(mapId, who, c!.id, 0, 'hearthfire', 'hearthfire', '2026-10-09');
    await resident(mapId, who);
    // The home ring (7) and a joined homestead make 8 tended tiles.
    await makeHomestead(db, mapId, who.id, clock);
    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId, userId: who.id }, { timber: 30, stone: 20 }, 'dev-grant'),
    );
  }

  const bag = async (mapId: string, who: Player) =>
    (
      await db.query.inventories.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, who.id)),
      })
    ).reduce<Record<string, number>>((all, r) => ({ ...all, [r.itemId]: r.quantity }), {});

  const buildHouse = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    toLevel: number,
    key: string = crypto.randomUUID(),
  ) =>
    server.inject({
      method: 'POST',
      url: `/api/v1/maps/${mapId}/house/build`,
      headers: { ...HEADERS, 'idempotency-key': key },
      cookies: { [SESSION_COOKIE]: who.token },
      payload: { toLevel },
    });

  it('counts a happy resident, and not one away in a trade', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const id = await resident(mapId, kid);
    expect(row(await house(server, kid, mapId), 'residentsContent')).toMatchObject({
      have: 1,
      done: true,
    });
    const view = await house(server, kid, mapId);
    expect(view.rooms[0]!.residents).toEqual([
      { squishyId: id, since: clock.toISOString(), away: null },
    ]);
    await db.execute(`update squishies set state = 'in-trade' where id = '${id}'`);
    const away = await house(server, kid, mapId);
    expect(row(away, 'residentsContent').have).toBe(0);
    expect(away.rooms[0]!.residents[0]!.away).toBe('in-trade');
  });

  it('builds the Playroom in one go: pays, levels up, tells the patch, and the home shows it', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await readyForPlayroom(mapId, kid);
    const before = await house(server, kid, mapId);
    expect(before.next).toMatchObject({ level: 2, unlocked: true, affordable: true });

    const res = await buildHouse(server, kid, mapId, 2);
    expect(res.statusCode, res.body).toBe(200);
    const after = HouseViewSchema.parse(res.json());
    expect(after).toMatchObject({ level: 2, levelName: 'The Playroom', exterior: 'wing' });
    expect(after.rooms.map((r) => r.id)).toEqual(['snug', 'playroom']);
    expect(after.next).toMatchObject({ level: 3, name: 'The Kitchen' });
    expect(await bag(mapId, kid)).toMatchObject({ timber: 0, stone: 0 });

    const home = HomeResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/home`, kid)).json(),
    );
    expect(home.house).toEqual({ level: 2 });

    const [event] = await db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'house.built')),
    });
    expect(event!.payload).toEqual({ userId: kid.id, level: 2, cost: { timber: 30, stone: 20 } });
    // Everyone on the patch hears it; the bill stays internal.
    expect(publicViewFor(PUBLIC_VIEWS, event!, { userId: crypto.randomUUID() })).toEqual({
      userId: kid.id,
      level: 2,
    });
    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'house-build')),
    });
    expect(ledger.map((l) => [l.itemId, l.delta]).sort()).toEqual([
      ['stone', -20],
      ['timber', -30],
    ]);
  });

  it('refuses a build that is not unlocked, not affordable or not the next level, and spends nothing', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId, userId: kid.id }, { timber: 30, stone: 20 }, 'dev-grant'),
    );
    const unmet = await buildHouse(server, kid, mapId, 2);
    expect(unmet.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(unmet.json()).error.message).toBe(
      'Not quite yet! Check what the house needs.',
    );
    expect((await buildHouse(server, kid, mapId, 3)).statusCode).toBe(409);
    expect(await bag(mapId, kid)).toMatchObject({ timber: 30, stone: 20 });
    expect((await house(server, kid, mapId)).level).toBe(1);

    // Every requirement met but short on Stone: still nothing spent.
    const other = await player();
    const theirs = await newMap(server, other);
    await readyForPlayroom(theirs, other);
    await db.execute(
      `update inventories set quantity = 5 where map_id = '${theirs}' and item_id = 'stone'`,
    );
    const short = await buildHouse(server, other, theirs, 2);
    expect(short.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(short.json()).error.message).toMatch(/Stone/);
    expect(await bag(theirs, other)).toMatchObject({ timber: 30, stone: 5 });
  });

  it('re-checks every requirement in the build, never trusting the screen it sent', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await readyForPlayroom(mapId, kid);
    expect((await house(server, kid, mapId)).next!.unlocked).toBe(true);
    // The fire burns out before the tap lands.
    await db.execute(
      `update buildings set fuelled_through = '2026-09-30' where map_id = '${mapId}' and kind = 'hearthfire'`,
    );
    expect((await buildHouse(server, kid, mapId, 2)).statusCode).toBe(409);
    expect(await bag(mapId, kid)).toMatchObject({ timber: 30, stone: 20 });
  });

  it('caps the house at the Heart Seed: the Kitchen waits for Seed level 2', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await readyForPlayroom(mapId, kid);
    expect((await buildHouse(server, kid, mapId, 2)).statusCode).toBe(200);
    const view = await house(server, kid, mapId);
    expect(view.next!.requirements[0]).toMatchObject({ kind: 'heartSeedLevel', have: 1, need: 2 });
    const res = await buildHouse(server, kid, mapId, 3);
    expect(ApiErrorSchema.parse(res.json()).error.message).toBe(
      'Your Heart Seed needs to grow first 🌱',
    );
  });

  it('replays a retried build (Idempotency-Key) without paying or levelling twice', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await readyForPlayroom(mapId, kid);
    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId, userId: kid.id }, { timber: 30, stone: 20 }, 'dev-grant'),
    );
    const first = await buildHouse(server, kid, mapId, 2, 'house-1');
    const again = await buildHouse(server, kid, mapId, 2, 'house-1');
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(await bag(mapId, kid)).toMatchObject({ timber: 30, stone: 20 });
    const built = await db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'house.built')),
    });
    expect(built).toHaveLength(1);
  });

  it('builds once when two taps race for the same level', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await readyForPlayroom(mapId, kid);
    await withTransaction(db, (tx) =>
      grantItems(tx, { mapId, userId: kid.id }, { timber: 30, stone: 20 }, 'dev-grant'),
    );
    const results = await Promise.all([
      buildHouse(server, kid, mapId, 2),
      buildHouse(server, kid, mapId, 2),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await bag(mapId, kid)).toMatchObject({ timber: 30, stone: 20 });
  });

  it('resets the house when its Keeper leaves the patch', async () => {
    const server = await start();
    const owner = await player();
    const kid = await player();
    const mapId = await newMap(server, owner);
    await join(server, owner, kid, mapId);
    await readyForPlayroom(mapId, kid);
    expect((await buildHouse(server, kid, mapId, 2)).statusCode).toBe(200);
    expect((await call(server, 'POST', `/maps/${mapId}/leave`, kid)).statusCode).toBe(204);
    expect(
      await db.query.keeperHouses.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
      }),
    ).toEqual([]);
    expect(
      await db.query.houseResidents.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
      }),
    ).toEqual([]);
  });

  it("has no house on the Tutorial Glade, nor for someone else's patch", async () => {
    const server = await start();
    const kid = await player();
    const started = await call(server, 'POST', '/tutorial/start', kid);
    const glade = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
    expect((await call(server, 'GET', `/maps/${glade}/house`, kid)).statusCode).toBe(404);
    // …and the Glade's home offers none, so no cottage appears there.
    const gladeHome = await call(server, 'GET', `/maps/${glade}/home`, kid);
    expect(gladeHome.statusCode).toBe(200);
    expect(HomeResponseSchema.parse(gladeHome.json()).house).toBeUndefined();
    const other = await player();
    const theirs = await newMap(server, other);
    expect((await call(server, 'GET', `/maps/${theirs}/house`, kid)).statusCode).toBe(404);
  });
});
