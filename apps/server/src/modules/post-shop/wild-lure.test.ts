import {
  GAME_DATA,
  MapResponseSchema,
  WildHintsResponseSchema,
  type PublicUser,
} from '@heartpatch/shared';
import { SPAWN_RULES, type SpawnData } from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient, type Transaction } from '../../db/client.js';
import { keepers, postPurchases, sessions, speciesSeen, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { backendPid, waitUntilBlockedBy } from '../../../tests/lock-waits.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesService } from '../battles/service.js';
import { createSpawnsService, defaultSpawnData } from '../spawns/service.js';

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
const STRONG_LEVEL = 40;
const yearRound = GAME_DATA.species.filter((s) => !s.season);
const STRONG = yearRound[0]!.id;
/** A plain common and uncommon squishy, met wild in these tests. */
const COMMON = yearRound.find((s) => s.rarity === 'common')!.id;
const UNCOMMON = yearRound.find((s) => s.rarity === 'uncommon')!.id;
const everywhere = (entries: { species: string; weight: number }[]): SpawnData => ({
  ...defaultSpawnData(),
  tables: [{ id: 'everywhere', terrains: GAME_DATA.terrains.map((t) => t.id), entries }],
  rules: { ...SPAWN_RULES, chance: 100 },
});
/** Almost always a common on a plain roll (one in a billion an uncommon), so a lure lifts it. */
const COMMON_THEN_UNCOMMON = everywhere([
  { species: COMMON, weight: 1_000_000_000 },
  { species: UNCOMMON, weight: 1 },
]);
/** Nothing rarer than a common anywhere: a lure has nowhere to climb. */
const COMMON_ONLY = everywhere([{ species: COMMON, weight: 1 }]);

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('a Rare Lure in a wild start (#729, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date('2026-11-04T17:00:00Z');
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
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: 'true',
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  function services(data: SpawnData) {
    const spawns = createSpawnsService({ db, clock: () => clock, data });
    const battles = createBattlesService({
      db,
      clock: () => clock,
      findWildEncounter: spawns.findWildEncounter,
    });
    return { spawns, battles };
  }

  async function player(): Promise<Player> {
    const username = `lurer_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'UTC' })
      .returning({ id: users.id });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    return { id: user!.id, username, token };
  }

  const call = (
    server: FastifyInstance,
    method: 'GET' | 'POST',
    path: string,
    who: Player,
    payload?: object,
  ) =>
    server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      cookies: { [SESSION_COOKIE]: who.token },
      ...(payload ? { payload } : {}),
    });

  /** A patch with a strong squishy for the kid, and (with `lure`) a Rare Lure held. */
  async function patch(server: FastifyInstance, kid: Player, lure = true) {
    const res = await call(server, 'POST', '/maps', kid, {
      name: `Lure Patch ${String(counter)}`,
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const mapId = MapResponseSchema.parse(res.json()).map.id;
    const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
      speciesId: STRONG,
      level: STRONG_LEVEL,
    });
    expect(granted.statusCode, granted.body).toBe(201);
    const lureId = lure ? await holdLure(mapId, kid) : null;
    return { mapId, lureId };
  }
  async function holdLure(mapId: string, kid: PublicUser) {
    const [row] = await db
      .insert(postPurchases)
      .values({
        mapId,
        userId: kid.id,
        itemId: 'rare-lure',
        price: 120,
        day: '2026-11-04',
        createdAt: clock,
      })
      .returning({ id: postPurchases.id });
    return row!.id;
  }
  const lureRow = async (id: string) =>
    (await db.query.postPurchases.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
  const battlesOf = (mapId: string) =>
    db.query.battles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const opponentOf = (battle: { setup: unknown }) =>
    (battle.setup as { b: { squishies: { speciesId: string }[] } }).b.squishies[0]!.speciesId;

  it('a held lure lures the start, is consumed with the battle id, and the battle says lured', async () => {
    const server = await start();
    const kid = await player();
    const { mapId, lureId } = await patch(server, kid);
    const { battles } = services(COMMON_THEN_UNCOMMON);
    const { battle, created } = await battles.startWild(kid, mapId);
    expect(created).toBe(true);
    expect(battle.lured).toBe(true);
    const [row] = await battlesOf(mapId);
    expect(opponentOf(row!)).toBe(UNCOMMON);
    expect(await lureRow(lureId!)).toMatchObject({ consumedBattleId: battle.id });
    expect((await lureRow(lureId!)).consumedAt).not.toBeNull();
  });

  it('without a lure the same patch finds the common one, and the battle says nothing of lures', async () => {
    const server = await start();
    const kid = await player();
    const { mapId } = await patch(server, kid, false);
    const { battle } = await services(COMMON_THEN_UNCOMMON).battles.startWild(kid, mapId);
    expect(battle.lured).toBeUndefined();
    expect(opponentOf((await battlesOf(mapId))[0]!)).toBe(COMMON);
  });

  it('a lure that changes nothing stays held and the battle says lured: false', async () => {
    const server = await start();
    const kid = await player();
    const { mapId, lureId } = await patch(server, kid);
    const { battle } = await services(COMMON_ONLY).battles.startWild(kid, mapId);
    expect(battle.lured).toBe(false);
    expect(opponentOf((await battlesOf(mapId))[0]!)).toBe(COMMON);
    expect(await lureRow(lureId!)).toMatchObject({ consumedAt: null, consumedBattleId: null });
  });

  it('an already-active battle leaves the lure held', async () => {
    const server = await start();
    const kid = await player();
    const { mapId } = await patch(server, kid, false);
    const { battles } = services(COMMON_THEN_UNCOMMON);
    const first = await battles.startWild(kid, mapId);
    const lureId = await holdLure(mapId, kid);
    const again = await battles.startWild(kid, mapId);
    expect(again.created).toBe(false);
    expect(again.battle.id).toBe(first.battle.id);
    expect(again.battle.lured).toBeUndefined();
    expect(await lureRow(lureId)).toMatchObject({ consumedAt: null });
  });

  it('a start against a given team (not a tile spawn) never touches the lure', async () => {
    const server = await start();
    const kid = await player();
    const { mapId, lureId } = await patch(server, kid);
    const { battles } = services(COMMON_THEN_UNCOMMON);
    const { battle } = await battles.startAgainst(kid, mapId, {
      squishies: [{ id: 'wild-1', speciesId: COMMON, level: 3 }],
    });
    expect(battle.lured).toBeUndefined();
    expect(await lureRow(lureId!)).toMatchObject({ consumedAt: null });
  });

  it('GET /maps/:id/wild says lureHeld, and never what it does', async () => {
    const server = await start();
    const kid = await player();
    const { mapId } = await patch(server, kid, false);
    const wild = async () => {
      const res = await call(server, 'GET', `/maps/${mapId}/wild`, kid);
      expect(res.statusCode, res.body).toBe(200);
      return WildHintsResponseSchema.parse(res.json()).wild;
    };
    expect((await wild()).lureHeld).toBe(false);
    await holdLure(mapId, kid);
    const hints = await wild();
    expect(hints.lureHeld).toBe(true);
    expect(Object.keys(hints).sort()).toEqual(['lureHeld', 'tiles']);
  });

  describe('lock order (tech spec §7 step 5d)', () => {
    /** Holds the lure row, starts the lured battle, and once it waits takes `then` too. */
    async function holdLureThen(
      lureId: string,
      command: () => Promise<unknown>,
      then: (tx: Transaction) => Promise<unknown>,
    ) {
      let running: Promise<unknown> | undefined;
      await db.transaction(async (tx) => {
        await tx.execute(`set local lock_timeout = '10s'`);
        await tx.execute(`select id from post_purchases where id = '${lureId}' for update`);
        const pid = await backendPid(tx);
        running = command().catch((err: unknown) => err);
        await waitUntilBlockedBy(db, pid);
        await then(tx);
      });
      return running!;
    }

    it('a wild start with a lure takes the seat, then the lure row, then species_seen', async () => {
      const server = await start();
      const kid = await player();
      const { mapId, lureId } = await patch(server, kid);
      // The kid has met the uncommon before, so the start's `markSeen` touches that row.
      await db
        .insert(speciesSeen)
        .values({ mapId, userId: kid.id, speciesId: UNCOMMON, firstSeenAt: clock });
      const { battles } = services(COMMON_THEN_UNCOMMON);
      const result = await holdLureThen(
        lureId!,
        () => battles.startWild(kid, mapId),
        (tx) =>
          tx.execute(
            `select species_id from species_seen where map_id = '${mapId}' and user_id = '${kid.id}' and species_id = '${UNCOMMON}' for update`,
          ),
      );
      expect(result).toMatchObject({ created: true, battle: { lured: true } });
      expect((await lureRow(lureId!)).consumedBattleId).not.toBeNull();
    });

    it('a consume racing to 0 rows rolls the battle back with CONFLICT', async () => {
      const server = await start();
      const kid = await player();
      const { mapId, lureId } = await patch(server, kid);
      const { battles } = services(COMMON_THEN_UNCOMMON);
      // Another start of the kid's used the lure first, while this one waited on it.
      const result = await holdLureThen(
        lureId!,
        () => battles.startWild(kid, mapId),
        (tx) => tx.execute(`update post_purchases set consumed_at = now() where id = '${lureId!}'`),
      );
      expect(result).toBeInstanceOf(AppError);
      expect((result as AppError).code).toBe('CONFLICT');
      expect(await battlesOf(mapId)).toHaveLength(0);
      // Asking again starts a plain battle: no lure is held any more.
      const next = await battles.startWild(kid, mapId);
      expect(next.battle.lured).toBeUndefined();
    });
  });
});
