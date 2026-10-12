import {
  HollowResponseSchema,
  HomeResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, squishies, users } from '../../db/schema.js';
import { makeHomestead } from '../../../tests/homestead.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { planOwnerTileUses, relayoutTileUses } from './tile-uses.js';

/*
 * One building per tile (#295): the boot pass that tidies patches built
 * under the old rules, its dry run, and its morning-report note. The pass
 * scans every patch in the database (other tests' too), so each test checks
 * only its own patch's rows and events.
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
const START = '2026-10-02T12:00:00Z';

interface Player {
  id: string;
  token: string;
}

describe.skipIf(!url)('one building per tile: the tidy-up pass (#295, needs DATABASE_URL)', () => {
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
    const [user] = await db
      .insert(users)
      .values({
        username: `tidier_${String((counter += 1))}`,
        passwordHash: 'not-a-hash',
        birthYear: 2014,
        timeZone: ZONE,
      })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
    });
    return { id: user!.id, token };
  }

  const call = (server: FastifyInstance, method: 'GET' | 'POST', path: string, who: Player) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
    });

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/maps',
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      payload: { name: 'Tidy Patch', timeZone: ZONE },
    });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  /** My home tiles' ids: the Heart Seed's, then the ring's, by (q, r). */
  async function homeTileIds(server: FastifyInstance, who: Player, mapId: string) {
    const { tiles } = HomeResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/home`, who)).json(),
    );
    const idOf = async (t: { q: number; r: number }) =>
      (await db.query.tiles.findFirst({
        where: (x, { and, eq }) => and(eq(x.mapId, mapId), eq(x.q, t.q), eq(x.r, t.r)),
      }))!.id;
    const seed = tiles.find((t) => t.heartSeed)!;
    const ring = tiles.filter((t) => !t.heartSeed);
    return { seed: await idOf(seed), ring: await Promise.all(ring.map(idOf)) };
  }

  /** A building as the old rules let it stand, placed `daysAgo` days ago. */
  const old = (
    mapId: string,
    who: Player,
    buildingId: string,
    kind: string,
    tileId: string,
    spot: number,
    daysAgo: number,
  ) =>
    db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: who.id,
        tileId,
        buildingId,
        kind,
        spot,
        placedAt: new Date(clock.getTime() - daysAgo * DAY_MS),
      })
      .returning({ id: buildings.id })
      .then(([row]) => row!.id);

  /** An open homestead (no resource spot) of `who`'s on forest land. */
  async function openHomestead(mapId: string, who: Player, nth: number) {
    const plot = await makeHomestead(db, mapId, who.id, clock, nth);
    await db.execute(
      `update tiles set node_resource = null, terrain = 'forest' where id = '${plot.id}'`,
    );
    return plot;
  }

  const pass = async () => {
    const errors: unknown[] = [];
    await relayoutTileUses(
      db,
      () => clock,
      (_owner, err) => errors.push(err),
    );
    expect(errors).toEqual([]);
  };

  const rowsOf = (mapId: string) =>
    db.query.buildings.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const noteOf = async (server: FastifyInstance, who: Player, mapId: string) =>
    HollowResponseSchema.parse((await call(server, 'GET', `/maps/${mapId}/hollow`, who)).json())
      .hollow.tileUseNote;

  it('moves extra home buildings to free home tiles, keeping each row, once', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const { ring } = await homeTileIds(server, kid, mapId);
    // Two habitats on one ring tile, and the Factory sharing another with a
    // habitat: the old rules allowed several to a tile.
    const den = await old(mapId, kid, 'ember-den', 'habitat', ring[0]!, 1, 3);
    const meadow = await old(mapId, kid, 'cozy-meadow', 'habitat', ring[0]!, 2, 2);
    const factory = await old(mapId, kid, 'crafting-factory', 'factory', ring[1]!, 1, 3);
    const meadow2 = await old(mapId, kid, 'cozy-meadow', 'habitat', ring[1]!, 3, 1);

    // The dry run sees the same plan and writes nothing.
    const dry = await planOwnerTileUses(db, { mapId, userId: kid.id });
    expect(dry.plan.move.map((m) => m.id).sort()).toEqual([meadow, meadow2].sort());
    expect(dry.plan.pack).toEqual([]);
    expect((await rowsOf(mapId)).map((r) => [r.id, r.tileId]).sort()).toEqual(
      [
        [den, ring[0]],
        [meadow, ring[0]],
        [factory, ring[1]],
        [meadow2, ring[1]],
      ].sort(),
    );

    await pass();
    const after = await rowsOf(mapId);
    expect(after.map((r) => r.id).sort()).toEqual([den, meadow, factory, meadow2].sort());
    // The oldest on each tile stays; the others are now alone on home tiles.
    expect(after.find((r) => r.id === den)?.tileId).toBe(ring[0]);
    expect(after.find((r) => r.id === factory)?.tileId).toBe(ring[1]);
    const perTile = new Map<string, number>();
    for (const r of after) perTile.set(r.tileId, (perTile.get(r.tileId) ?? 0) + 1);
    expect(Math.max(...perTile.values())).toBe(1);
    const events = await eventsOf(mapId);
    expect(events.filter((e) => e.type === 'building.moved')).toHaveLength(2);
    const note = await noteOf(server, kid, mapId);
    expect(note).toMatchObject({ packed: [], refund: {}, stoppedGatherers: [] });
    expect(note?.moved.map((m) => m.buildingId)).toEqual(['cozy-meadow', 'cozy-meadow']);
    expect(note?.at).toBe(clock.toISOString());

    // Run again: nothing left to do here.
    await pass();
    expect(await eventsOf(mapId)).toHaveLength(events.length);
  });

  it('keeps the fire on a shared homestead, moves the Training Grounds with its trainee, and stops a gatherer there', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const plot = await openHomestead(mapId, kid, 0);
    const spare = await openHomestead(mapId, kid, 1);
    // The Training Grounds is older, but the fire stays (it lights the land).
    const grounds = await old(mapId, kid, 'training-grounds', 'training-grounds', plot.id, 1, 3);
    const fire = await old(mapId, kid, 'hearthfire', 'hearthfire', plot.id, 0, 1);
    const [trainee, gatherer] = await db
      .insert(squishies)
      .values([
        {
          mapId,
          ownerUserId: kid.id,
          speciesId: 'puddlepuff',
          element: 'water',
          feeling: 'silly',
          nickname: 'Splash',
          trainingBuildingId: grounds,
          trainingSince: new Date(clock.getTime() - 2 * HOUR_MS),
        },
        {
          mapId,
          ownerUserId: kid.id,
          speciesId: 'puddlepuff',
          element: 'water',
          feeling: 'silly',
          nickname: 'Pip',
          workTileId: plot.id,
          workSince: new Date(clock.getTime() - HOUR_MS),
          workStartedAt: new Date(clock.getTime() - HOUR_MS),
        },
      ])
      .returning({ id: squishies.id });

    await pass();
    const after = await rowsOf(mapId);
    expect(after.find((r) => r.id === fire)?.tileId).toBe(plot.id);
    expect(after.find((r) => r.id === grounds)).toMatchObject({ tileId: spare.id, spot: 1 });
    // The trainee landed its two hours and carries on there.
    const pal = await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, trainee!.id) });
    expect(pal).toMatchObject({ xp: 10, trainingBuildingId: grounds });
    expect(pal?.trainingSince?.toISOString()).toBe(clock.toISOString());
    // The gatherer on the fire's tile stopped; what it had ready went in the bag.
    const worker = await db.query.squishies.findFirst({
      where: (t, { eq }) => eq(t.id, gatherer!.id),
    });
    expect(worker).toMatchObject({ workTileId: null });
    expect(await noteOf(server, kid, mapId)).toMatchObject({
      moved: [
        {
          buildingId: 'training-grounds',
          from: { q: plot.q, r: plot.r },
          to: { q: spare.q, r: spare.r },
        },
      ],
      packed: [],
      stoppedGatherers: [{ squishyId: gatherer!.id, name: 'Pip' }],
    });
    const types = (await eventsOf(mapId)).map((e) => e.type);
    expect(types).toContain('building.moved');
    expect(types).toContain('squishy.trained');
  });

  it('packs what has nowhere to go, with everything back and its trainee landed', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const plot = await openHomestead(mapId, kid, 0);
    const grounds = await old(mapId, kid, 'training-grounds', 'training-grounds', plot.id, 1, 3);
    await old(mapId, kid, 'hearthfire', 'hearthfire', plot.id, 0, 1);
    const [trainee] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: kid.id,
        speciesId: 'puddlepuff',
        element: 'water',
        feeling: 'silly',
        trainingBuildingId: grounds,
        trainingSince: new Date(clock.getTime() - 2 * HOUR_MS),
      })
      .returning({ id: squishies.id });

    await pass();
    expect((await rowsOf(mapId)).find((r) => r.id === grounds)).toBeUndefined();
    expect(
      await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, trainee!.id) }),
    ).toMatchObject({ xp: 10, trainingBuildingId: null, trainingSince: null });
    // Everything it cost, whole (level 1).
    const refund = { timber: 8, stone: 8 };
    const bag = await db.query.inventories.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
    });
    expect(Object.fromEntries(bag.map((b) => [b.itemId, b.quantity]))).toEqual(refund);
    expect(await noteOf(server, kid, mapId)).toMatchObject({
      moved: [],
      packed: [{ buildingId: 'training-grounds', q: plot.q, r: plot.r }],
      refund,
    });
    const removed = (await eventsOf(mapId)).filter((e) => e.type === 'building.removed');
    expect(removed.map((e) => parseGameEventPayload('building.removed', e.payload))).toEqual([
      expect.objectContaining({ lost: 'packed', refund, movedOut: [trainee!.id] }),
    ]);
  });

  it('leaves a building already on a resource spot alone (grandfathered), and a tidy home has no note', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const plot = await makeHomestead(db, mapId, kid.id, clock, 0);
    await db.execute(`update tiles set node_resource = 'stone' where id = '${plot.id}'`);
    const grounds = await old(mapId, kid, 'training-grounds', 'training-grounds', plot.id, 1, 3);
    await pass();
    expect((await rowsOf(mapId)).find((r) => r.id === grounds)?.tileId).toBe(plot.id);
    expect(await noteOf(server, kid, mapId)).toBeNull();
  });
});
