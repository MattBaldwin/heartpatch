import {
  ApiErrorSchema,
  CareListResponseSchema,
  HomeResponseSchema,
  HouseViewSchema,
  JobsViewSchema,
  MapResponseSchema,
  TutorialResponseSchema,
  type HouseView,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import {
  buildings,
  houseResidents,
  keeperHouses,
  keepers,
  sessions,
  squishies,
  tileDefenders,
  users,
} from '../../db/schema.js';
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

  it('stops counting a resident once another Keeper owns the squishy', async () => {
    const server = await start();
    const owner = await player();
    const kid = await player();
    const mapId = await newMap(server, owner);
    await join(server, owner, kid, mapId);
    const id = await resident(mapId, kid);
    expect(row(await house(server, kid, mapId), 'residentsContent').have).toBe(1);
    await db.execute(`update squishies set owner_user_id = '${owner.id}' where id = '${id}'`);
    const view = await house(server, kid, mapId);
    expect(row(view, 'residentsContent').have).toBe(0);
    expect(view.rooms[0]!.residents).toEqual([]);
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

  describe('residents (PR C)', () => {
    const HOUR_MS = 60 * 60 * 1000;
    const later = (hours: number) => clock.setTime(clock.getTime() + hours * HOUR_MS);

    /** A content squishy of mine, resting at home, checkpointed now. */
    async function pet(mapId: string, who: Player, nickname: string | null = null) {
      const [row] = await db
        .insert(squishies)
        .values({
          mapId,
          ownerUserId: who.id,
          speciesId: 'puddlepuff',
          element: 'water',
          feeling: 'silly',
          nickname,
          contentment: 100,
          contentmentSince: clock,
        })
        .returning({ id: squishies.id });
      return row!.id;
    }

    const move = (
      server: FastifyInstance,
      who: Player,
      mapId: string,
      squishyId: string,
      roomId: string | null,
      key: string = crypto.randomUUID(),
    ) =>
      server.inject({
        method: 'POST',
        url: `/api/v1/maps/${mapId}/house/residents`,
        headers: { ...HEADERS, 'idempotency-key': key },
        cookies: { [SESSION_COOKIE]: who.token },
        payload: { squishyId, roomId },
      });

    const moveOk = async (...args: Parameters<typeof move>) => {
      const res = await move(...args);
      expect(res.statusCode, res.body).toBe(200);
      return HouseViewSchema.parse(res.json());
    };

    const refused = async (pending: ReturnType<typeof move>) => {
      const res = await pending;
      expect(res.statusCode, res.body).toBe(409);
      return ApiErrorSchema.parse(res.json()).error.message;
    };

    const squishyRow = async (id: string) =>
      (await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
    const residencyOf = (id: string) =>
      db.query.houseResidents.findFirst({ where: (t, { eq }) => eq(t.squishyId, id) });
    const movedEvents = (mapId: string) =>
      db.query.gameEvents.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'resident.moved')),
        orderBy: (t, { asc }) => [asc(t.seq)],
      });
    const careOf = async (server: FastifyInstance, who: Player, mapId: string, id: string) =>
      CareListResponseSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/care`, who)).json(),
      ).squishies.find((s) => s.id === id)!;
    const snug = (view: HouseView) => view.rooms.find((r) => r.id === 'snug')!;

    it('moves a squishy in: a bed, its event, a checkpoint first, and the perk from then on', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await pet(mapId, kid);
      const rester = await pet(mapId, kid);
      later(6); // six hours resting: a quarter of the range at the normal rate
      const view = await moveOk(server, kid, mapId, id, 'snug');
      expect(snug(view).residents).toEqual([
        { squishyId: id, since: clock.toISOString(), away: null },
      ]);
      // The time before counted at the old rate, written before the move.
      expect(await squishyRow(id)).toMatchObject({ contentment: 75, contentmentSince: clock });
      const [event] = await movedEvents(mapId);
      expect(event!.payload).toEqual({
        userId: kid.id,
        squishyId: id,
        roomId: 'snug',
        fromRoomId: null,
      });
      // The patch hears who moved where, never the room it left.
      expect(publicViewFor(PUBLIC_VIEWS, event!, { userId: crypto.randomUUID() })).toEqual({
        userId: kid.id,
        squishyId: id,
        roomId: 'snug',
      });
      // Twelve hours on: the resident fades at half the rate, the rester at the full one.
      later(12);
      expect((await careOf(server, kid, mapId, id)).contentment).toBe(50);
      expect((await careOf(server, kid, mapId, rester)).contentment).toBe(25);
      // Every read that shows a squishy says where it lives.
      expect((await careOf(server, kid, mapId, id)).houseRoomId).toBe('snug');
      expect((await careOf(server, kid, mapId, rester)).houseRoomId).toBeNull();
      const jobs = JobsViewSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/jobs`, kid)).json(),
      );
      expect(jobs.squishies.find((s) => s.squishy.id === id)!.houseRoomId).toBe('snug');
      const home = HomeResponseSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/home`, kid)).json(),
      );
      expect(home.squishies.find((s) => s.id === id)!.houseRoomId).toBe('snug');
      expect(home.squishies.find((s) => s.id === rester)!.houseRoomId).toBeNull();
    });

    it('moves out for free with a checkpoint, frees the bed at once, and holds a move back in for 24 h', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const mochi = await pet(mapId, kid, 'Mochi');
      const other = await pet(mapId, kid);
      const third = await pet(mapId, kid);
      await moveOk(server, kid, mapId, mochi, 'snug');
      await moveOk(server, kid, mapId, other, 'snug');
      later(12); // half the rate while it lived there
      const out = await moveOk(server, kid, mapId, mochi, null);
      expect(snug(out).residents.map((r) => r.squishyId)).toEqual([other]);
      expect(await squishyRow(mochi)).toMatchObject({ contentment: 75, contentmentSince: clock });
      expect(await residencyOf(mochi)).toMatchObject({
        roomId: null,
        movedInAt: null,
        movedOutAt: clock,
      });
      expect((await movedEvents(mapId)).at(-1)!.payload).toEqual({
        userId: kid.id,
        squishyId: mochi,
        roomId: null,
        fromRoomId: 'snug',
      });
      // From the move out on, it fades at the normal rate again.
      later(6);
      expect((await careOf(server, kid, mapId, mochi)).contentment).toBe(50);
      // The bed is free for someone else at once…
      await moveOk(server, kid, mapId, third, 'snug');
      // …but Mochi waits a day to move back in.
      expect(await refused(move(server, kid, mapId, mochi, 'snug'))).toBe(
        'Mochi just moved out. Let them stretch their legs first!',
      );
      later(18);
      await moveOk(server, kid, mapId, third, null);
      const back = await moveOk(server, kid, mapId, mochi, 'snug');
      expect(
        snug(back)
          .residents.map((r) => r.squishyId)
          .sort(),
      ).toEqual([mochi, other].sort());
      // Moving out of a house it isn't in changes nothing.
      const events = (await movedEvents(mapId)).length;
      await moveOk(server, kid, mapId, third, null);
      expect(await movedEvents(mapId)).toHaveLength(events);
    });

    it('says a full room is full, and refuses squishies at a post, in the Hollow, or not mine', async () => {
      const server = await start();
      const owner = await player();
      const kid = await player();
      const mapId = await newMap(server, owner);
      await join(server, owner, kid, mapId);
      const [a, b, c] = [await pet(mapId, kid), await pet(mapId, kid), await pet(mapId, kid)];
      await moveOk(server, kid, mapId, a, 'snug');
      await moveOk(server, kid, mapId, b, 'snug');
      expect(await refused(move(server, kid, mapId, c, 'snug'))).toBe(
        'The Snug is full! Pick another room.',
      );
      expect(await refused(move(server, kid, mapId, c, 'playroom'))).toBe(
        "That room isn't built yet. Grow the house first! 🌱",
      );
      await moveOk(server, kid, mapId, b, null);
      await db.execute(`update squishies set state = 'in-trade' where id = '${c}'`);
      expect(await refused(move(server, kid, mapId, c, 'snug'))).toBe(
        'That squishy is waiting at a trading post right now. 📬',
      );
      await db.execute(`update squishies set state = 'hollowed' where id = '${c}'`);
      expect(await refused(move(server, kid, mapId, c, 'snug'))).toBe(
        'That squishy is in the Hollow right now. Rescue them first!',
      );
      const theirs = await pet(mapId, owner);
      const notMine = await move(server, kid, mapId, theirs, 'snug');
      expect(notMine.statusCode).toBe(404);
      expect(ApiErrorSchema.parse(notMine.json()).error.message).toBe(
        "We couldn't find that squishy.",
      );
      expect(await residencyOf(theirs)).toBeUndefined();
      // A refused move writes no event.
      expect(await movedEvents(mapId)).toHaveLength(3);
    });

    it('gives the last bed to one of two moves racing for it', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const [a, b, c] = [await pet(mapId, kid), await pet(mapId, kid), await pet(mapId, kid)];
      await moveOk(server, kid, mapId, a, 'snug');
      const results = await Promise.all([
        move(server, kid, mapId, b, 'snug'),
        move(server, kid, mapId, c, 'snug'),
      ]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const lost = results.find((r) => r.statusCode === 409)!;
      expect(ApiErrorSchema.parse(lost.json()).error.message).toBe(
        'The Snug is full! Pick another room.',
      );
      expect(snug(await house(server, kid, mapId)).residents).toHaveLength(2);
    });

    it('evicts nobody from a room tuned below its residents, and lets no one new in until there is room', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      // Three residents in the two-bed Snug: what a tune-down leaves behind.
      const [a, b, c, d] = [
        await resident(mapId, kid),
        await resident(mapId, kid),
        await resident(mapId, kid),
        await pet(mapId, kid),
      ];
      expect(snug(await house(server, kid, mapId)).residents).toHaveLength(3);
      expect(await refused(move(server, kid, mapId, d, 'snug'))).toBe(
        'The Snug is full! Pick another room.',
      );
      await moveOk(server, kid, mapId, a, null);
      expect(await refused(move(server, kid, mapId, d, 'snug'))).toBe(
        'The Snug is full! Pick another room.',
      );
      await moveOk(server, kid, mapId, b, null);
      const view = await moveOk(server, kid, mapId, d, 'snug');
      expect(
        snug(view)
          .residents.map((r) => r.squishyId)
          .sort(),
      ).toEqual([c, d].sort());
    });

    it('moves between rooms freely, keeping when it first moved in', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await db.insert(keeperHouses).values({
        mapId,
        userId: kid.id,
        level: 2,
        builtAt: clock,
        updatedAt: clock,
      });
      const id = await pet(mapId, kid);
      const movedIn = clock.toISOString();
      await moveOk(server, kid, mapId, id, 'snug');
      later(1);
      const view = await moveOk(server, kid, mapId, id, 'playroom');
      expect(view.rooms.find((r) => r.id === 'playroom')!.residents).toEqual([
        { squishyId: id, since: movedIn, away: null },
      ]);
      expect(snug(view).residents).toEqual([]);
      expect((await movedEvents(mapId)).at(-1)!.payload).toMatchObject({
        roomId: 'playroom',
        fromRoomId: 'snug',
      });
    });

    it('takes over the row a previous Keeper left on a squishy, with no clash and no cooldown of theirs', async () => {
      const server = await start();
      const owner = await player();
      const kid = await player();
      const mapId = await newMap(server, owner);
      await join(server, owner, kid, mapId);
      const id = await pet(mapId, kid);
      // The owner had it before a trade, and moved it out an hour before.
      await db.insert(houseResidents).values({
        squishyId: id,
        mapId,
        userId: owner.id,
        roomId: null,
        movedInAt: null,
        movedOutAt: new Date(clock.getTime() - HOUR_MS),
      });
      await moveOk(server, kid, mapId, id, 'snug');
      expect(await residencyOf(id)).toMatchObject({
        userId: kid.id,
        roomId: 'snug',
        movedOutAt: null,
      });
      // …and a row still saying "in the owner's Snug" is taken over too.
      const other = await pet(mapId, kid);
      await db.insert(houseResidents).values({
        squishyId: other,
        mapId,
        userId: owner.id,
        roomId: 'snug',
        movedInAt: clock,
      });
      expect(snug(await house(server, owner, mapId)).residents).toEqual([]);
      await moveOk(server, kid, mapId, other, 'snug');
      expect(await residencyOf(other)).toMatchObject({ userId: kid.id, roomId: 'snug' });
    });

    it('shows a resident out at its job as away: gathering, on watch or training', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await db.insert(keeperHouses).values({
        mapId,
        userId: kid.id,
        level: 2,
        builtAt: clock,
        updatedAt: clock,
      });
      const [seed, ring] = await homeTiles(mapId, kid);
      const [gatherer, guard, trainee] = [
        await pet(mapId, kid),
        await pet(mapId, kid),
        await pet(mapId, kid),
      ];
      await moveOk(server, kid, mapId, gatherer, 'snug');
      await moveOk(server, kid, mapId, guard, 'snug');
      await moveOk(server, kid, mapId, trainee, 'playroom');
      const at = clock.toISOString();
      await db.execute(
        `update squishies set work_tile_id = '${seed!.id}', work_since = '${at}', work_started_at = '${at}' where id = '${gatherer}'`,
      );
      await db.insert(tileDefenders).values({
        mapId,
        tileId: ring!.id,
        slot: 0,
        squishyId: guard,
        assignedAt: clock,
      });
      const [grounds] = await db
        .insert(buildings)
        .values({
          mapId,
          ownerUserId: kid.id,
          tileId: ring!.id,
          buildingId: 'training-grounds',
          kind: 'training-grounds',
          spot: 1,
        })
        .returning({ id: buildings.id });
      await db.execute(
        `update squishies set training_building_id = '${grounds!.id}', training_since = '${at}' where id = '${trainee}'`,
      );
      const view = await house(server, kid, mapId);
      const away = new Map(
        view.rooms.flatMap((r) => r.residents).map((r) => [r.squishyId, r.away]),
      );
      expect(Object.fromEntries(away)).toEqual({
        [gatherer]: 'gathering',
        [guard]: 'guarding',
        [trainee]: 'training',
      });
    });

    it('replays a retried move (Idempotency-Key) once', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await pet(mapId, kid);
      const first = await move(server, kid, mapId, id, 'snug', 'move-1');
      await moveOk(server, kid, mapId, id, null);
      const again = await move(server, kid, mapId, id, 'snug', 'move-1');
      expect(again.json()).toEqual(first.json());
      expect(await movedEvents(mapId)).toHaveLength(2);
      expect((await residencyOf(id))!.roomId).toBeNull();
    });

    it('is NOT_FOUND while the switch is off', async () => {
      const server = await start({});
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await pet(mapId, kid);
      const res = await move(server, kid, mapId, id, 'snug');
      expect(res.statusCode).toBe(404);
      expect(ApiErrorSchema.parse(res.json()).error.message).toBe("We couldn't find that patch.");
      expect(await residencyOf(id)).toBeUndefined();
    });

    it('writes the checkpoints of residents when their Keeper leaves, before their rows go', async () => {
      const server = await start();
      const owner = await player();
      const kid = await player();
      const mapId = await newMap(server, owner);
      await join(server, owner, kid, mapId);
      const id = await pet(mapId, kid);
      await moveOk(server, kid, mapId, id, 'snug');
      later(12);
      expect((await call(server, 'POST', `/maps/${mapId}/leave`, kid)).statusCode).toBe(204);
      // Twelve hours at the perk's half rate, written at the leave.
      expect(await squishyRow(id)).toMatchObject({ contentment: 75, contentmentSince: clock });
      expect(await residencyOf(id)).toBeUndefined();
    });
  });
});
