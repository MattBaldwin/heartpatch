import {
  ApiErrorSchema,
  forecastLine,
  heartSeedOf,
  HollowResponseSchema,
  MapResponseSchema,
  SettleResponseSchema,
  weatherAt,
  WeatherViewSchema,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { buildings, keepers, sessions, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { makeHomestead } from '../../../tests/homestead.js';
import { makeWildIsle } from '../../../tests/weather.js';
import { dayWindow, planDay, weatherMap } from './plans.js';

/*
 * The forecast on a Wild Isle (#621 W1-7): a Cozy Patch has no weather and
 * its settle is untouched; each day's plan is made once and stored; tomorrow
 * is a one-line summary, or the full plan with a Weather Vane; the dev
 * routes; and the morning card's knocks.
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const ZONE = 'America/Denver';
/** Noon in Denver on 2026-10-25 (MDT). */
const START = '2026-10-25T18:00:00Z';
const TODAY = '2026-10-25';
const TOMORROW = '2026-10-26';
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

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('the weather forecast (needs DATABASE_URL)', () => {
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
    const username = `forecaster_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
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

  async function patch(server: FastifyInstance, kid: Player) {
    const res = await call(server, 'POST', '/maps', kid, { name: 'Sky Patch', timeZone: ZONE });
    expect(res.statusCode, res.body).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  const view = async (server: FastifyInstance, kid: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/weather`, kid);
    expect(res.statusCode, res.body).toBe(200);
    return WeatherViewSchema.parse(res.json());
  };
  const storedDays = (mapId: string) =>
    db.query.weatherDays.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.day)],
    });
  /** A free tile of my first home that isn't the Heart Seed's. */
  async function freeHomeTile(mapId: string, kid: Player) {
    const [row] = [
      ...(await db.execute<{ id: string }>(
        `select t.id from tiles t where t.map_id = '${mapId}' and t.owner_user_id = '${kid.id}'
         and t.home_slot is not null and not exists (select 1 from buildings b where b.tile_id = t.id)
         order by t.id limit 1`,
      )),
    ];
    return row!.id;
  }

  it('has no weather on a Cozy Patch, and leaves its settle untouched', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const res = await call(server, 'GET', `/maps/${mapId}/weather`, kid);
    expect(res.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(res.json()).error.message).toBe(
      'There is no weather on this patch.',
    );
    const settled = await call(server, 'POST', `/maps/${mapId}/settle`, kid);
    expect(settled.statusCode).toBe(200);
    expect(SettleResponseSchema.parse(settled.json())).not.toHaveProperty('weather');
    expect(settled.json()).not.toHaveProperty('weather');
    const hollow = HollowResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/hollow`, kid)).json(),
    );
    expect(hollow.hollow).not.toHaveProperty('weatherNotes');
    expect(await storedDays(mapId)).toEqual([]);
    expect(
      (await call(server, 'POST', `/maps/${mapId}/dev/weather`, kid, { kind: 'rain' })).statusCode,
    ).toBe(404);
  });

  it('plans each day once from the secret seed, and keeps the plan it stored', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeWildIsle(db, mapId);
    const map = (await weatherMap(db, mapId))!;

    const first = await view(server, kid, mapId);
    expect(first.today).toEqual(planDay(map, TODAY));
    expect(first.serverTime).toBe(new Date(START).toISOString());
    const stored = await storedDays(mapId);
    expect(stored.map((d) => d.day)).toEqual([TODAY, TOMORROW]);

    // A retune never rewrites a day kids already saw: the stored plan stands.
    await db.execute(
      `update weather_days set kind = 'fog', fronts = '[]'::jsonb where map_id = '${mapId}' and day = '${TODAY}'`,
    );
    clock.setTime(clock.getTime() + 60_000);
    const again = await view(server, kid, mapId);
    expect(again.today).toEqual({ day: TODAY, kind: 'fog', fronts: [] });
    expect((await storedDays(mapId)).map((d) => d.plannedAt)).toEqual(
      stored.map((d) => d.plannedAt),
    );
    // Nothing about the seed or the odds goes out.
    expect(JSON.stringify(again)).not.toMatch(/seed|knock|percent/i);
  });

  it('tells everyone tomorrow in a line, and a Weather Vane’s keeper in full', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeWildIsle(db, mapId);
    const map = (await weatherMap(db, mapId))!;
    const tomorrow = planDay(map, TOMORROW);

    expect((await view(server, kid, mapId)).tomorrow).toEqual({
      summary: forecastLine(tomorrow, dayWindow(TOMORROW, ZONE).startMs),
    });

    // A Weather Vane (its data comes with W1-8; the row is all the forecast reads).
    await db.insert(buildings).values({
      mapId,
      ownerUserId: kid.id,
      tileId: await freeHomeTile(mapId, kid),
      buildingId: 'weather-vane',
      kind: 'vane',
      spot: 1,
      placedAt: clock,
    });
    expect((await view(server, kid, mapId)).tomorrow).toEqual(tomorrow);
  });

  it('puts a dev front over my home, and the morning card lists my knocks', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await makeWildIsle(db, mapId);
    const res = await call(server, 'POST', `/maps/${mapId}/dev/weather`, kid, { kind: 'fog' });
    expect(res.statusCode, res.body).toBe(200);
    const fogged = WeatherViewSchema.parse(res.json());
    const home = [
      ...(await db.execute<{ q: number; r: number }>(
        `select q, r from tiles where map_id = '${mapId}' and owner_user_id = '${kid.id}' and home_slot is not null`,
      )),
    ];
    const seed = heartSeedOf(home)!;
    expect(fogged.today.fronts).toHaveLength(1);
    expect(weatherAt(fogged.today.fronts, seed, clock.getTime())).toBe('fog');
    expect(weatherAt(fogged.today.fronts, seed, clock.getTime() + 2 * 3600_000)).toBe('clear');

    const plot = await makeHomestead(db, mapId, kid.id, clock);
    const [hut] = await db
      .insert(buildings)
      .values({
        mapId,
        ownerUserId: kid.id,
        tileId: plot.id,
        buildingId: 'woodcutters-hut',
        kind: 'resource',
        spot: 1,
        placedAt: clock,
        producedSince: clock,
      })
      .returning({ id: buildings.id });
    const before = HollowResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/hollow`, kid)).json(),
    );
    expect(before.hollow.weatherNotes).toEqual([]);
    const knock = await call(server, 'POST', `/maps/${mapId}/dev/knock`, kid, {
      buildingId: hut!.id,
    });
    expect(knock.statusCode, knock.body).toBe(204);
    const after = HollowResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/hollow`, kid)).json(),
    );
    expect(after.hollow.weatherNotes).toEqual([
      {
        buildingRowId: hut!.id,
        buildingId: 'woodcutters-hut',
        q: plot.q,
        r: plot.r,
        at: new Date(START).toISOString(),
      },
    ]);
    // Knocked already: nothing more to knock.
    const twice = await call(server, 'POST', `/maps/${mapId}/dev/knock`, kid, {
      buildingId: hut!.id,
    });
    expect(twice.statusCode).toBe(409);
    // Old knocks drop off the card after a few nights.
    clock.setTime(clock.getTime() + 4 * DAY_MS);
    const later = HollowResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/hollow`, kid)).json(),
    );
    expect(later.hollow.weatherNotes).toEqual([]);
  });
});
