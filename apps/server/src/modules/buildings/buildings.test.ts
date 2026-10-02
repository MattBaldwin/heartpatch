import {
  ApiErrorSchema,
  GAME_DATA,
  HOME_BASE_RULES,
  HomeResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  RemoveBuildingResponseSchema,
  type HomeResponse,
  type MapView,
  type MyBuilding,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, squishies, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { mapLocalTime } from './hearthfire.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const ZONE = 'America/Denver';
/** Oct 2, 6:00 AM in Denver: in the Halloween window, before nightfall. */
const START = '2026-10-02T12:00:00Z';
const PLENTY = { timber: 50, stone: 50, emberwood: 20 };

const building = (id: string) => GAME_DATA.buildings.find((b) => b.id === id)!;

describe('mapLocalTime (map-local wall clock)', () => {
  it('follows daylight saving in the map time zone', () => {
    // Denver falls back on Nov 1, 2026: 21:00 is 03:00Z before and 04:00Z after.
    expect(mapLocalTime(new Date('2026-10-31T03:00:00Z'), ZONE)).toEqual({
      date: '2026-10-30',
      minute: 21 * 60,
    });
    expect(mapLocalTime(new Date('2026-11-02T04:00:00Z'), ZONE)).toEqual({
      date: '2026-11-01',
      minute: 21 * 60,
    });
    expect(mapLocalTime(new Date('2026-11-02T03:59:00Z'), ZONE).minute).toBe(20 * 60 + 59);
    // Spring forward, Mar 8 2026: 21:00 MDT is 03:00Z.
    expect(mapLocalTime(new Date('2026-03-09T03:00:00Z'), ZONE)).toEqual({
      date: '2026-03-08',
      minute: 21 * 60,
    });
    expect(mapLocalTime(new Date('2026-10-02T05:30:00Z'), 'Asia/Kolkata')).toEqual({
      date: '2026-10-02',
      minute: 11 * 60,
    });
    expect(mapLocalTime(new Date('2026-10-02T06:00:00Z'), 'UTC').minute).toBe(6 * 60);
  });
});

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('buildings (needs DATABASE_URL)', () => {
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

  async function login(userId: string): Promise<string> {
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId, tokenHash, expiresAt: new Date(Date.parse(START) + 365 * DAY_MS) });
    return token;
  }

  async function player(): Promise<Player> {
    const username = `builder_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, username, token: await login(user!.id) };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player | null,
    payload?: object,
    headers: Record<string, string> = {},
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...HEADERS, ...headers },
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, { name: 'Home Patch', timeZone: ZONE });
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
    const approve = `/maps/${mapId}/requests/${requestId}/approve`;
    expect((await call(server, 'POST', approve, owner)).statusCode).toBe(204);
  }

  async function view(server: FastifyInstance, who: Player, mapId: string): Promise<MapView> {
    const res = await call(server, 'GET', `/maps/${mapId}/view`, who);
    expect(res.statusCode).toBe(200);
    return MapViewSchema.parse(res.json());
  }

  async function home(server: FastifyInstance, who: Player, mapId: string): Promise<HomeResponse> {
    const res = await call(server, 'GET', `/maps/${mapId}/home`, who);
    expect(res.statusCode).toBe(200);
    return HomeResponseSchema.parse(res.json());
  }

  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));

  /** A plain home tile (no Heart Seed, no node) and the Heart Seed tile. */
  async function homeTiles(server: FastifyInstance, who: Player, mapId: string) {
    const { tiles } = await home(server, who, mapId);
    expect(tiles).toHaveLength(7);
    const seed = tiles.find((t) => t.heartSeed)!;
    const plain = tiles.filter((t) => !t.heartSeed && t.nodeResource === null);
    expect(plain.length).toBeGreaterThan(0);
    const at = (t: { q: number; r: number }) => ({ q: t.q, r: t.r });
    return { seed: at(seed), plain: at(plain[0]!), tiles };
  }

  const place = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    body: { buildingId: string; q: number; r: number; spot: number },
    headers: Record<string, string> = {},
  ) => call(server, 'POST', `/maps/${mapId}/buildings`, who, body, headers);

  async function placed(
    server: FastifyInstance,
    who: Player,
    mapId: string,
    body: { buildingId: string; q: number; r: number; spot: number },
  ): Promise<MyBuilding> {
    const res = await place(server, who, mapId, body);
    expect(res.statusCode, res.body).toBe(201);
    const found = HomeResponseSchema.parse(res.json()).buildings.find(
      (b) => b.q === body.q && b.r === body.r && b.spot === body.spot,
    );
    expect(found).toBeDefined();
    return found!;
  }

  const fuel = (server: FastifyInstance, who: Player, mapId: string, id: string, nights: number) =>
    call(server, 'POST', `/maps/${mapId}/buildings/${id}/fuel`, who, { nights });

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  /** Every balance equals the sum of its ledger rows (tech spec §4). */
  async function reconciled(mapId: string, userId: string) {
    const [balances, ledger] = await Promise.all([
      db.query.inventories.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
      }),
      db.query.resourceLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
        orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
      }),
    ]);
    const sums: Record<string, number> = {};
    for (const row of ledger) sums[row.itemId] = (sums[row.itemId] ?? 0) + row.delta;
    expect(Object.fromEntries(balances.map((b) => [b.itemId, b.quantity]))).toEqual(sums);
    return ledger;
  }

  async function squishy(mapId: string, who: Player, state: 'active' | 'hollowed' = 'active') {
    const [row] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: who.id,
        speciesId: 'test-squishy',
        element: 'fire',
        feeling: 'cozy',
        state,
      })
      .returning({ id: squishies.id });
    return row!.id;
  }

  describe('access', () => {
    it('needs a logged-in member', async () => {
      const server = await start();
      const [kid, stranger] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      expect((await call(server, 'GET', `/maps/${mapId}/home`, null)).statusCode).toBe(401);
      const probe = await call(server, 'GET', `/maps/${mapId}/home`, stranger);
      expect(probe.statusCode).toBe(404);
      const { plain } = await homeTiles(server, kid, mapId);
      const build = await place(server, stranger, mapId, {
        buildingId: 'hearthfire',
        q: plain.q,
        r: plain.r,
        spot: 1,
      });
      expect(build.statusCode).toBe(404);
    });
  });

  describe('placing', () => {
    it('builds a Hearthfire on a home spot, pays in the same transaction and shows everyone', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, PLENTY);
      const { seed } = await homeTiles(server, kid, mapId);

      // The Heart Seed stands in the middle of its tile: spot 0 is taken there.
      const middle = await place(server, kid, mapId, {
        buildingId: 'hearthfire',
        q: seed.q,
        r: seed.r,
        spot: 0,
      });
      expect(middle.statusCode).toBe(409);
      expect(errorOf(middle).message).toBe('Something is already there. Try another spot!');

      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        q: seed.q,
        r: seed.r,
        spot: 2,
      });
      expect(fire).toMatchObject({
        buildingId: 'hearthfire',
        kind: 'hearthfire',
        level: 1,
        lit: false,
        safeRadius: 1,
        nightsLeft: 0,
        fuelSpace: 5,
        capacity: null,
        residents: null,
      });
      const after = await home(server, kid, mapId);
      expect(after.items).toMatchObject({ timber: 45, stone: 45 });
      const ledger = await reconciled(mapId, kid.id);
      expect(
        ledger
          .filter((l) => l.reason === 'build')
          .map((l) => [l.itemId, l.delta, l.refId])
          .sort(),
      ).toEqual([
        ['stone', -5, fire.id],
        ['timber', -5, fire.id],
      ]);

      // Fires are public: on the friend's map view too.
      const shown = (await view(server, friend, mapId)).tiles.find(
        (t) => t.q === seed.q && t.r === seed.r,
      )!;
      expect(shown.buildings).toEqual([
        {
          id: fire.id,
          buildingId: 'hearthfire',
          kind: 'hearthfire',
          level: 1,
          spot: 2,
          lit: false,
          safeRadius: 1,
        },
      ]);
      const event = (await eventsOf(mapId)).at(-1)!;
      expect(event).toMatchObject({ type: 'building.placed', actorUserId: kid.id });
      expect(publicViewFor(PUBLIC_VIEWS, event, { userId: friend.id })).toEqual({
        userId: kid.id,
        building: { ...shown.buildings[0], q: seed.q, r: seed.r },
      });
    });

    it('only builds on your own home base, on free spots, within the limits', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const theirs = (await home(server, friend, mapId)).tiles[0]!;
      const wild = (await view(server, kid, mapId)).tiles.find((t) => t.ownerUserId === null)!;

      for (const tile of [theirs, wild]) {
        const res = await place(server, kid, mapId, {
          buildingId: 'cozy-meadow',
          q: tile.q,
          r: tile.r,
          spot: 1,
        });
        expect(res.statusCode).toBe(403);
        expect(errorOf(res).message).toBe('You can only build on your home base.');
      }

      await placed(server, kid, mapId, { buildingId: 'hearthfire', ...plain, spot: 0 });
      const taken = await place(server, kid, mapId, {
        buildingId: 'cozy-meadow',
        q: plain.q,
        r: plain.r,
        spot: 0,
      });
      expect(errorOf(taken).message).toBe('Something is already there. Try another spot!');
      const second = await place(server, kid, mapId, {
        buildingId: 'hearthfire',
        q: plain.q,
        r: plain.r,
        spot: 1,
      });
      expect(second.statusCode).toBe(409);
      expect(errorOf(second).message).toBe('Your home already has all the Hearthfire it can hold!');

      const notYet = await place(server, kid, mapId, {
        buildingId: 'training-grounds',
        q: plain.q,
        r: plain.r,
        spot: 1,
      });
      expect(notYet.statusCode).toBe(409);
      const unknown = await place(server, kid, mapId, {
        buildingId: 'castle',
        q: plain.q,
        r: plain.r,
        spot: 1,
      });
      expect(unknown.statusCode).toBe(404);
    });

    it('refuses when the bag is short, and changes nothing', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, { timber: 1 });
      const { plain } = await homeTiles(server, kid, mapId);
      const res = await place(server, kid, mapId, {
        buildingId: 'ember-den',
        q: plain.q,
        r: plain.r,
        spot: 3,
      });
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).message).toMatch(/^You need/);
      const after = await home(server, kid, mapId);
      expect(after.buildings).toEqual([]);
      expect(after.items).toEqual({ timber: 1 });
    });

    it('builds the Jack-o-Lantern Hearthfire from the crafted item, only around Halloween', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, { 'jack-o-lantern-hearthfire': 1 });
      const { plain } = await homeTiles(server, kid, mapId);
      const body = { buildingId: 'jack-o-lantern-hearthfire', q: plain.q, r: plain.r, spot: 4 };

      clock.setTime(Date.parse('2026-12-15T18:00:00Z'));
      const late = await place(server, kid, mapId, body);
      expect(late.statusCode).toBe(409);
      expect(errorOf(late).message).toBe(
        "Jack-o'-Lantern Hearthfire can only be built around Halloween!",
      );

      clock.setTime(Date.parse('2026-10-31T18:00:00Z'));
      const lantern = await placed(server, kid, mapId, body);
      expect(lantern).toMatchObject({ kind: 'hearthfire', safeRadius: 2 });
      expect(building('jack-o-lantern-hearthfire').season).toBe('halloween');
      expect((await home(server, kid, mapId)).items).toEqual({});
    });

    it('replays a retried build (Idempotency-Key) without paying twice', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const body = { buildingId: 'cozy-meadow', q: plain.q, r: plain.r, spot: 5 };
      const key = { 'idempotency-key': 'build-1' };
      const first = await place(server, kid, mapId, body, key);
      const retry = await place(server, kid, mapId, body, key);
      expect(retry.statusCode).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(first.json());
      expect((await home(server, kid, mapId)).items).toMatchObject({ timber: 46, stone: 48 });
    });
  });

  describe('Hearthfire fuel', () => {
    it('stores up to 5 nights, burns one per nightfall lazily and goes out', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...plain,
        spot: 1,
      });

      const res = await fuel(server, kid, mapId, fire.id, 3);
      expect(res.statusCode).toBe(200);
      const lit = HomeResponseSchema.parse(res.json());
      expect(lit.buildings[0]).toMatchObject({ lit: true, nightsLeft: 3, fuelSpace: 2 });
      expect(lit.items.emberwood).toBe(17);
      expect(lit.tonight).toBe('2026-10-02');
      const row = await db.query.buildings.findFirst({ where: (t, { eq }) => eq(t.id, fire.id) });
      expect(row).toMatchObject({ fuelledThrough: '2026-10-04', fuelUpdatedAt: clock });

      // Members hear it lit up, not how many nights it holds.
      const event = (await eventsOf(mapId)).at(-1)!;
      expect(event).toMatchObject({
        type: 'building.fueled',
        payload: { nights: 3, fuelledThrough: '2026-10-04' },
      });
      const shown = publicViewFor(PUBLIC_VIEWS, event, { userId: friend.id });
      expect(shown).toMatchObject({ userId: kid.id, building: { id: fire.id, lit: true } });
      expect(JSON.stringify(shown)).not.toContain('2026-10-04');

      // More than fits: it fills up and only charges for what went in.
      const topped = HomeResponseSchema.parse((await fuel(server, kid, mapId, fire.id, 9)).json());
      expect(topped.buildings[0]).toMatchObject({ nightsLeft: 5, fuelSpace: 0 });
      expect(topped.items.emberwood).toBe(15);
      const full = await fuel(server, kid, mapId, fire.id, 1);
      expect(full.statusCode).toBe(409);
      expect(errorOf(full).message).toBe("It's full! Come back after a night or two.");

      // Nothing ticks: each nightfall (9 PM in Denver) shows one night fewer.
      const nightsAt = async (iso: string) => {
        clock.setTime(Date.parse(iso));
        return (await home(server, kid, mapId)).buildings[0]!.nightsLeft;
      };
      expect(await nightsAt('2026-10-03T02:59:00Z')).toBe(5); // 8:59 PM Oct 2
      expect(await nightsAt('2026-10-03T03:00:00Z')).toBe(4); // 9:00 PM Oct 2
      expect(await nightsAt('2026-10-06T12:00:00Z')).toBe(1); // Oct 6, before nightfall
      expect(await nightsAt('2026-10-07T03:00:00Z')).toBe(0);
      const out = (await view(server, friend, mapId)).tiles.find(
        (t) => t.q === plain.q && t.r === plain.r,
      )!;
      expect(out.buildings[0]).toMatchObject({ lit: false });
      await reconciled(mapId, kid.id);
    });

    it('counts nights by the map clock across the end of daylight saving', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...plain,
        spot: 1,
      });
      // Oct 31, noon in Denver (MDT): 2 nights, Oct 31 and Nov 1.
      clock.setTime(Date.parse('2026-10-31T18:00:00Z'));
      expect((await fuel(server, kid, mapId, fire.id, 2)).statusCode).toBe(200);
      const nightsAt = async (iso: string) => {
        clock.setTime(Date.parse(iso));
        return (await home(server, kid, mapId)).buildings[0]!.nightsLeft;
      };
      // Nov 1 is 25 hours long; its nightfall is 04:00Z (MST), not 03:00Z.
      expect(await nightsAt('2026-11-01T03:30:00Z')).toBe(1); // 9:30 PM Oct 31
      expect(await nightsAt('2026-11-02T03:30:00Z')).toBe(1); // 8:30 PM Nov 1 (MST)
      expect(await nightsAt('2026-11-02T04:00:00Z')).toBe(0); // 9:00 PM Nov 1
    });

    it('only fuels your own fires', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, PLENTY);
      await give(mapId, friend, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...plain,
        spot: 1,
      });
      const meadow = await placed(server, kid, mapId, {
        buildingId: 'cozy-meadow',
        ...plain,
        spot: 2,
      });
      expect((await fuel(server, friend, mapId, fire.id, 1)).statusCode).toBe(404);
      const grass = await fuel(server, kid, mapId, meadow.id, 1);
      expect(errorOf(grass).message).toBe('Only fires need fuel.');
    });
  });

  describe('moving and taking down', () => {
    it('moves a building to a free spot on another home tile', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const { seed, plain } = await homeTiles(server, kid, mapId);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...plain,
        spot: 1,
      });
      const den = await placed(server, kid, mapId, { buildingId: 'ember-den', ...plain, spot: 2 });
      const move = (body: object) =>
        call(server, 'POST', `/maps/${mapId}/buildings/${fire.id}/move`, kid, body);

      expect(errorOf(await move({ q: plain.q, r: plain.r, spot: 2 })).message).toBe(
        'Something is already there. Try another spot!',
      );
      const moved = await move({ q: seed.q, r: seed.r, spot: 6 });
      expect(moved.statusCode).toBe(200);
      expect(
        HomeResponseSchema.parse(moved.json()).buildings.find((b) => b.id === fire.id),
      ).toMatchObject({ q: seed.q, r: seed.r, spot: 6 });
      expect((await eventsOf(mapId)).at(-1)).toMatchObject({
        type: 'building.moved',
        payload: { from: { q: plain.q, r: plain.r, spot: 1 }, building: { spot: 6 } },
      });
      // Back where it was: a no-op move writes no event.
      const seq = (await eventsOf(mapId)).length;
      expect((await move({ q: seed.q, r: seed.r, spot: 6 })).statusCode).toBe(200);
      expect(await eventsOf(mapId)).toHaveLength(seq);
      expect(den.id).not.toBe(fire.id);
    });

    it('gives back half the cost and any unburned fuel, and moves residents out', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, { timber: 9, stone: 7, emberwood: 3 });
      const { plain } = await homeTiles(server, kid, mapId);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...plain,
        spot: 1,
      });
      await fuel(server, kid, mapId, fire.id, 3);
      const den = await placed(server, kid, mapId, {
        buildingId: 'cozy-meadow',
        ...plain,
        spot: 2,
      });
      const pal = await squishy(mapId, kid);
      await call(server, 'POST', `/maps/${mapId}/squishies/${pal}/habitat`, kid, {
        habitatId: den.id,
      });
      // Nightfall passes: one night burned.
      clock.setTime(Date.parse('2026-10-03T12:00:00Z'));

      const removeFire = await call(
        server,
        'POST',
        `/maps/${mapId}/buildings/${fire.id}/remove`,
        kid,
      );
      expect(removeFire.statusCode).toBe(200);
      const fireBack = RemoveBuildingResponseSchema.parse(removeFire.json());
      expect(fireBack.refund).toEqual({ timber: 2, stone: 2, emberwood: 2 });

      const removeDen = await call(
        server,
        'POST',
        `/maps/${mapId}/buildings/${den.id}/remove`,
        kid,
      );
      const denBack = RemoveBuildingResponseSchema.parse(removeDen.json());
      expect(denBack.refund).toEqual({ timber: 2, stone: 1 });
      expect(denBack.home.buildings).toEqual([]);
      expect(denBack.home.squishies).toEqual([
        expect.objectContaining({ id: pal, habitatId: null }),
      ]);
      expect((await eventsOf(mapId)).at(-1)).toMatchObject({
        type: 'building.removed',
        payload: { buildingRowId: den.id, movedOut: [pal] },
      });
      expect(denBack.home.items).toEqual({ timber: 4, stone: 3, emberwood: 2 });
      const ledger = await reconciled(mapId, kid.id);
      expect(ledger.filter((l) => l.reason === 'build-refund')).toHaveLength(5);
      expect(HOME_BASE_RULES.removeRefundPercent).toBe(50);
    });

    it("takes a leaver's buildings down, so a returning player gets a fresh home", async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, friend, PLENTY);
      const { plain } = await homeTiles(server, friend, mapId);
      await placed(server, friend, mapId, { buildingId: 'hearthfire', ...plain, spot: 1 });
      const pal = await squishy(mapId, friend);
      const meadow = await placed(server, friend, mapId, {
        buildingId: 'cozy-meadow',
        ...plain,
        spot: 2,
      });
      await call(server, 'POST', `/maps/${mapId}/squishies/${pal}/habitat`, friend, {
        habitatId: meadow.id,
      });
      expect((await call(server, 'POST', `/maps/${mapId}/leave`, friend)).statusCode).toBe(204);
      expect(
        await db.query.buildings.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) }),
      ).toEqual([]);
      const row = await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, pal) });
      expect(row?.habitatBuildingId).toBeNull();
      expect((await view(server, kid, mapId)).tiles.every((t) => t.buildings.length === 0)).toBe(
        true,
      );
    });
  });

  describe('habitats', () => {
    it('houses your own active squishies up to capacity, and moves them out', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const den = await placed(server, kid, mapId, { buildingId: 'ember-den', ...plain, spot: 1 });
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...plain,
        spot: 2,
      });
      expect(den).toMatchObject({ capacity: 3, residents: 0 });
      const house = (who: Player, squishyId: string, habitatId: string | null) =>
        call(server, 'POST', `/maps/${mapId}/squishies/${squishyId}/habitat`, who, { habitatId });

      const pals = [
        await squishy(mapId, kid),
        await squishy(mapId, kid),
        await squishy(mapId, kid),
      ];
      for (const pal of pals) expect((await house(kid, pal, den.id)).statusCode).toBe(200);
      const fourth = await squishy(mapId, kid);
      const full = await house(kid, fourth, den.id);
      expect(full.statusCode).toBe(409);
      expect(errorOf(full).message).toBe('The Ember Den is full! Try another home.');

      const shown = await home(server, kid, mapId);
      expect(shown.buildings.find((b) => b.id === den.id)).toMatchObject({ residents: 3 });
      expect(shown.squishies.filter((s) => s.habitatId === den.id)).toHaveLength(3);
      expect((await eventsOf(mapId)).at(-1)).toMatchObject({
        type: 'squishy.housed',
        payload: { squishyId: pals[2], habitatId: den.id, fromHabitatId: null },
      });

      expect(errorOf(await house(kid, fourth, fire.id)).message).toBe(
        'Squishies can only move into a habitat.',
      );
      const sleepy = await squishy(mapId, kid, 'hollowed');
      expect((await house(kid, sleepy, den.id)).statusCode).toBe(409);
      const theirs = await squishy(mapId, friend);
      expect((await house(kid, theirs, den.id)).statusCode).toBe(404);
      expect((await house(friend, pals[0]!, den.id)).statusCode).toBe(404);

      const out = await house(kid, pals[0]!, null);
      expect(out.statusCode).toBe(200);
      expect(
        HomeResponseSchema.parse(out.json()).buildings.find((b) => b.id === den.id),
      ).toMatchObject({ residents: 2 });
      expect((await house(kid, fourth, den.id)).statusCode).toBe(200);
    });
  });
});
