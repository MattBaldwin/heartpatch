import {
  ApiErrorSchema,
  CollectResponseSchema,
  GAME_DATA,
  GatherResponseSchema,
  InventoryResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  TUTORIAL_OVERRIDES,
  TutorialResponseSchema,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const START = '2026-10-02T12:00:00Z';

interface Player {
  id: string;
  username: string;
  token: string;
}

const resource = (id: string) => GAME_DATA.resources.find((r) => r.id === id)!;
const TIMBER = resource('timber');
const EMBERWOOD = resource('emberwood');
const PUMPKINS = resource('pumpkins');

describe.skipIf(!url)('gathering (needs DATABASE_URL)', () => {
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
    const username = `gatherer_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    // Every player has picked a Keeper (the map gate, #42).
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
    const res = await call(server, 'POST', '/maps', who, {
      name: 'Gather Patch',
      timeZone: 'America/Denver',
    });
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

  /** The player's home-ring node tile for a resource. */
  async function nodeTile(
    server: FastifyInstance,
    who: Player,
    mapId: string,
    resourceId: string,
  ): Promise<PublicTile> {
    const tile = (await view(server, who, mapId)).tiles.find(
      (t) => t.ownerUserId === who.id && t.nodeResource === resourceId,
    );
    expect(tile, resourceId).toBeDefined();
    return tile!;
  }

  const gatherAt = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    tile: PublicTile,
    headers = {},
  ) => call(server, 'POST', `/maps/${mapId}/gathers`, who, { q: tile.q, r: tile.r }, headers);

  const collect = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    gatherId: string,
    headers = {},
  ) => call(server, 'POST', `/maps/${mapId}/gathers/${gatherId}/collect`, who, undefined, headers);

  const inventory = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/inventory`, who);
    expect(res.statusCode).toBe(200);
    return InventoryResponseSchema.parse(res.json());
  };

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  /**
   * Hand-edits a tile (map generation and captures aren't this module's).
   * Plain SQL with ids and numbers this test made itself.
   */
  const setTile = (
    mapId: string,
    tile: PublicTile,
    set: { ownerUserId: string } | { nodeResource: string },
  ) => {
    const [column, value] =
      'ownerUserId' in set
        ? ['owner_user_id', set.ownerUserId]
        : ['node_resource', set.nodeResource];
    return db.execute(
      `update tiles set ${column} = '${value}' where map_id = '${mapId}' and q = ${String(tile.q)} and r = ${String(tile.r)}`,
    );
  };

  describe('access', () => {
    it('needs a logged-in player', async () => {
      const server = await start();
      const id = '00000000-0000-7000-8000-000000000000';
      for (const [path, body] of [
        [`/maps/${id}/gathers`, { q: 0, r: 0 }],
        [`/maps/${id}/gathers/${id}/collect`, undefined],
      ] as const) {
        const res = await call(server, 'POST', path, null, body);
        expect(res.statusCode, path).toBe(401);
      }
    });

    it("hides other players' patches (NOT_FOUND) and refuses their land (FORBIDDEN)", async () => {
      const server = await start();
      const [owner, friend, stranger] = [await player(), await player(), await player()];
      const mapId = await newMap(server, owner);
      await join(server, owner, friend, mapId);
      const tile = await nodeTile(server, owner, mapId, 'timber');

      const probe = await gatherAt(server, stranger, mapId, tile);
      expect(probe.statusCode).toBe(404);
      expect(errorOf(probe).code).toBe('NOT_FOUND');

      const theirs = await gatherAt(server, friend, mapId, tile);
      expect(theirs.statusCode).toBe(403);
      expect(errorOf(theirs).message).toBe('You can only gather on your own land.');

      const gather = GatherResponseSchema.parse(
        (await gatherAt(server, owner, mapId, tile)).json(),
      );
      const stolen = await collect(server, friend, mapId, gather.gather.id);
      expect(stolen.statusCode).toBe(404);
    });

    it('needs a node, on a tile that exists', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const bare = (await view(server, kid, mapId)).tiles.find(
        (t) => t.ownerUserId === kid.id && t.nodeResource === null,
      )!;
      const none = await gatherAt(server, kid, mapId, bare);
      expect(none.statusCode).toBe(409);
      expect(errorOf(none).message).toBe("There's nothing to gather here.");
      const far = await call(server, 'POST', `/maps/${mapId}/gathers`, kid, { q: 500, r: 500 });
      expect(far.statusCode).toBe(404);
    });
  });

  describe('gathering', () => {
    it('finishes on the clock across a logout, grants once and tells the patch', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      const tile = await nodeTile(server, kid, mapId, 'timber');

      const started = await gatherAt(server, kid, mapId, tile);
      expect(started.statusCode).toBe(201);
      const { gather } = GatherResponseSchema.parse(started.json());
      expect(gather).toMatchObject({
        q: tile.q,
        r: tile.r,
        resource: 'timber',
        items: { timber: TIMBER.gather!.quantity },
        startedAt: clock.toISOString(),
        readyAt: new Date(clock.getTime() + TIMBER.gather!.seconds * 1000).toISOString(),
      });
      // Every member sees "gathering here, ready at …" on the tile.
      for (const who of [kid, friend]) {
        const shown = (await view(server, who, mapId)).tiles.find(
          (t) => t.q === tile.q && t.r === tile.r,
        );
        expect(shown?.gathering).toEqual({ readyAt: gather.readyAt });
      }
      expect((await inventory(server, kid, mapId)).gathers).toEqual([gather]);
      // Live: members hear where and until when, never what it will yield.
      const startedEvent = (await eventsOf(mapId)).at(-1)!;
      expect(startedEvent).toMatchObject({
        type: 'gather.started',
        actorUserId: kid.id,
        payload: { gatherId: gather.id, resource: 'timber', readyAt: gather.readyAt },
      });
      expect(publicViewFor(PUBLIC_VIEWS, startedEvent, { userId: friend.id })).toEqual({
        userId: kid.id,
        q: tile.q,
        r: tile.r,
        readyAt: gather.readyAt,
      });

      const early = await collect(server, kid, mapId, gather.id);
      expect(early.statusCode).toBe(409);
      expect(errorOf(early).message).toBe('Not ready yet. Check back soon!');

      // Log out, let the clock run (nothing ticks meanwhile), log in again.
      expect((await call(server, 'POST', '/auth/logout', kid)).statusCode).toBe(204);
      clock.setTime(clock.getTime() + TIMBER.gather!.seconds * 1000);
      const again = { ...kid, token: await login(kid.id) };

      const done = await collect(server, again, mapId, gather.id);
      expect(done.statusCode).toBe(200);
      expect(CollectResponseSchema.parse(done.json())).toEqual({
        granted: { timber: TIMBER.gather!.quantity },
        items: { timber: TIMBER.gather!.quantity },
        now: clock.toISOString(),
      });

      const twice = await collect(server, again, mapId, gather.id);
      expect(twice.statusCode).toBe(409);
      expect(errorOf(twice).message).toBe('Already collected!');
      const after = await inventory(server, again, mapId);
      expect(after.items).toEqual({ timber: TIMBER.gather!.quantity });
      expect(after.gathers).toEqual([]);

      const shown = (await view(server, friend, mapId)).tiles.find(
        (t) => t.q === tile.q && t.r === tile.r,
      );
      expect(shown?.gathering).toBeNull();

      const event = (await eventsOf(mapId)).at(-1)!;
      expect(event).toMatchObject({
        type: 'resource.gathered',
        actorUserId: kid.id,
        payload: {
          gatherId: gather.id,
          userId: kid.id,
          q: tile.q,
          r: tile.r,
          resource: 'timber',
          items: { timber: TIMBER.gather!.quantity },
        },
      });
      // On the ledger once, pointing at the gather (tech spec §4).
      const ledger = await db.query.resourceLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
      });
      expect(ledger.map((l) => [l.itemId, l.delta, l.reason, l.refId])).toEqual([
        ['timber', TIMBER.gather!.quantity, 'gather', gather.id],
      ]);
      // Members hear where; how much stays with the gatherer.
      expect(publicViewFor(PUBLIC_VIEWS, event, { userId: friend.id })).toEqual({
        userId: kid.id,
        q: tile.q,
        r: tile.r,
        resource: 'timber',
      });
    });

    it('runs one gather per node, even on a double tap', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const tile = await nodeTile(server, kid, mapId, 'stone');
      const [a, b] = await Promise.all([
        gatherAt(server, kid, mapId, tile),
        gatherAt(server, kid, mapId, tile),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
      const refused = a.statusCode === 409 ? a : b;
      expect(errorOf(refused).message).toBe("You're already gathering here!");
      // Other nodes are free.
      const other = await nodeTile(server, kid, mapId, 'treats');
      expect((await gatherAt(server, kid, mapId, other)).statusCode).toBe(201);
      expect((await inventory(server, kid, mapId)).gathers).toHaveLength(2);
    });

    it('replays a retried start and collect (Idempotency-Key) without granting twice', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const tile = await nodeTile(server, kid, mapId, 'treats');
      const key = { 'idempotency-key': 'gather-start-1' };
      const first = await gatherAt(server, kid, mapId, tile, key);
      const retry = await gatherAt(server, kid, mapId, tile, key);
      expect(first.statusCode).toBe(201);
      expect(retry.statusCode).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(first.json());

      const { gather } = GatherResponseSchema.parse(first.json());
      clock.setTime(Date.parse(gather.readyAt));
      const collectKey = { 'idempotency-key': 'gather-collect-1' };
      const got = await collect(server, kid, mapId, gather.id, collectKey);
      const gotAgain = await collect(server, kid, mapId, gather.id, collectKey);
      expect(got.statusCode).toBe(200);
      expect(gotAgain.statusCode).toBe(200);
      expect(gotAgain.headers['idempotent-replayed']).toBe('true');
      expect((await inventory(server, kid, mapId)).items).toEqual({
        treats: resource('treats').gather!.quantity,
      });
      expect((await eventsOf(mapId)).filter((e) => e.type === 'resource.gathered')).toHaveLength(1);
    });

    it("lets a node's new owner take over a gather left behind", async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await join(server, kid, friend, mapId);
      const tile = await nodeTile(server, kid, mapId, 'timber');
      const { gather } = GatherResponseSchema.parse(
        (await gatherAt(server, kid, mapId, tile)).json(),
      );

      // The tile changes hands (captures arrive with #14; set it by hand here).
      await setTile(mapId, tile, { ownerUserId: friend.id });
      clock.setTime(Date.parse(gather.readyAt));
      const gone = await collect(server, kid, mapId, gather.id);
      expect(gone.statusCode).toBe(409);
      expect(errorOf(gone).message).toBe("That spot isn't yours anymore.");
      expect((await inventory(server, kid, mapId)).gathers).toEqual([]);
      const shown = (await view(server, kid, mapId)).tiles.find(
        (t) => t.q === tile.q && t.r === tile.r,
      );
      expect(shown?.gathering).toBeNull();

      expect((await gatherAt(server, friend, mapId, tile)).statusCode).toBe(201);
      const lost = await collect(server, kid, mapId, gather.id);
      expect(lost.statusCode).toBe(409);
      expect(errorOf(lost).message).toBe('Someone else looks after that spot now.');
    });

    it('uses the quick tutorial timer on a tutorial map', async () => {
      const server = await start();
      const kid = await player();
      const started = await call(server, 'POST', '/tutorial/start', kid);
      const mapId = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
      const tile = await nodeTile(server, kid, mapId, 'timber');
      const { gather } = GatherResponseSchema.parse(
        (await gatherAt(server, kid, mapId, tile)).json(),
      );
      expect(Date.parse(gather.readyAt) - Date.parse(gather.startedAt)).toBe(
        TUTORIAL_OVERRIDES.gatherSeconds * 1000,
      );
    });
  });

  describe('seasons (design doc §15)', () => {
    it('gathers Pumpkins and finds Witch Dust only in the Halloween window, map-local', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const ember = await nodeTile(server, kid, mapId, 'emberwood');
      // A pumpkin patch at home (generated maps put them on neutral land).
      const patch = (await view(server, kid, mapId)).tiles.find(
        (t) => t.ownerUserId === kid.id && t.nodeResource === null && t.homeSlot !== null,
      )!;
      await setTile(mapId, patch, { nodeResource: 'pumpkins' });

      // Nov 9, 23:30 in Denver is Nov 10 in UTC, but still Halloween on this map.
      clock.setTime(Date.parse('2026-11-10T06:30:00Z'));
      // Windows overlap (design doc §15): Thanksgiving has started too.
      expect((await inventory(server, kid, mapId)).seasons).toEqual(['halloween', 'thanksgiving']);
      const pumpkins = GatherResponseSchema.parse(
        (await gatherAt(server, kid, mapId, patch)).json(),
      );
      expect(pumpkins.gather.items).toEqual({
        pumpkins: PUMPKINS.gather!.quantity,
        'witch-dust': 1,
      });
      const embers = GatherResponseSchema.parse((await gatherAt(server, kid, mapId, ember)).json());
      expect(embers.gather.items).toEqual({
        emberwood: EMBERWOOD.gather!.quantity,
        'witch-dust': 1,
      });

      // A started gather finishes even after the window closes.
      clock.setTime(Date.parse('2026-11-11T12:00:00Z'));
      expect((await inventory(server, kid, mapId)).seasons).toEqual(['thanksgiving']);
      for (const g of [pumpkins.gather, embers.gather]) {
        expect((await collect(server, kid, mapId, g.id)).statusCode).toBe(200);
      }
      expect((await inventory(server, kid, mapId)).items).toEqual({
        emberwood: EMBERWOOD.gather!.quantity,
        pumpkins: PUMPKINS.gather!.quantity,
        'witch-dust': 2,
      });

      // After Halloween: no Pumpkins to gather, and Emberwood comes without Witch Dust.
      const shut = await gatherAt(server, kid, mapId, patch);
      expect(shut.statusCode).toBe(409);
      expect(errorOf(shut).message).toBe('Pumpkins only turn up around Halloween!');
      const plain = GatherResponseSchema.parse((await gatherAt(server, kid, mapId, ember)).json());
      expect(plain.gather.items).toEqual({ emberwood: EMBERWOOD.gather!.quantity });
    });
  });
});
