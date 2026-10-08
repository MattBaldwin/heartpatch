import { randomUUID } from 'node:crypto';
import {
  ApiErrorSchema,
  CollectWorkResponseSchema,
  hexDistance,
  GROWTH_RULES,
  JOB_RULES,
  xpForLevel,
  JobsViewSchema,
  MapResponseSchema,
  MapViewSchema,
  type JobsView,
  type PublicTile,
  extraNodes,
  GAME_DATA,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import {
  battles,
  buildings,
  inventories,
  keepers,
  mapMembers,
  maps,
  sessions,
  squishies,
  tileAttacks,
  tileDefenders,
  tiles,
  users,
} from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesService } from '../battles/service.js';
import { createHollowService } from '../hollow/service.js';
import { backendPid, waitUntilBlockedBy } from '../../../tests/lock-waits.js';
import { createSquishyJobsService } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;
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
// 6 AM in Denver, in Halloween's window (Timber and Stone have no seasonal extras).
const START = '2026-10-02T12:00:00Z';

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('squishy jobs (needs DATABASE_URL)', () => {
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

  const later = (ms: number) => clock.setTime(clock.getTime() + ms);

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `jobber_${String(process.pid)}_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
    });
    return { id: user!.id, username, token };
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

  /** Hand-edits rows this test made itself (plain SQL with its own ids, as gathering's tests do). */
  const run = (statement: string) => db.execute(statement);

  const tileIdAt = async (mapId: string, at: { q: number; r: number }) =>
    (await db.query.tiles.findFirst({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.q, at.q), eq(t.r, at.r)),
    }))!.id;

  const squishyRow = (id: string) =>
    db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, id) });

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, {
      name: 'Job Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function tilesOf(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'GET', `/maps/${mapId}/view`, who);
    expect(res.statusCode).toBe(200);
    return MapViewSchema.parse(res.json()).tiles;
  }

  /** Hands the player a squishy (captures and starters aren't this module's). */
  async function squishy(
    mapId: string,
    who: Player,
    traits: {
      id?: string;
      speciesId?: string;
      element?: string;
      feeling?: string;
      level?: number;
    } = {},
  ): Promise<string> {
    const [row] = await db
      .insert(squishies)
      .values({
        ...(traits.id ? { id: traits.id } : {}),
        mapId,
        ownerUserId: who.id,
        speciesId: traits.speciesId ?? 'puddlepuff',
        element: traits.element ?? 'water',
        feeling: traits.feeling ?? 'silly',
        level: traits.level ?? 5,
        createdAt: new Date(clock),
      })
      .returning({ id: squishies.id });
    return row!.id;
  }

  /** A tile of land outside my home, far from it, made mine with this terrain. */
  async function farLand(
    server: FastifyInstance,
    who: Player,
    mapId: string,
    terrain: string,
    skip: readonly PublicTile[] = [],
  ): Promise<PublicTile> {
    const all = await tilesOf(server, who, mapId);
    const home = all.filter((t) => t.homeSlot !== null);
    const seed = (await db.query.maps.findFirst({ where: (m, { eq }) => eq(m.id, mapId) }))!.seed!;
    const far = all.find(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        !skip.some((s) => s.q === t.q && s.r === t.r) &&
        home.every((h) => hexDistance(h, t) >= 4) &&
        // Bare even after #238's extra pass would roll this terrain here.
        extraNodes([{ ...t, terrain, nodeResource: null }], GAME_DATA.terrains, seed).length === 0,
    );
    expect(far).toBeDefined();
    await run(
      `update tiles set owner_user_id = '${who.id}', terrain = '${terrain}', node_resource = null
       where id = '${await tileIdAt(mapId, far!)}'`,
    );
    return { ...far!, ownerUserId: who.id, terrain, nodeResource: null };
  }

  async function homeNode(server: FastifyInstance, who: Player, mapId: string, resource: string) {
    const tile = (await tilesOf(server, who, mapId)).find(
      (t) => t.ownerUserId === who.id && t.nodeResource === resource,
    );
    expect(tile).toBeDefined();
    return tile!;
  }

  const jobs = async (server: FastifyInstance, who: Player, mapId: string): Promise<JobsView> => {
    const res = await call(server, 'GET', `/maps/${mapId}/jobs`, who);
    expect(res.statusCode).toBe(200);
    return JobsViewSchema.parse(res.json());
  };

  const setJob = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    squishyId: string,
    body: object,
    headers = {},
  ) => call(server, 'POST', `/maps/${mapId}/squishies/${squishyId}/job`, who, body, headers);

  const setTeam = (server: FastifyInstance, who: Player, mapId: string, ids: string[]) =>
    call(server, 'POST', `/maps/${mapId}/team`, who, { squishyIds: ids });

  const collect = (server: FastifyInstance, who: Player, mapId: string, headers = {}) =>
    call(server, 'POST', `/maps/${mapId}/work/collect`, who, undefined, headers);

  const jobOf = (view: JobsView, id: string) => view.squishies.find((s) => s.squishy.id === id)!;

  const bag = async (mapId: string, who: Player) =>
    Object.fromEntries(
      (
        await db.query.inventories.findMany({
          where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, who.id)),
        })
      ).map((r) => [r.itemId, r.quantity]),
    );

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq: is }) => is(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  describe('access', () => {
    it('needs a logged-in member', async () => {
      const server = await start();
      const [kid, stranger] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      expect((await call(server, 'GET', `/maps/${mapId}/jobs`, null)).statusCode).toBe(401);
      const probe = await call(server, 'GET', `/maps/${mapId}/jobs`, stranger);
      expect(probe.statusCode).toBe(404);
      const pet = await squishy(mapId, kid);
      expect((await setJob(server, stranger, mapId, pet, { job: 'team' })).statusCode).toBe(404);
    });
  });

  describe('the job board', () => {
    it('shows existing guards and habitats as they were (nothing changes for current players)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const [guard, housed, idle] = [
        await squishy(mapId, kid, { level: 9 }),
        await squishy(mapId, kid),
        await squishy(mapId, kid),
      ];
      const land = await farLand(server, kid, mapId, 'meadow');
      const landRow = { id: await tileIdAt(mapId, land) };
      // Posted and housed the way #15 and #18 stored them before jobs existed.
      await db
        .insert(tileDefenders)
        .values({ mapId, tileId: landRow.id, slot: 0, squishyId: guard, assignedAt: clock });
      const home = (await tilesOf(server, kid, mapId)).find(
        (t) => t.ownerUserId === kid.id && t.homeSlot !== null,
      )!;
      const homeRow = { id: await tileIdAt(mapId, home) };
      const [habitat] = await db
        .insert(buildings)
        .values({
          mapId,
          ownerUserId: kid.id,
          tileId: homeRow.id,
          buildingId: 'cozy-meadow',
          kind: 'habitat',
          spot: 3,
        })
        .returning({ id: buildings.id });
      await run(
        `update squishies set habitat_building_id = '${habitat!.id}' where id = '${housed}'`,
      );

      const view = await jobs(server, kid, mapId);
      expect(jobOf(view, guard)).toMatchObject({ job: 'guard', post: { q: land.q, r: land.r } });
      expect(jobOf(view, housed)).toMatchObject({ job: 'resting', habitatId: habitat!.id });
      expect(jobOf(view, idle)).toMatchObject({ job: 'resting', habitatId: null, work: null });
      expect(view.team).toEqual([]);
      expect(view.rules).toEqual({ teamSize: 3, maxStoredCycles: JOB_RULES.work.maxStoredCycles });
      // Home nodes and the meadow (Greens since #238) can be worked; home land without a node can't.
      const spots = view.spots.map((s) => `${s.resource}/${s.from}`).sort();
      expect(spots).toEqual(
        expect.arrayContaining([
          'emberwood/node',
          'stone/node',
          'timber/node',
          'treats/node',
          'greens/land',
        ]),
      );
      // Home is always safe (the Heart Seed, owner decision 2026-10-07); land needs a fire.
      expect(view.spots.filter((s) => s.from === 'node').every((s) => s.firelit)).toBe(true);
    });
  });

  describe('gatherers', () => {
    it('works a node on its own, lazily, up to the cap, and collects once', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const node = await homeNode(server, kid, mapId, 'timber');
      // Leaf + Brave: both sides of Timber's match, so 175%.
      const pet = await squishy(mapId, kid, { element: 'leaf', feeling: 'brave' });

      const res = await setJob(server, kid, mapId, pet, { job: 'gatherer', q: node.q, r: node.r });
      expect(res.statusCode).toBe(200);
      const assigned = jobOf(JobsViewSchema.parse(res.json()), pet);
      const cycle = Math.floor((900 * JOB_RULES.work.cyclePercent) / 175);
      expect(assigned).toMatchObject({
        job: 'gatherer',
        work: {
          q: node.q,
          r: node.r,
          resource: 'timber',
          from: 'node',
          speedPercent: 175,
          cycleSeconds: cycle,
          readyCycles: 0,
          full: false,
          nextReadyAt: new Date(clock.getTime() + cycle * 1000).toISOString(),
        },
      });

      expect(errorOf(await collect(server, kid, mapId)).message).toBe(
        'Nothing ready yet. Check back soon!',
      );

      // Hours later: only the cap is waiting, nothing ticked in between.
      later(10 * 60 * MINUTE_MS);
      const full = jobOf(await jobs(server, kid, mapId), pet).work!;
      const cap = JOB_RULES.work.maxStoredCycles;
      expect(full).toMatchObject({ readyCycles: cap, full: true, nextReadyAt: null });
      expect(full.ready).toEqual({ timber: 5 * cap });

      const key = { 'idempotency-key': 'collect-work-1' };
      const first = await collect(server, kid, mapId, key);
      expect(first.statusCode).toBe(200);
      const body = CollectWorkResponseSchema.parse(first.json());
      expect(body.granted).toEqual({ timber: 5 * cap });
      expect(body.items['timber']).toBe(5 * cap);
      // A retried request gets the same reply and changes nothing.
      const retry = await collect(server, kid, mapId, key);
      expect(retry.json()).toEqual(first.json());
      expect((await bag(mapId, kid))['timber']).toBe(5 * cap);
      // A new collect finds nothing: a full gatherer starts again from the collect.
      expect((await collect(server, kid, mapId)).statusCode).toBe(409);
      expect(jobOf(body.jobs, pet).work).toMatchObject({
        readyCycles: 0,
        nextReadyAt: new Date(clock.getTime() + cycle * 1000).toISOString(),
      });

      const ledger = (
        await db.query.resourceLedger.findMany({
          where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, kid.id)),
        })
      ).map(({ reason, refId, delta }) => ({ reason, refId, delta }));
      expect(ledger).toEqual([{ reason: 'work', refId: pet, delta: 5 * cap }]);
      const types = (await eventsOf(mapId)).map((e) => e.type);
      expect(types.filter((t) => t === 'work.collected')).toHaveLength(1);
      const collected = (await eventsOf(mapId)).find((e) => e.type === 'work.collected')!;
      // Members see who collected, never how much.
      expect(publicViewFor(PUBLIC_VIEWS, collected as never, { userId: kid.id })).toEqual({
        userId: kid.id,
      });
    });

    it('carries a part-done cycle on after a collect', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const node = await homeNode(server, kid, mapId, 'stone');
      const pet = await squishy(mapId, kid, { element: 'fire', feeling: 'joy' });
      await setJob(server, kid, mapId, pet, { job: 'gatherer', q: node.q, r: node.r });
      const cycle = 1800 * 1000;
      const started = clock.getTime();
      later(cycle + 10 * MINUTE_MS);
      const body = CollectWorkResponseSchema.parse((await collect(server, kid, mapId)).json());
      expect(body.granted).toEqual({ stone: 5 });
      expect(jobOf(body.jobs, pet).work?.nextReadyAt).toBe(
        new Date(started + 2 * cycle).toISOString(),
      );
    });

    it('works the land’s main resource out on the map, whatever its spot; home spots as ever (#238)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      // Out on the land, spots are the Keeper's: a forest's Greens spot, a mountain's Glimmer.
      const forest = await farLand(server, kid, mapId, 'forest');
      const mountain = await farLand(server, kid, mapId, 'mountains', [forest]);
      await run(
        `update tiles set node_resource = 'greens' where id = '${await tileIdAt(mapId, forest)}'`,
      );
      await run(
        `update tiles set node_resource = 'glimmer' where id = '${await tileIdAt(mapId, mountain)}'`,
      );
      const home = await homeNode(server, kid, mapId, 'stone');
      const [a, b, c] = [
        await squishy(mapId, kid),
        await squishy(mapId, kid),
        await squishy(mapId, kid),
      ];
      const work = async (id: string, at: { q: number; r: number }) => {
        const res = await setJob(server, kid, mapId, id, { job: 'gatherer', q: at.q, r: at.r });
        expect(res.statusCode, res.body).toBe(200);
        return jobOf(JobsViewSchema.parse(res.json()), id).work;
      };
      expect(await work(a, forest)).toMatchObject({ resource: 'timber', from: 'land' });
      expect(await work(b, mountain)).toMatchObject({ resource: 'ice', from: 'land' });
      // In the home ring, a spot is still what a gatherer works.
      expect(await work(c, home)).toMatchObject({ resource: 'stone', from: 'node' });
      // The job board's spots say the same.
      const spots = (await jobs(server, kid, mapId)).spots;
      const at = (t: { q: number; r: number }) => spots.find((s) => s.q === t.q && s.r === t.r);
      expect(at(forest)).toMatchObject({ resource: 'timber', from: 'land' });
      expect(at(mountain)).toMatchObject({ resource: 'ice', from: 'land' });
    });

    it('farms territory by terrain, one gatherer per tile, only on my land', async () => {
      const server = await start();
      const [kid, sib] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      const forest = await farLand(server, kid, mapId, 'forest');
      const [a, b] = [await squishy(mapId, kid), await squishy(mapId, kid)];

      const ok = await setJob(server, kid, mapId, a, { job: 'gatherer', q: forest.q, r: forest.r });
      expect(jobOf(JobsViewSchema.parse(ok.json()), a).work).toMatchObject({
        resource: 'timber',
        from: 'land',
        firelit: false,
      });
      const taken = await setJob(server, kid, mapId, b, {
        job: 'gatherer',
        q: forest.q,
        r: forest.r,
      });
      expect(taken.statusCode).toBe(409);
      expect(errorOf(taken).message).toBe('Puddlepuff is already gathering here!');

      const neutral = (await tilesOf(server, kid, mapId)).find(
        (t) => t.ownerUserId === null && t.homeSlot === null,
      )!;
      const notMine = await setJob(server, kid, mapId, b, {
        job: 'gatherer',
        q: neutral.q,
        r: neutral.r,
      });
      expect(notMine.statusCode).toBe(403);

      const bare = (await tilesOf(server, kid, mapId)).find(
        (t) => t.ownerUserId === kid.id && t.homeSlot !== null && t.nodeResource === null,
      )!;
      const nothing = await setJob(server, kid, mapId, b, {
        job: 'gatherer',
        q: bare.q,
        r: bare.r,
      });
      expect(errorOf(nothing)).toEqual({
        code: 'CONFLICT',
        message: "There's nothing to gather here.",
      });

      const pumpkins = await farLand(server, kid, mapId, 'pumpkin-fields', [forest]);
      const field = { job: 'gatherer', q: pumpkins.q, r: pumpkins.r };
      // In season, a pumpkin field gives Pumpkins and a sprinkle of Witch Dust.
      const inSeason = await setJob(server, kid, mapId, b, field);
      expect(jobOf(JobsViewSchema.parse(inSeason.json()), b).work).toMatchObject({
        resource: 'pumpkins',
      });
      later(41 * MINUTE_MS);
      expect(jobOf(await jobs(server, kid, mapId), b).work?.ready).toEqual({
        pumpkins: 1,
        'witch-dust': 1,
      });
      await setJob(server, kid, mapId, b, { job: 'resting' });
      clock.setTime(Date.parse('2026-12-01T19:00:00Z'));
      const early = await setJob(server, kid, mapId, b, {
        job: 'gatherer',
        q: pumpkins.q,
        r: pumpkins.r,
      });
      expect(errorOf(early).message).toBe('Pumpkins only turn up around Halloween!');

      // The map shows the gatherer to everyone: where it went, never what it gathers.
      const assigned = (await eventsOf(mapId)).find((e) => e.type === 'squishy.assigned')!;
      expect(publicViewFor(PUBLIC_VIEWS, assigned as never, { userId: sib.id })).toEqual({
        userId: kid.id,
        from: null,
        to: { q: forest.q, r: forest.r },
      });
      const view = await tilesOf(server, kid, mapId);
      expect(view.find((t) => t.q === forest.q && t.r === forest.r)?.workers).toBe(1);
    });

    it('banks what was ready when taken off (a part-done cycle is let go)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const node = await homeNode(server, kid, mapId, 'timber');
      const pet = await squishy(mapId, kid);
      await setJob(server, kid, mapId, pet, { job: 'gatherer', q: node.q, r: node.r });
      later(45 * MINUTE_MS);
      const res = await setJob(server, kid, mapId, pet, { job: 'resting' });
      expect(res.statusCode).toBe(200);
      expect(jobOf(JobsViewSchema.parse(res.json()), pet)).toMatchObject({
        job: 'resting',
        work: null,
      });
      expect((await bag(mapId, kid))['timber']).toBe(5);
      const row = await squishyRow(pet);
      expect(row).toMatchObject({ workTileId: null, workSince: null, workStartedAt: null });
    });

    it('moves a housed squishy out of its habitat to go to work', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const node = await homeNode(server, kid, mapId, 'timber');
      const nodeRow = { id: await tileIdAt(mapId, node) };
      const [habitat] = await db
        .insert(buildings)
        .values({
          mapId,
          ownerUserId: kid.id,
          tileId: nodeRow.id,
          buildingId: 'cozy-meadow',
          kind: 'habitat',
          spot: 2,
        })
        .returning({ id: buildings.id });
      const pet = await squishy(mapId, kid);
      await run(`update squishies set habitat_building_id = '${habitat!.id}' where id = '${pet}'`);
      await setJob(server, kid, mapId, pet, { job: 'gatherer', q: node.q, r: node.r });
      const row = await squishyRow(pet);
      expect(row?.habitatBuildingId).toBeNull();
      const housed = (await eventsOf(mapId)).find((e) => e.type === 'squishy.housed');
      expect(housed?.payload).toMatchObject({
        squishyId: pet,
        habitatId: null,
        fromHabitatId: habitat!.id,
      });

      // Moving back into the habitat stops the work, banking what was ready.
      later(31 * MINUTE_MS);
      const back = await call(server, 'POST', `/maps/${mapId}/squishies/${pet}/habitat`, kid, {
        habitatId: habitat!.id,
      });
      expect(back.statusCode).toBe(200);
      expect(jobOf(await jobs(server, kid, mapId), pet)).toMatchObject({
        job: 'resting',
        habitatId: habitat!.id,
      });
      expect((await bag(mapId, kid))['timber']).toBe(5);
    });

    it('stops on land that changed hands, even land won back later', async () => {
      const server = await start();
      const [kid, rival] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      const forest = await farLand(server, kid, mapId, 'forest');
      const pet = await squishy(mapId, kid);
      await setJob(server, kid, mapId, pet, { job: 'gatherer', q: forest.q, r: forest.r });
      later(70 * MINUTE_MS);
      // A capture of that tile, recorded the way #15 does, and the land back again.
      const tileRow = { id: await tileIdAt(mapId, forest) };
      await db.insert(mapMembers).values({ mapId, userId: rival.id, role: 'member' });
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
        tileId: tileRow.id,
        attackerUserId: rival.id,
        defenderUserId: kid.id,
        battleId: battle!.id,
        outcome: 'captured',
        startedAt: clock,
        cooldownUntil: clock,
        lastActionAt: clock,
        endedAt: clock,
      });
      const view = await jobs(server, kid, mapId);
      expect(jobOf(view, pet)).toMatchObject({ job: 'resting', work: null });
      expect(errorOf(await collect(server, kid, mapId)).message).toBe(
        'Nothing ready yet. Check back soon!',
      );
      // It can go back to work there, starting fresh.
      const again = await setJob(server, kid, mapId, pet, {
        job: 'gatherer',
        q: forest.q,
        r: forest.r,
      });
      expect(jobOf(JobsViewSchema.parse(again.json()), pet).work?.readyCycles).toBe(0);
    });
  });

  describe('one job at a time', () => {
    it('keeps guards and gatherers off the team, swapping them over when picked', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const forest = await farLand(server, kid, mapId, 'forest');
      const hills = await farLand(server, kid, mapId, 'hills', [forest]);
      const [guard, worker, idle] = [
        await squishy(mapId, kid),
        await squishy(mapId, kid),
        await squishy(mapId, kid),
      ];
      const post = await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: hills.q,
        r: hills.r,
        squishyIds: [guard],
      });
      expect(post.statusCode).toBe(200);
      await setJob(server, kid, mapId, worker, { job: 'gatherer', q: forest.q, r: forest.r });
      later(31 * MINUTE_MS);

      const res = await setTeam(server, kid, mapId, [worker, guard, idle]);
      expect(res.statusCode).toBe(200);
      const view = JobsViewSchema.parse(res.json());
      expect(view.team).toEqual([worker, guard, idle]);
      for (const id of [worker, guard, idle]) expect(jobOf(view, id).job).toBe('team');
      expect(jobOf(view, guard).post).toBeNull();
      expect(
        await db.query.tileDefenders.findMany({ where: (t, { eq }) => eq(t.squishyId, guard) }),
      ).toEqual([]);
      // The gatherer's finished cycle went in the bag on the way.
      expect((await bag(mapId, kid))['timber']).toBe(2);
      const types = (await eventsOf(mapId)).map((e) => e.type);
      expect(types).toEqual(
        expect.arrayContaining(['defenders.changed', 'work.collected', 'team.picked']),
      );
      // The team is the player's own: nobody else hears it.
      const picked = (await eventsOf(mapId)).find((e) => e.type === 'team.picked')!;
      expect(publicViewFor(PUBLIC_VIEWS, picked as never, { userId: kid.id })).toEqual({
        userId: kid.id,
        squishyIds: [worker, guard, idle],
      });
      const someoneElse = '0190a000-0000-7000-8000-000000000999';
      expect(publicViewFor(PUBLIC_VIEWS, picked as never, { userId: someoneElse })).toBeNull();

      // Posting a team member as a guard takes it off the team.
      await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: hills.q,
        r: hills.r,
        squishyIds: [idle],
      });
      const after = await jobs(server, kid, mapId);
      expect(after.team).toEqual([worker, guard]);
      expect(jobOf(after, idle)).toMatchObject({ job: 'guard', teamSlot: null });
    });

    it('fills team slots in order, refuses a fourth, and never in the Hollow', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const ids = [
        await squishy(mapId, kid),
        await squishy(mapId, kid),
        await squishy(mapId, kid),
        await squishy(mapId, kid),
      ];
      for (const id of ids.slice(0, 3)) {
        expect((await setJob(server, kid, mapId, id, { job: 'team' })).statusCode).toBe(200);
      }
      expect((await jobs(server, kid, mapId)).team).toEqual(ids.slice(0, 3));
      const full = await setJob(server, kid, mapId, ids[3]!, { job: 'team' });
      expect(errorOf(full)).toEqual({
        code: 'CONFLICT',
        message: 'Your team is full! Take someone off first.',
      });
      expect(errorOf(await setTeam(server, kid, mapId, ids)).code).toBe('VALIDATION_FAILED');
      expect(errorOf(await setTeam(server, kid, mapId, [ids[0]!, ids[0]!])).message).toBe(
        'Each squishy can only go once!',
      );
      // Taking one off frees its slot for the next.
      await setJob(server, kid, mapId, ids[1]!, { job: 'resting' });
      await setJob(server, kid, mapId, ids[3]!, { job: 'team' });
      expect((await jobs(server, kid, mapId)).team).toEqual([ids[0], ids[3], ids[2]]);

      await run(`update squishies set state = 'hollowed' where id = '${ids[1]!}'`);
      const away = await setJob(server, kid, mapId, ids[1]!, { job: 'team' });
      expect(errorOf(away).message).toBe('Puddlepuff is in the Hollow. Rescue them first!');
      expect(errorOf(await setTeam(server, kid, mapId, [ids[1]!])).code).toBe('CONFLICT');
      // Clearing the team is fine.
      expect((await setTeam(server, kid, mapId, [])).statusCode).toBe(200);
      expect((await jobs(server, kid, mapId)).team).toEqual([]);
    });
  });

  /** Who a wild battle would take for this player (and leaves the battle finished). */
  async function battleTeamOf(kid: Player, mapId: string) {
    const service = createBattlesService({ db, clock: () => clock });
    const { battle } = await service.startAgainst({ id: kid.id, username: kid.username }, mapId, {
      squishies: [
        { id: 'wild-1', speciesId: 'puddlepuff', level: 3, element: 'water', feeling: 'silly' },
      ],
    } as never);
    const row = await db.query.battles.findFirst({ where: (t, { eq }) => eq(t.id, battle.id) });
    await run(`update battles set status = 'finished' where id = '${battle.id}'`);
    return (row!.setup as { a: { squishies: { id: string }[] } }).a.squishies.map((s) => s.id);
  }

  describe('battles use the team', () => {
    const wild = {
      squishies: [
        { id: 'wild-1', speciesId: 'puddlepuff', level: 3, element: 'water', feeling: 'silly' },
      ],
    } as const;

    async function battleTeam(kid: Player, mapId: string) {
      const service = createBattlesService({ db, clock: () => clock });
      const { battle } = await service.startAgainst(
        { id: kid.id, username: kid.username },
        mapId,
        wild as never,
      );
      const row = await db.query.battles.findFirst({ where: (t, { eq }) => eq(t.id, battle.id) });
      await run(`update battles set status = 'finished' where id = '${battle.id}'`);
      return (row!.setup as { a: { squishies: { id: string }[] } }).a.squishies.map((s) => s.id);
    }

    it('takes the picked team in slot order', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      // The strongest (level 9) sits out: the picked team goes, in its order.
      const [weak, , strong] = [
        await squishy(mapId, kid, { level: 2 }),
        await squishy(mapId, kid, { level: 4 }),
        await squishy(mapId, kid, { level: 9 }),
      ];
      await setTeam(server, kid, mapId, [weak, strong]);
      expect(await battleTeam(kid, mapId)).toEqual([weak, strong]);
    });

    it('falls back to the strongest resting squishies, never guards or gatherers', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const forest = await farLand(server, kid, mapId, 'forest');
      const hills = await farLand(server, kid, mapId, 'hills', [forest]);
      const [guard, worker, a, b, c, d] = [
        await squishy(mapId, kid, { level: 20 }),
        await squishy(mapId, kid, { level: 19 }),
        await squishy(mapId, kid, { level: 5 }),
        await squishy(mapId, kid, { level: 7 }),
        await squishy(mapId, kid, { level: 3 }),
        await squishy(mapId, kid, { level: 6 }),
      ];
      await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: hills.q,
        r: hills.r,
        squishyIds: [guard],
      });
      await setJob(server, kid, mapId, worker, { job: 'gatherer', q: forest.q, r: forest.r });
      expect(await battleTeam(kid, mapId)).toEqual([b, d, a]);

      // A team whose members are all in the Hollow falls back too.
      await setTeam(server, kid, mapId, [c]);
      await run(`update squishies set state = 'hollowed' where id = '${c}'`);
      expect(await battleTeam(kid, mapId)).toEqual([b, d, a]);
    });

    it("keeps the Glade friend on watch in the tutorial's battles (team as before)", async () => {
      const kid = await player();
      const [map] = await db
        .insert(maps)
        .values({ kind: 'tutorial', name: 'Tutorial Glade', timeZone: 'UTC', maxPlayers: 1 })
        .returning({ id: maps.id });
      const mapId = map!.id;
      await db.insert(mapMembers).values({ mapId, userId: kid.id, role: 'owner' });
      const [tile] = await db
        .insert(tiles)
        .values({ mapId, q: 1, r: 0, terrain: 'meadow', ownerUserId: kid.id })
        .returning({ id: tiles.id });
      const [friend, partner] = [
        await squishy(mapId, kid, { level: 5 }),
        await squishy(mapId, kid, { level: 2 }),
      ];
      await db
        .insert(tileDefenders)
        .values({ mapId, tileId: tile!.id, slot: 0, squishyId: friend, assignedAt: clock });
      expect(await battleTeam(kid, mapId)).toEqual([friend, partner]);
    });

    it('says everyone is busy when nobody is free to battle', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const forest = await farLand(server, kid, mapId, 'forest');
      const worker = await squishy(mapId, kid);
      await setJob(server, kid, mapId, worker, { job: 'gatherer', q: forest.q, r: forest.r });
      await expect(battleTeam(kid, mapId)).rejects.toThrow(
        'Everyone is busy with a job! Pick a team first.',
      );
    });
  });

  describe('training (owner decision 2026-10-06)', () => {
    const HOUR_MS = 60 * MINUTE_MS;

    /** Builds the player's Training Grounds straight in the table, at `level`. */
    async function grounds(server: FastifyInstance, who: Player, mapId: string, level = 1) {
      const node = await homeNode(server, who, mapId, 'timber');
      const [row] = await db
        .insert(buildings)
        .values({
          mapId,
          ownerUserId: who.id,
          tileId: await tileIdAt(mapId, node),
          buildingId: 'training-grounds',
          kind: 'training-grounds',
          level,
          spot: 2,
        })
        .returning({ id: buildings.id });
      return row!.id;
    }

    it('needs Training Grounds with room, and shows trainees on the board', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const [a, b, c] = [
        await squishy(mapId, kid),
        await squishy(mapId, kid),
        await squishy(mapId, kid),
      ];
      const none = await setJob(server, kid, mapId, a, { job: 'training' });
      expect(none.statusCode).toBe(409);
      expect(errorOf(none).message).toBe('Build Training Grounds at home first!');

      const id = await grounds(server, kid, mapId);
      expect((await setJob(server, kid, mapId, a, { job: 'training' })).statusCode).toBe(200);
      const res = await setJob(server, kid, mapId, b, { job: 'training' });
      const view = JobsViewSchema.parse(res.json());
      expect(jobOf(view, b)).toMatchObject({
        job: 'training',
        training: { buildingId: id, xpPerHour: 5, xpReady: 0, full: false },
      });
      expect(view.trainingGrounds).toEqual({ id, capacity: 2, used: 2 });
      const full = await setJob(server, kid, mapId, c, { job: 'training' });
      expect(full.statusCode).toBe(409);
      expect(errorOf(full).message).toBe(
        'The Training Grounds are full! Upgrade them for more room.',
      );
      // Training again is a no-op.
      expect((await setJob(server, kid, mapId, a, { job: 'training' })).statusCode).toBe(200);
      const assigned = (await eventsOf(mapId)).filter((e) => e.type === 'squishy.assigned');
      expect(assigned.map((e) => (e.payload as { job: string }).job)).toEqual([
        'training',
        'training',
      ]);

      // A level-2 Training Grounds has room for 3 and gives 8 XP an hour.
      await run(`update buildings set level = 2 where id = '${id}'`);
      const roomier = JobsViewSchema.parse(
        (await setJob(server, kid, mapId, c, { job: 'training' })).json(),
      );
      expect(roomier.trainingGrounds).toEqual({ id, capacity: 3, used: 3 });
      expect(jobOf(roomier, c).training?.xpPerHour).toBe(8);
      // Full at the top level: no upgrade to suggest.
      const d = await squishy(mapId, kid);
      const top = await setJob(server, kid, mapId, d, { job: 'training' });
      expect(top.statusCode).toBe(409);
      expect(errorOf(top).message).toBe(
        'The Training Grounds are full! Give someone else a turn first.',
      );
    });

    it('lands its XP when it changes job, and never battles while training', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await grounds(server, kid, mapId);
      const [trainee, other] = [
        await squishy(mapId, kid, { level: 9 }),
        await squishy(mapId, kid, { level: 2 }),
      ];
      await setJob(server, kid, mapId, trainee, { job: 'training' });
      expect(await battleTeamOf(kid, mapId)).toEqual([other]);

      later(3 * HOUR_MS);
      expect(jobOf(await jobs(server, kid, mapId), trainee).training?.xpReady).toBe(15);
      // A squishy made at level 9 counts from that level's XP (shared `addXp`).
      const before = xpForLevel(9, GROWTH_RULES);
      const res = await setTeam(server, kid, mapId, [trainee]);
      expect(res.statusCode).toBe(200);
      expect(jobOf(JobsViewSchema.parse(res.json()), trainee)).toMatchObject({
        job: 'team',
        training: null,
      });
      expect(await squishyRow(trainee)).toMatchObject({
        xp: before + 15,
        trainingBuildingId: null,
        trainingSince: null,
      });
      const trained = (await eventsOf(mapId)).find((e) => e.type === 'squishy.trained')!;
      expect(trained.payload).toEqual({
        userId: kid.id,
        trained: [{ squishyId: trainee, xp: 15 }],
      });
      // How much stays internal.
      expect(publicViewFor(PUBLIC_VIEWS, trained as never, { userId: kid.id })).toEqual({
        userId: kid.id,
      });
    });

    it('lands its XP when it is posted on watch, and stops training', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await grounds(server, kid, mapId);
      const hills = await farLand(server, kid, mapId, 'hills');
      const trainee = await squishy(mapId, kid, { level: 1 });
      await setJob(server, kid, mapId, trainee, { job: 'training' });
      later(2 * HOUR_MS);
      const post = await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: hills.q,
        r: hills.r,
        squishyIds: [trainee],
      });
      expect(post.statusCode, post.body).toBe(200);
      expect(await squishyRow(trainee)).toMatchObject({
        xp: 10,
        trainingBuildingId: null,
        trainingSince: null,
      });
      expect(jobOf(await jobs(server, kid, mapId), trainee).job).toBe('guard');
      const trained = (await eventsOf(mapId)).find((e) => e.type === 'squishy.trained')!;
      expect(trained.payload).toEqual({
        userId: kid.id,
        trained: [{ squishyId: trainee, xp: 10 }],
      });
    });

    it('sleeps at home, always safe (the Heart Seed, owner decision 2026-10-07)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await run(
        `update map_members set joined_at = '2026-09-01T12:00:00Z'
         where map_id = '${mapId}' and user_id = '${kid.id}'`,
      );
      await grounds(server, kid, mapId);
      // A second friend resting at home, so the trainee isn't the last one.
      const [trainee] = [await squishy(mapId, kid), await squishy(mapId, kid)];
      await setJob(server, kid, mapId, trainee, { job: 'training' });
      const hollow = createHollowService({
        db,
        clock: () => clock,
        battles: createBattlesService({ db, clock: () => clock }),
      });
      // No fire anywhere, two nights running: the trainee sleeps safe at home.
      clock.setTime(Date.parse('2026-10-03T03:00:00Z')); // 9 PM in Denver
      expect(await hollow.runNightfall(mapId, '2026-10-02')).toEqual({ taken: 0 });
      clock.setTime(Date.parse('2026-10-04T03:00:00Z'));
      expect(await hollow.runNightfall(mapId, '2026-10-03')).toEqual({ taken: 0 });
      expect(await squishyRow(trainee)).toMatchObject({ state: 'active' });
    });
  });

  describe('nightfall', () => {
    it('can take a gatherer outside the firelight, banking its work; one inside is safe', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      // Past the first-night grace.
      await run(
        `update map_members set joined_at = '2026-09-01T12:00:00Z'
         where map_id = '${mapId}' and user_id = '${kid.id}'`,
      );
      const node = await homeNode(server, kid, mapId, 'timber');
      const nodeRow = { id: await tileIdAt(mapId, node) };
      // A lit fire on the home base keeps home safe tonight.
      await db.insert(buildings).values({
        mapId,
        ownerUserId: kid.id,
        tileId: nodeRow.id,
        buildingId: 'hearthfire',
        kind: 'hearthfire',
        spot: 1,
        fuelledThrough: '2026-10-09',
      });
      const forest = await farLand(server, kid, mapId, 'forest');
      const [outside, inside, home] = [
        await squishy(mapId, kid),
        await squishy(mapId, kid),
        await squishy(mapId, kid),
      ];
      await setJob(server, kid, mapId, outside, { job: 'gatherer', q: forest.q, r: forest.r });
      await setJob(server, kid, mapId, inside, { job: 'gatherer', q: node.q, r: node.r });

      // Told before night falls: the job board shows which spots are in the light.
      const view = await jobs(server, kid, mapId);
      expect(view.spots.find((s) => s.q === forest.q && s.r === forest.r)?.firelit).toBe(false);
      expect(view.spots.find((s) => s.q === node.q && s.r === node.r)?.firelit).toBe(true);
      expect(jobOf(view, outside).work?.firelit).toBe(false);

      clock.setTime(Date.parse('2026-10-03T03:00:00Z')); // 9 PM in Denver
      const hollow = createHollowService({
        db,
        clock: () => clock,
        battles: createBattlesService({ db, clock: () => clock }),
      });
      expect(await hollow.runNightfall(mapId, '2026-10-02')).toEqual({ taken: 1 });
      const taken = await squishyRow(outside);
      expect(taken).toMatchObject({ state: 'hollowed', workTileId: null });
      for (const id of [inside, home]) {
        expect((await squishyRow(id))?.state).toBe('active');
      }
      // Its day's work went home with the morning: 15 h at 30 min a cycle, capped.
      expect((await bag(mapId, kid))['timber']).toBe(2 * JOB_RULES.work.maxStoredCycles);
      const types = (await eventsOf(mapId)).map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['work.collected', 'squishy.hollowed']));
    });
  });

  describe('lock order (tech spec §7)', () => {
    /** Holds `first`, runs `command`, and once it waits, takes `then` too. */
    async function holdThen(
      first: (tx: Database) => Promise<unknown>,
      command: () => Promise<unknown>,
      then: (tx: Database) => Promise<unknown>,
    ): Promise<void> {
      let running: Promise<unknown> | undefined;
      await db.transaction(async (tx) => {
        await tx.execute(`set local lock_timeout = '10s'`);
        await first(tx);
        const pid = await backendPid(tx);
        running = command();
        await waitUntilBlockedBy(db, pid);
        await then(tx);
      });
      await running;
    }

    // Plain SQL with ids this test made itself (module tests don't build queries).
    const lockRow = (tx: Database, table: 'squishies' | 'tiles', id: string) =>
      tx.execute(`select 1 from ${table} where id = '${id}' for update`);
    const lockMap = (tx: Database, mapId: string) =>
      tx.execute(`select 1 from maps where id = '${mapId}' for no key update`);
    const lockMember = (tx: Database, mapId: string, userId: string) =>
      tx.execute(
        `select 1 from map_members where map_id = '${mapId}' and user_id = '${userId}' for update`,
      );

    async function setup() {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const node = await homeNode(server, kid, mapId, 'timber');
      const tileRow = { id: await tileIdAt(mapId, node) };
      const pet = await squishy(mapId, kid);
      const service = createSquishyJobsService({ db, clock: () => clock });
      const user = { id: kid.id, username: kid.username } as never;
      return { server, kid, mapId, node, tileId: tileRow.id, pet, service, user };
    }

    it('takes the member row before the tile (jobs `setJob`)', async () => {
      const { kid, mapId, node, tileId, pet, service, user } = await setup();
      await holdThen(
        (tx) => lockMember(tx, mapId, kid.id),
        () => service.setJob(user, mapId, pet, { job: 'gatherer', q: node.q, r: node.r }),
        (tx) => lockRow(tx, 'tiles', tileId),
      );
    });

    it('takes the tile before the squishy (jobs `setJob`)', async () => {
      const { mapId, node, tileId, pet, service, user } = await setup();
      await holdThen(
        (tx) => lockRow(tx, 'tiles', tileId),
        () => service.setJob(user, mapId, pet, { job: 'gatherer', q: node.q, r: node.r }),
        (tx) => lockRow(tx, 'squishies', pet),
      );
    });

    it('takes the work tile before the squishy, and the squishy before `maps` (jobs `collect`)', async () => {
      const { mapId, node, tileId, pet, service, user } = await setup();
      await service.setJob(user, mapId, pet, { job: 'gatherer', q: node.q, r: node.r });
      later(31 * MINUTE_MS);
      await holdThen(
        (tx) => lockRow(tx, 'tiles', tileId),
        () => service.collect(user, mapId),
        (tx) => lockRow(tx, 'squishies', pet),
      );
      later(31 * MINUTE_MS);
      await holdThen(
        (tx) => lockRow(tx, 'squishies', pet),
        () => service.collect(user, mapId),
        (tx) => lockMap(tx, mapId),
      );
    });

    it("locks two gatherers' items in item-id order, not squishy order (jobs `collect`)", async () => {
      const { server, kid, mapId, service, user } = await setup();
      const forest = await farLand(server, kid, mapId, 'forest');
      const hills = await farLand(server, kid, mapId, 'hills', [forest]);
      // The Timber gatherer has the lower id, so grants in squishy order would
      // take timber before stone: the reverse of item-id order.
      const [low, high] = [randomUUID(), randomUUID()].sort();
      await squishy(mapId, kid, { id: low });
      await squishy(mapId, kid, { id: high });
      await service.setJob(user, mapId, low!, { job: 'gatherer', q: forest.q, r: forest.r });
      await service.setJob(user, mapId, high!, { job: 'gatherer', q: hills.q, r: hills.r });
      await db.insert(inventories).values([
        { mapId, userId: kid.id, itemId: 'stone', quantity: 1 },
        { mapId, userId: kid.id, itemId: 'timber', quantity: 1 },
      ]);
      later(31 * MINUTE_MS);
      const row = (item: string) => (tx: Database) =>
        tx.execute(
          `select 1 from inventories
           where map_id = '${mapId}' and user_id = '${kid.id}' and item_id = '${item}' for update`,
        );
      // Hold Stone the way a building's cost would (item-id order), then take Timber.
      await holdThen(row('stone'), () => service.collect(user, mapId), row('timber'));
      expect(await bag(mapId, kid)).toMatchObject({ stone: 3, timber: 3 });
    });

    it("takes the squishy before its owner's inventory rows (jobs `collect`)", async () => {
      const { kid, mapId, node, pet, service, user } = await setup();
      await service.setJob(user, mapId, pet, { job: 'gatherer', q: node.q, r: node.r });
      // A Timber row to lock (a missing row is made by the first grant).
      await db.insert(inventories).values({ mapId, userId: kid.id, itemId: 'timber', quantity: 1 });
      later(31 * MINUTE_MS);
      await holdThen(
        (tx) => lockRow(tx, 'squishies', pet),
        () => service.collect(user, mapId),
        (tx) =>
          tx.execute(
            `select 1 from inventories
             where map_id = '${mapId}' and user_id = '${kid.id}' and item_id = 'timber' for update`,
          ),
      );
      expect((await bag(mapId, kid))['timber']).toBe(6);
    });
  });
});
