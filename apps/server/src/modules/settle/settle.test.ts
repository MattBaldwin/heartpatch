import { randomUUID } from 'node:crypto';
import {
  ApiErrorSchema,
  CraftResponseSchema,
  GatherResponseSchema,
  hexDistance,
  InventoryResponseSchema,
  JOB_RULES,
  JobsViewSchema,
  MapResponseSchema,
  MapViewSchema,
  SettleResponseSchema,
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
  sessions,
  squishies,
  tileAttacks,
  users,
} from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { setDevDropChance } from '../wardrobe/drops.js';
import { makeHomestead } from '../../../tests/homestead.js';
import { backendPid, waitUntilBlockedBy } from '../../../tests/lock-waits.js';
import { createGatheringService } from '../gathering/service.js';
import { createInventoryService } from '../inventory/service.js';
import { createSquishyJobsService } from '../jobs/service.js';
import { createSettleService } from './service.js';

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

describe.skipIf(!url)(
  'settling: finished things go straight to the bag (needs DATABASE_URL)',
  () => {
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
      setDevDropChance(null);
    });

    const later = (ms: number) => clock.setTime(clock.getTime() + ms);

    async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
      const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, ...env });
      app = await buildApp({ config, db, clock: () => clock, logger: false });
      return app;
    }

    async function player(): Promise<Player> {
      const username = `settler_${String(process.pid)}_${String((counter += 1))}`;
      const [user] = await db
        .insert(users)
        .values({
          username,
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

    async function newMap(server: FastifyInstance, who: Player): Promise<string> {
      const res = await call(server, 'POST', '/maps', who, {
        name: 'Settle Patch',
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
      const seed = (await db.query.maps.findFirst({ where: (m, { eq }) => eq(m.id, mapId) }))!
        .seed!;
      const far = all.find(
        (t) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          !skip.some((s) => s.q === t.q && s.r === t.r) &&
          home.every((h) => hexDistance(h, t) >= 4) &&
          // Bare even after #238's extra pass would roll this terrain here.
          extraNodes([{ ...t, terrain, nodeResource: null }], GAME_DATA.terrains, seed).length ===
            0,
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

    const jobOf = (view: JobsView, id: string) => view.squishies.find((s) => s.squishy.id === id)!;

    const bag = async (mapId: string, who: Player) =>
      Object.fromEntries(
        (
          await db.query.inventories.findMany({
            where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, who.id)),
          })
        )
          .filter((r) => r.quantity > 0)
          .map((r) => [r.itemId, r.quantity]),
      );

    const eventsOf = (mapId: string) =>
      db.query.gameEvents.findMany({
        where: (t, { eq: is }) => is(t.mapId, mapId),
        orderBy: (t, { asc }) => [asc(t.seq)],
      });

    const settle = async (server: FastifyInstance, who: Player, mapId: string) => {
      const res = await call(server, 'POST', `/maps/${mapId}/settle`, who);
      expect(res.statusCode).toBe(200);
      return SettleResponseSchema.parse(res.json());
    };

    const gatherAt = async (
      server: FastifyInstance,
      who: Player,
      mapId: string,
      at: { q: number; r: number },
    ) => {
      const res = await call(server, 'POST', `/maps/${mapId}/gathers`, who, { q: at.q, r: at.r });
      expect(res.statusCode).toBe(201);
      return GatherResponseSchema.parse(res.json()).gather;
    };

    const craft = (server: FastifyInstance, who: Player, mapId: string, recipeId: string) =>
      call(server, 'POST', `/maps/${mapId}/crafts`, who, { recipeId });

    /** Puts items straight in the bag (no ledger: these tests read the ledger for what settling wrote). */
    const stock = (mapId: string, who: Player, items: Record<string, number>) =>
      db.insert(inventories).values(
        Object.entries(items).map(([itemId, quantity]) => ({
          mapId,
          userId: who.id,
          itemId,
          quantity,
        })),
      );

    const ledgerOf = (mapId: string, who: Player) =>
      db.query.resourceLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, who.id)),
      });

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
      await run(`update tiles set owner_user_id = '${rival.id}' where id = '${tileId}'`);
    }

    it('banks a finished craft, gather and gatherer in one go, as Collect did', async () => {
      // No found clothing this time (a gather's real roll would add `clothing.found`).
      const server = await start({ HP_DEV_DROP_CHANCE: '0' });
      const kid = await player();
      const mapId = await newMap(server, kid);
      const forest = await farLand(server, kid, mapId, 'forest');
      const pet = await squishy(mapId, kid);
      await setJob(server, kid, mapId, pet, { job: 'gatherer', q: forest.q, r: forest.r });
      const gather = await gatherAt(
        server,
        kid,
        mapId,
        await homeNode(server, kid, mapId, 'timber'),
      );
      await stock(mapId, kid, { timber: 2, treats: 1 });
      const made = CraftResponseSchema.parse(
        (await craft(server, kid, mapId, 'heart-charm')).json(),
      );

      // Nothing has finished yet: nothing lands, and it says when to ask again.
      const early = await settle(server, kid, mapId);
      expect(early.landed).toEqual([]);
      const cycle = jobOf(await jobs(server, kid, mapId), pet).work!.cycleSeconds;
      const soonest = Math.min(
        Date.parse(gather.readyAt),
        Date.parse(made.craft.readyAt),
        clock.getTime() + cycle * 1000,
      );
      expect(early.nextAt).toBe(new Date(soonest).toISOString());

      // Long enough for all three (and two of the gatherer's cycles).
      const until = Math.max(Date.parse(gather.readyAt), Date.parse(made.craft.readyAt));
      clock.setTime(Math.max(until, clock.getTime() + 2 * cycle * 1000));
      const before = (await eventsOf(mapId)).length;
      const done = await settle(server, kid, mapId);
      expect(done.landed.map((l) => l.kind).sort()).toEqual(['craft', 'gather', 'work']);
      expect(done.landed.find((l) => l.kind === 'craft')?.items).toEqual({ 'heart-charm': 1 });
      expect(done.landed.find((l) => l.kind === 'gather')?.items).toEqual(gather.items);
      const worked = done.landed.find((l) => l.kind === 'work')?.items ?? {};
      expect(worked['timber']).toBeGreaterThan(0);
      expect(done.crafts).toEqual([]);
      expect(done.gathers).toEqual([]);
      expect(done.items).toEqual(await bag(mapId, kid));

      // The same events and ledger rows a Collect wrote, so milestones, the
      // recipe book and the tutorial keep counting.
      const events = (await eventsOf(mapId)).slice(before);
      expect(events.map((e) => e.type).sort()).toEqual([
        'item.crafted',
        'resource.gathered',
        'work.collected',
      ]);
      expect(events.find((e) => e.type === 'resource.gathered')?.payload).toEqual({
        gatherId: gather.id,
        userId: kid.id,
        q: gather.q,
        r: gather.r,
        resource: gather.resource,
        items: gather.items,
      });
      expect(events.find((e) => e.type === 'item.crafted')?.payload).toEqual({
        craftId: made.craft.id,
        userId: kid.id,
        recipeId: 'heart-charm',
        items: { 'heart-charm': 1 },
      });
      expect(events.find((e) => e.type === 'work.collected')?.payload).toEqual({
        userId: kid.id,
        squishyIds: [pet],
        items: worked,
      });
      const ledger = await ledgerOf(mapId, kid);
      const reasons = ledger.filter((l) => l.delta > 0).map((l) => [l.reason, l.refId]);
      expect(reasons).toEqual(
        expect.arrayContaining([
          ['craft', made.craft.id],
          ['gather', gather.id],
          ['work', pet],
        ]),
      );
      // The bag still matches its ledger (#17's reconcile rule), plus what `stock` put in.
      const sums: Record<string, number> = { timber: 2, treats: 1 };
      for (const l of ledger) sums[l.itemId] = (sums[l.itemId] ?? 0) + l.delta;
      expect(Object.fromEntries(Object.entries(sums).filter(([, n]) => n !== 0))).toEqual(
        await bag(mapId, kid),
      );

      // Settling again banks nothing new.
      const again = await settle(server, kid, mapId);
      expect(again.landed).toEqual([]);
      expect(again.items).toEqual(done.items);
    });

    it('banks once when two phones settle at the same moment', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const forest = await farLand(server, kid, mapId, 'forest');
      const pet = await squishy(mapId, kid);
      await setJob(server, kid, mapId, pet, { job: 'gatherer', q: forest.q, r: forest.r });
      const gather = await gatherAt(
        server,
        kid,
        mapId,
        await homeNode(server, kid, mapId, 'timber'),
      );
      later(3 * 60 * MINUTE_MS);
      expect(Date.parse(gather.readyAt)).toBeLessThan(clock.getTime());

      const [a, b] = await Promise.all([settle(server, kid, mapId), settle(server, kid, mapId)]);
      expect(a.landed.length + b.landed.length).toBe(2); // the gather and the gatherer, once each
      expect(a.items).not.toEqual({});
      const events = await eventsOf(mapId);
      expect(events.filter((e) => e.type === 'resource.gathered')).toHaveLength(1);
      expect(events.filter((e) => e.type === 'work.collected')).toHaveLength(1);
      expect((await settle(server, kid, mapId)).landed).toEqual([]);
    });

    it('keeps the cap: a gatherer away for ages banks only its stored cycles, then starts again', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const forest = await farLand(server, kid, mapId, 'forest');
      const pet = await squishy(mapId, kid);
      await setJob(server, kid, mapId, pet, { job: 'gatherer', q: forest.q, r: forest.r });
      const work = jobOf(await jobs(server, kid, mapId), pet).work!;
      const one = (await jobs(server, kid, mapId)).spots.find(
        (s) => s.q === forest.q && s.r === forest.r,
      )!.quantity;

      later(work.cycleSeconds * 1000 * (JOB_RULES.work.maxStoredCycles + 10));
      const settled = await settle(server, kid, mapId);
      const banked = settled.landed.find((l) => l.kind === 'work')!.items;
      expect(banked['timber']).toBe(one * JOB_RULES.work.maxStoredCycles);
      // It starts again from the settle, not from where it stopped.
      const after = jobOf(await jobs(server, kid, mapId), pet).work!;
      expect(after).toMatchObject({ readyCycles: 0, full: false });
      expect(Date.parse(after.nextReadyAt!)).toBe(clock.getTime() + work.cycleSeconds * 1000);
      expect(settled.nextAt).toBe(after.nextReadyAt);
    });

    it('lands Training Grounds XP by itself, carrying part of a point, capped at a day', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      // On a homestead (owner decision 4 on #277).
      const plot = await makeHomestead(db, mapId, kid.id, clock);
      await db.insert(buildings).values({
        mapId,
        ownerUserId: kid.id,
        tileId: plot.id,
        buildingId: 'training-grounds',
        kind: 'training-grounds',
        spot: 2,
      });
      const pet = await squishy(mapId, kid, { level: 1 });
      const assigned = await setJob(server, kid, mapId, pet, { job: 'training' });
      expect(assigned.statusCode, assigned.body).toBe(200);
      expect((await settle(server, kid, mapId)).trained).toEqual([]);

      // 90 minutes at 5 an hour: 7 whole XP, and 6 minutes carry on.
      later(90 * MINUTE_MS);
      const first = await settle(server, kid, mapId);
      expect(first.trained).toEqual([{ squishyId: pet, name: 'Puddlepuff', xp: 7 }]);
      expect(first.landed).toEqual([]);
      later(6 * MINUTE_MS);
      expect((await settle(server, kid, mapId)).trained).toEqual([
        { squishyId: pet, name: 'Puddlepuff', xp: 1 },
      ]);
      expect(
        (await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, pet) }))?.xp,
      ).toBe(8);

      // Away for 30 hours: only a day's worth lands, then it starts again from now.
      later(30 * 60 * MINUTE_MS);
      const capped = await settle(server, kid, mapId);
      expect(capped.trained).toEqual([
        { squishyId: pet, name: 'Puddlepuff', xp: 5 * JOB_RULES.training.maxHours },
      ]);
      expect((await settle(server, kid, mapId)).trained).toEqual([]);
      const row = await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, pet) });
      expect(row).toMatchObject({ xp: 128, level: 3, trainingSince: new Date(clock) });
      const types = (await eventsOf(mapId)).map((e) => e.type);
      expect(types.slice(-2)).toEqual(['squishy.trained', 'squishy.leveled']);
    });

    it('keeps what finished before the land changed hands, and lets the rest go', async () => {
      const server = await start();
      const [kid, rival] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await db.insert(mapMembers).values({ mapId, userId: rival.id, role: 'member' });
      const forest = await farLand(server, kid, mapId, 'forest');
      const hills = await farLand(server, kid, mapId, 'hills', [forest]);
      const pet = await squishy(mapId, kid);
      await setJob(server, kid, mapId, pet, { job: 'gatherer', q: forest.q, r: forest.r });
      const view = await jobs(server, kid, mapId);
      const cycle = jobOf(view, pet).work!.cycleSeconds * 1000;
      const one = view.spots.find((s) => s.q === forest.q && s.r === forest.r)!.quantity;
      // Two of my nodes: one gather finishes before its tile is taken, one doesn't.
      await run(
        `update tiles set node_resource = 'stone' where id = '${await tileIdAt(mapId, hills)}'`,
      );
      const quick = await gatherAt(server, kid, mapId, hills);

      // Two cycles and the Stone gather finish; a Timber gather has only just
      // started when the tiles are captured.
      clock.setTime(Math.max(clock.getTime() + 2 * cycle + 1000, Date.parse(quick.readyAt)));
      const timberNode = await homeNode(server, kid, mapId, 'timber');
      const slow = await gatherAt(server, kid, mapId, timberNode);
      later(1000);
      expect(Date.parse(slow.readyAt)).toBeGreaterThan(clock.getTime());
      const timberTile = await tileIdAt(mapId, timberNode);
      await capture(mapId, await tileIdAt(mapId, forest), kid, rival);
      await capture(mapId, await tileIdAt(mapId, hills), kid, rival);
      await capture(mapId, timberTile, kid, rival);
      later(10 * cycle + 60 * MINUTE_MS); // long after: nothing more counts

      const settled = await settle(server, kid, mapId);
      const worked = settled.landed.find((l) => l.kind === 'work')!.items;
      expect(worked['timber']).toBe(2 * one); // exactly the two cycles before the capture
      expect(settled.landed.find((l) => l.kind === 'gather')?.items).toEqual(quick.items);
      const rows = await db.query.gatherJobs.findMany({
        where: (t, { inArray }) => inArray(t.id, [quick.id, slow.id]),
      });
      expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
        [quick.id]: 'collected',
        [slow.id]: 'lost',
      });
      // The gatherer rests now.
      expect(jobOf(await jobs(server, kid, mapId), pet)).toMatchObject({
        job: 'resting',
        work: null,
      });
      expect((await settle(server, kid, mapId)).landed).toEqual([]);
    });

    it('banks a previous owner’s finished gather when the new owner starts one there', async () => {
      const server = await start();
      const [kid, rival] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      await db.insert(mapMembers).values({ mapId, userId: rival.id, role: 'member' });
      const hills = await farLand(server, kid, mapId, 'hills');
      const tileId = await tileIdAt(mapId, hills);
      await run(`update tiles set node_resource = 'stone' where id = '${tileId}'`);
      const gather = await gatherAt(server, kid, mapId, hills);
      clock.setTime(Date.parse(gather.readyAt) + MINUTE_MS);
      await capture(mapId, tileId, kid, rival);

      await gatherAt(server, rival, mapId, hills);
      expect((await bag(mapId, kid))['stone']).toBe(gather.items['stone']);
      const row = await db.query.gatherJobs.findFirst({
        where: (t, { eq }) => eq(t.id, gather.id),
      });
      expect(row?.status).toBe('collected');
      expect((await settle(server, kid, mapId)).landed).toEqual([]);
    });

    it('frees the pot: making something banks a finished craft first', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await stock(mapId, kid, { timber: 4, treats: 2 });
      const first = CraftResponseSchema.parse(
        (await craft(server, kid, mapId, 'heart-charm')).json(),
      );

      // Still cooking: the pot is busy, kindly.
      const busy = await craft(server, kid, mapId, 'heart-charm');
      expect(busy.statusCode).toBe(409);
      expect(errorOf(busy).message).toMatch(/still cooking/);

      clock.setTime(Date.parse(first.craft.readyAt));
      const second = await craft(server, kid, mapId, 'heart-charm');
      expect(second.statusCode).toBe(201);
      expect(CraftResponseSchema.parse(second.json()).items['heart-charm']).toBe(1);
      expect((await eventsOf(mapId)).filter((e) => e.type === 'item.crafted')).toHaveLength(1);
    });

    it('banks my own finished gather when I gather that node again', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const node = await homeNode(server, kid, mapId, 'timber');
      const first = await gatherAt(server, kid, mapId, node);
      const busy = await call(server, 'POST', `/maps/${mapId}/gathers`, kid, {
        q: node.q,
        r: node.r,
      });
      expect(busy.statusCode).toBe(409);
      clock.setTime(Date.parse(first.readyAt));
      await gatherAt(server, kid, mapId, node);
      expect((await bag(mapId, kid))['timber']).toBe(first.items['timber']);
    });

    it('rolls for found clothing on a settled gather', async () => {
      const server = await start({ HP_DEV_DROP_CHANCE: '100' });
      const kid = await player();
      const mapId = await newMap(server, kid);
      const gather = await gatherAt(
        server,
        kid,
        mapId,
        await homeNode(server, kid, mapId, 'timber'),
      );
      clock.setTime(Date.parse(gather.readyAt));
      await settle(server, kid, mapId);
      const found = (await eventsOf(mapId)).filter((e) => e.type === 'clothing.found');
      expect(found).toHaveLength(1);
      expect(found[0]?.payload).toMatchObject({
        userId: kid.id,
        source: 'gather',
        refId: gather.id,
      });
    });

    it('only settles for members', async () => {
      const server = await start();
      const [kid, stranger] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      const res = await call(server, 'POST', `/maps/${mapId}/settle`, stranger);
      expect([403, 404]).toContain(res.statusCode);
      expect((await call(server, 'POST', `/maps/${mapId}/settle`, null)).statusCode).toBe(401);
    });

    it('finishes my crafts now with the dev route, only when HP_DEV_SQUISHY_GRANTS is on', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await stock(mapId, kid, { timber: 2, treats: 1 });
      const { craft: made } = CraftResponseSchema.parse(
        (await craft(server, kid, mapId, 'heart-charm')).json(),
      );
      // Not a route at all without HP_DEV_SQUISHY_GRANTS.
      expect((await call(server, 'POST', `/maps/${mapId}/dev/crafts/ready`, kid)).statusCode).toBe(
        404,
      );
      await server.close();

      const dev = await start({ HP_DEV_SQUISHY_GRANTS: 'true' });
      // Someone outside the patch can't see it, as with every map route.
      const stranger = await player();
      expect(
        (await call(dev, 'POST', `/maps/${mapId}/dev/crafts/ready`, stranger)).statusCode,
      ).toBe(404);
      const ready = await call(dev, 'POST', `/maps/${mapId}/dev/crafts/ready`, kid);
      expect(ready.statusCode, ready.body).toBe(200);
      const bag = InventoryResponseSchema.parse(ready.json());
      // Ready now, and still the same length (started_at moved back with it).
      expect(bag.crafts.map((c) => c.id)).toEqual([made.id]);
      expect(bag.crafts[0]!.readyAt).toBe(clock.toISOString());
      expect(Date.parse(bag.crafts[0]!.readyAt) - Date.parse(bag.crafts[0]!.startedAt)).toBe(
        Date.parse(made.readyAt) - Date.parse(made.startedAt),
      );
      // The next settle lands it.
      expect((await settle(dev, kid, mapId)).landed).toEqual([
        { kind: 'craft', items: { 'heart-charm': 1 } },
      ]);
    });

    describe('the old banking points keep what finished before the land changed hands', () => {
      /** A gatherer works far land for two cycles, then a rival captures it, and time goes on. */
      async function capturedGatherer() {
        const server = await start();
        const [kid, rival] = [await player(), await player()];
        const mapId = await newMap(server, kid);
        await db.insert(mapMembers).values({ mapId, userId: rival.id, role: 'member' });
        const forest = await farLand(server, kid, mapId, 'forest');
        const pet = await squishy(mapId, kid);
        await setJob(server, kid, mapId, pet, { job: 'gatherer', q: forest.q, r: forest.r });
        const view = await jobs(server, kid, mapId);
        const cycle = jobOf(view, pet).work!.cycleSeconds * 1000;
        const one = view.spots.find((t) => t.q === forest.q && t.r === forest.r)!.quantity;
        later(2 * cycle + 1000);
        await capture(mapId, await tileIdAt(mapId, forest), kid, rival);
        const seenBefore = (await eventsOf(mapId)).length;
        later(5 * cycle);
        return { server, kid, mapId, pet, one, seenBefore };
      }

      for (const job of ['resting', 'team'] as const) {
        it(`banks exactly the cycles before the capture when it’s given a new job (${job})`, async () => {
          const { server, kid, mapId, pet, one, seenBefore } = await capturedGatherer();
          const res = await setJob(server, kid, mapId, pet, { job });
          expect(res.statusCode).toBe(200);
          expect((await bag(mapId, kid))['timber']).toBe(2 * one);
          const after = (await eventsOf(mapId)).slice(seenBefore);
          const collected = after.filter((e) => e.type === 'work.collected');
          expect(collected).toHaveLength(1);
          expect(collected[0]?.payload).toEqual({
            userId: kid.id,
            squishyIds: [pet],
            items: { timber: 2 * one },
          });
          // It wasn't shown working on the map any more, so no "left its tile" either.
          expect(
            after.filter(
              (e) =>
                e.type === 'squishy.assigned' &&
                (e.payload as { squishyId: string; job: string }).job !== 'team',
            ),
          ).toEqual([]);
          // Banked once: settling after finds nothing more.
          expect((await settle(server, kid, mapId)).landed).toEqual([]);
        });
      }
    });

    describe('lock order (tech spec §7)', () => {
      /** Holds `first`, runs `command`, and once it waits, takes `then` too (a deadlock fails fast). */
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
      const lockRow = (
        tx: Database,
        table: 'squishies' | 'tiles' | 'gather_jobs' | 'crafts',
        id: string,
      ) => tx.execute(`select 1 from ${table} where id = '${id}' for update`);
      const lockItem = (mapId: string, who: Player, item: string) => (tx: Database) =>
        tx.execute(
          `select 1 from inventories
           where map_id = '${mapId}' and user_id = '${who.id}' and item_id = '${item}' for update`,
        );
      const lockMember = (tx: Database, mapId: string, userId: string) =>
        tx.execute(
          `select 1 from map_members where map_id = '${mapId}' and user_id = '${userId}' for update`,
        );

      async function setup() {
        const server = await start();
        const kid = await player();
        const mapId = await newMap(server, kid);
        const user = { id: kid.id, username: kid.username } as never;
        const settler = createSettleService({ db, clock: () => clock });
        const jobsService = createSquishyJobsService({ db, clock: () => clock });
        return { server, kid, mapId, user, settler, jobsService };
      }

      /** A gatherer working my Timber node, a cycle finished, and a Timber row to lock. */
      async function workingGatherer() {
        const ctx = await setup();
        const node = await homeNode(ctx.server, ctx.kid, ctx.mapId, 'timber');
        const pet = await squishy(ctx.mapId, ctx.kid);
        await ctx.jobsService.setJob(ctx.user, ctx.mapId, pet, {
          job: 'gatherer',
          q: node.q,
          r: node.r,
        });
        await stock(ctx.mapId, ctx.kid, { timber: 1 });
        later(31 * MINUTE_MS);
        return { ...ctx, pet, tileId: await tileIdAt(ctx.mapId, node) };
      }

      it('takes the member row before the tiles', async () => {
        const { kid, mapId, user, settler, tileId } = await workingGatherer();
        await holdThen(
          (tx) => lockMember(tx, mapId, kid.id),
          () => settler.settle(user, mapId),
          (tx) => lockRow(tx, 'tiles', tileId),
        );
      });

      it('takes the work tile before the squishy, so a capture or a new job can’t land mid-settle', async () => {
        const { mapId, user, settler, tileId, pet } = await workingGatherer();
        await holdThen(
          (tx) => lockRow(tx, 'tiles', tileId),
          () => settler.settle(user, mapId),
          (tx) => lockRow(tx, 'squishies', pet),
        );
      });

      it('takes the squishy before its owner’s inventory rows', async () => {
        const { kid, mapId, user, settler, pet } = await workingGatherer();
        await holdThen(
          (tx) => lockRow(tx, 'squishies', pet),
          () => settler.settle(user, mapId),
          lockItem(mapId, kid, 'timber'),
        );
        expect((await bag(mapId, kid))['timber']).toBeGreaterThan(1);
      });

      it('locks two gatherers’ items in item-id order, not squishy order', async () => {
        const { server, kid, mapId, user, settler, jobsService } = await setup();
        const forest = await farLand(server, kid, mapId, 'forest');
        const hills = await farLand(server, kid, mapId, 'hills', [forest]);
        // The Timber gatherer has the lower id, so grants in squishy order would
        // take timber before stone: the reverse of item-id order.
        const [low, high] = [randomUUID(), randomUUID()].sort();
        await squishy(mapId, kid, { id: low });
        await squishy(mapId, kid, { id: high });
        await jobsService.setJob(user, mapId, low!, { job: 'gatherer', q: forest.q, r: forest.r });
        await jobsService.setJob(user, mapId, high!, { job: 'gatherer', q: hills.q, r: hills.r });
        await stock(mapId, kid, { stone: 1, timber: 1 });
        later(31 * MINUTE_MS);
        // Hold Stone the way a building's cost would (item-id order), then take Timber.
        await holdThen(
          lockItem(mapId, kid, 'stone'),
          () => settler.settle(user, mapId),
          lockItem(mapId, kid, 'timber'),
        );
        expect(await bag(mapId, kid)).toMatchObject({ stone: 3, timber: 3 });
      });

      it('takes the tile before the gather, and the gather before the inventory rows', async () => {
        const { server, kid, mapId, user, settler } = await setup();
        const node = await homeNode(server, kid, mapId, 'timber');
        const tileId = await tileIdAt(mapId, node);
        const gather = await gatherAt(server, kid, mapId, node);
        await stock(mapId, kid, { timber: 1 });
        clock.setTime(Date.parse(gather.readyAt));
        await holdThen(
          (tx) => lockRow(tx, 'tiles', tileId),
          () => settler.settle(user, mapId),
          (tx) => lockRow(tx, 'gather_jobs', gather.id),
        );
        const again = await gatherAt(server, kid, mapId, node);
        clock.setTime(Date.parse(again.readyAt));
        await holdThen(
          (tx) => lockRow(tx, 'gather_jobs', again.id),
          () => settler.settle(user, mapId),
          lockItem(mapId, kid, 'timber'),
        );
        expect((await bag(mapId, kid))['timber']).toBe(1 + 2 * gather.items['timber']!);
      });

      it('takes the craft before the inventory rows, banking a finished one as the next starts', async () => {
        const { kid, mapId, user } = await setup();
        const inventory = createInventoryService({ db, clock: () => clock });
        await stock(mapId, kid, { timber: 4, treats: 2, 'heart-charm': 1 });
        const first = await inventory.startCraft(user, mapId, 'heart-charm');
        clock.setTime(Date.parse(first.craft.readyAt));
        await holdThen(
          (tx) => lockRow(tx, 'crafts', first.craft.id),
          () => inventory.startCraft(user, mapId, 'heart-charm'),
          lockItem(mapId, kid, 'heart-charm'),
        );
        expect((await bag(mapId, kid))['heart-charm']).toBe(2);
      });

      it('takes the tile, then the gather, then the old owner’s rows when a new owner banks it', async () => {
        const { server, kid, mapId } = await setup();
        const rival = await player();
        await db.insert(mapMembers).values({ mapId, userId: rival.id, role: 'member' });
        const hills = await farLand(server, kid, mapId, 'hills');
        const tileId = await tileIdAt(mapId, hills);
        await run(`update tiles set node_resource = 'stone' where id = '${tileId}'`);
        const gather = await gatherAt(server, kid, mapId, hills);
        await stock(mapId, kid, { stone: 1 });
        clock.setTime(Date.parse(gather.readyAt) + MINUTE_MS);
        await capture(mapId, tileId, kid, rival);
        const gathering = createGatheringService({ db, clock: () => clock });
        const asRival = { id: rival.id, username: rival.username } as never;
        await holdThen(
          (tx) => lockRow(tx, 'tiles', tileId),
          () => gathering.start(asRival, mapId, { q: hills.q, r: hills.r }),
          (tx) => lockRow(tx, 'gather_jobs', gather.id),
        );
        // The gather was banked into my bag, not lost.
        expect((await bag(mapId, kid))['stone']).toBe(1 + gather.items['stone']!);
      });
    });
  },
);
