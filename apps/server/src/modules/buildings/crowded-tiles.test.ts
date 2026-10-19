import {
  HOME_BASE_RULES,
  HollowResponseSchema,
  HomeResponseSchema,
  MapResponseSchema,
  fuelCost,
  hearthfireState,
  parseGameEventPayload,
  spentOn,
  type ItemCounts,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import { ONE_BUILDING_PER_TILE, runMigrations } from '../../db/migrator.js';
import {
  buildings,
  factoryQueues,
  keepers,
  mapMembers,
  maps,
  sessions,
  squishies,
  tiles,
  users,
} from '../../db/schema.js';
import { databaseBefore, type ScratchDatabase } from '../../../tests/before-migration.js';
import { makeHomestead } from '../../../tests/homestead.js';
import { mapLocalTime } from '../../lib/time.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { packBeforeOneBuildingPerTile, packCrowdedTiles } from './crowded-tiles.js';
import { BUILDING_DATA } from './hearthfire.js';

/*
 * Migration B (#295, owner decision 2026-10-18): tiles still holding two or
 * more buildings are packed up with everything back, then the unique index
 * on `buildings.tile_id` goes in. Each test gets a scratch database migrated
 * up to migration B, seeds what the old rules allowed, and runs the migrate
 * step the way `pnpm db:migrate` does.
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

/*
 * Columns migrations after B add to tables the app writes on every patch
 * (#306's naming columns on `map_members`, migration 0050). Each test adds
 * them to its database from before B so the app can make its patches, and
 * the migrate step drops them first, for their migration to add for real.
 */
const LATER_COLUMNS: readonly (readonly [table: string, column: string, type: string])[] = [
  ['map_members', 'home_name', 'text'],
  ['map_members', 'home_named_at_level', 'smallint'],
  ['map_members', 'caught_count', 'integer default 0 not null'],
  ['map_members', 'kinds_built', "text[] default '{}'::text[] not null"],
];
const START = '2026-10-02T12:00:00Z';

interface Player {
  id: string;
  token: string;
}

/** Everything a building at `level` cost, from the building data. */
const cost = (buildingId: string, level: number): ItemCounts =>
  spentOn(BUILDING_DATA.get(buildingId)!, level);

const add = (...all: ItemCounts[]): ItemCounts => {
  const sum: ItemCounts = {};
  for (const items of all)
    for (const [id, n] of Object.entries(items)) sum[id] = (sum[id] ?? 0) + n;
  return sum;
};

describe.skipIf(!url)('migration B: crowded tiles packed up (#295, needs DATABASE_URL)', () => {
  let scratch: ScratchDatabase;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date(START);
  let counter = 0;
  const logged: { level: 'info' | 'error'; msg: string; obj: object }[] = [];
  const log = {
    info: (obj: object, msg: string) => logged.push({ level: 'info', msg, obj }),
    error: (obj: object, msg: string) => logged.push({ level: 'error', msg, obj }),
  };

  let laterColumns = false;

  beforeEach(async () => {
    scratch = await databaseBefore(url!, ONE_BUILDING_PER_TILE, { max: 10 });
    db = scratch.client.db;
    // The app makes patches here, so it needs the columns it writes.
    for (const [table, column, type] of LATER_COLUMNS) {
      await db.execute(`alter table "${table}" add column "${column}" ${type}`);
    }
    laterColumns = true;
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    await scratch.drop();
    clock.setTime(Date.parse(START));
    logged.length = 0;
  });

  /** Drops `LATER_COLUMNS` once, for their own migrations to add for real. */
  const dropLaterColumns = async () => {
    if (!laterColumns) return;
    for (const [table, column] of LATER_COLUMNS) {
      await db.execute(`alter table "${table}" drop column "${column}"`);
    }
    laterColumns = false;
  };

  /** The migrate step, as `pnpm db:migrate` runs it. */
  const migrate = async () => {
    await dropLaterColumns();
    await runMigrations(db, {
      beforeOneBuildingPerTile: (d) => packBeforeOneBuildingPerTile(d, () => clock, log),
    });
  };

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const [user] = await db
      .insert(users)
      .values({
        username: `crowded_${String((counter += 1))}`,
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

  const call = (server: FastifyInstance, path: string, who: Player) =>
    server.inject({
      method: 'GET',
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
      payload: { name: 'Crowded Patch', timeZone: ZONE },
    });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  /** My home ring tiles' ids, by (q, r). */
  async function ringTileIds(server: FastifyInstance, who: Player, mapId: string) {
    const { tiles: home } = HomeResponseSchema.parse(
      (await call(server, `/maps/${mapId}/home`, who)).json(),
    );
    const ring = home.filter((t) => !t.heartSeed);
    return Promise.all(
      ring.map(
        async (t) =>
          (await db.query.tiles.findFirst({
            where: (x, { and, eq }) => and(eq(x.mapId, mapId), eq(x.q, t.q), eq(x.r, t.r)),
          }))!.id,
      ),
    );
  }

  /** A building as the old rules let it stand. */
  const old = (
    mapId: string,
    who: Player,
    values: { buildingId: string; kind: string; tileId: string; spot: number; level?: number },
    extra: { fuelledThrough?: string } = {},
  ) =>
    db
      .insert(buildings)
      .values({ mapId, ownerUserId: who.id, ...values, ...extra, placedAt: clock })
      .returning({ id: buildings.id })
      .then(([row]) => row!.id);

  const squishy = (mapId: string, who: Player, job: Partial<typeof squishies.$inferInsert>) =>
    db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: who.id,
        speciesId: 'puddlepuff',
        element: 'water',
        feeling: 'silly',
        ...job,
      })
      .returning({ id: squishies.id })
      .then(([row]) => row!.id);

  const rowsOf = (mapId: string) =>
    db.query.buildings.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const bagOf = async (mapId: string, who: Player) =>
    Object.fromEntries(
      (
        await db.query.inventories.findMany({
          where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, who.id)),
        })
      )
        .filter((b) => b.quantity !== 0)
        .map((b) => [b.itemId, b.quantity]),
    );
  const noteOf = async (server: FastifyInstance, who: Player, mapId: string) =>
    HollowResponseSchema.parse((await call(server, `/maps/${mapId}/hollow`, who)).json()).hollow
      .crowdedTilesPacked;
  const indexed = async () =>
    (
      await db.execute<{ found: boolean }>(
        `select to_regclass('public.buildings_tile_id_key') is not null as found`,
      )
    )[0]!.found;

  it('packs up every building on a tile with 2 or 3, everything back, then adds the index', async () => {
    const server = await start();
    const kid = await player();
    const neighbour = await player();
    const mapId = await newMap(server, kid);
    const ring = await ringTileIds(server, kid, mapId);
    const plot = await makeHomestead(db, mapId, kid.id, clock, 0);
    await db.execute(`update tiles set node_resource = null where id = '${plot.id}'`);
    const local = mapLocalTime(clock, ZONE);

    // Two habitats on one ring tile, one upgraded, with a squishy living in it.
    const den = await old(mapId, kid, {
      buildingId: 'ember-den',
      kind: 'habitat',
      tileId: ring[0]!,
      spot: 1,
      level: 2,
    });
    const meadow = await old(mapId, kid, {
      buildingId: 'cozy-meadow',
      kind: 'habitat',
      tileId: ring[0]!,
      spot: 2,
    });
    const resident = await squishy(mapId, kid, { habitatBuildingId: den });

    // Three on one homestead: an upgraded fire with fuel left, Training
    // Grounds with a trainee, and a Factory with a batch going.
    const fuelledThrough = new Date(clock.getTime() + 3 * DAY_MS).toISOString().slice(0, 10);
    const fire = await old(
      mapId,
      kid,
      { buildingId: 'hearthfire', kind: 'hearthfire', tileId: plot.id, spot: 0, level: 2 },
      { fuelledThrough },
    );
    const grounds = await old(mapId, kid, {
      buildingId: 'training-grounds',
      kind: 'training-grounds',
      tileId: plot.id,
      spot: 1,
    });
    const factory = await old(mapId, kid, {
      buildingId: 'crafting-factory',
      kind: 'factory',
      tileId: plot.id,
      spot: 2,
    });
    const trainee = await squishy(mapId, kid, {
      trainingBuildingId: grounds,
      trainingSince: new Date(clock.getTime() - 2 * HOUR_MS),
    });
    // Ten charms at a minute each, started four and a half minutes ago: four made.
    const [batch] = await db
      .insert(factoryQueues)
      .values({
        mapId,
        userId: kid.id,
        buildingId: factory,
        recipeId: 'heart-charm',
        total: 10,
        itemSeconds: 60,
        output: { 'heart-charm': 1 },
        inputs: { timber: 2, treats: 1 },
        startedAt: new Date(clock.getTime() - 270_000),
      })
      .returning({ id: factoryQueues.id });
    // A patch-mate's batch in the same Factory, not started yet: it comes
    // back to them, and stays out of my note.
    const friend = await player();
    await db.insert(mapMembers).values({ mapId, userId: friend.id, role: 'member' });
    await db.insert(factoryQueues).values({
      mapId,
      userId: friend.id,
      buildingId: factory,
      recipeId: 'heart-charm',
      total: 2,
      itemSeconds: 60,
      output: { 'heart-charm': 1 },
      inputs: { timber: 2, treats: 1 },
      startedAt: new Date(clock.getTime() + HOUR_MS),
    });

    // Clean tiles: a lone habitat of mine, and a neighbour's lone one on
    // another patch. Neither is touched.
    const lone = await old(mapId, kid, {
      buildingId: 'cozy-meadow',
      kind: 'habitat',
      tileId: ring[1]!,
      spot: 1,
    });
    const otherMap = await newMap(server, neighbour);
    const otherRing = await ringTileIds(server, neighbour, otherMap);
    const theirs = await old(otherMap, neighbour, {
      buildingId: 'ember-den',
      kind: 'habitat',
      tileId: otherRing[0]!,
      spot: 1,
    });
    const untouched = await rowsOf(otherMap);

    expect(await indexed()).toBe(false);
    await migrate();
    expect(await indexed()).toBe(true);

    // Every building on the crowded tiles is gone; the clean ones stay as they were.
    const left = await rowsOf(mapId);
    expect(left.map((r) => r.id)).toEqual([lone]);
    expect(left[0]).toMatchObject({ tileId: ring[1], spot: 1, level: 1 });
    expect(await rowsOf(otherMap)).toEqual(untouched);
    expect(untouched.map((r) => r.id)).toEqual([theirs]);

    // Everything back: each building's build and upgrades, the fire's
    // unburned fuel, and the Factory's batch (four made, six runs' inputs).
    const fireData = BUILDING_DATA.get('hearthfire');
    if (fireData?.kind !== 'hearthfire') throw new Error('no Hearthfire data');
    const { nightsLeft } = hearthfireState(fuelledThrough, local, HOME_BASE_RULES);
    expect(nightsLeft).toBeGreaterThan(0);
    const buildRefund = add(
      cost('ember-den', 2),
      cost('cozy-meadow', 1),
      cost('hearthfire', 2),
      fuelCost(fireData, nightsLeft),
      cost('training-grounds', 1),
      cost('crafting-factory', 1),
    );
    const batchBack = { 'heart-charm': 4, timber: 12, treats: 6 };
    const everything = add(buildRefund, batchBack);
    expect(await bagOf(mapId, kid)).toEqual(everything);
    expect(await bagOf(otherMap, neighbour)).toEqual({});
    expect(await bagOf(mapId, friend)).toEqual({ timber: 4, treats: 2 });

    // The ledger reconciles: each building's refund against that building.
    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.mapId, mapId), eq(t.userId, kid.id), eq(t.reason, 'build-refund')),
    });
    expect(add(...ledger.map((l) => ({ [l.itemId]: l.delta })))).toEqual(buildRefund);
    expect(new Set(ledger.map((l) => l.refId))).toEqual(
      new Set([den, meadow, fire, grounds, factory]),
    );
    expect(
      await db.query.factoryQueues.findFirst({ where: (t, { eq }) => eq(t.id, batch!.id) }),
    ).toMatchObject({ banked: 4, endReason: 'taken-down' });

    // The resident moved out; the trainee landed its XP and stopped.
    expect(
      await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, resident) }),
    ).toMatchObject({ habitatBuildingId: null });
    const trained = await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, trainee) });
    expect(trained).toMatchObject({ trainingBuildingId: null, trainingSince: null });
    expect(trained!.xp).toBeGreaterThan(0);

    // One `building.removed` each, packed, naming who moved out.
    const removed = (
      await db.query.gameEvents.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'building.removed')),
      })
    ).map((e) => parseGameEventPayload('building.removed', e.payload));
    expect(removed.map((p) => p.buildingRowId).sort()).toEqual(
      [den, meadow, fire, grounds, factory].sort(),
    );
    expect(removed.every((p) => p.lost === 'packed')).toBe(true);
    expect(removed.find((p) => p.buildingRowId === den)?.movedOut).toEqual([resident]);
    expect(removed.find((p) => p.buildingRowId === grounds)?.movedOut).toEqual([trainee]);

    // The morning report's one-time note says what came back; the neighbour has none.
    expect(await noteOf(server, kid, mapId)).toEqual({
      refund: everything,
      at: clock.toISOString(),
    });
    expect(await noteOf(server, neighbour, otherMap)).toBeNull();
    expect(logged).toEqual([
      {
        level: 'info',
        msg: 'packed up crowded tiles before the one-building-per-tile index',
        obj: { players: 1, packed: 5, failed: 0 },
      },
    ]);

    // The index now turns away a second building on a tile.
    await expect(
      old(mapId, kid, { buildingId: 'ember-den', kind: 'habitat', tileId: ring[1]!, spot: 2 }),
    ).rejects.toMatchObject({ cause: { code: '23505', constraint_name: 'buildings_tile_id_key' } });

    // Migrating again changes nothing, and the pack-up has nothing to do.
    const seen = await db.query.gameEvents.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
    await migrate();
    expect(await packCrowdedTiles(db, () => clock)).toEqual({ players: 0, packed: 0, failed: 0 });
    expect(
      await db.query.gameEvents.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) }),
    ).toHaveLength(seen.length);
    expect(await bagOf(mapId, kid)).toEqual(everything);
  });

  it('stops before the index when a player fails, and a re-run finishes the job', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const ring = await ringTileIds(server, kid, mapId);
    for (const [buildingId, spot] of [
      ['ember-den', 1],
      ['cozy-meadow', 2],
    ] as const) {
      await old(mapId, kid, { buildingId, kind: 'habitat', tileId: ring[0]!, spot });
    }
    // The player's transaction throws (its clock, read inside it).
    await dropLaterColumns();
    await expect(
      runMigrations(db, {
        beforeOneBuildingPerTile: (d) =>
          packBeforeOneBuildingPerTile(
            d,
            () => {
              throw new Error('boom');
            },
            log,
          ),
      }),
    ).rejects.toThrow('crowded-tile pack-up failed for 1 player(s)');
    expect(await indexed()).toBe(false);
    expect(await rowsOf(mapId)).toHaveLength(2);
    expect(await bagOf(mapId, kid)).toEqual({});
    expect(logged).toEqual([
      {
        level: 'error',
        msg: 'crowded-tile pack-up failed for a player',
        obj: expect.objectContaining({ mapId, userId: kid.id }) as object,
      },
    ]);

    await migrate();
    expect(await indexed()).toBe(true);
    expect(await rowsOf(mapId)).toEqual([]);
    expect(await bagOf(mapId, kid)).toEqual(add(cost('ember-den', 1), cost('cozy-meadow', 1)));
  });

  it('packs a crowded Tutorial Glade tile too: the index holds on every map', async () => {
    const kid = await player();
    const [glade] = await db
      .insert(maps)
      .values({ kind: 'tutorial', name: 'Glade', timeZone: ZONE, maxPlayers: 1 })
      .returning({ id: maps.id });
    const mapId = glade!.id;
    await db.insert(mapMembers).values({ mapId, userId: kid.id, role: 'owner' });
    const [ring] = await db
      .insert(tiles)
      .values({ mapId, q: 0, r: 0, terrain: 'meadow', ownerUserId: kid.id, homeSlot: 0 })
      .returning({ id: tiles.id });
    for (const [buildingId, spot] of [
      ['ember-den', 1],
      ['cozy-meadow', 2],
    ] as const) {
      await old(mapId, kid, { buildingId, kind: 'habitat', tileId: ring!.id, spot });
    }
    await migrate();
    expect(await rowsOf(mapId)).toEqual([]);
    expect(await bagOf(mapId, kid)).toEqual(add(cost('ember-den', 1), cost('cozy-meadow', 1)));
  });
});

describe.skipIf(!url)('migration B on a clean database (#295, needs DATABASE_URL)', () => {
  it('adds the index with nothing to pack on an empty database', async () => {
    const scratch = await databaseBefore(url!, ONE_BUILDING_PER_TILE);
    try {
      const db = scratch.client.db;
      const logged: string[] = [];
      const log = { info: (_: object, msg: string) => logged.push(msg), error: () => undefined };
      await runMigrations(db, {
        beforeOneBuildingPerTile: (d) => packBeforeOneBuildingPerTile(d, () => new Date(), log),
      });
      expect(logged).toEqual([]);
      const found = await db.execute<{ found: boolean }>(
        `select to_regclass('public.buildings_tile_id_key') is not null as found`,
      );
      expect(found[0]!.found).toBe(true);
    } finally {
      await scratch.drop();
    }
  });
});
