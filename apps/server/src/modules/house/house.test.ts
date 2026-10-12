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
import { buildings, keepers, sessions, squishies, users } from '../../db/schema.js';
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

  it('counts residents as none until residents land (A2/C)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    await db.insert(squishies).values({
      mapId,
      ownerUserId: kid.id,
      speciesId: 'puddlepuff',
      element: 'water',
      feeling: 'silly',
    });
    expect(row(await house(server, kid, mapId), 'residentsContent')).toMatchObject({
      have: 0,
      need: 1,
    });
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
