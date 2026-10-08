import { randomUUID } from 'node:crypto';
import {
  ApiErrorSchema,
  BattleResponseSchema,
  CLOTHING,
  GatherResponseSchema,
  HomeResponseSchema,
  LorebookResponseSchema,
  MapResponseSchema,
  MyMapsResponseSchema,
  parseGameEventPayload,
  STARTERS,
  TUTORIAL_LAYOUT,
  TUTORIAL_SETUP,
  TUTORIAL_STEPS,
  TutorialResponseSchema,
  WardrobeResponseSchema,
  type PlayerBattle,
  type PlayerBattleAction,
  type TutorialStep,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { appendGameEvent } from '../../db/game-events.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createLoreConsumer } from '../lore/consumer.js';
import { createTutorialConsumer } from './consumer.js';
import { SEEDLING_SCARF, scarfRefId } from './rewards.js';
import { createTutorialService } from './service.js';

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

interface Player {
  id: string;
  username: string;
  token: string;
}

describe.skipIf(!url)('tutorial (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let clock = new Date('2026-10-02T12:00:00Z');
  let counter = 0;
  const consumer = createTutorialConsumer({ clock: () => clock });

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock = new Date('2026-10-02T12:00:00Z');
  });

  async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, ...env });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  /** A logged-in player, written straight to the database (auth has its own tests). */
  async function player(): Promise<Player> {
    const username = `sproutkid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    // Every player has picked a Keeper (the map gate, #42; keepers.test.ts covers it).
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, username, token };
  }

  function call(
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player | null,
    payload?: object,
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;
  const tutorialOf = (res: LightMyRequestResponse) =>
    TutorialResponseSchema.parse(res.json()).tutorial;

  async function getTutorial(server: FastifyInstance, who: Player) {
    const res = await call(server, 'GET', '/tutorial', who);
    expect(res.statusCode).toBe(200);
    return tutorialOf(res);
  }

  async function begin(server: FastifyInstance, who: Player) {
    const res = await call(server, 'POST', '/tutorial/start', who);
    expect(res.statusCode).toBe(201);
    return tutorialOf(res);
  }

  /** Taps through the current step and lets the step engine run. */
  async function acknowledge(server: FastifyInstance, who: Player, stepId: string) {
    const res = await call(server, 'POST', '/tutorial/acknowledge', who, { stepId });
    expect(res.statusCode).toBe(204);
    const { mapId } = await getTutorial(server, who);
    await runConsumer(db, consumer, mapId!);
  }

  /**
   * Moves a run straight to a step (a test shortcut: the play-through test
   * below plays every step for real).
   */
  async function jumpTo(who: Player, stepId: string) {
    await db.execute(`update users set tutorial_step = '${stepId}' where id = '${who.id}'`);
  }

  /** Finishes the run going: straight to graduation, then the real tap. */
  async function finish(server: FastifyInstance, who: Player) {
    await jumpTo(who, 'graduation');
    await acknowledge(server, who, 'graduation');
  }

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  const membershipOf = (mapId: string, userId: string) =>
    db.query.mapMembers.findFirst({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
    });

  const squishiesOf = (mapId: string) =>
    db.query.squishies.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
    });

  const progressOf = (userId: string) =>
    db.query.users.findFirst({
      where: (t, { eq }) => eq(t.id, userId),
      columns: { tutorialStep: true, tutorialCompletedAt: true },
    });

  describe('starting and resuming', () => {
    it('needs a logged-in player', async () => {
      const server = await start();
      for (const [method, path] of [
        ['GET', '/tutorial'],
        ['POST', '/tutorial/start'],
        ['POST', '/tutorial/replay'],
        ['POST', '/tutorial/skip'],
      ] as const) {
        const res = await call(server, method, path, null);
        expect(res.statusCode).toBe(401);
        expect(errorOf(res).code).toBe('UNAUTHENTICATED');
      }
    });

    it('reports the tutorial gate setting (decision A)', async () => {
      const kid = await player();
      expect(await getTutorial(await start(), kid)).toEqual({
        status: 'not-started',
        stepId: null,
        mapId: null,
        completedAt: null,
        required: false,
        partner: null,
      });
      await app!.close();
      expect((await getTutorial(await start({ HP_TUTORIAL_REQUIRED: 'true' }), kid)).required).toBe(
        true,
      );
    });

    it('builds the Tutorial Glade as a one-player map from the hand-authored layout', async () => {
      const server = await start();
      const kid = await player();
      const tutorial = await begin(server, kid);
      expect(tutorial).toMatchObject({ status: 'in-progress', stepId: 'welcome' });

      const map = await db.query.maps.findFirst({
        where: (t, { eq }) => eq(t.id, tutorial.mapId!),
      });
      expect(map).toMatchObject({
        kind: 'tutorial',
        name: 'Tutorial Glade',
        timeZone: 'America/Denver',
        maxPlayers: 1,
        pvpMode: 'off',
        seed: null,
        eventSeq: 1,
      });
      expect(await membershipOf(map!.id, kid.id)).toMatchObject({
        role: 'owner',
        status: 'active',
        homeSlot: 0,
      });

      const tiles = await db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, map!.id) });
      expect(tiles).toHaveLength(TUTORIAL_LAYOUT.tiles.length);
      const byKey = new Map(tiles.map((t) => [`${t.q},${t.r}`, t]));
      for (const t of TUTORIAL_LAYOUT.tiles) {
        expect(byKey.get(`${t.q},${t.r}`)).toMatchObject({
          terrain: t.terrain,
          nodeResource: t.nodeResource,
          guardianStrength: t.guardianStrength,
          homeSlot: t.homeSlot,
          ownerUserId: t.homeSlot === 0 ? kid.id : null,
        });
      }

      const [created] = await eventsOf(map!.id);
      expect(created).toMatchObject({ seq: 1, type: 'map.created', actorUserId: kid.id });
      expect(parseGameEventPayload('map.created', created!.payload)).toEqual({
        name: 'Tutorial Glade',
        timeZone: 'America/Denver',
        pvpMode: 'off',
        maxPlayers: 1,
        homeSlot: 0,
        heartSeed: { q: 0, r: 0 },
      });
    });

    it('resumes the same run after quitting, at the same step', async () => {
      const server = await start();
      const kid = await player();
      const first = await begin(server, kid);
      await acknowledge(server, kid, 'welcome');

      // "Killing the app": a new server, then the client asks where it was.
      await app!.close();
      const again = await start();
      const resumed = await getTutorial(again, kid);
      expect(resumed).toEqual({ ...first, stepId: 'plant' });
      const res = await call(again, 'POST', '/tutorial/start', kid);
      expect(res.statusCode).toBe(200);
      expect(tutorialOf(res)).toEqual(resumed);
    });

    it("keeps tutorial maps out of the player's patches", async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await begin(server, kid);
      const mine = MyMapsResponseSchema.parse((await call(server, 'GET', '/maps', kid)).json());
      expect(mine.maps).toEqual([]);
      expect((await call(server, 'GET', `/maps/${mapId!}`, kid)).statusCode).toBe(404);
    });
  });

  describe('the step engine', () => {
    it('moves through the steps as the player reads them, then finishes', async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await begin(server, kid);

      await acknowledge(server, kid, 'welcome');
      expect((await getTutorial(server, kid)).stepId).toBe('plant');
      await acknowledge(server, kid, 'plant');
      expect((await getTutorial(server, kid)).stepId).toBe('gather');

      clock = new Date('2026-10-02T12:15:00Z');
      await jumpTo(kid, 'graduation');
      await acknowledge(server, kid, 'graduation');
      expect(await getTutorial(server, kid)).toEqual({
        status: 'completed',
        stepId: null,
        mapId: null,
        completedAt: '2026-10-02T12:15:00.000Z',
        required: false,
        partner: null,
      });

      // Each acknowledgement, then the engine's own system event, in seq order.
      const events = (await eventsOf(mapId!)).map((e) => [e.type, e.actorUserId, e.payload]);
      expect(events).toEqual([
        ['map.created', kid.id, expect.anything()],
        ['tutorial.acknowledged', kid.id, { stepId: 'welcome' }],
        ['tutorial.advanced', null, { completedStepId: 'welcome', stepId: 'plant' }],
        ['tutorial.acknowledged', kid.id, { stepId: 'plant' }],
        ['tutorial.advanced', null, { completedStepId: 'plant', stepId: 'gather' }],
        ['tutorial.acknowledged', kid.id, { stepId: 'graduation' }],
        ['tutorial.advanced', null, { completedStepId: 'graduation', stepId: null }],
      ]);
      // Caught up, including its own events: running again changes nothing.
      expect(await runConsumer(db, consumer, mapId!)).toBe(0);
    });

    it('only acknowledges the current, talk-only step', async () => {
      const server = await start();
      const kid = await player();
      const before = await call(server, 'POST', '/tutorial/acknowledge', kid, {
        stepId: 'welcome',
      });
      expect(before.statusCode).toBe(409);

      await begin(server, kid);
      const ahead = await call(server, 'POST', '/tutorial/acknowledge', kid, {
        stepId: 'graduation',
      });
      expect(ahead.statusCode).toBe(409);
      expect(errorOf(ahead).message).toBe('Sprout has already moved on. Take a look!');
      const bad = await call(server, 'POST', '/tutorial/acknowledge', kid, { stepId: 'Nope!' });
      expect(bad.statusCode).toBe(400);

      // A gameplay step finishes on the real module's event, not on a tap.
      const steps: TutorialStep[] = [
        {
          id: 'calm-down',
          goal: 'Make it gentle',
          sproutLines: ['Gentle is nice.'],
          highlightTarget: 'none',
          completeOn: { eventType: 'map.updated', actor: 'anyone', where: [] },
        },
      ];
      const service = createTutorialService({ db, tutorialRequired: false, steps });
      const other = await player();
      await service.replay({ id: other.id, username: other.username });
      await expect(
        service.acknowledge({ id: other.id, username: other.username }, 'calm-down'),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('advances one step per matching event, however often the player taps', async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await begin(server, kid);
      // A double tap before the engine runs: two events for the same step.
      for (let i = 0; i < 2; i++) {
        const res = await call(server, 'POST', '/tutorial/acknowledge', kid, { stepId: 'welcome' });
        expect(res.statusCode).toBe(204);
      }
      await runConsumer(db, consumer, mapId!);
      expect((await getTutorial(server, kid)).stepId).toBe('plant');
      expect((await eventsOf(mapId!)).filter((e) => e.type === 'tutorial.advanced')).toHaveLength(
        1,
      );
    });

    it('waits on a step-completing event until the engine runs, then applies it once', async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await begin(server, kid);
      await call(server, 'POST', '/tutorial/acknowledge', kid, { stepId: 'welcome' });
      // Committed but not yet consumed (a crash before the job ran): still on welcome.
      expect((await getTutorial(server, kid)).stepId).toBe('welcome');

      // A handler that fails after its writes rolls them back with the position.
      const failing = createTutorialConsumer({ clock: () => clock });
      const handle = failing.handle;
      failing.handle = async (tx, event) => {
        await handle(tx, event);
        if (event.type === 'tutorial.acknowledged') throw new Error('crash');
      };
      await expect(runConsumer(db, failing, mapId!)).rejects.toThrow('crash');
      expect((await progressOf(kid.id))?.tutorialStep).toBe('welcome');

      await runConsumer(db, consumer, mapId!);
      await runConsumer(db, consumer, mapId!);
      expect((await getTutorial(server, kid)).stepId).toBe('plant');
      expect((await eventsOf(mapId!)).filter((e) => e.type === 'tutorial.advanced')).toHaveLength(
        1,
      );
    });
  });

  describe('replay and skip', () => {
    it('only lets a player skip after finishing once', async () => {
      const server = await start();
      const kid = await player();
      await begin(server, kid);
      const res = await call(server, 'POST', '/tutorial/skip', kid);
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).message).toBe(
        'Finish your first adventure with Sprout, then you can skip it.',
      );
      expect((await getTutorial(server, kid)).status).toBe('in-progress');
    });

    it('replays on a fresh Glade, keeps the first completion and ignores the old run', async () => {
      const server = await start();
      const kid = await player();
      const first = await begin(server, kid);
      await finish(server, kid);
      const done = await getTutorial(server, kid);
      expect(done.status).toBe('completed');

      // Starting again is a replay, which Settings asks for explicitly.
      expect((await call(server, 'POST', '/tutorial/start', kid)).statusCode).toBe(409);

      clock = new Date('2026-10-03T09:00:00Z');
      const res = await call(server, 'POST', '/tutorial/replay', kid);
      expect(res.statusCode).toBe(201);
      const replay = tutorialOf(res);
      expect(replay).toMatchObject({
        status: 'in-progress',
        stepId: 'welcome',
        completedAt: done.completedAt,
      });
      expect(replay.mapId).not.toBe(first.mapId);
      expect((await membershipOf(first.mapId!, kid.id))?.status).toBe('removed');

      // Finishing the replay doesn't move the first completion time.
      await finish(server, kid);
      expect((await getTutorial(server, kid)).completedAt).toBe(done.completedAt);
    });

    it('grants rewards when the wardrobe step comes up and on finishing, once per event', async () => {
      const granted: string[] = [];
      const rewarding = createTutorialConsumer({
        clock: () => clock,
        grantRewards: (_tx, { userId }) => {
          granted.push(userId);
          return Promise.resolve();
        },
      });
      const server = await start();
      const kid = await player();
      const { mapId } = await begin(server, kid);
      // The evolve step finishes on the Partner's evolution: the scarf is next.
      await jumpTo(kid, 'evolve');
      await db.transaction((tx) =>
        appendGameEvent(tx, {
          mapId: mapId!,
          type: 'squishy.evolved',
          actorUserId: kid.id,
          payload: {
            userId: kid.id,
            squishyId: randomUUID(),
            fromSpeciesId: 'emberbun',
            intoSpeciesId: 'hearthbun',
            level: 16,
          },
        }),
      );
      await runConsumer(db, rewarding, mapId!);
      await runConsumer(db, rewarding, mapId!);
      expect((await getTutorial(server, kid)).stepId).toBe('wardrobe');
      expect(granted).toEqual([kid.id]);
      await jumpTo(kid, 'graduation');
      await call(server, 'POST', '/tutorial/acknowledge', kid, { stepId: 'graduation' });
      await runConsumer(db, rewarding, mapId!);
      await runConsumer(db, rewarding, mapId!);
      expect(granted).toEqual([kid.id, kid.id]);
    });

    it('grants the Seedling Scarf once per account, with a ref of its own per player', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      for (const who of [kid, friend]) {
        await begin(server, who);
        await finish(server, who);
      }
      // Replayed and finished again: still one scarf.
      await call(server, 'POST', '/tutorial/replay', kid);
      await finish(server, kid);
      const scarves = await db.query.clothingOwned.findMany({
        where: (t, { and, eq, inArray }) =>
          and(eq(t.itemId, SEEDLING_SCARF), inArray(t.userId, [kid.id, friend.id])),
      });
      expect(scarves).toHaveLength(2);
      for (const who of [kid, friend]) {
        const mine = scarves.filter((s) => s.userId === who.id);
        expect(mine).toEqual([
          expect.objectContaining({ source: 'tutorial', refId: scarfRefId(who.id) }),
        ]);
      }
      expect(scarfRefId(kid.id)).not.toBe(scarfRefId(friend.id));
      expect(CLOTHING.find((c) => c.id === SEEDLING_SCARF)).toMatchObject({
        sources: ['tutorial'],
        tradable: false,
      });
      // It's in their wardrobe to wear.
      const res = await call(server, 'GET', '/wardrobe', kid);
      expect(WardrobeResponseSchema.parse(res.json()).wardrobe.owned).toEqual(
        expect.arrayContaining([expect.objectContaining({ itemId: SEEDLING_SCARF })]),
      );
    });

    it('restarts a run in progress, and the old run can no longer advance', async () => {
      const server = await start();
      const kid = await player();
      const first = await begin(server, kid);
      // An acknowledgement the engine hasn't processed yet when the replay happens.
      await call(server, 'POST', '/tutorial/acknowledge', kid, { stepId: 'welcome' });
      const replay = tutorialOf(await call(server, 'POST', '/tutorial/replay', kid));

      await runConsumer(db, consumer, first.mapId!);
      expect(await getTutorial(server, kid)).toEqual(replay);
      expect(replay.stepId).toBe('welcome');
    });

    it('skips a replay once finished, ending the run', async () => {
      const server = await start();
      const kid = await player();
      await begin(server, kid);
      await finish(server, kid);
      const replay = tutorialOf(await call(server, 'POST', '/tutorial/replay', kid));

      const res = await call(server, 'POST', '/tutorial/skip', kid);
      expect(res.statusCode).toBe(200);
      expect(tutorialOf(res)).toMatchObject({ status: 'completed', stepId: null, mapId: null });
      expect((await membershipOf(replay.mapId!, kid.id))?.status).toBe('removed');
      // Nothing to skip: still fine.
      expect((await call(server, 'POST', '/tutorial/skip', kid)).statusCode).toBe(200);
    });

    it('opens the multiplayer game once finished when the gate is on (decision A)', async () => {
      const server = await start({ HP_TUTORIAL_REQUIRED: 'true' });
      const kid = await player();
      const patch = { name: 'Moon Patch', timeZone: 'UTC' };
      expect((await call(server, 'POST', '/maps', kid, patch)).statusCode).toBe(403);
      await begin(server, kid);
      await finish(server, kid);
      const res = await call(server, 'POST', '/maps', kid, patch);
      expect(res.statusCode).toBe(201);
      expect(MapResponseSchema.parse(res.json()).map.name).toBe('Moon Patch');
    });
  });
  describe('a run', () => {
    it("starts with the Glade friend and Sprout's little bag", async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await begin(server, kid);
      expect(await squishiesOf(mapId!)).toEqual([
        expect.objectContaining({
          ownerUserId: kid.id,
          speciesId: TUTORIAL_SETUP.helper.speciesId,
          level: TUTORIAL_SETUP.helper.level,
          state: 'active',
        }),
      ]);
      const bag = await db.query.inventories.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId!), eq(t.userId, kid.id)),
      });
      expect(Object.fromEntries(bag.map((row) => [row.itemId, row.quantity]))).toEqual(
        TUTORIAL_SETUP.bag,
      );
    });

    it('stores only a starter as the Partner, on the befriend step', async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await begin(server, kid);
      await jumpTo(kid, 'befriend');
      const captured = (speciesId: string) =>
        db.transaction((tx) =>
          appendGameEvent(tx, {
            mapId: mapId!,
            type: 'squishy.captured',
            actorUserId: kid.id,
            payload: {
              battleId: randomUUID(),
              userId: kid.id,
              squishyId: randomUUID(),
              speciesId,
              level: 1,
            },
          }),
        );
      const partnerOf = async () =>
        (
          await db.query.users.findFirst({
            where: (t, { eq }) => eq(t.id, kid.id),
            columns: { partnerSpeciesId: true },
          })
        )?.partnerSpeciesId;

      // Not a starter (no Glade squishy is, but the step engine checks anyway).
      await captured('fuzzbolt');
      await runConsumer(db, consumer, mapId!);
      expect((await getTutorial(server, kid)).stepId).toBe('befriend');
      expect(await partnerOf()).toBeNull();

      await captured('thistlepip');
      await runConsumer(db, consumer, mapId!);
      expect((await getTutorial(server, kid)).stepId).toBe('name-partner');
      expect(await partnerOf()).toBe('thistlepip');
    });

    it('jumps steps for dev tools only, the way the step engine moves', async () => {
      const off = await start();
      const kid = await player();
      const { mapId } = await begin(off, kid);
      const jump = { stepId: 'wardrobe' };
      expect((await call(off, 'POST', '/tutorial/dev/step', kid, jump)).statusCode).toBe(404);
      await app!.close();

      const server = await start({ HP_DEV_SQUISHY_GRANTS: 'true' });
      const res = await call(server, 'POST', '/tutorial/dev/step', kid, jump);
      expect(res.statusCode, res.body).toBe(200);
      expect(tutorialOf(res).stepId).toBe('wardrobe');
      const last = (await eventsOf(mapId!)).at(-1)!;
      expect(last).toMatchObject({ type: 'tutorial.advanced', actorUserId: null });
      expect(last.payload).toEqual({ completedStepId: 'welcome', stepId: 'wardrobe' });
      // The wardrobe step needs the scarf to put on.
      const scarves = await db.query.clothingOwned.findMany({
        where: (t, { and, eq }) => and(eq(t.userId, kid.id), eq(t.itemId, SEEDLING_SCARF)),
      });
      expect(scarves).toHaveLength(1);
    });

    it('lets night fall on the Glade only on its step, and takes nothing', async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await begin(server, kid);
      const early = await call(server, 'POST', '/tutorial/nightfall', kid);
      expect(early.statusCode).toBe(409);
      expect(errorOf(early).message).toBe(
        "It's not time for night yet. Let's finish this step first!",
      );

      await jumpTo(kid, 'nightfall');
      expect((await call(server, 'POST', '/tutorial/nightfall', kid)).statusCode).toBe(204);
      // A double tap before the engine moves on: the next night, still nothing taken.
      expect((await call(server, 'POST', '/tutorial/nightfall', kid)).statusCode).toBe(204);
      await runConsumer(db, consumer, mapId!);
      expect((await getTutorial(server, kid)).stepId).toBe('evolve');
      const nights = (await eventsOf(mapId!)).filter((e) => e.type === 'hollow.nightfall');
      expect(nights.length).toBeGreaterThan(0);
      for (const night of nights) {
        expect(parseGameEventPayload('hollow.nightfall', night.payload).taken).toEqual([]);
      }
      expect((await squishiesOf(mapId!)).every((s) => s.state === 'active')).toBe(true);
    });
  });

  describe('the whole Glade, played for real', () => {
    const lore = createLoreConsumer({ clock: () => clock });
    const later = (seconds: number) => {
      clock = new Date(clock.getTime() + seconds * 1000);
    };
    const battleOf = (res: LightMyRequestResponse) => BattleResponseSchema.parse(res.json()).battle;

    async function act(
      server: FastifyInstance,
      who: Player,
      b: PlayerBattle,
      action: PlayerBattleAction,
    ) {
      const res = await call(server, 'POST', `/battles/${b.id}/actions`, who, {
        action,
        turn: b.view.turn,
      });
      expect(res.statusCode, res.body).toBe(200);
      return battleOf(res);
    }

    /** Plays the first move every turn (or befriends at once) until the battle ends. */
    async function playOut(
      server: FastifyInstance,
      who: Player,
      battle: PlayerBattle,
      capture = false,
    ) {
      let current = battle;
      for (let i = 0; i < 200 && current.status === 'active'; i++) {
        const side = current.view.sides[current.mySide];
        const action: PlayerBattleAction = capture
          ? { type: 'capture' }
          : current.view.phase.type === 'replace'
            ? { type: 'replace', slot: side.squishies.findIndex((s) => s.energy > 0) }
            : { type: 'move', move: side.squishies[side.active]!.moves[0]! };
        current = await act(server, who, current, action);
      }
      expect(current.status).toBe('finished');
      return current;
    }

    it('names and grows the starter befriended on the befriend step, not an earlier one', async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await begin(server, kid);
      const m = mapId!;
      const befriend = async (tile: { q: number; r: number }) => {
        const res = await call(server, 'POST', `/maps/${m}/battles`, kid, { tile });
        expect(res.statusCode, res.body).toBe(201);
        const battle = battleOf(res);
        await playOut(server, kid, battle, true);
        await runConsumer(db, consumer, m);
        return battle.view.sides.b.squishies[0]!.speciesId;
      };
      // A starter befriended early, while the kid is meant to be building a fire.
      await jumpTo(kid, 'hearthfire');
      const early = await befriend({ q: 0, r: 1 });
      expect((await getTutorial(server, kid)).stepId).toBe('hearthfire');
      // Then the real one, on the befriend step.
      await jumpTo(kid, 'befriend');
      const chosen = await befriend({ q: 1, r: 0 });
      expect(chosen).not.toBe(early);
      const { partner } = await getTutorial(server, kid);
      expect(partner?.speciesId).toBe(chosen);
      const account = await db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, kid.id) });
      expect(account?.partnerSpeciesId).toBe(chosen);

      // The evolve step grows that one.
      await jumpTo(kid, 'evolve');
      const res = await call(server, 'POST', `/maps/${m}/battles`, kid, { tile: { q: -1, r: 1 } });
      await playOut(server, kid, battleOf(res));
      await runConsumer(db, consumer, m);
      expect((await getTutorial(server, kid)).stepId).toBe('wardrobe');
      const rows = await squishiesOf(m);
      expect(rows.find((r) => r.id === partner!.squishyId)!.speciesId).not.toBe(chosen);
      expect(rows.filter((r) => r.speciesId === early)).toHaveLength(1);
    }, 30_000);

    it('teaches every step with the real modules, from the Heart Seed to graduation', async () => {
      const server = await start();
      const kid = await player();
      const { mapId } = await begin(server, kid);
      const m = mapId!;
      const step = async () => {
        await runConsumer(db, consumer, m);
        await runConsumer(db, lore, m);
        return (await getTutorial(server, kid)).stepId;
      };
      const ok = async (method: 'GET' | 'POST', path: string, body?: object) => {
        const res = await call(server, method, path, kid, body);
        expect(res.statusCode, `${path}: ${res.body}`).toBeLessThan(300);
        return res;
      };
      const gather = async (q: number, r: number) => {
        const res = await ok('POST', `/maps/${m}/gathers`, { q, r });
        const { gather: job } = GatherResponseSchema.parse(res.json());
        later(10);
        await ok('POST', `/maps/${m}/gathers/${job.id}/collect`);
      };
      const build = async (buildingId: string) => {
        for (const [q, r] of [
          [0, 1],
          [-1, 0],
          [0, 0],
        ] as const) {
          for (let spot = 0; spot <= 6; spot++) {
            const res = await call(server, 'POST', `/maps/${m}/buildings`, kid, {
              buildingId,
              q,
              r,
              spot,
            });
            if (res.statusCode === 201 || res.statusCode === 200) {
              const home = HomeResponseSchema.parse(res.json());
              return home.buildings.find((b) => b.buildingId === buildingId)!;
            }
          }
        }
        throw new Error(`no spot for ${buildingId}`);
      };

      // 1. Plant the Heart Seed (Sprout's welcome first).
      await acknowledge(server, kid, 'welcome');
      await acknowledge(server, kid, 'plant');
      expect(await step()).toBe('gather');

      // 2. Gather: Timber from the ring, in seconds.
      await gather(1, 0);
      expect(await step()).toBe('hearthfire');

      // 3. The Heart Seed keeps home safe (owner decision 2026-10-07): Sprout says so.
      await acknowledge(server, kid, 'hearthfire');
      expect(await step()).toBe('first-battle');

      // 4. First battle, with the Glade friend: won or not, it counts.
      const first = battleOf(await ok('POST', `/maps/${m}/battles`, { tile: { q: 0, r: 1 } }));
      expect(first.view.sides[first.mySide].squishies.map((s) => s.speciesId)).toEqual([
        TUTORIAL_SETUP.helper.speciesId,
      ]);
      const wild = first.view.sides[first.mySide === 'a' ? 'b' : 'a'].squishies[0]!.speciesId;
      expect(STARTERS.speciesIds).toContain(wild);
      await playOut(server, kid, first);
      expect(await step()).toBe('befriend');

      // 5. Befriend a starter (always works here), and name the Partner.
      const meet = battleOf(await ok('POST', `/maps/${m}/battles`, { tile: { q: 0, r: 1 } }));
      await playOut(server, kid, meet, true);
      expect(await step()).toBe('name-partner');
      const { partner } = await getTutorial(server, kid);
      expect(partner).toMatchObject({ speciesId: wild, nickname: null });
      await ok('POST', `/maps/${m}/squishies/${partner!.squishyId}/rename`, { nickname: 'Sunny' });
      expect(await step()).toBe('care');

      // 6. Care up close.
      await ok('POST', `/maps/${m}/squishies/${partner!.squishyId}/care`, { action: 'pet' });
      expect(await step()).toBe('habitat');

      // 7. A habitat (one more Timber gather pays for it), and move in.
      await gather(1, 0);
      const habitat = await build('cozy-meadow');
      await ok('POST', `/maps/${m}/squishies/${partner!.squishyId}/habitat`, {
        habitatId: habitat.id,
      });
      expect(await step()).toBe('territory');

      // 8. Claim a tile next to home (another one, if the guardian wins).
      let claimed: { q: number; r: number } | null = null;
      for (const [q, r] of [
        [1, 1],
        [-1, 2],
        [2, -1],
        [-2, 1],
        [1, -2],
        [-1, -1],
      ] as const) {
        const res = await call(server, 'POST', `/maps/${m}/attacks`, kid, { q, r });
        if (res.statusCode >= 300) continue;
        const ended = await playOut(server, kid, battleOf(res));
        if ((await step()) === 'land-fire') {
          claimed = { q, r };
          break;
        }
        expect(ended.status).toBe('finished');
      }
      expect(claimed).not.toBeNull();

      // 8b. A fire in the new land's middle: Emberwood fuels it, the bag's Stone builds it.
      await gather(1, -1);
      const lit = await ok('POST', `/maps/${m}/buildings`, {
        buildingId: 'hearthfire',
        ...claimed!,
        spot: 0,
      });
      const fire = HomeResponseSchema.parse(lit.json()).buildings.find(
        (b) => b.buildingId === 'hearthfire',
      )!;
      await ok('POST', `/maps/${m}/buildings/${fire.id}/fuel`, { nights: 1 });
      expect(await step()).toBe('defend');

      // 9. Defend: the Glade friend stands watch on the new land.
      const helper = (await squishiesOf(m)).find(
        (s) => s.speciesId === TUTORIAL_SETUP.helper.speciesId,
      )!;
      await ok('POST', `/maps/${m}/defenders`, { ...claimed!, squishyIds: [helper.id] });
      expect(await step()).toBe('nightfall');

      // 10. Nightfall: the Hollow Man visits and takes nothing; a lore page is found.
      await ok('POST', '/tutorial/nightfall');
      expect(await step()).toBe('evolve');
      const book = LorebookResponseSchema.parse((await ok('GET', '/lore')).json());
      expect(book.pages.map((p) => p.id)).toEqual(['paw-prints-by-the-fire']);

      // 11. One more battle, and the Partner evolves.
      const last = battleOf(await ok('POST', `/maps/${m}/battles`, { tile: { q: -1, r: 1 } }));
      await playOut(server, kid, last);
      expect(await step()).toBe('wardrobe');
      const grown = (await squishiesOf(m)).find((s) => s.id === partner!.squishyId)!;
      expect(grown.speciesId).not.toBe(wild);
      expect(grown.nickname).toBe('Sunny');

      // 12. The Seedling Scarf is theirs: put it on.
      const wardrobe = WardrobeResponseSchema.parse((await ok('GET', '/wardrobe')).json()).wardrobe;
      expect(wardrobe.owned.map((o) => o.itemId)).toContain(SEEDLING_SCARF);
      const top = new Set(CLOTHING.filter((c) => c.slot === 'top').map((c) => c.id));
      await ok('POST', '/wardrobe/wear', {
        wearing: [...wardrobe.wearing.filter((id) => !top.has(id)), SEEDLING_SCARF],
      });
      expect(await step()).toBe('graduation');

      // 13. Graduation: done, with the Partner remembered for the starter pick.
      await acknowledge(server, kid, 'graduation');
      const done = await getTutorial(server, kid);
      expect(done.status).toBe('completed');
      const account = await db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, kid.id) });
      expect(account).toMatchObject({ partnerSpeciesId: wild, tutorialStep: null });
      expect(account!.tutorialCompletedAt).not.toBeNull();
      // Every step, in order, each with its own `tutorial.advanced`.
      const advanced = (await eventsOf(m))
        .filter((e) => e.type === 'tutorial.advanced')
        .map((e) => parseGameEventPayload('tutorial.advanced', e.payload).completedStepId);
      expect(advanced).toEqual(TUTORIAL_STEPS.map((s) => s.id));
      // ~60 requests and consumer runs: more than the 5 s default on a busy runner.
    }, 30_000);
  });
});
