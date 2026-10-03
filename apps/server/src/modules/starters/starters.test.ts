import {
  ApiErrorSchema,
  CARE_RULES,
  JoinMapResponseSchema,
  MapResponseSchema,
  SquishyResponseSchema,
  TutorialResponseSchema,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const START = '2026-10-03T18:00:00.000Z';

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('starter pick (needs DATABASE_URL)', () => {
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
    const username = `starter_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
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
  const pick = (server: FastifyInstance, who: Player, mapId: string, speciesId: string) =>
    call(server, 'POST', `/maps/${mapId}/starter`, who, { speciesId });

  async function needsStarter(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'GET', `/maps/${mapId}`, who);
    expect(res.statusCode, res.body).toBe(200);
    return MapResponseSchema.parse(res.json()).map.needsStarter;
  }

  /** A patch made by `owner`; returns its id and invite code. */
  async function patch(server: FastifyInstance, owner: Player) {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Starter Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const map = MapResponseSchema.parse(res.json()).map;
    return { id: map.id, code: map.admin!.invite!.code };
  }

  /** `who` asks to join with `code`; returns the request id. */
  async function ask(server: FastifyInstance, who: Player, code: string) {
    const res = await call(server, 'POST', '/maps/join', who, { code });
    expect(res.statusCode, res.body).toBe(201);
    return JoinMapResponseSchema.parse(res.json()).request.id;
  }

  async function approve(server: FastifyInstance, owner: Player, mapId: string, requestId: string) {
    const res = await call(server, 'POST', `/maps/${mapId}/requests/${requestId}/approve`, owner);
    expect(res.statusCode, res.body).toBe(204);
  }

  const squishiesOf = (mapId: string, userId: string) =>
    db.query.squishies.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.ownerUserId, userId)),
    });

  async function markerOf(mapId: string, userId: string) {
    const row = await db.query.mapMembers.findFirst({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, userId)),
    });
    return row?.starterSquishyId ?? null;
  }

  it('gives the patch maker one level-1 starter, once', async () => {
    const server = await start();
    const owner = await player();
    const { id: mapId } = await patch(server, owner);
    expect(await needsStarter(server, owner, mapId)).toBe(true);

    const res = await pick(server, owner, mapId, 'puddlepuff');
    expect(res.statusCode, res.body).toBe(201);
    const { squishy } = SquishyResponseSchema.parse(res.json());
    expect(squishy).toMatchObject({
      mapId,
      ownerUserId: owner.id,
      speciesId: 'puddlepuff',
      element: 'water',
      feeling: 'silly',
      level: 1,
      xp: 0,
      state: 'active',
    });
    // Through the one squishy insert path: new squishies start half content (#19).
    const [row] = await squishiesOf(mapId, owner.id);
    expect(row?.contentmentAtLastCare).toBe(CARE_RULES.startContentment);
    expect(row?.lastCaredAt?.toISOString()).toBe(START);
    expect(await markerOf(mapId, owner.id)).toBe(squishy.id);
    expect(await needsStarter(server, owner, mapId)).toBe(false);
    // It's in their catalog as a friend.
    const seen = await db.query.speciesSeen.findFirst({
      where: (t, { and: all, eq: is }) =>
        all(is(t.mapId, mapId), is(t.userId, owner.id), is(t.speciesId, 'puddlepuff')),
    });
    expect(seen?.firstCaughtAt?.toISOString()).toBe(START);

    // A second pick is refused kindly, and nothing more is granted.
    const again = await pick(server, owner, mapId, 'emberbun');
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toMatchObject({
      code: 'CONFLICT',
      message: 'You already picked your first friend here!',
    });
    expect(await squishiesOf(mapId, owner.id)).toHaveLength(1);
  });

  it('asks a joiner once they are let in, and never anyone outside the patch', async () => {
    const server = await start();
    const owner = await player();
    const friend = await player();
    const stranger = await player();
    const { id: mapId, code } = await patch(server, owner);

    const requestId = await ask(server, friend, code);
    // Waiting for the owner is not being in the patch yet.
    const early = await pick(server, friend, mapId, 'thistlepip');
    expect(early.statusCode).toBe(404);
    expect(errorOf(early)).toMatchObject({
      code: 'NOT_FOUND',
      message: "We couldn't find that patch.",
    });
    await approve(server, owner, mapId, requestId);
    expect(await needsStarter(server, friend, mapId)).toBe(true);
    expect((await pick(server, friend, mapId, 'thistlepip')).statusCode).toBe(201);
    expect(await needsStarter(server, friend, mapId)).toBe(false);
    // The owner's own pick is separate.
    expect(await needsStarter(server, owner, mapId)).toBe(true);

    const outside = await pick(server, stranger, mapId, 'puddlepuff');
    expect(outside.statusCode).toBe(404);
    expect(errorOf(outside).code).toBe('NOT_FOUND');
    expect(await squishiesOf(mapId, stranger.id)).toHaveLength(0);
  });

  it('only takes one of the three starters', async () => {
    const server = await start();
    const owner = await player();
    const { id: mapId } = await patch(server, owner);

    // An evolved form, a non-starter, a secret species, and nonsense.
    for (const speciesId of ['splashmallow', 'pebblesnooze', 'heartlet', 'no-such-squishy']) {
      const res = await pick(server, owner, mapId, speciesId);
      expect(res.statusCode, speciesId).toBe(400);
      expect(errorOf(res), speciesId).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'Pick one of the three friends!',
      });
    }
    expect(await squishiesOf(mapId, owner.id)).toHaveLength(0);
    expect(await needsStarter(server, owner, mapId)).toBe(true);
  });

  it('is for patches only, not the Tutorial Glade', async () => {
    const server = await start();
    const kid = await player();
    const started = await call(server, 'POST', '/tutorial/start', kid);
    expect(started.statusCode, started.body).toBe(201);
    const glade = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;

    const res = await pick(server, kid, glade, 'puddlepuff');
    expect(res.statusCode).toBe(404);
    expect(await squishiesOf(glade, kid.id)).toHaveLength(0);
  });

  it('gives no second pick to a player who leaves and comes back', async () => {
    const server = await start();
    const owner = await player();
    const friend = await player();
    const { id: mapId, code } = await patch(server, owner);
    await approve(server, owner, mapId, await ask(server, friend, code));
    expect((await pick(server, friend, mapId, 'emberbun')).statusCode).toBe(201);

    expect((await call(server, 'POST', `/maps/${mapId}/leave`, friend)).statusCode).toBe(204);
    // Gone: no pick while away either.
    expect((await pick(server, friend, mapId, 'emberbun')).statusCode).toBe(404);
    await approve(server, owner, mapId, await ask(server, friend, code));

    // Back, with the squishy they had, so nothing to pick.
    expect(await needsStarter(server, friend, mapId)).toBe(false);
    expect((await pick(server, friend, mapId, 'puddlepuff')).statusCode).toBe(409);
    const owned = await squishiesOf(mapId, friend.id);
    expect(owned.map((s) => s.speciesId)).toEqual(['emberbun']);
  });

  it('grants nothing if any part of the pick fails (one transaction)', async () => {
    const server = await start();
    const owner = await player();
    const { id: mapId } = await patch(server, owner);

    // The catalog write is the pick's last; make it fail for this player only.
    await db.execute(`
      create function starter_test_fail() returns trigger language plpgsql as $$
      begin
        if new.user_id = '${owner.id}' then raise exception 'starter test failure'; end if;
        return new;
      end $$;
      create trigger starter_test_fail before insert on species_seen
        for each row execute function starter_test_fail();
    `);
    try {
      const res = await pick(server, owner, mapId, 'puddlepuff');
      expect(res.statusCode).toBe(500);
    } finally {
      await db.execute(`
        drop trigger starter_test_fail on species_seen;
        drop function starter_test_fail();
      `);
    }
    expect(await squishiesOf(mapId, owner.id)).toHaveLength(0);
    expect(await markerOf(mapId, owner.id)).toBeNull();
    expect(await needsStarter(server, owner, mapId)).toBe(true);

    // Nothing was used up: the pick works now.
    expect((await pick(server, owner, mapId, 'puddlepuff')).statusCode).toBe(201);
  });

  it('answers a retried pick with the same squishy (Idempotency-Key)', async () => {
    const server = await start();
    const owner = await player();
    const { id: mapId } = await patch(server, owner);
    const retry = () =>
      server.inject({
        method: 'POST',
        url: `/api/v1/maps/${mapId}/starter`,
        headers: { ...HEADERS, 'idempotency-key': 'starter-retry-1' },
        cookies: { [SESSION_COOKIE]: owner.token },
        payload: { speciesId: 'emberbun' },
      });

    const first = await retry();
    expect(first.statusCode, first.body).toBe(201);
    const again = await retry();
    expect(again.statusCode, again.body).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const id = SquishyResponseSchema.parse(first.json()).squishy.id;
    expect(SquishyResponseSchema.parse(again.json()).squishy.id).toBe(id);
    expect(await squishiesOf(mapId, owner.id)).toHaveLength(1);
  });

  it('gives exactly one squishy when picks race', async () => {
    const server = await start();
    const owner = await player();
    const { id: mapId } = await patch(server, owner);

    const species = ['emberbun', 'puddlepuff', 'thistlepip', 'emberbun', 'puddlepuff'];
    const results = await Promise.all(species.map((s) => pick(server, owner, mapId, s)));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409]);

    const owned = await squishiesOf(mapId, owner.id);
    expect(owned).toHaveLength(1);
    expect(await markerOf(mapId, owner.id)).toBe(owned[0]?.id);
  });

  it('lets a patch with a picked starter be deleted', async () => {
    const server = await start();
    const owner = await player();
    const { id: mapId } = await patch(server, owner);
    expect((await pick(server, owner, mapId, 'thistlepip')).statusCode).toBe(201);

    // The marker points at a squishy that points at the member: both go with the map.
    await db.execute(`delete from maps where id = '${mapId}'`);
    expect(await squishiesOf(mapId, owner.id)).toHaveLength(0);
  });
});
