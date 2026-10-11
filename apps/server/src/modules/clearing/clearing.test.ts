import {
  ApiErrorSchema,
  ClearResponseSchema,
  CLEARING_RULES,
  InventoryResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  SettleResponseSchema,
  type MapView,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { makeHomestead, type HomesteadTile } from '../../../tests/homestead.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { seedExtraNodes } from '../maps/extra-nodes.js';

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
const START = '2026-10-02T12:00:00Z';
const CLEAR_MS = CLEARING_RULES.seconds * 1000;

interface Player {
  id: string;
  token: string;
}

describe.skipIf(!url)('clearing land (#242, needs DATABASE_URL)', () => {
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
        username: `clearer_${String((counter += 1))}`,
        passwordHash: 'not-a-hash',
        birthYear: 2014,
        timeZone: 'America/Denver',
      })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({
        userId: user!.id,
        tokenHash,
        expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
      });
    return { id: user!.id, token };
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

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, {
      name: 'Clear Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function view(server: FastifyInstance, who: Player, mapId: string): Promise<MapView> {
    const res = await call(server, 'GET', `/maps/${mapId}/view`, who);
    expect(res.statusCode).toBe(200);
    return MapViewSchema.parse(res.json());
  }

  const tileOf = async (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    at: { q: number; r: number },
  ) => (await view(server, who, mapId)).tiles.find((t) => t.q === at.q && t.r === at.r)!;

  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));

  /** Hand-edits a tile's land (map generation isn't this module's). Ids and words this test made. */
  const setLand = (tile: HomesteadTile, terrain: string, node: string | null) =>
    db.execute(
      `update tiles set terrain = '${terrain}', node_resource = ${node === null ? 'null' : `'${node}'`} where id = '${tile.id}'`,
    );

  const clear = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    at: { q: number; r: number },
  ) => call(server, 'POST', `/maps/${mapId}/clears`, who, { q: at.q, r: at.r });

  const settle = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'POST', `/maps/${mapId}/settle`, who);
    expect(res.statusCode).toBe(200);
    return SettleResponseSchema.parse(res.json());
  };

  const bag = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/inventory`, who);
    expect(res.statusCode).toBe(200);
    return InventoryResponseSchema.parse(res.json());
  };

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  /** A player with a patch, an Axe and a forest homestead with a Timber spot. */
  async function forestHomestead() {
    const server = await start();
    const kid = await player();
    const mapId = await newMap(server, kid);
    const plot = await makeHomestead(db, mapId, kid.id, clock);
    await setLand(plot, 'forest', 'timber');
    await give(mapId, kid, { axe: CLEARING_RULES.tools.find((t) => t.id === 'axe')!.uses });
    return { server, kid, mapId, plot };
  }

  it('spends one Axe use, shows "clearing here", and turns the tile into cleared land when it settles', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    const res = await clear(server, kid, mapId, plot);
    expect(res.statusCode).toBe(201);
    const started = ClearResponseSchema.parse(res.json());
    expect(started.clearing).toMatchObject({
      q: plot.q,
      r: plot.r,
      tool: 'axe',
      drop: { timber: 5 },
    });
    expect(started.items['axe']).toBe(2);
    expect(Date.parse(started.clearing.readyAt) - Date.parse(START)).toBe(CLEAR_MS);
    expect((await tileOf(server, kid, mapId, plot)).clearing).toEqual({
      readyAt: started.clearing.readyAt,
    });
    expect((await bag(server, kid, mapId)).clears).toEqual([started.clearing]);

    // Not yet: nothing changes, and the settle says when to ask again.
    const early = await settle(server, kid, mapId);
    expect(early.cleared).toEqual([]);
    expect(early.nextAt).toBe(started.clearing.readyAt);
    expect((await tileOf(server, kid, mapId, plot)).terrain).toBe('forest');

    clock.setTime(Date.parse(START) + CLEAR_MS);
    const done = await settle(server, kid, mapId);
    expect(done.cleared).toEqual([{ q: plot.q, r: plot.r, items: { timber: 5 } }]);
    expect(done.items['timber']).toBe(5);
    const tile = await tileOf(server, kid, mapId, plot);
    expect(tile).toMatchObject({ terrain: 'clearing', nodeResource: null, clearing: null });
    // Still a homestead: explore progress never depended on terrain (#199).
    expect(tile.homestead).toBe('joined');
    expect((await bag(server, kid, mapId)).clears).toEqual([]);

    // Settling again banks nothing twice.
    expect((await settle(server, kid, mapId)).cleared).toEqual([]);
    const ledger = await db.query.resourceLedger.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'clear')),
    });
    expect(ledger.map((l) => [l.itemId, l.delta]).sort()).toEqual([
      ['axe', -1],
      ['timber', 5],
    ]);

    const types = (await eventsOf(mapId)).map((e) => e.type);
    expect(types.filter((t) => t === 'clearing.started' || t === 'tile.cleared')).toEqual([
      'clearing.started',
      'tile.cleared',
    ]);
    // Members see where and when, never the tool or the drop.
    for (const event of await eventsOf(mapId)) {
      if (event.type !== 'clearing.started' && event.type !== 'tile.cleared') continue;
      const pub = publicViewFor(PUBLIC_VIEWS, event, { userId: 'someone-else' });
      expect(pub).not.toHaveProperty('drop');
      expect(pub).not.toHaveProperty('tool');
    }
  });

  it('stays cleared: the extra-node pass never plants a node back', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
    clock.setTime(Date.parse(START) + CLEAR_MS);
    await settle(server, kid, mapId);
    await seedExtraNodes(db, mapId);
    expect((await tileOf(server, kid, mapId, plot)).nodeResource).toBeNull();
  });

  it('a meadow drops a little of its Greens', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    await setLand(plot, 'meadow', null);
    await give(mapId, kid, { spade: 3 });
    const res = await clear(server, kid, mapId, plot);
    expect(ClearResponseSchema.parse(res.json()).clearing).toMatchObject({
      tool: 'spade',
      drop: { greens: 4 },
    });
  });

  it('lets the clear go, and keeps the tool use spent, if the land changes hands first', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
    await db.execute(`update tiles set owner_user_id = null where id = '${plot.id}'`);
    clock.setTime(Date.parse(START) + CLEAR_MS);
    const done = await settle(server, kid, mapId);
    expect(done.cleared).toEqual([]);
    expect(done.items['timber']).toBeUndefined();
    expect(done.items['axe']).toBe(2);
    const row = await db.query.tileClears.findFirst({
      where: (t, { eq }) => eq(t.tileId, plot.id),
    });
    expect(row).toMatchObject({ endReason: 'lost' });
    const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, plot.id) });
    expect(tile).toMatchObject({ terrain: 'forest', nodeResource: 'timber' });
  });

  it('needs the right tool, a joined homestead, clearable land and nothing in the way', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    const refused = async (at: { q: number; r: number }, status: number, message: RegExp) => {
      const res = await clear(server, kid, mapId, at);
      expect(res.statusCode, message.source).toBe(status);
      expect(errorOf(res).message).toMatch(message);
    };

    // A lake can't be cleared (owner Q5), nor Old Forest.
    await setLand(plot, 'lake', 'water');
    await refused(plot, 409, /can't be cleared/);
    await setLand(plot, 'old-forest', 'emberwood');
    await refused(plot, 409, /can't be cleared/);
    // A mountain needs a Pickaxe.
    await setLand(plot, 'mountains', 'stone');
    await refused(plot, 409, /Pickaxe/);
    await setLand(plot, 'forest', 'timber');

    // Home tiles stay as they are.
    const home = (await view(server, kid, mapId)).tiles.find(
      (t) => t.ownerUserId === kid.id && t.homeSlot !== null,
    )!;
    await refused(home, 409, /home/i);

    // Land that isn't a homestead yet.
    await db.execute(
      `update tile_explore set joined_at = null, completed_at = null where tile_id = '${plot.id}'`,
    );
    await refused(plot, 409, /Explore this land first/);
    await db.execute(
      `update tile_explore set joined_at = '${START}', completed_at = '${START}' where tile_id = '${plot.id}'`,
    );

    // A paused homestead naps.
    await db.execute(`update tile_explore set paused_at = '${START}' where tile_id = '${plot.id}'`);
    await refused(plot, 409, /napping/);
    await db.execute(`update tile_explore set paused_at = null where tile_id = '${plot.id}'`);

    // Someone else's land.
    const neutral = (await view(server, kid, mapId)).tiles.find(
      (t) => t.ownerUserId === null && t.homeSlot === null,
    )!;
    await refused(neutral, 403, /your own land/);

    // One at a time.
    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
    const second = await makeHomestead(db, mapId, kid.id, clock, 1);
    await setLand(second, 'forest', 'timber');
    await refused(second, 409, /One at a time/);

    // Nothing was spent by a refusal: one use went on the one clear.
    expect((await bag(server, kid, mapId)).items['axe']).toBe(2);
  });

  it('waits for a gather on the spot to finish', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    const gather = await call(server, 'POST', `/maps/${mapId}/gathers`, kid, {
      q: plot.q,
      r: plot.r,
    });
    expect(gather.statusCode).toBe(201);
    const res = await clear(server, kid, mapId, plot);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res).message).toMatch(/gathering here/);
  });
});
