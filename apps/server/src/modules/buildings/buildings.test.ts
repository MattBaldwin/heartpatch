import {
  ApiErrorSchema,
  CareListResponseSchema,
  GAME_DATA,
  HOME_BASE_RULES,
  HomeResponseSchema,
  hexKey,
  hexSpiral,
  JOB_RULES,
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
import { keepers, sessions, squishies, tileDefenders, users } from '../../db/schema.js';
import { mapLocalTime } from '../../lib/time.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { fireStateAt, litSafeTiles } from './hearthfire.js';
import { createBuildingsRepo } from './repo.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = {
  base: 'pip',
  hairColor: 'honey',
  eyeColor: 'sky',
  outfit: 'sunflower',
  skinTone: 'tone-1',
  eyes: 'round' as const,
  brows: 'arched',
  mouth: 'smile',
  extras: [],
};
const ZONE = 'America/Denver';
/** Oct 2, 6:00 AM in Denver: in the Halloween window, before nightfall. */
const START = '2026-10-02T12:00:00Z';
const PLENTY = { timber: 50, stone: 50, emberwood: 20 };

const building = (id: string) => GAME_DATA.buildings.find((b) => b.id === id)!;

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

  /**
   * A home ring tile and the Heart Seed tile. Every ring tile has a node in
   * its middle since the seasonal nodes joined the ring (owner decision
   * 2026-10-06), so buildings go on spots 1–6.
   */
  async function homeTiles(server: FastifyInstance, who: Player, mapId: string) {
    const { tiles } = await home(server, who, mapId);
    expect(tiles).toHaveLength(7);
    const seed = tiles.find((t) => t.heartSeed)!;
    const plain = tiles.filter((t) => !t.heartSeed);
    expect(plain.length).toBeGreaterThan(1);
    const at = (t: { q: number; r: number }) => ({ q: t.q, r: t.r });
    return { seed: at(seed), plain: at(plain[0]!), plain2: at(plain[1]!), tiles };
  }

  /**
   * Captured land for fires (#202: Hearthfires stand only out there, owner
   * decision 2026-10-07): `count` neutral outer tiles with a free middle,
   * handed to `who` as if claimed, far from anyone's home.
   */
  async function landFor(mapId: string, who: Player, count = 1) {
    const wild = await db.query.tiles.findMany({
      where: (t, { and, eq, isNull }) =>
        and(eq(t.mapId, mapId), isNull(t.homeSlot), isNull(t.ownerUserId), isNull(t.nodeResource)),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
    const picked = wild.slice(0, count);
    for (const t of picked) {
      await db.execute(`update tiles set owner_user_id = '${who.id}' where id = '${t.id}'`);
    }
    return picked.map((t) => ({ q: t.q, r: t.r }));
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
        buildingId: 'cozy-meadow',
        q: plain.q,
        r: plain.r,
        spot: 1,
      });
      expect(build.statusCode).toBe(404);
    });
  });

  describe('placing', () => {
    it('builds a Hearthfire on my land, never at home, pays in the same transaction and shows everyone', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, PLENTY);
      const { seed, plain: ring } = await homeTiles(server, kid, mapId);
      const [plain] = await landFor(mapId, kid);

      // The Heart Seed keeps home safe: no fires there (owner decision 2026-10-07).
      for (const at of [
        { ...seed, spot: 0 },
        { ...ring, spot: 2 },
      ]) {
        const res = await place(server, kid, mapId, { buildingId: 'hearthfire', ...at });
        expect(res.statusCode).toBe(403);
        expect(errorOf(res).message).toBe(
          'Fires go on your land, in the middle of a tile 🔥. Your Heart Seed keeps home safe!',
        );
      }
      // A fire is a light: only a tile's middle takes one (#204).
      const offMiddle = await place(server, kid, mapId, {
        buildingId: 'hearthfire',
        q: plain!.q,
        r: plain!.r,
        spot: 2,
      });
      expect(offMiddle.statusCode).toBe(409);
      expect(errorOf(offMiddle).message).toBe('Hearthfires go in the middle of a tile!');

      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        q: plain!.q,
        r: plain!.r,
        spot: 0,
      });
      expect(fire).toMatchObject({
        buildingId: 'hearthfire',
        kind: 'hearthfire',
        level: 1,
        lit: false,
        safeRadius: 1,
        nightsLeft: 0,
        fuelSpace: 8,
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
        (t) => t.q === plain!.q && t.r === plain!.r,
      )!;
      expect(shown.buildings).toEqual([
        {
          id: fire.id,
          buildingId: 'hearthfire',
          kind: 'hearthfire',
          level: 1,
          spot: 0,
          lit: false,
          safeRadius: 1,
        },
      ]);
      const event = (await eventsOf(mapId)).at(-1)!;
      expect(event).toMatchObject({ type: 'building.placed', actorUserId: kid.id });
      expect(publicViewFor(PUBLIC_VIEWS, event, { userId: friend.id })).toEqual({
        userId: kid.id,
        building: { ...shown.buildings[0], q: plain!.q, r: plain!.r },
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

      // A habitat goes around a tile's middle (#204); the middle holds the node.
      const node = await place(server, kid, mapId, {
        buildingId: 'cozy-meadow',
        q: plain.q,
        r: plain.r,
        spot: 0,
      });
      expect(errorOf(node).message).toBe('The Cozy Meadow goes around the middle of a tile!');
      await placed(server, kid, mapId, { buildingId: 'cozy-meadow', ...plain, spot: 1 });
      const twice = await place(server, kid, mapId, {
        buildingId: 'ember-den',
        q: plain.q,
        r: plain.r,
        spot: 1,
      });
      expect(errorOf(twice).message).toBe('Something is already there. Try another spot!');
      await placed(server, kid, mapId, { buildingId: 'cozy-meadow', ...plain, spot: 2 });
      const third = await place(server, kid, mapId, {
        buildingId: 'cozy-meadow',
        q: plain.q,
        r: plain.r,
        spot: 3,
      });
      expect(third.statusCode).toBe(409);
      expect(errorOf(third).message).toBe('Your home already has all the Cozy Meadow it can hold!');

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
      const [land] = await landFor(mapId, kid);
      const body = { buildingId: 'jack-o-lantern-hearthfire', q: land!.q, r: land!.r, spot: 0 };

      clock.setTime(Date.parse('2026-12-15T18:00:00Z'));
      const late = await place(server, kid, mapId, body);
      expect(late.statusCode).toBe(409);
      expect(errorOf(late).message).toBe(
        "Jack-o'-Lantern Hearthfire can only be built around Halloween!",
      );

      clock.setTime(Date.parse('2026-10-31T18:00:00Z'));
      const lantern = await placed(server, kid, mapId, body);
      expect(lantern).toMatchObject({ kind: 'hearthfire', safeRadius: 1 });
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
    it('stores up to 8 nights, burns one per nightfall lazily and goes out', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, PLENTY);
      const [land] = await landFor(mapId, kid);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...land!,
        spot: 0,
      });

      const res = await fuel(server, kid, mapId, fire.id, 3);
      expect(res.statusCode).toBe(200);
      const lit = HomeResponseSchema.parse(res.json());
      expect(lit.buildings[0]).toMatchObject({ lit: true, nightsLeft: 3, fuelSpace: 5 });
      expect(lit.items['emberwood']).toBe(17);
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
      expect(topped.buildings[0]).toMatchObject({ nightsLeft: 8, fuelSpace: 0 });
      expect(topped.items['emberwood']).toBe(12);
      const full = await fuel(server, kid, mapId, fire.id, 1);
      expect(full.statusCode).toBe(409);
      expect(errorOf(full).message).toBe("It's full! Come back after a night or two.");

      // Nothing ticks: each nightfall (7 PM in Denver, #277) shows one night fewer.
      const nightsAt = async (iso: string) => {
        clock.setTime(Date.parse(iso));
        return (await home(server, kid, mapId)).buildings[0]!.nightsLeft;
      };
      expect(await nightsAt('2026-10-03T00:59:00Z')).toBe(8); // 6:59 PM Oct 2
      expect(await nightsAt('2026-10-03T01:00:00Z')).toBe(7); // 7:00 PM Oct 2
      expect(await nightsAt('2026-10-09T12:00:00Z')).toBe(1); // Oct 9, before nightfall
      expect(await nightsAt('2026-10-10T01:00:00Z')).toBe(0);
      const out = (await view(server, friend, mapId)).tiles.find(
        (t) => t.q === land!.q && t.r === land!.r,
      )!;
      expect(out.buildings[0]).toMatchObject({ lit: false });
      await reconciled(mapId, kid.id);
    });

    it('counts nights by the map clock across the end of daylight saving', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const [land] = await landFor(mapId, kid);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...land!,
        spot: 0,
      });
      // Oct 31, noon in Denver (MDT): 2 nights, Oct 31 and Nov 1.
      clock.setTime(Date.parse('2026-10-31T18:00:00Z'));
      expect((await fuel(server, kid, mapId, fire.id, 2)).statusCode).toBe(200);
      const nightsAt = async (iso: string) => {
        clock.setTime(Date.parse(iso));
        return (await home(server, kid, mapId)).buildings[0]!.nightsLeft;
      };
      // Nov 1 is 25 hours long; its nightfall is 02:00Z (MST), not 01:00Z.
      expect(await nightsAt('2026-11-01T01:30:00Z')).toBe(1); // 7:30 PM Oct 31
      expect(await nightsAt('2026-11-02T01:30:00Z')).toBe(1); // 6:30 PM Nov 1 (MST)
      expect(await nightsAt('2026-11-02T02:00:00Z')).toBe(0); // 7:00 PM Nov 1
    });

    it('only fuels your own fires', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, PLENTY);
      await give(mapId, friend, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const [land] = await landFor(mapId, kid);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...land!,
        spot: 0,
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
    it('moves a building to a free spot of its kind on another home tile', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const { seed, plain, plain2 } = await homeTiles(server, kid, mapId);
      const [land] = await landFor(mapId, kid);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...land!,
        spot: 0,
      });
      const den = await placed(server, kid, mapId, { buildingId: 'ember-den', ...plain, spot: 2 });
      await placed(server, kid, mapId, { buildingId: 'cozy-meadow', ...plain, spot: 3 });
      const move = (id: string, body: object) =>
        call(server, 'POST', `/maps/${mapId}/buildings/${id}/move`, kid, body);

      expect(errorOf(await move(den.id, { q: plain.q, r: plain.r, spot: 3 })).message).toBe(
        'Something is already there. Try another spot!',
      );
      expect(errorOf(await move(den.id, { q: plain2.q, r: plain2.r, spot: 0 })).message).toBe(
        'The Ember Den goes around the middle of a tile!',
      );
      // A fire out on my land stays put; it never comes home (owner decision 2026-10-07).
      expect(errorOf(await move(fire.id, { q: seed.q, r: seed.r, spot: 6 })).message).toBe(
        'A fire on your land stays where it is. Take it down to build it somewhere else.',
      );
      const moved = await move(den.id, { q: seed.q, r: seed.r, spot: 6 });
      expect(moved.statusCode).toBe(200);
      expect(
        HomeResponseSchema.parse(moved.json()).buildings.find((b) => b.id === den.id),
      ).toMatchObject({ q: seed.q, r: seed.r, spot: 6 });
      expect((await eventsOf(mapId)).at(-1)).toMatchObject({
        type: 'building.moved',
        payload: { from: { q: plain.q, r: plain.r, spot: 2 }, building: { spot: 6 } },
      });
      // Back where it was: a no-op move writes no event.
      const seq = (await eventsOf(mapId)).length;
      expect((await move(den.id, { q: seed.q, r: seed.r, spot: 6 })).statusCode).toBe(200);
      expect(await eventsOf(mapId)).toHaveLength(seq);
    });

    it('gives back half the cost and any unburned fuel, and moves residents out', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, { timber: 9, stone: 7, emberwood: 3 });
      const { plain } = await homeTiles(server, kid, mapId);
      const [land] = await landFor(mapId, kid);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...land!,
        spot: 0,
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
      const [land] = await landFor(mapId, friend);
      await placed(server, friend, mapId, { buildingId: 'hearthfire', ...land!, spot: 0 });
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

  describe('races (one command per player at a time)', () => {
    it('never builds two Hearthfires when two builds race', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const [land] = await landFor(mapId, kid);
      // One fire a tile: two taps on the same land, one fire.
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          place(server, kid, mapId, { buildingId: 'hearthfire', ...land!, spot: 0 }),
        ),
      );
      const codes = results.map((r) => (r.status === 'fulfilled' ? r.value.statusCode : 0));
      expect(codes.sort()).toEqual([201, 409]);
      const fires = await db.query.buildings.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.buildingId, 'hearthfire')),
      });
      expect(fires).toHaveLength(1);
      // Paid once.
      expect((await home(server, kid, mapId)).items).toMatchObject({ timber: 45, stone: 45 });
      await reconciled(mapId, kid.id);
    });

    it('never overfills a habitat when two squishies race for the last bed', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const den = await placed(server, kid, mapId, { buildingId: 'ember-den', ...plain, spot: 1 });
      const house = (squishyId: string) =>
        call(server, 'POST', `/maps/${mapId}/squishies/${squishyId}/habitat`, kid, {
          habitatId: den.id,
        });
      for (const pal of [await squishy(mapId, kid), await squishy(mapId, kid)]) {
        expect((await house(pal)).statusCode).toBe(200);
      }
      const racers = [await squishy(mapId, kid), await squishy(mapId, kid)];
      const results = await Promise.allSettled(racers.map(house));
      const codes = results.map((r) => (r.status === 'fulfilled' ? r.value.statusCode : 0));
      expect(codes.sort()).toEqual([200, 409]);
      const living = await db.query.squishies.findMany({
        where: (t, { eq }) => eq(t.habitatBuildingId, den.id),
      });
      expect(living).toHaveLength(3);
    });
  });

  describe('safe tiles for nightfall (#21)', () => {
    it('keeps every home safe, and land within a lit fire’s radius, across players', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, PLENTY);
      await give(mapId, friend, PLENTY);
      const mine = await homeTiles(server, kid, mapId);
      const theirs = await homeTiles(server, friend, mapId);
      const [myLand, theirLand] = await landFor(mapId, kid, 2);
      await db.execute(
        `update tiles set owner_user_id = '${friend.id}' where map_id = '${mapId}' and q = ${String(theirLand!.q)} and r = ${String(theirLand!.r)}`,
      );
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...myLand!,
        spot: 0,
      });
      await placed(server, friend, mapId, { buildingId: 'hearthfire', ...theirLand!, spot: 0 });
      await fuel(server, kid, mapId, fire.id, 1); // only the kid's fire is lit

      const repo = createBuildingsRepo(db);
      const fires = (await repo.listOnMap(mapId)).filter((b) => b.kind === 'hearthfire');
      expect(fires).toHaveLength(2);
      const homes = [...mine.tiles, ...theirs.tiles];
      const local = mapLocalTime(clock, ZONE);
      const safe = litSafeTiles(fires, homes, local);
      expect([...safe].sort()).toEqual(
        [...new Set([...homes.map(hexKey), ...hexSpiral(myLand!, 1).map(hexKey)])].sort(),
      );
      // After tonight's nightfall the fire is out: only the homes stay safe.
      const later = mapLocalTime(new Date('2026-10-03T12:00:00Z'), ZONE);
      expect([...litSafeTiles(fires, homes, later)].sort()).toEqual(homes.map(hexKey).sort());
      expect(fireStateAt('2026-10-02', clock, ZONE)).toMatchObject({
        lit: true,
        nightsLeft: 1,
      });
    });
  });

  describe('upgrades (owner decision 2026-10-06)', () => {
    const upgrade = (server: FastifyInstance, who: Player, mapId: string, id: string) =>
      call(server, 'POST', `/maps/${mapId}/buildings/${id}/upgrade`, who);

    it('raises a Hearthfire a level, pays in the same transaction, and its light reaches further', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, { timber: 35, stone: 30, emberwood: 1 });
      const { tiles } = await homeTiles(server, kid, mapId);
      const [land] = await landFor(mapId, kid);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...land!,
        spot: 0,
      });
      await fuel(server, kid, mapId, fire.id, 1);

      const res = await upgrade(server, kid, mapId, fire.id);
      expect(res.statusCode, res.body).toBe(200);
      const after = HomeResponseSchema.parse(res.json());
      expect(after.buildings.find((b) => b.id === fire.id)).toMatchObject({
        level: 2,
        safeRadius: 1,
        lit: true,
        nightsLeft: 1,
      });
      expect(after.items).toMatchObject({ timber: 20, stone: 15 });
      const ledger = await reconciled(mapId, kid.id);
      expect(
        ledger
          .filter((l) => l.reason === 'upgrade')
          .map((l) => [l.itemId, l.delta, l.refId])
          .sort(),
      ).toEqual([
        ['stone', -10, fire.id],
        ['timber', -10, fire.id],
      ]);

      // Members see the new level and radius; the bill stays internal.
      const event = (await eventsOf(mapId)).at(-1)!;
      expect(event).toMatchObject({
        type: 'building.upgraded',
        payload: { fromLevel: 1, cost: { timber: 10, stone: 10 } },
      });
      expect(publicViewFor(PUBLIC_VIEWS, event, { userId: friend.id })).toMatchObject({
        userId: kid.id,
        building: { id: fire.id, level: 2, safeRadius: 1 },
      });
      const shown = (await view(server, friend, mapId)).tiles.find(
        (t) => t.q === land!.q && t.r === land!.r,
      )!;
      expect(shown.buildings[0]).toMatchObject({ level: 2, safeRadius: 1 });

      // Nightfall's safe tiles follow the level: every tile within 1 of the fire (radii 1 / 1 / 2, #277).
      const fires = (await createBuildingsRepo(db).listOnMap(mapId)).filter(
        (b) => b.kind === 'hearthfire',
      );
      const safe = litSafeTiles(fires, tiles, mapLocalTime(clock, ZONE));
      expect([...safe].sort()).toEqual(
        [...new Set([...tiles.map(hexKey), ...hexSpiral(land!, 1).map(hexKey)])].sort(),
      );
    });

    it('needs Glimmer for level 3, changes nothing when short, and stops at the top', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, { timber: 35, stone: 30 });
      const [land] = await landFor(mapId, kid);
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...land!,
        spot: 0,
      });
      expect((await upgrade(server, kid, mapId, fire.id)).statusCode).toBe(200);

      const short = await upgrade(server, kid, mapId, fire.id);
      expect(short.statusCode).toBe(409);
      expect(errorOf(short).message).toMatch(/Glimmer/);
      const still = await home(server, kid, mapId);
      expect(still.buildings[0]).toMatchObject({ level: 2, safeRadius: 1 });
      expect(still.items).toMatchObject({ timber: 20, stone: 15 });

      await give(mapId, kid, { glimmer: 1 });
      const top = await upgrade(server, kid, mapId, fire.id);
      expect(top.statusCode).toBe(200);
      expect(HomeResponseSchema.parse(top.json()).buildings[0]).toMatchObject({
        level: 3,
        safeRadius: 2,
      });
      const past = await upgrade(server, kid, mapId, fire.id);
      expect(past.statusCode).toBe(409);
      expect(errorOf(past).message).toBe('Your Hearthfire is as big as it gets!');

      // Taking it down gives back half of everything spent on it, upgrades included.
      const removed = await call(server, 'POST', `/maps/${mapId}/buildings/${fire.id}/remove`, kid);
      // Half of one Glimmer rounds down to none (#277: level 3 needs 1).
      expect(RemoveBuildingResponseSchema.parse(removed.json()).refund).toEqual({
        timber: 17,
        stone: 15,
      });
      await reconciled(mapId, kid.id);
    });

    it('gives a habitat more room, and only upgrades your own buildings', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      await give(mapId, kid, PLENTY);
      await give(mapId, friend, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const den = await placed(server, kid, mapId, { buildingId: 'ember-den', ...plain, spot: 1 });
      expect(den.capacity).toBe(3);
      expect((await upgrade(server, friend, mapId, den.id)).statusCode).toBe(404);
      const res = await upgrade(server, kid, mapId, den.id);
      expect(HomeResponseSchema.parse(res.json()).buildings[0]).toMatchObject({
        level: 2,
        capacity: 5,
      });
      // The Jack-o'-Lantern Hearthfire has one level only.
      expect(building('jack-o-lantern-hearthfire').levels).toHaveLength(1);
    });
  });

  describe('Training Grounds (owner decision 2026-10-06)', () => {
    it('builds, shows its trainees, and lands their XP when taken down', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const grounds = await placed(server, kid, mapId, {
        buildingId: 'training-grounds',
        ...plain,
        spot: 1,
      });
      expect(grounds).toMatchObject({ kind: 'training-grounds', capacity: 2, residents: 0 });

      const pal = await squishy(mapId, kid);
      const assign = await call(server, 'POST', `/maps/${mapId}/squishies/${pal}/job`, kid, {
        job: 'training',
      });
      expect(assign.statusCode, assign.body).toBe(200);
      const trainingHome = await home(server, kid, mapId);
      expect(trainingHome.buildings[0]).toMatchObject({ residents: 1 });
      expect(trainingHome.squishies).toEqual([
        expect.objectContaining({
          id: pal,
          trainingId: grounds.id,
          habitatId: null,
          job: 'training',
        }),
      ]);

      // Two hours at 5 XP an hour, then it's taken down: the 10 XP land first.
      clock.setTime(clock.getTime() + 2 * 60 * 60 * 1000);
      const removed = await call(
        server,
        'POST',
        `/maps/${mapId}/buildings/${grounds.id}/remove`,
        kid,
      );
      expect(removed.statusCode, removed.body).toBe(200);
      const row = await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, pal) });
      expect(row).toMatchObject({ xp: 10, trainingBuildingId: null, trainingSince: null });
      const events = (await eventsOf(mapId)).slice(-2);
      expect(events.map((e) => e.type)).toEqual(['building.removed', 'squishy.trained']);
      expect(events[1]!.payload).toEqual({ userId: kid.id, trained: [{ squishyId: pal, xp: 10 }] });
      expect(JOB_RULES.training.maxHours).toBe(24);
    });
  });

  describe('upgrading Training Grounds with trainees (review round 1)', () => {
    it('pays the old rate up to the upgrade and the new rate after it', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const grounds = await placed(server, kid, mapId, {
        buildingId: 'training-grounds',
        ...plain,
        spot: 1,
      });
      const pal = await squishy(mapId, kid);
      await call(server, 'POST', `/maps/${mapId}/squishies/${pal}/job`, kid, { job: 'training' });

      // 10 h at level 1 (5 an hour) lands at the upgrade as 50 XP, not 80.
      clock.setTime(clock.getTime() + 10 * 60 * 60 * 1000);
      const up = await call(server, 'POST', `/maps/${mapId}/buildings/${grounds.id}/upgrade`, kid);
      expect(up.statusCode, up.body).toBe(200);
      expect(
        (await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, pal) }))?.xp,
      ).toBe(50);
      // The bill, then the training that landed, then the level it reached.
      const types = (await eventsOf(mapId)).slice(-3).map((e) => e.type);
      expect(types).toEqual(['building.upgraded', 'squishy.trained', 'squishy.leveled']);

      // 2 h more at level 2 (8 an hour): the next settle pays 16.
      clock.setTime(clock.getTime() + 2 * 60 * 60 * 1000);
      const settled = await call(server, 'POST', `/maps/${mapId}/settle`, kid);
      expect(settled.statusCode).toBe(200);
      expect(
        (await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, pal) }))?.xp,
      ).toBe(66);
      await reconciled(mapId, kid.id);
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
      const [land] = await landFor(mapId, kid);
      const den = await placed(server, kid, mapId, { buildingId: 'ember-den', ...plain, spot: 1 });
      const fire = await placed(server, kid, mapId, {
        buildingId: 'hearthfire',
        ...land!,
        spot: 0,
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

    it('houses a squishy or puts it on watch, never both (owner decision 2026-10-03)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const den = await placed(server, kid, mapId, { buildingId: 'ember-den', ...plain, spot: 1 });
      // Two non-home tiles of the kid's, as if claimed.
      const [post, post2] = await db.query.tiles.findMany({
        where: (t, { and, eq, isNull }) => and(eq(t.mapId, mapId), isNull(t.homeSlot)),
        orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
        limit: 2,
      });
      // Our own uuids, so raw SQL is safe.
      await db.execute(
        `update tiles set owner_user_id = '${kid.id}' where id in ('${post!.id}', '${post2!.id}')`,
      );
      const [pal] = await db
        .insert(squishies)
        .values({
          mapId,
          ownerUserId: kid.id,
          speciesId: 'test-squishy',
          element: 'fire',
          feeling: 'cozy',
          nickname: 'Puddles',
        })
        .returning({ id: squishies.id });
      const palId = pal!.id;
      const house = (habitatId: string | null) =>
        call(server, 'POST', `/maps/${mapId}/squishies/${palId}/habitat`, kid, { habitatId });
      const watch = (tile: { q: number; r: number }, squishyIds: string[]) =>
        call(server, 'POST', `/maps/${mapId}/defenders`, kid, { q: tile.q, r: tile.r, squishyIds });

      // On watch: housing is refused with how to free it, and nothing changes.
      expect((await watch(post!, [palId])).statusCode).toBe(200);
      const refused = await house(den.id);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused).message).toBe('Bring Puddles home from watch first!');
      expect((await home(server, kid, mapId)).squishies.find((s) => s.id === palId)).toMatchObject({
        habitatId: null,
      });
      // Home from watch: now it can move in.
      expect((await watch(post!, [])).statusCode).toBe(200);
      expect((await house(den.id)).statusCode).toBe(200);

      // Housed: standing watch is refused the same way, and nothing changes.
      const posted = await watch(post!, [palId]);
      expect(posted.statusCode).toBe(409);
      expect(errorOf(posted).message).toBe('Move Puddles out of their habitat first!');
      expect(
        await db.query.tileDefenders.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) }),
      ).toEqual([]);
      // Moving out is always fine; then it can stand watch.
      expect((await house(null)).statusCode).toBe(200);
      expect((await watch(post!, [palId])).statusCode).toBe(200);
      expect((await watch(post!, [])).statusCode).toBe(200);

      // Housing and posting at once: exactly one wins (both lock the squishy).
      const raced = await Promise.all([house(den.id), watch(post2!, [palId])]);
      expect(raced.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const row = await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, palId) });
      const guards = await db.query.tileDefenders.findMany({
        where: (t, { eq }) => eq(t.squishyId, palId),
      });
      expect(row!.habitatBuildingId === null).toBe(guards.length === 1);
    });

    it('treats a squishy both housed and on watch from before the rule as on watch only', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await give(mapId, kid, PLENTY);
      const { plain } = await homeTiles(server, kid, mapId);
      const den = await placed(server, kid, mapId, { buildingId: 'ember-den', ...plain, spot: 1 });
      const [post] = await db.query.tiles.findMany({
        where: (t, { and, eq, isNull }) => and(eq(t.mapId, mapId), isNull(t.homeSlot)),
        orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
        limit: 1,
      });
      await db.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${post!.id}'`);
      const both = await squishy(mapId, kid);
      const housed = await squishy(mapId, kid);
      const homeless = await squishy(mapId, kid);
      await db.execute(
        `update squishies set habitat_building_id = '${den.id}' where id in ('${both}', '${housed}')`,
      );
      // Written straight to the table, as rows from before the rule were.
      await db
        .insert(tileDefenders)
        .values({ mapId, tileId: post!.id, slot: 0, squishyId: both, assignedAt: new Date() });

      // No habitat bonus while on watch: the same as a squishy with no habitat.
      const res = await call(server, 'GET', `/maps/${mapId}/care`, kid);
      expect(res.statusCode).toBe(200);
      const bonus = new Map(
        CareListResponseSchema.parse(res.json()).squishies.map((s) => [s.id, s.xpBonusPercent]),
      );
      expect(bonus.get(both)).toBe(bonus.get(homeless));
      expect(bonus.get(housed)).toBeGreaterThan(bonus.get(homeless)!);

      // It may keep its post when the guards on that spot change…
      const kept = await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: post!.q,
        r: post!.r,
        squishyIds: [both, homeless],
      });
      expect(kept.statusCode, kept.body).toBe(200);
      // …and move out of the habitat, which ends the overlap.
      const out = await call(server, 'POST', `/maps/${mapId}/squishies/${both}/habitat`, kid, {
        habitatId: null,
      });
      expect(out.statusCode).toBe(200);
    });
  });
});
