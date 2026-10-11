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
import {
  battles,
  buildings,
  keepers,
  mapMembers,
  sessions,
  squishies,
  tileAttacks,
  tileDefenders,
  users,
} from '../../db/schema.js';
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
    await db.insert(sessions).values({
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
    headers: Record<string, string> = {},
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...HEADERS, ...headers },
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

  /** A squishy of the player's, resting. */
  async function pal(mapId: string, who: Player): Promise<string> {
    const [row] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: who.id,
        speciesId: 'puddlepuff',
        element: 'water',
        feeling: 'silly',
        level: 5,
        createdAt: new Date(clock),
      })
      .returning({ id: squishies.id });
    return row!.id;
  }

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
    expect(done.cleared).toEqual([
      { q: plot.q, r: plot.r, items: { timber: 5 }, landCleared: true },
    ]);
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

  /** A rival on the patch. */
  async function rivalOn(mapId: string): Promise<Player> {
    const rival = await player();
    await db.insert(mapMembers).values({ mapId, userId: rival.id, role: 'member' });
    return rival;
  }

  /** A capture of the tile by `rival` at the clock's time, recorded the way #15 does, and the land theirs. */
  async function capture(mapId: string, tileId: string, from: Player, rival: Player) {
    const [battle] = await db
      .insert(battles)
      .values({
        mapId,
        kind: 'rival-tile',
        playerUserId: rival.id,
        seed: '00',
        contentHash: 'x',
        setup: {},
        actions: [],
        state: {},
        status: 'finished',
        startedAt: clock,
      })
      .returning({ id: battles.id });
    await db.insert(tileAttacks).values({
      mapId,
      tileId,
      attackerUserId: rival.id,
      defenderUserId: from.id,
      battleId: battle!.id,
      outcome: 'captured',
      startedAt: clock,
      cooldownUntil: clock,
      lastActionAt: clock,
      endedAt: new Date(clock),
    });
    await db.execute(`update tiles set owner_user_id = '${rival.id}' where id = '${tileId}'`);
  }

  /** Makes the tile a joined homestead of `who` too (their explore row), as capturing explored land does. */
  const joinAsHomestead = (mapId: string, tileId: string, who: Player) =>
    db.execute(
      `insert into tile_explore (user_id, tile_id, map_id, layout, terrain, searched, spot_count, completed_at, joined_at)
       values ('${who.id}', '${tileId}', '${mapId}', 1, 'forest', 7, 3, '${START}', '${START}')`,
    );

  const clearRow = (tileId: string) =>
    db.query.tileClears.findFirst({ where: (t, { eq }) => eq(t.tileId, tileId) });

  it('lets the clear go, and keeps the tool use spent, if the land is captured first', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    const rival = await rivalOn(mapId);
    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
    clock.setTime(Date.parse(START) + CLEAR_MS / 2);
    await capture(mapId, plot.id, kid, rival);
    clock.setTime(Date.parse(START) + CLEAR_MS);
    const done = await settle(server, kid, mapId);
    expect(done.cleared).toEqual([]);
    expect(done.items['timber']).toBeUndefined();
    expect(done.items['axe']).toBe(2);
    expect(await clearRow(plot.id)).toMatchObject({ endReason: 'lost' });
    const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, plot.id) });
    expect(tile).toMatchObject({ terrain: 'forest', nodeResource: 'timber' });
  });

  it("banks the drop for its clearer, and leaves the new owner's land alone, when a capture came after it was done", async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    const rival = await rivalOn(mapId);
    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
    // Done, but the kid closed the app; the land changes hands an hour later.
    clock.setTime(Date.parse(START) + CLEAR_MS + 60 * 60 * 1000);
    await capture(mapId, plot.id, kid, rival);
    // The new owner sees their land as it is, and gathers its spot.
    const seen = await tileOf(server, rival, mapId, plot);
    expect(seen).toMatchObject({ terrain: 'forest', nodeResource: 'timber', clearing: null });
    const gather = await call(server, 'POST', `/maps/${mapId}/gathers`, rival, {
      q: plot.q,
      r: plot.r,
    });
    expect(gather.statusCode).toBe(201);

    // The kid comes back: the drop lands, and the rival's land stays as it is.
    clock.setTime(Date.parse(START) + 2 * CLEAR_MS + 60 * 60 * 1000);
    const done = await settle(server, kid, mapId);
    expect(done.cleared).toEqual([
      { q: plot.q, r: plot.r, items: { timber: 5 }, landCleared: false },
    ]);
    expect(done.items['timber']).toBe(5);
    expect(await clearRow(plot.id)).toMatchObject({ endReason: 'cleared' });
    const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, plot.id) });
    expect(tile).toMatchObject({
      terrain: 'forest',
      nodeResource: 'timber',
      ownerUserId: rival.id,
    });
    const types = (await eventsOf(mapId)).map((e) => e.type);
    expect(types).not.toContain('tile.cleared');
    const rivalGather = await db.query.gatherJobs.findFirst({
      where: (t, { and, eq }) => and(eq(t.tileId, plot.id), eq(t.userId, rival.id)),
    });
    expect(rivalGather).toMatchObject({ status: 'active' });
  });

  it('clears the land when its clearer won it back before settling', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    const rival = await rivalOn(mapId);
    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
    clock.setTime(Date.parse(START) + CLEAR_MS + 60 * 60 * 1000);
    await capture(mapId, plot.id, kid, rival);
    clock.setTime(Date.parse(START) + CLEAR_MS + 2 * 60 * 60 * 1000);
    await capture(mapId, plot.id, rival, kid);
    const done = await settle(server, kid, mapId);
    expect(done.cleared).toEqual([
      { q: plot.q, r: plot.r, items: { timber: 5 }, landCleared: true },
    ]);
    const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, plot.id) });
    expect(tile).toMatchObject({ terrain: 'clearing', nodeResource: null, ownerUserId: kid.id });
  });

  it('clears land that went wild after the clear was done: nobody holds it to disturb', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
    const wildAt = new Date(Date.parse(START) + CLEAR_MS + 60 * 60 * 1000);
    await db.execute(`update tiles set owner_user_id = null where id = '${plot.id}'`);
    await db.execute(
      `insert into tile_tending (tile_id, map_id, tended_at, wild_night, wild_from_user_id, wild_at)
       values ('${plot.id}', '${mapId}', '${START}', '2026-10-02', '${kid.id}', '${wildAt.toISOString()}')
       on conflict (tile_id) do update set wild_night = excluded.wild_night,
         wild_from_user_id = excluded.wild_from_user_id, wild_at = excluded.wild_at`,
    );
    clock.setTime(wildAt.getTime() + 60 * 60 * 1000);
    const done = await settle(server, kid, mapId);
    expect(done.cleared).toEqual([
      { q: plot.q, r: plot.r, items: { timber: 5 }, landCleared: true },
    ]);
    const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, plot.id) });
    expect(tile).toMatchObject({ terrain: 'clearing', nodeResource: null, ownerUserId: null });
  });

  it("isn't blocked by a clear or a gather the land's last owner left behind", async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    const rival = await rivalOn(mapId);
    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
    clock.setTime(Date.parse(START) + CLEAR_MS / 2);
    await capture(mapId, plot.id, kid, rival);
    await joinAsHomestead(mapId, plot.id, rival);
    await give(mapId, rival, { axe: 1 });
    // The kid never settles; the rival clears the land as their own.
    const res = await clear(server, rival, mapId, plot);
    expect(res.statusCode).toBe(201);
    const rows = await db.query.tileClears.findMany({
      where: (t, { eq }) => eq(t.tileId, plot.id),
      orderBy: (t, { asc }) => [asc(t.startedAt)],
    });
    expect(rows.map((r) => [r.userId, r.endReason])).toEqual([
      [kid.id, 'lost'],
      [rival.id, null],
    ]);

    // A gather left behind is let go the same way.
    const { server: s2, kid: k2, mapId: m2, plot: p2 } = await forestHomestead();
    const r2 = await rivalOn(m2);
    const gather = await call(s2, 'POST', `/maps/${m2}/gathers`, k2, { q: p2.q, r: p2.r });
    expect(gather.statusCode).toBe(201);
    await capture(m2, p2.id, k2, r2);
    await joinAsHomestead(m2, p2.id, r2);
    await give(m2, r2, { axe: 1 });
    expect((await clear(s2, r2, m2, p2)).statusCode).toBe(201);
    const left = await db.query.gatherJobs.findFirst({
      where: (t, { eq }) => eq(t.tileId, p2.id),
    });
    expect(left).toMatchObject({ userId: k2.id, status: 'lost' });
  });

  it('finishes my last clear first when it is done but not settled yet', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
    const second = await makeHomestead(db, mapId, kid.id, clock, 1);
    await setLand(second, 'forest', 'timber');
    clock.setTime(Date.parse(START) + CLEAR_MS);
    // No settle in between: the next clear starts, and the first one lands.
    expect((await clear(server, kid, mapId, second)).statusCode).toBe(201);
    expect(await clearRow(plot.id)).toMatchObject({ endReason: 'cleared' });
    expect((await bag(server, kid, mapId)).items['timber']).toBe(5);
    expect((await tileOf(server, kid, mapId, plot)).terrain).toBe('clearing');
  });

  it('replies the same to a retry with the same Idempotency-Key, spending one use', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    const key = { 'idempotency-key': 'clear-tap-1' };
    const path = `/maps/${mapId}/clears`;
    const first = await call(server, 'POST', path, kid, { q: plot.q, r: plot.r }, key);
    const again = await call(server, 'POST', path, kid, { q: plot.q, r: plot.r }, key);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect((await bag(server, kid, mapId)).items['axe']).toBe(2);
  });

  it('keeps gathers, gatherers and new guards off land being cleared', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    const pet = await pal(mapId, kid);
    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
    const refusals = [
      await call(server, 'POST', `/maps/${mapId}/gathers`, kid, { q: plot.q, r: plot.r }),
      await call(server, 'POST', `/maps/${mapId}/squishies/${pet}/job`, kid, {
        job: 'gatherer',
        q: plot.q,
        r: plot.r,
      }),
      await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: plot.q,
        r: plot.r,
        squishyIds: [pet],
      }),
    ];
    for (const res of refusals) {
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).message).toMatch(/clearing this land/);
    }
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

  it('waits for a building, a gatherer or a guard to move first', async () => {
    const { server, kid, mapId, plot } = await forestHomestead();
    const refused = async (message: RegExp) => {
      const res = await clear(server, kid, mapId, plot);
      expect(res.statusCode, message.source).toBe(409);
      expect(errorOf(res).message).toMatch(message);
    };
    const [fire] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: kid.id,
        tileId: plot.id,
        buildingId: 'hearthfire',
        kind: 'hearthfire',
        spot: 0,
      })
      .returning({ id: buildings.id });
    await refused(/building stands here/);
    await db.execute(`delete from buildings where id = '${fire!.id}'`);

    const pet = await pal(mapId, kid);
    await db.execute(
      `update squishies set work_tile_id = '${plot.id}', work_since = '${START}', work_started_at = '${START}' where id = '${pet}'`,
    );
    await refused(/Ask your squishy to move/);
    await db.execute(
      `update squishies set work_tile_id = null, work_since = null, work_started_at = null where id = '${pet}'`,
    );

    await db
      .insert(tileDefenders)
      .values({ mapId, tileId: plot.id, slot: 0, squishyId: pet, assignedAt: clock });
    await refused(/Ask your squishy to move/);
    await db.execute(`delete from tile_defenders where squishy_id = '${pet}'`);

    expect((await clear(server, kid, mapId, plot)).statusCode).toBe(201);
  });

  it("won't make a clearing tool before the clear sheet ships (#295 PR 3)", async () => {
    const { server, kid, mapId } = await forestHomestead();
    await give(mapId, kid, { timber: 10, stone: 10 });
    const res = await call(server, 'POST', `/maps/${mapId}/crafts`, kid, { recipeId: 'axe' });
    expect(res.statusCode).toBe(404);
  });
});
