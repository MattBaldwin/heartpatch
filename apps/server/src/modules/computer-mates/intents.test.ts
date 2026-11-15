import { hexDistance, isTradingPost, isWaterTerrain, MapResponseSchema } from '@heartpatch/shared';
import { COMPUTER_MATES, mateLandCap, type ComputerMatesSecrets } from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, squishies, users } from '../../db/schema.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { heartSeedOf } from '../maps/depart.js';
import { createHollowRepo } from '../hollow/repo.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { createComputerMateSteps } from './intents.js';
import { createComputerMatesRepo } from './repo.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
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

/** Busy mates for the land tests: many claims a day, no guards, so the cap is reached. */
const BUSY: ComputerMatesSecrets = {
  ...COMPUTER_MATES,
  personas: COMPUTER_MATES.personas.map((p) => ({
    ...p,
    claimsPerDay: 60,
    weights: { ...p.weights, guard: 0 },
  })),
};

describe.skipIf(!url)('computer patch-mates act (#386c, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let clock = new Date();
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock = new Date();
  });

  async function soloPatch() {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_SIGNUP_CODE: 'acts-signup-code',
      HP_COMPUTER_MATES: 'on',
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    const username = `actkid_${String((counter += 1))}_${String(Date.now() % 100000)}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014 })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const cookies = { [SESSION_COOKIE]: token };
    const made = await app.inject({
      method: 'POST',
      url: '/api/v1/maps',
      headers: HEADERS,
      cookies,
      payload: { name: 'Act Hollow', timeZone: 'America/Chicago' },
    });
    expect(made.statusCode).toBe(201);
    const map = MapResponseSchema.parse(made.json()).map;
    const on = await app.inject({
      method: 'POST',
      url: `/api/v1/maps/${map.id}/computer-mates`,
      headers: HEADERS,
      cookies,
      payload: { enabled: true },
    });
    expect(on.statusCode).toBe(200);
    const mates = await db.query.computerMates.findMany({
      where: (t, { eq }) => eq(t.mapId, map.id),
    });
    expect(mates.length).toBe(3);
    return { kidId: user!.id, cookies, mapId: map.id, mates: mates.map((m) => m.userId) };
  }

  const stepOf = async (userId: string) =>
    (await db.query.computerMates.findFirst({ where: (t, { eq }) => eq(t.userId, userId) }))!;

  /** Runs every mate's due steps, moving the clock on by `minutes` each round. */
  async function play(
    steps: ReturnType<typeof createComputerMateSteps>,
    mapId: string,
    rounds: number,
    minutes = 61,
  ) {
    const results = [];
    for (let i = 0; i < rounds; i++) {
      clock = new Date(clock.getTime() + minutes * MINUTE_MS);
      await createComputerMatesRepo(db).stampSeen(mapId, clock);
      for (const { userId, step } of await steps.due()) {
        results.push({ userId, result: await steps.act(userId, step) });
      }
    }
    return results;
  }

  it('no step runs on a patch nobody opened in warmMinutes', async () => {
    const { mapId } = await soloPatch();
    const steps = createComputerMateSteps({ db, clock: () => clock });
    clock = new Date(clock.getTime() + 2 * 60 * MINUTE_MS);
    expect(await steps.due()).toEqual([]);
    // Opened long ago: still cold.
    await createComputerMatesRepo(db).stampSeen(
      mapId,
      new Date(clock.getTime() - (COMPUTER_MATES.rules.warmMinutes + 1) * MINUTE_MS),
    );
    expect(await steps.due()).toEqual([]);
    // Someone has it open right now (the hub): warm again.
    const open = createComputerMateSteps({
      db,
      clock: () => clock,
      isOnline: (m) => m === mapId,
    });
    expect((await open.due()).length).toBe(3);
  });

  it('act is idempotent per step, and a departed mate’s queued step does nothing', async () => {
    const { mapId, mates, cookies } = await soloPatch();
    const steps = createComputerMateSteps({ db, clock: () => clock });
    clock = new Date(clock.getTime() + MINUTE_MS);
    await createComputerMatesRepo(db).stampSeen(mapId, clock);
    const [first] = await steps.due();
    expect(first).toBeDefined();
    expect(await steps.act(first!.userId, first!.step)).not.toBeNull();
    // A retry, or a duplicate job for the same step: nothing.
    expect(await steps.act(first!.userId, first!.step)).toBeNull();
    expect((await stepOf(first!.userId)).step).toBe(first!.step + 1);

    // Switch off: every mate departs, and their queued steps do nothing.
    clock = new Date(clock.getTime() + 2 * 60 * MINUTE_MS);
    const off = await app!.inject({
      method: 'POST',
      url: `/api/v1/maps/${mapId}/computer-mates`,
      headers: HEADERS,
      cookies,
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    for (const userId of mates) {
      const row = await stepOf(userId);
      expect(row.nextActAt).toBeNull();
      expect(await steps.act(userId, row.step)).toBeNull();
    }
  });

  it('claim respects home rings, posts, water, the kid buffer and the land cap; fires per 6 tiles', async () => {
    const { mapId, mates, kidId } = await soloPatch();
    const steps = createComputerMateSteps({ db, clock: () => clock, secrets: BUSY });
    await play(steps, mapId, 120, 61);
    const tiles = await createTerritoryRepo(db).listTiles(mapId);
    const kidSeed = heartSeedOf(
      tiles.filter((t) => t.ownerUserId === kidId && t.homeSlot !== null),
    );
    const map = await db.query.maps.findFirst({ where: (t, { eq }) => eq(t.id, mapId) });
    const cap = mateLandCap(tiles, map!.maxPlayers, BUSY.rules);
    let claimedAny = false;
    for (const mate of mates) {
      const outer = tiles.filter((t) => t.ownerUserId === mate && t.homeSlot === null);
      if (outer.length > 0) claimedAny = true;
      expect(outer.length).toBeLessThanOrEqual(cap);
      for (const t of outer) {
        expect(isTradingPost(t)).toBe(false);
        expect(isWaterTerrain(t.terrain)).toBe(false);
        expect(hexDistance(t, kidSeed)).toBeGreaterThan(BUSY.rules.kidHomeBuffer);
      }
      const fires = await db.query.buildings.findMany({
        where: (b, { and, eq }) => and(eq(b.ownerUserId, mate), eq(b.kind, 'hearthfire')),
      });
      const wanted = Math.floor(outer.length / BUSY.rules.fireEveryTiles);
      expect(fires.length).toBeLessThanOrEqual(wanted);
      expect(fires.length).toBeGreaterThanOrEqual(Math.max(0, wanted - 1));
      // Kept fuelled, and never on a home tile.
      for (const f of fires) {
        expect(f.fuelledThrough).not.toBeNull();
        expect(outer.some((t) => t.id === f.tileId)).toBe(true);
      }
    }
    expect(claimedAny).toBe(true);
    // Every claim told the patch (`tile.claimed`), one event per mate tile.
    const claimed = await db.query.gameEvents.findMany({
      where: (e, { and, eq }) => and(eq(e.mapId, mapId), eq(e.type, 'tile.claimed')),
    });
    const outerCount = tiles.filter(
      (t) => t.ownerUserId !== null && mates.includes(t.ownerUserId) && t.homeSlot === null,
    ).length;
    expect(claimed.length).toBe(outerCount);
    // The kid's home ring is untouched.
    expect(tiles.filter((t) => t.homeSlot !== null && t.ownerUserId === kidId).length).toBe(7);
  }, 120_000);

  it('team levels follow the Partner level plus the persona offset, every step', async () => {
    const { mapId, mates, kidId } = await soloPatch();
    // The kid's strongest squishy (no Partner picked): level 20.
    await db.insert(squishies).values({
      mapId,
      ownerUserId: kidId,
      speciesId: 'puddlepup',
      element: 'water',
      feeling: 'calm',
      level: 20,
    } as typeof squishies.$inferInsert);
    const steps = createComputerMateSteps({ db, clock: () => clock });
    await play(steps, mapId, 2, 61);
    const partner = (await createTerritoryRepo(db).defenderFloorLevel(mapId, kidId)) ?? 1;
    for (const mate of mates) {
      const persona = (await stepOf(mate)).personaId;
      const offset = COMPUTER_MATES.personas.find((p) => p.id === persona)!.levelOffset;
      const team = await db.query.squishies.findMany({
        where: (s, { eq }) => eq(s.ownerUserId, mate),
      });
      expect(team.length).toBeGreaterThan(0);
      for (const s of team) expect(s.level).toBe(Math.max(1, partner + offset));
    }
  });

  it('after a gap, at most catchUpSteps quiet steps that only claim', async () => {
    const { mapId, mates } = await soloPatch();
    const steps = createComputerMateSteps({ db, clock: () => clock });
    // Nobody came for a day; then the kid opens the patch.
    clock = new Date(clock.getTime() + DAY_MS);
    const results = await play(steps, mapId, 10, 2);
    for (const mate of mates) {
      const mine = results.filter((r) => r.userId === mate && r.result);
      const quiet = mine.filter((r) => r.result!.catchUp);
      expect(quiet.length).toBeGreaterThan(0);
      expect(quiet.length).toBeLessThanOrEqual(COMPUTER_MATES.rules.catchUpSteps);
      for (const r of quiet) expect([null, 'claim']).toContain(r.result!.intent);
    }
  });

  it('the Hollow Man never takes a computer squishy', async () => {
    const { mapId, mates, kidId } = await soloPatch();
    const night = await createHollowRepo(db).nightSquishies(mapId, { lock: false });
    expect(night.some((s) => mates.includes(s.ownerUserId))).toBe(false);
    // The kid's own are still his to find (none yet here, but the read isn't empty by rule).
    expect(night.every((s) => s.ownerUserId === kidId)).toBe(true);
  });
});
