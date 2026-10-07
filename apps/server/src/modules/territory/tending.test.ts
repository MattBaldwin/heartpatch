import {
  ApiErrorSchema,
  heartSeedOf,
  hexDistance,
  LandTendingResponseSchema,
  MapResponseSchema,
  parseGameEventPayload,
  SquishyResponseSchema,
  TERRITORY_RULES,
  type MapDetail,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, mapMembers, sessions, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { backendPid, waitUntilBlockedBy } from '../../../tests/lock-waits.js';
import { createLandTending } from './tending.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const UUID = /^[0-9a-f-]{36}$/;
const uuid = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
};
// 21:00 in Denver: nightfall.
const START = '2026-10-03T03:00:00Z';
const { tending: RULES } = TERRITORY_RULES;

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('land that misses you (needs DATABASE_URL)', () => {
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
    const username = `tender_${String((counter += 1))}`;
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
  const tendingOf = (res: LightMyRequestResponse) => {
    expect(res.statusCode, res.body).toBe(200);
    return LandTendingResponseSchema.parse(res.json()).tending;
  };

  async function patch(server: FastifyInstance, owner: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Tending Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
    return map.id;
  }

  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
  const setOwner = (tileId: string, userId: string | null) =>
    db.execute(
      `update tiles set owner_user_id = ${userId === null ? 'null' : `'${uuid(userId)}'`} where id = '${uuid(tileId)}'`,
    );
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const advance = (days: number) => clock.setTime(clock.getTime() + days * DAY_MS);

  /**
   * Gives `who` one neutral land tile at each distance from their Heart Seed
   * (outside Juniper's Gap), farthest first; returns them.
   */
  async function landAt(
    mapId: string,
    who: PublicUser,
    distances: readonly number[],
    terrains?: readonly string[],
    withNode = false,
  ) {
    const all = await tilesOf(mapId);
    const seed = heartSeedOf(all.filter((t) => t.ownerUserId === who.id && t.homeSlot !== null))!;
    const picked = distances.map((d) => {
      const tile = all.find(
        (t) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          t.terrain !== 'junipers-gap' &&
          (!terrains || terrains.includes(t.terrain)) &&
          (!withNode || t.nodeResource !== null) &&
          hexDistance(t, seed) === d,
      )!;
      return tile;
    });
    for (const t of picked) await setOwner(t.id, who.id);
    return picked;
  }

  it('fades untended land for its owner only, and Visit tends all of it', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const [far, mid, near, kept] = await landAt(mapId, kid, [5, 4, 3, 2]);
    const land = createLandTending({ db, clock: () => clock });

    // Land held before tending existed counts as tended when nightfall first sees it.
    expect(
      tendingOf(await call(server, 'GET', `/maps/${mapId}/territory/tending`, kid)).missing,
    ).toEqual([]);
    expect(await land.nightfall(mapId, '2026-10-02')).toEqual({ wild: 0 });
    const fresh = tendingOf(await call(server, 'GET', `/maps/${mapId}/territory/tending`, kid));
    expect(fresh.nextMissesYouAt).toBe(
      new Date(clock.getTime() + RULES.missesYouAfterDays * DAY_MS).toISOString(),
    );

    advance(RULES.missesYouAfterDays + 1);
    const missing = tendingOf(await call(server, 'GET', `/maps/${mapId}/territory/tending`, kid));
    // The ring round home never fades.
    expect(missing.missing.map((t) => `${String(t.q)},${String(t.r)}`).sort()).toEqual(
      [far!, mid!, near!].map((t) => `${String(t.q)},${String(t.r)}`).sort(),
    );
    expect(missing.missing.some((t) => t.q === kept!.q && t.r === kept!.r)).toBe(false);
    expect(missing.missing[0]!.fade).toBeGreaterThan(0);
    expect(missing.missing[0]!.fade).toBeLessThan(100);

    const visited = tendingOf(await call(server, 'POST', `/maps/${mapId}/territory/visit`, kid));
    expect(visited.missing).toEqual([]);
    expect(
      tendingOf(await call(server, 'GET', `/maps/${mapId}/territory/tending`, kid)).missing,
    ).toEqual([]);
  });

  it('lets a few long-untended tiles go wild each night, farthest first, never twice a night', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const [far, mid, near, kept] = await landAt(mapId, kid, [5, 4, 3, 2]);
    const land = createLandTending({ db, clock: () => clock });
    await land.nightfall(mapId, '2026-10-02');

    // A squishy on watch on the farthest tile goes home when it goes wild.
    const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, { level: 5 });
    expect(granted.statusCode, granted.body).toBe(201);
    const guard = SquishyResponseSchema.parse(granted.json()).squishy;
    const posted = await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
      q: far!.q,
      r: far!.r,
      squishyIds: [guard.id],
    });
    expect(posted.statusCode, posted.body).toBe(200);

    // A week away: nothing goes.
    advance(7);
    expect(await land.nightfall(mapId, '2026-10-09')).toEqual({ wild: 0 });

    advance(RULES.wildAfterDays - 7);
    const night = '2026-10-14';
    const cap = RULES.wildPerNight.gentle;
    expect(cap).toBe(2);
    expect(await land.nightfall(mapId, night)).toEqual({ wild: 2 });
    // A rerun of the same night (a retry) takes nothing more.
    expect(await land.nightfall(mapId, night)).toEqual({ wild: 0 });

    const owners = new Map((await tilesOf(mapId)).map((t) => [t.id, t.ownerUserId]));
    expect(owners.get(far!.id)).toBeNull();
    expect(owners.get(mid!.id)).toBeNull();
    expect(owners.get(near!.id)).toBe(kid.id);
    expect(owners.get(kept!.id)).toBe(kid.id);
    expect(
      await db.query.tileDefenders.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) }),
    ).toEqual([]);

    const wild = (await eventsOf(mapId)).filter((e) => e.type === 'tile.rewilded');
    expect(wild).toHaveLength(1);
    const payload = parseGameEventPayload('tile.rewilded', wild[0]!.payload);
    expect(payload).toMatchObject({ userId: kid.id, night, returnedSquishyIds: [guard.id] });
    expect(payload.tiles.map((t) => [t.q, t.r])).toEqual([
      [far!.q, far!.r],
      [mid!.q, mid!.r],
    ]);
    // Everyone on the map sees which tiles went wild; who stood watch stays internal.
    const view = publicViewFor(PUBLIC_VIEWS, wild[0]!, { userId: kid.id });
    expect(view).not.toHaveProperty('returnedSquishyIds');

    // The next night the last outer tile goes; the ring round home never does.
    advance(1);
    expect(await land.nightfall(mapId, '2026-10-15')).toEqual({ wild: 1 });
    advance(30);
    expect(await land.nightfall(mapId, '2026-11-14')).toEqual({ wild: 0 });
  });

  it('lists what went wild lately for the welcome back, until it is claimed again', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const [far] = await landAt(mapId, kid, [5]);
    const land = createLandTending({ db, clock: () => clock });
    await land.nightfall(mapId, '2026-10-02');
    advance(RULES.wildAfterDays);
    expect(await land.nightfall(mapId, '2026-10-14')).toEqual({ wild: 1 });

    const back = tendingOf(await call(server, 'GET', `/maps/${mapId}/territory/tending`, kid));
    expect(back.wentWild).toEqual([{ q: far!.q, r: far!.r, night: '2026-10-14', lostFire: null }]);
    await setOwner(far!.id, kid.id);
    const reclaimed = tendingOf(await call(server, 'GET', `/maps/${mapId}/territory/tending`, kid));
    expect(reclaimed.wentWild).toEqual([]);
  });

  it('sends a gatherer on land that goes wild to rest, with what it had ready', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const [far] = await landAt(mapId, kid, [5], ['forest', 'meadow', 'hills']);
    const land = createLandTending({ db, clock: () => clock });
    await land.nightfall(mapId, '2026-10-02');
    const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, { level: 5 });
    const gatherer = SquishyResponseSchema.parse(granted.json()).squishy;
    const job = await call(server, 'POST', `/maps/${mapId}/squishies/${gatherer.id}/job`, kid, {
      job: 'gatherer',
      q: far!.q,
      r: far!.r,
    });
    expect(job.statusCode, job.body).toBe(200);

    advance(RULES.wildAfterDays);
    expect(await land.nightfall(mapId, '2026-10-14')).toEqual({ wild: 1 });
    const row = await db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, gatherer.id) });
    expect(row?.workTileId).toBeNull();
    const types = (await eventsOf(mapId)).map((e) => e.type);
    // Its land went wild first, so the map hears `tile.rewilded` (and resyncs), not a job change.
    expect(types.slice(-2)).toEqual(['work.collected', 'tile.rewilded']);
  });

  it('still banks my own gather that finished before its land went wild', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const [far] = await landAt(mapId, kid, [5], undefined, true);
    const land = createLandTending({ db, clock: () => clock });
    await land.nightfall(mapId, '2026-10-02');
    const gather = await call(server, 'POST', `/maps/${mapId}/gathers`, kid, {
      q: far!.q,
      r: far!.r,
    });
    expect(gather.statusCode, gather.body).toBe(201);

    advance(RULES.wildAfterDays);
    expect(await land.nightfall(mapId, '2026-10-14')).toMatchObject({ wild: 1 });
    expect((await tilesOf(mapId)).find((t) => t.id === far!.id)?.ownerUserId).toBeNull();
    const settled = await call(server, 'POST', `/maps/${mapId}/settle`, kid);
    expect(settled.statusCode, settled.body).toBe(200);
    const types = (await eventsOf(mapId)).map((e) => e.type);
    expect(types).toContain('resource.gathered');
    const row = await db.query.gatherJobs.findFirst({ where: (t, { eq }) => eq(t.mapId, mapId) });
    expect(row?.status).not.toBe('lost');
  });

  it('lets a Visit that lands while nightfall waits keep the land', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const [far] = await landAt(mapId, kid, [5]);
    const land = createLandTending({ db, clock: () => clock });
    await land.nightfall(mapId, '2026-10-02');
    advance(RULES.wildAfterDays);

    let running: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(`set local lock_timeout = '10s'`);
      // A Visit's first lock (tiles, `for no key update`), held while night falls.
      await tx.execute(`select id from tiles where id = '${uuid(far!.id)}' for no key update`);
      const pid = await backendPid(tx);
      running = land.nightfall(mapId, '2026-10-14');
      await waitUntilBlockedBy(db, pid);
      await tx.execute(
        `update tile_tending set tended_at = '${clock.toISOString()}' where tile_id = '${uuid(far!.id)}'`,
      );
    });
    expect(await running).toEqual({ wild: 0 });
    expect((await tilesOf(mapId)).find((t) => t.id === far!.id)?.ownerUserId).toBe(kid.id);
  });

  it('takes locks for a Visit in the tech spec order: tiles, then tending rows', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const [far] = await landAt(mapId, kid, [5]);
    const land = createLandTending({ db, clock: () => clock });
    await land.nightfall(mapId, '2026-10-02');

    let running: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(`set local lock_timeout = '10s'`);
      // Nightfall's order: the tile, then its tending row. Visit waits at the
      // tile holding nothing, so taking the row here can't deadlock.
      await tx.execute(`select id from tiles where id = '${uuid(far!.id)}' for update`);
      const pid = await backendPid(tx);
      running = call(server, 'POST', `/maps/${mapId}/territory/visit`, kid);
      await waitUntilBlockedBy(db, pid);
      await tx.execute(
        `select tile_id from tile_tending where tile_id = '${uuid(far!.id)}' for update`,
      );
    });
    expect(((await running) as LightMyRequestResponse).statusCode).toBe(200);
  });

  it('caps each player on their own each night', async () => {
    const server = await start();
    const kid = await player();
    const friend = await player();
    const mapId = await patch(server, kid);
    await db.insert(mapMembers).values({ mapId, userId: friend.id, role: 'member', homeSlot: 1 });
    await landAt(mapId, kid, [6, 5, 4]);
    // The friend's land, far from the kid's home (no home ring of their own here).
    const all = await tilesOf(mapId);
    const theirs = all
      .filter((t) => t.ownerUserId === null && t.homeSlot === null && t.terrain !== 'junipers-gap')
      .slice(-3);
    for (const t of theirs) await setOwner(t.id, friend.id);
    const land = createLandTending({ db, clock: () => clock });
    await land.nightfall(mapId, '2026-10-02');
    advance(RULES.wildAfterDays);
    expect(await land.nightfall(mapId, '2026-10-14')).toEqual({ wild: 4 });
    const wild = (await eventsOf(mapId)).filter((e) => e.type === 'tile.rewilded');
    expect(wild.map((e) => parseGameEventPayload('tile.rewilded', e.payload).tiles.length)).toEqual(
      [2, 2],
    );
  });

  it('lets a dev age my land and send it wild, to try it on a device', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await landAt(mapId, kid, [5, 4]);
    const aged = tendingOf(
      await call(server, 'POST', `/maps/${mapId}/dev/territory/age`, kid, { days: 6 }),
    );
    expect(aged.missing).toHaveLength(2);
    const wild = tendingOf(
      await call(server, 'POST', `/maps/${mapId}/dev/territory/age`, kid, { days: 10 }),
    );
    expect(wild.wentWild).toHaveLength(2);
  });

  it('never fades land on a tutorial map', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await landAt(mapId, kid, [5]);
    await db.execute(`update maps set kind = 'tutorial' where id = '${uuid(mapId)}'`);
    const land = createLandTending({ db, clock: () => clock });
    advance(60);
    expect(await land.nightfall(mapId, '2026-12-01')).toBeNull();
  });

  it('is only for members of the patch', async () => {
    const server = await start();
    const kid = await player();
    const stranger = await player();
    const mapId = await patch(server, kid);
    const res = await call(server, 'POST', `/maps/${mapId}/territory/visit`, stranger);
    expect(res.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
  });
});
