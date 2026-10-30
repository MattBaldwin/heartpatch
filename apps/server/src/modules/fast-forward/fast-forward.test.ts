import { BATTLE_RULES, GAME_DATA, MapResponseSchema, type MapDetail } from '@heartpatch/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, mapMembers, sessions, squishies, tiles, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { FAST_FORWARD_DAYS } from './days.js';
import { grownForm } from './service.js';

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
const START = '2026-10-30T12:00:00Z';
const species = (id: string) => GAME_DATA.species.find((s) => s.id === id)!;

interface Player {
  id: string;
  token: string;
}

describe('grownForm', () => {
  it('follows a line by level and stops where the next step is out of reach', () => {
    expect(grownForm(species('emberbun'), 15).id).toBe('emberbun');
    expect(grownForm(species('emberbun'), 22).id).toBe('kindlebun');
    expect(grownForm(species('emberbun'), 27).id).toBe('hearthbun');
  });
});

describe.skipIf(!url)('dev fast-forward (needs DATABASE_URL)', () => {
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

  async function start(devGrants = true): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      ...(devGrants ? { HP_DEV_SQUISHY_GRANTS: 'true' } : {}),
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `ffwd_${String(process.pid)}_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'UTC' })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 365 * DAY_MS) });
    return { id: user!.id, token };
  }

  function call(server: FastifyInstance, path: string, who: Player, payload?: object) {
    return server.inject({
      method: 'POST',
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });
  }

  /** A patch where `owner` has picked Emberbun. */
  async function patch(server: FastifyInstance, owner: Player): Promise<string> {
    const res = await call(server, '/maps', owner, { name: 'Day Patch', timeZone: 'UTC' });
    expect(res.statusCode, res.body).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
    const pick = await call(server, `/maps/${map.id}/starter`, owner, { speciesId: 'emberbun' });
    expect(pick.statusCode, pick.body).toBe(201);
    return map.id;
  }

  const mine = (mapId: string, userId: string) =>
    db
      .select()
      .from(squishies)
      .where(and(eq(squishies.mapId, mapId), eq(squishies.ownerUserId, userId)));

  const landOf = async (mapId: string, userId: string) =>
    (
      await db
        .select({ id: tiles.id })
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.ownerUserId, userId)))
    ).length;

  it('is not there at all without HP_DEV_SQUISHY_GRANTS', async () => {
    const server = await start(false);
    const owner = await player();
    const res = await call(server, '/maps', owner, { name: 'No Dev', timeZone: 'UTC' });
    const mapId = MapResponseSchema.parse(res.json()).map.id;
    const ff = await call(server, `/maps/${mapId}/dev/fast-forward`, owner, { day: 10 });
    expect(ff.statusCode).toBe(404);
  });

  it('seeds day 10 from the sim table and backdates my account, once', async () => {
    const server = await start();
    const owner = await player();
    const mapId = await patch(server, owner);
    const [starterBefore] = await mine(mapId, owner.id);
    const standing = FAST_FORWARD_DAYS[10];

    const res = await call(server, `/maps/${mapId}/dev/fast-forward`, owner, { day: 10 });
    expect(res.statusCode, res.body).toBe(200);
    const land = await landOf(mapId, owner.id);
    expect(res.json()).toEqual({
      day: 10,
      partnerLevel: standing.partnerLevel,
      tiles: land,
      added: 2,
    });
    expect(land).toBe(standing.tiles);

    const after = await mine(mapId, owner.id);
    const partner = after.find((s) => s.id === starterBefore!.id)!;
    expect(partner).toMatchObject({ speciesId: 'kindlebun', level: standing.partnerLevel });
    // Care timers don't jump: the Partner was cared for when it was, not 10 days ago.
    expect(partner.lastCaredAt).toEqual(starterBefore!.lastCaredAt);
    for (const mate of standing.team) {
      const row = after.find((s) => s.speciesId === mate.speciesId)!;
      expect(row.level).toBe(mate.level);
      expect(row.teamSlot).not.toBeNull();
      expect(row.teamSlot!).toBeLessThan(BATTLE_RULES.teamSize);
    }
    const since = Date.parse(START) - 10 * DAY_MS;
    for (const row of after) expect(row.createdAt.getTime()).toBeLessThanOrEqual(since);
    const [member] = await db
      .select({ joinedAt: mapMembers.joinedAt })
      .from(mapMembers)
      .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, owner.id)));
    expect(member!.joinedAt.getTime()).toBeLessThanOrEqual(since);

    // A second seed for the same day changes nothing.
    const again = await call(server, `/maps/${mapId}/dev/fast-forward`, owner, { day: 10 });
    expect(again.json()).toMatchObject({ added: 0, tiles: land });
    expect(await mine(mapId, owner.id)).toHaveLength(after.length);
    expect(await landOf(mapId, owner.id)).toBe(land);
  });

  it('only takes day 3, 10 or 21, and only on my own patches', async () => {
    const server = await start();
    const owner = await player();
    const stranger = await player();
    const mapId = await patch(server, owner);
    const odd = await call(server, `/maps/${mapId}/dev/fast-forward`, owner, { day: 5 });
    expect(odd.statusCode).toBe(400);
    const theirs = await call(server, `/maps/${mapId}/dev/fast-forward`, stranger, { day: 3 });
    expect(theirs.statusCode).toBe(404);
  });
});
