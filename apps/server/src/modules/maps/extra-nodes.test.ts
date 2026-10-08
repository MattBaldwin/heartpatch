import {
  CraftResponseSchema,
  GAME_DATA,
  MapResponseSchema,
  MapViewSchema,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { seedExtraNodes } from './extra-nodes.js';

/*
 * New things to gather (#238): Water, Greens and Ice nodes come to maps made
 * before them on the next read, the same ones a new map is made with, once;
 * and a Frost squishy on the team freezes Water into Ice faster.
 */

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
const START = '2026-10-02T18:00:00Z';

/** `terrain:resource` pairs the extra pass makes (and the main pass never does). */
const EXTRA = new Set(
  GAME_DATA.terrains.flatMap((t) =>
    (t.extraNodes ?? [])
      .filter((e) => !t.nodeResources.includes(e.resource))
      .map((e) => `${t.id}:${e.resource}`),
  ),
);

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('new gatherables (#238, needs DATABASE_URL)', () => {
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
    const username = `wellkeeper_${String((counter += 1))}`;
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

  async function patch(server: FastifyInstance, owner: Player) {
    const res = await call(server, 'POST', '/maps', owner, { name: 'Pond Patch', timeZone: ZONE });
    expect(res.statusCode, res.body).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
  const nodesOf = async (mapId: string) =>
    new Map((await tilesOf(mapId)).map((t) => [`${String(t.q)},${String(t.r)}`, t.nodeResource]));

  it('gives a map made before them the same nodes a new map gets, once', async () => {
    const server = await start();
    const extrasOf = async (id: string) =>
      (await tilesOf(id)).filter(
        (t) => t.homeSlot === null && EXTRA.has(`${t.terrain}:${String(t.nodeResource)}`),
      );
    const hasWell = async (id: string) =>
      (await extrasOf(id)).some((t) => t.nodeResource === 'water');
    // About 1 map in 2,500 has no lake at all, so no well (CI drew one): then
    // another Keeper makes another patch. Five such maps in a row: ~1 in 10^17.
    let kid = await player();
    let mapId = await patch(server, kid);
    for (let tries = 0; tries < 4 && !(await hasWell(mapId)); tries++) {
      kid = await player();
      mapId = await patch(server, kid);
    }
    const made = await nodesOf(mapId);
    const extras = await extrasOf(mapId);
    expect(extras.some((t) => t.nodeResource === 'water')).toBe(true);

    // As it was before #238: no extra nodes, and a fire in one tile's middle.
    for (const t of extras) {
      await db.execute(`update tiles set node_resource = null where id = '${t.id}'`);
    }
    const busy = extras[0]!;
    await db.execute(`update tiles set owner_user_id = '${kid.id}' where id = '${busy.id}'`);
    await db.insert(buildings).values({
      mapId,
      ownerUserId: kid.id,
      tileId: busy.id,
      buildingId: 'hearthfire',
      kind: 'hearthfire',
      spot: 0,
    });

    const view = MapViewSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/view`, kid)).json(),
    );
    const after = await nodesOf(mapId);
    const busyKey = `${String(busy.q)},${String(busy.r)}`;
    for (const [key, node] of made) {
      expect(after.get(key), key).toBe(key === busyKey ? null : node);
    }
    // The view it answered with has them already.
    expect(view.tiles.filter((t) => t.nodeResource === 'water').length).toBeGreaterThan(0);
    // Nothing twice; the busy tile gets its node once its middle is free.
    expect(await seedExtraNodes(db, mapId)).toBe(0);
    await db.execute(`delete from buildings where tile_id = '${busy.id}'`);
    expect(await seedExtraNodes(db, mapId)).toBe(1);
    expect(await nodesOf(mapId)).toEqual(made);
  });

  it('waits for a gatherer on bare land to finish, so its work never changes what it pays', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const made = await nodesOf(mapId);
    const extra = (await tilesOf(mapId)).find(
      (t) => t.homeSlot === null && EXTRA.has(`${t.terrain}:${String(t.nodeResource)}`),
    )!;
    // As it was before #238, and my squishy farming the bare land there.
    await db.execute(
      `update tiles set node_resource = null, owner_user_id = '${kid.id}' where id = '${extra.id}'`,
    );
    const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
      level: 10,
      speciesId: 'thistlepip',
    });
    expect(granted.statusCode, granted.body).toBe(201);
    const squishyId = granted.json<{ squishy: { id: string } }>().squishy.id;
    await db.execute(
      `update squishies set team_slot = null, work_tile_id = '${extra.id}', work_since = now(), work_started_at = now() where id = '${squishyId}'`,
    );
    const key = `${String(extra.q)},${String(extra.r)}`;

    await seedExtraNodes(db, mapId);
    expect((await nodesOf(mapId)).get(key)).toBeNull();
    // The job ends: the node comes on the next read.
    await db.execute(
      `update squishies set work_tile_id = null, work_since = null, work_started_at = null where id = '${squishyId}'`,
    );
    expect(await seedExtraNodes(db, mapId)).toBe(1);
    expect((await nodesOf(mapId)).get(key)).toBe(made.get(key));
  });

  it('two readers at once add each node once', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const made = await nodesOf(mapId);
    await db.execute(
      `update tiles set node_resource = null where map_id = '${mapId}' and home_slot is null and node_resource in ('water', 'ice', 'greens')`,
    );
    const counts = await Promise.all([seedExtraNodes(db, mapId), seedExtraNodes(db, mapId)]);
    const extras = [...made.values()].filter((n) => n === 'water' || n === 'ice' || n === 'greens');
    // Each node added exactly once, between the two of them.
    expect(counts[0] + counts[1]).toBe(extras.length);
    expect(await nodesOf(mapId)).toEqual(made);
  });

  it('freezes Water into Ice twice as fast with a Frost squishy on the team', async () => {
    const server = await start();
    const minutes = async (speciesId: string) => {
      const kid = await player();
      const mapId = await patch(server, kid);
      await withTransaction(db, (tx) =>
        grantItems(tx, { mapId, userId: kid.id }, { water: 3 }, 'dev-grant'),
      );
      const squishy = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
        level: 10,
        speciesId,
      });
      expect(squishy.statusCode).toBe(201);
      const res = await call(server, 'POST', `/maps/${mapId}/crafts`, kid, {
        recipeId: 'freeze-water',
      });
      expect(res.statusCode, res.body).toBe(201);
      const { craft, items } = CraftResponseSchema.parse(res.json());
      expect(craft.items).toEqual({ ice: 1 });
      expect(items['water'] ?? 0).toBe(0);
      return (Date.parse(craft.readyAt) - Date.parse(craft.startedAt)) / 60_000;
    };
    expect(await minutes('snoozicle')).toBe(15);
    expect(await minutes('thistlepip')).toBe(30);
  });
});
