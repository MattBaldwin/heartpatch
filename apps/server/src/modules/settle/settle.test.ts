import {
  ApiErrorSchema,
  CraftResponseSchema,
  GatherResponseSchema,
  hexDistance,
  JOB_RULES,
  JobsViewSchema,
  MapResponseSchema,
  MapViewSchema,
  SettleResponseSchema,
  type JobsView,
  type PublicTile,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import {
  battles,
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

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
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
      const far = all.find(
        (t) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          !skip.some((s) => s.q === t.q && s.r === t.r) &&
          home.every((h) => hexDistance(h, t) >= 4),
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
  },
);
