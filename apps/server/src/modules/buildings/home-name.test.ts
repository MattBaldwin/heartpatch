import {
  ApiErrorSchema,
  HOME_BASE_RULES,
  HomeResponseSchema,
  MapResponseSchema,
  NAMING_RULES,
  TutorialResponseSchema,
  type HomeResponse,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { appendGameEvent } from '../../db/game-events.js';
import { keepers, mapMembers, sessions, users } from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { createJobsRepo } from '../../jobs/repo.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { activeMember, createMapsRepo } from '../maps/repo.js';
import { createHomeNamingConsumer } from './home-name-consumer.js';

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
const ZONE = 'America/Denver';
const START = '2026-10-02T12:00:00Z';
const LOCKED = `Build one of each and befriend ${String(NAMING_RULES.caughtToName)} squishies first!`;
const SEED_FIRST = 'Your Heart Seed needs to grow first 🌱';

interface Player {
  id: string;
  token: string;
}

describe.skipIf(!url)('naming your home (#306, needs DATABASE_URL)', () => {
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
  });

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `namer_${String(process.pid % 1000)}_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
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
    const res = await call(server, 'POST', '/maps', who, { name: 'Name Patch', timeZone: ZONE });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function home(server: FastifyInstance, who: Player, mapId: string): Promise<HomeResponse> {
    const res = await call(server, 'GET', `/maps/${mapId}/home`, who);
    expect(res.statusCode).toBe(200);
    return HomeResponseSchema.parse(res.json());
  }

  const name = (server: FastifyInstance, who: Player, mapId: string, homeName: string) =>
    call(server, 'POST', `/maps/${mapId}/home/name`, who, { name: homeName });

  // `activeMember` from the maps repo: only repos import drizzle-orm (lint rule).
  const member = (mapId: string, who: Player) => activeMember(mapId, who.id);

  /** Sets the naming counters by hand (the consumer's tests cover counting). */
  const setFacts = (
    mapId: string,
    who: Player,
    facts: { caughtCount?: number; kindsBuilt?: string[]; homeNamedAtLevel?: number | null },
  ) => db.update(mapMembers).set(facts).where(member(mapId, who));

  const unlock = (mapId: string, who: Player) =>
    setFacts(mapId, who, {
      caughtCount: NAMING_RULES.caughtToName,
      kindsBuilt: [...HOME_BASE_RULES.buildableKinds],
    });

  const memberRow = async (mapId: string, who: Player) =>
    (await db.select().from(mapMembers).where(member(mapId, who)))[0]!;

  /** The member row in any status (`memberRow` reads active members only). */
  const anyMemberRow = (mapId: string, who: Player) =>
    db.query.mapMembers.findFirst({
      where: (t, { and: both, eq: is }) => both(is(t.mapId, mapId), is(t.userId, who.id)),
    });

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq: is }) => is(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  describe('POST /maps/:mapId/home/name', () => {
    it('shows the gate on the home view and refuses while it is locked', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await setFacts(mapId, kid, { caughtCount: 3, kindsBuilt: ['habitat'] });

      expect((await home(server, kid, mapId)).naming).toEqual({
        name: null,
        unlocked: false,
        kinds: NAMING_RULES.kindsToName.map((kind) => ({ kind, built: kind === 'habitat' })),
        caught: 3,
        need: NAMING_RULES.caughtToName,
        renameOpen: false,
      });
      const res = await name(server, kid, mapId, 'Pumpkin Hollow');
      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toMatchObject({ code: 'FORBIDDEN', message: LOCKED });

      // Every kind but one is still locked, however many are caught.
      await setFacts(mapId, kid, {
        caughtCount: 99,
        kindsBuilt: NAMING_RULES.kindsToName.slice(1),
      });
      expect((await name(server, kid, mapId, 'Pumpkin Hollow')).statusCode).toBe(403);
      expect((await memberRow(mapId, kid)).homeName).toBeNull();
    });

    it('names the home once unlocked, tells the patch, and waits for the Heart Seed to rename', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await unlock(mapId, kid);
      expect((await home(server, kid, mapId)).naming).toMatchObject({
        unlocked: true,
        renameOpen: true,
        caught: NAMING_RULES.caughtToName,
      });

      const res = await name(server, kid, mapId, '  Pumpkin    Hollow ');
      expect(res.statusCode).toBe(200);
      const named = HomeResponseSchema.parse(res.json());
      expect(named.naming).toMatchObject({
        name: 'Pumpkin Hollow',
        unlocked: true,
        renameOpen: false,
      });
      expect(named.tiles.length).toBeGreaterThan(0);
      expect(await memberRow(mapId, kid)).toMatchObject({
        homeName: 'Pumpkin Hollow',
        homeNamedAtLevel: 1,
      });

      const event = (await eventsOf(mapId)).at(-1)!;
      expect(event).toMatchObject({
        type: 'member.named',
        actorUserId: kid.id,
        payload: { userId: kid.id, name: 'Pumpkin Hollow' },
      });
      expect(publicViewFor(PUBLIC_VIEWS, event, { userId: kid.id })).toEqual({
        userId: kid.id,
        name: 'Pumpkin Hollow',
      });

      // The member list carries it for the map flag.
      const detail = MapResponseSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}`, kid)).json(),
      ).map;
      expect(detail.members.find((m) => m.user.id === kid.id)?.homeName).toBe('Pumpkin Hollow');

      // Same Heart Seed level: no rename yet.
      const again = await name(server, kid, mapId, 'Moon Patch');
      expect(again.statusCode).toBe(403);
      expect(errorOf(again)).toMatchObject({ code: 'FORBIDDEN', message: SEED_FIRST });

      // As if the Heart Seed grew since (#221): named at a lower level.
      await setFacts(mapId, kid, { homeNamedAtLevel: 0 });
      const renamed = await name(server, kid, mapId, 'Moon Patch');
      expect(renamed.statusCode).toBe(200);
      expect(HomeResponseSchema.parse(renamed.json()).naming?.name).toBe('Moon Patch');
      expect((await memberRow(mapId, kid)).homeNamedAtLevel).toBe(1);
    });

    it('checks the name: the text filter, the length cap and no emoji', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await unlock(mapId, kid);

      const rude = await name(server, kid, mapId, 'fuck');
      expect(rude.statusCode).toBe(400);
      expect(errorOf(rude).code).toBe('VALIDATION_FAILED');

      const long = await name(server, kid, mapId, 'x'.repeat(NAMING_RULES.maxLength + 1));
      expect(long.statusCode).toBe(400);
      expect((await name(server, kid, mapId, 'Pumpkin 🎃')).statusCode).toBe(400);
      expect((await name(server, kid, mapId, '   ')).statusCode).toBe(400);
      expect((await memberRow(mapId, kid)).homeName).toBeNull();

      const longest = 'x'.repeat(NAMING_RULES.maxLength);
      expect((await name(server, kid, mapId, longest)).statusCode).toBe(200);
    });

    it('leaves the Tutorial Glade alone: no naming on its home, and no naming there', async () => {
      const server = await start();
      const kid = await player();
      const started = await call(server, 'POST', '/tutorial/start', kid);
      expect(started.statusCode).toBe(201);
      const gladeId = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;

      expect((await home(server, kid, gladeId)).naming).toBeUndefined();
      expect((await name(server, kid, gladeId, 'Glade Home')).statusCode).toBe(404);
    });

    it("refuses someone else's patch", async () => {
      const server = await start();
      const owner = await player();
      const stranger = await player();
      const mapId = await newMap(server, owner);
      expect((await name(server, stranger, mapId, 'Not Mine')).statusCode).toBe(404);
    });

    it('starts the name and its progress over when the member leaves (fresh home base)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await unlock(mapId, kid);
      expect((await name(server, kid, mapId, 'Pumpkin Hollow')).statusCode).toBe(200);

      await createMapsRepo(db).archiveMember(mapId, kid.id);
      expect(await anyMemberRow(mapId, kid)).toMatchObject({
        status: 'removed',
        homeName: null,
        homeNamedAtLevel: null,
        caughtCount: 0,
        kindsBuilt: [],
      });
    });
  });

  describe('the home-naming consumer', () => {
    const consumer = createHomeNamingConsumer();

    const append = (mapId: string, events: Parameters<typeof appendGameEvent>[1][]) =>
      withTransaction(db, async (tx) => {
        for (const e of events) await appendGameEvent(tx, e);
      });

    const captured = (mapId: string, who: Player) =>
      ({
        mapId,
        type: 'squishy.captured',
        actorUserId: who.id,
        payload: {
          battleId: uuidv7(),
          userId: who.id,
          squishyId: uuidv7(),
          speciesId: 'emberpup',
          level: 3,
        },
      }) as const;

    const placedEvent = (mapId: string, who: Player, buildingId: string, kind: string) =>
      ({
        mapId,
        type: 'building.placed',
        actorUserId: who.id,
        payload: {
          userId: who.id,
          building: {
            id: uuidv7(),
            buildingId,
            kind,
            level: 1,
            spot: 1,
            lit: null,
            safeRadius: null,
            q: 0,
            r: 0,
          },
          cost: { timber: 1 },
        },
      }) as unknown as Parameters<typeof appendGameEvent>[1];

    const fenceEvent = (mapId: string, who: Player) =>
      ({
        mapId,
        type: 'fence.built',
        actorUserId: who.id,
        payload: {
          userId: who.id,
          fence: {
            id: uuidv7(),
            edge: 0,
            buildingId: 'hedge',
            level: 1,
            hp: 5,
            maxHp: 5,
            q: 0,
            r: 0,
          },
          cost: { timber: 1 },
        },
      }) as const;

    it('counts battle befriends once each, and each buildable kind once', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await runConsumer(db, consumer, mapId);

      await append(mapId, [
        captured(mapId, kid),
        captured(mapId, kid),
        placedEvent(mapId, kid, 'cozy-meadow', 'habitat'),
        placedEvent(mapId, kid, 'ember-den', 'habitat'),
        placedEvent(mapId, kid, 'training-grounds', 'training-grounds'),
        fenceEvent(mapId, kid),
        fenceEvent(mapId, kid),
      ]);
      expect(await runConsumer(db, consumer, mapId)).toBeGreaterThanOrEqual(7);
      expect(await memberRow(mapId, kid)).toMatchObject({ caughtCount: 2 });
      expect([...(await memberRow(mapId, kid)).kindsBuilt].sort()).toEqual(
        ['fence', 'habitat', 'training-grounds'].sort(),
      );

      // Exactly once: a second run applies nothing new.
      expect(await runConsumer(db, consumer, mapId)).toBe(0);
      expect((await memberRow(mapId, kid)).caughtCount).toBe(2);
      expect((await home(server, kid, mapId)).naming).toMatchObject({
        caught: 2,
        unlocked: false,
        kinds: NAMING_RULES.kindsToName.map((kind) => ({
          kind,
          built: ['fence', 'habitat', 'training-grounds'].includes(kind),
        })),
      });
    });

    it('starts over at member.left, after counts it reached late', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await runConsumer(db, consumer, mapId);

      // The kid befriends and builds, then leaves before the consumer catches up.
      await append(mapId, [
        captured(mapId, kid),
        placedEvent(mapId, kid, 'cozy-meadow', 'habitat'),
        fenceEvent(mapId, kid),
      ]);
      await createMapsRepo(db).archiveMember(mapId, kid.id);
      await append(mapId, [
        {
          mapId,
          type: 'member.left',
          actorUserId: kid.id,
          payload: { userId: kid.id, releasedTiles: 7 },
        },
      ]);
      await runConsumer(db, consumer, mapId);
      expect(await anyMemberRow(mapId, kid)).toMatchObject({ caughtCount: 0, kindsBuilt: [] });
    });

    it('skips building ids it does not know', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await append(mapId, [placedEvent(mapId, kid, 'not-a-building', 'habitat')]);
      await runConsumer(db, consumer, mapId);
      expect((await memberRow(mapId, kid)).kindsBuilt).toEqual([]);
    });

    it('reads patches only, never the Tutorial Glade', async () => {
      expect(consumer.mapKinds).toEqual(['multiplayer']);
      const server = await start();
      const kid = await player();
      const started = await call(server, 'POST', '/tutorial/start', kid);
      const gladeId = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
      const lagging = await createJobsRepo(db).laggingMaps(consumer.name, consumer.mapKinds);
      expect(lagging).not.toContain(gladeId);
    });
  });
});
