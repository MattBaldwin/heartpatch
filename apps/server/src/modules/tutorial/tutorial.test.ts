import {
  ApiErrorSchema,
  MapResponseSchema,
  MyMapsResponseSchema,
  parseGameEventPayload,
  TUTORIAL_LAYOUT,
  TUTORIAL_STEPS,
  TutorialResponseSchema,
  type TutorialStep,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createTutorialConsumer } from './consumer.js';
import { createTutorialService } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;

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

  /** Plays the shipped tutorial from start to finish. */
  async function finish(server: FastifyInstance, who: Player) {
    for (const step of TUTORIAL_STEPS) await acknowledge(server, who, step.id);
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
      expect(resumed).toEqual({ ...first, stepId: 'graduation' });
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
      expect((await getTutorial(server, kid)).stepId).toBe('graduation');

      clock = new Date('2026-10-02T12:15:00Z');
      await acknowledge(server, kid, 'graduation');
      expect(await getTutorial(server, kid)).toEqual({
        status: 'completed',
        stepId: null,
        mapId: null,
        completedAt: '2026-10-02T12:15:00.000Z',
        required: false,
      });

      // Each acknowledgement, then the engine's own system event, in seq order.
      const events = (await eventsOf(mapId!)).map((e) => [e.type, e.actorUserId, e.payload]);
      expect(events).toEqual([
        ['map.created', kid.id, expect.anything()],
        ['tutorial.acknowledged', kid.id, { stepId: 'welcome' }],
        ['tutorial.advanced', null, { completedStepId: 'welcome', stepId: 'graduation' }],
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
      expect((await getTutorial(server, kid)).stepId).toBe('graduation');
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
      expect((await getTutorial(server, kid)).stepId).toBe('graduation');
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

    it('grants the completion rewards once, whatever is replayed or retried', async () => {
      const granted: string[] = [];
      const rewarding = createTutorialConsumer({
        clock: () => clock,
        grantRewards: (_repo, userId) => {
          granted.push(userId);
          return Promise.resolve();
        },
      });
      const server = await start();
      const kid = await player();
      const playThrough = async () => {
        for (const step of TUTORIAL_STEPS) {
          await call(server, 'POST', '/tutorial/acknowledge', kid, { stepId: step.id });
          const { mapId } = await getTutorial(server, kid);
          await runConsumer(db, rewarding, mapId!);
          await runConsumer(db, rewarding, mapId!);
        }
      };
      await begin(server, kid);
      await playThrough();
      expect(granted).toEqual([kid.id]);
      await call(server, 'POST', '/tutorial/replay', kid);
      await playThrough();
      expect(granted).toEqual([kid.id]);
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
});
