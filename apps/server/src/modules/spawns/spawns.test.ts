import {
  ApiErrorSchema,
  BATTLE_RULES,
  CatalogResponseSchema,
  createBattleContent,
  GAME_DATA,
  hexKey,
  hexNeighbors,
  MapResponseSchema,
  replayBattle,
  SquishyResponseSchema,
  TutorialResponseSchema,
  WildHintsResponseSchema,
  type BattleRules,
  type PlayerBattle,
  type PublicUser,
} from '@heartpatch/shared';
import {
  SERVER_GAME_DATA,
  serverBattleData,
  SPAWN_RULES,
  type SpawnData,
} from '@heartpatch/shared/server';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient, type Executor } from '../../db/client.js';
import { sessions, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { createClock, spawnWindowId } from '../../lib/time.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesService, type ItemsPort } from '../battles/service.js';
import { createSpawnsService, defaultSpawnData } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MOONPUFF = 'placeholder-moonpuff';
const UUID = /^[0-9a-f-]{36}$/;
/** A uuid for raw test SQL (only repos build queries; these are our own ids). */
const id = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return `'${value}'`;
};

interface Player extends PublicUser {
  token: string;
}

/** Rules where a Heart Charm always (or almost never) works, so tests don't depend on luck. */
const captureRules = (percent: number): BattleRules => ({
  ...BATTLE_RULES,
  capture: {
    atFull: percent,
    nearlyOut: percent,
    rarity: { common: 100, uncommon: 100, rare: 100, epic: 100, legendary: 100, secret: 100 },
  },
});
const contentWith = (rules: BattleRules) =>
  createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA), rules);

/** Every tile has a Moonpuff (any season, any time). */
const EVERYWHERE: SpawnData = {
  ...defaultSpawnData(),
  rules: { ...SPAWN_RULES, chance: 100 },
};

describe.skipIf(!url)('wild squishies and capture (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date('2026-10-02T18:00:00Z');
  let counter = 0;

  beforeAll(async () => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
    // Stands in for #17's inventory_items until it merges: a charm count per
    // player, changed on the caller's transaction like `consumeItems`.
    await db.execute(`
      create table if not exists test_heart_charms (
        map_id uuid not null, user_id uuid not null, quantity integer not null check (quantity >= 0),
        primary key (map_id, user_id))`);
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse('2026-10-02T18:00:00Z'));
  });

  /** `consumeItems` per the inventory contract: locks, refuses when short, changes nothing then. */
  const items: ItemsPort = {
    consume: async (tx: Executor, owner, wanted) => {
      expect(wanted).toEqual({ 'heart-charm': 1 });
      const rows = await tx.execute(`
        update test_heart_charms set quantity = quantity - 1
        where map_id = ${id(owner.mapId)} and user_id = ${id(owner.userId)} and quantity >= 1
        returning quantity`);
      if (rows.length === 0) throw new AppError('CONFLICT', "You're out of Heart Charms!");
    },
  };
  const giveCharms = (mapId: string, who: PublicUser, quantity: number) =>
    db.execute(`
      insert into test_heart_charms values (${id(mapId)}, ${id(who.id)}, ${String(quantity)})
      on conflict (map_id, user_id) do update set quantity = excluded.quantity`);
  const charmsLeft = async (mapId: string, who: PublicUser) => {
    const rows = await db.execute(`
      select quantity from test_heart_charms where map_id = ${id(mapId)} and user_id = ${id(who.id)}`);
    return Number(rows[0]?.['quantity'] ?? 0);
  };

  async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: 'true',
      ...env,
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  /** Services on the test clock: spawns with `data`, battles with `rules`. */
  function services(options: { data?: SpawnData; rules?: BattleRules; withItems?: boolean } = {}) {
    const spawns = createSpawnsService({
      db,
      clock: () => clock,
      data: options.data ?? EVERYWHERE,
    });
    const battles = createBattlesService({
      db,
      clock: () => clock,
      content: contentWith(options.rules ?? captureRules(100)),
      findWildEncounter: spawns.findWildEncounter,
      ...(options.withItems === false ? {} : { items }),
    });
    return { spawns, battles };
  }

  async function player(): Promise<Player> {
    const username = `finder_${String((counter += 1))}`;
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

  /** A patch with a strong squishy for `who`, so wild battles are easy. */
  async function patchWithSquishy(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, {
      name: 'Squishy Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const mapId = MapResponseSchema.parse(res.json()).map.id;
    const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, {
      level: 40,
    });
    expect(granted.statusCode).toBe(201);
    return mapId;
  }

  const tilesOf = (mapId: string) =>
    db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const seenOf = (mapId: string, who: PublicUser) =>
    db.query.speciesSeen.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, who.id)),
    });
  const squishiesOf = (mapId: string, who: PublicUser) =>
    db.query.squishies.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.ownerUserId, who.id)),
    });

  const capture = (
    battles: ReturnType<typeof services>['battles'],
    who: PublicUser,
    b: PlayerBattle,
  ) => battles.act(who, b.id, { action: { type: 'capture' }, turn: b.view.turn });

  describe('spawns (tech spec §8: no rerolls)', () => {
    it('finds the same wild squishy on the same tile all window, and records it as seen', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patchWithSquishy(server, kid);
      const { battles } = services();

      const first = await battles.startWild(kid, mapId);
      expect(first.created).toBe(true);
      const wild = first.battle.view.sides.b.squishies[0]!;
      expect(wild.speciesId).toBe(MOONPUFF);
      expect(wild.level).toBeGreaterThanOrEqual(SPAWN_RULES.levels.min);
      expect(wild.level).toBeLessThanOrEqual(SPAWN_RULES.levels.max);
      // The battle remembers its tile and window; the client never sees them.
      const row = await db.query.battles.findFirst({
        where: (t, { eq }) => eq(t.id, first.battle.id),
      });
      const window = spawnWindowId(clock, 'America/Denver', SPAWN_RULES.windowHours);
      expect(row).toMatchObject({ spawnWindow: window });
      expect(JSON.stringify(first.battle)).not.toContain(window);
      expect(await seenOf(mapId, kid)).toEqual([
        expect.objectContaining({ speciesId: MOONPUFF, firstSeenAt: clock, firstCaughtAt: null }),
      ]);

      // Run away and come back later in the window: the same squishy, same level.
      await battles.act(kid, first.battle.id, { action: { type: 'forfeit' }, turn: 0 });
      clock.setTime(clock.getTime() + 30 * 60 * 1000);
      const again = await battles.startWild(kid, mapId);
      expect(again.battle.id).not.toBe(first.battle.id);
      expect(again.battle.view.sides.b.squishies[0]).toMatchObject({
        speciesId: wild.speciesId,
        level: wild.level,
      });
      // Battle seeds still come fresh from newSeed(), never from the spawn.
      expect((await battles.get(kid, first.battle.id)).seed).not.toBe(
        (await db.query.battles.findFirst({ where: (t, { eq }) => eq(t.id, again.battle.id) }))!
          .seed,
      );
      // Seeing it twice keeps the first time.
      expect((await seenOf(mapId, kid))[0]!.firstSeenAt).toEqual(new Date('2026-10-02T18:00:00Z'));
    });

    it('looks on a picked tile in reach, and refuses tiles too far away', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patchWithSquishy(server, kid);
      const { battles } = services();
      const tiles = await tilesOf(mapId);
      const own = tiles.filter((t) => t.ownerUserId === kid.id);
      const ownKeys = new Set(own.map(hexKey));
      const edge = tiles.find(
        (t) => !ownKeys.has(hexKey(t)) && hexNeighbors(t).some((n) => ownKeys.has(hexKey(n))),
      )!;
      const far = tiles.find(
        (t) => !ownKeys.has(hexKey(t)) && !hexNeighbors(t).some((n) => ownKeys.has(hexKey(n))),
      )!;

      await expect(
        battles.startWild(kid, mapId, { tile: { q: far.q, r: far.r } }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: expect.stringMatching(/too far/) as unknown,
      });
      const picked = await battles.startWild(kid, mapId, { tile: { q: edge.q, r: edge.r } });
      const row = await db.query.battles.findFirst({
        where: (t, { eq }) => eq(t.id, picked.battle.id),
      });
      expect(row).toMatchObject({ spawnQ: edge.q, spawnR: edge.r });
    });

    it('says nobody is around when no tile has a squishy', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patchWithSquishy(server, kid);
      const { battles, spawns } = services({
        data: { ...EVERYWHERE, rules: { ...SPAWN_RULES, chance: 0 } },
      });
      await expect(battles.startWild(kid, mapId)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: expect.stringMatching(/No wild squishies around/) as unknown,
      });
      expect(await spawns.wildHints(kid, mapId)).toEqual({ tiles: [] });
    });

    it('spawns Halloween tables only in the Halloween window, following HP_DEV_NOW', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patchWithSquishy(server, kid);
      const halloweenOnly: SpawnData = {
        ...EVERYWHERE,
        tables: [
          {
            id: 'halloween-only',
            terrains: GAME_DATA.terrains.map((t) => t.id),
            season: 'halloween',
            entries: [{ species: MOONPUFF, weight: 1 }],
          },
        ],
      };
      const at = (devNow: string) =>
        createSpawnsService({
          db,
          clock: createClock({ NODE_ENV: 'test', HP_DEV_NOW: devNow }),
          data: halloweenOnly,
        }).wildHints(kid, mapId);
      expect((await at('2026-10-31T20:00:00-06:00')).tiles.length).toBeGreaterThan(0);
      // 2026's override runs Halloween to Nov 9 (map-local).
      expect((await at('2026-11-09T23:30:00-07:00')).tiles.length).toBeGreaterThan(0);
      expect((await at('2026-11-10T00:30:00-07:00')).tiles).toEqual([]);
      expect((await at('2026-09-30T12:00:00-06:00')).tiles).toEqual([]);
    });

    it('hints at tiles with someone on them, with no species', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patchWithSquishy(server, kid);
      const res = await call(server, 'GET', `/maps/${mapId}/wild`, kid);
      expect(res.statusCode).toBe(200);
      const { wild } = WildHintsResponseSchema.parse(res.json());
      expect(Object.keys(res.json<object>())).toEqual(['wild']);
      expect(Object.keys(wild)).toEqual(['tiles']);
      expect(res.body).not.toContain('moonpuff');
      // Only tiles in reach: their land and the tiles next to it.
      const tiles = await tilesOf(mapId);
      const ownKeys = new Set(tiles.filter((t) => t.ownerUserId === kid.id).map(hexKey));
      for (const tile of wild.tiles) {
        expect(
          ownKeys.has(hexKey(tile)) || hexNeighbors(tile).some((n) => ownKeys.has(hexKey(n))),
        ).toBe(true);
      }
      // Members only.
      const stranger = await player();
      expect((await call(server, 'GET', `/maps/${mapId}/wild`, stranger)).statusCode).toBe(404);
      expect((await call(server, 'GET', `/maps/${mapId}/wild`, null)).statusCode).toBe(401);
    });
  });

  describe('capture (design doc §6: Heart Charms)', () => {
    it('befriends the wild squishy in one transaction: charm, squishy, catalog, events', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patchWithSquishy(server, kid);
      const { battles, spawns } = services();
      await giveCharms(mapId, kid, 2);
      const { battle } = await battles.startWild(kid, mapId);
      const wild = battle.view.sides.b.squishies[0]!;
      const hintsBefore = (await spawns.wildHints(kid, mapId)).tiles;

      const done = await capture(battles, kid, battle);
      expect(done.status).toBe('finished');
      expect(done.view.phase).toMatchObject({
        type: 'over',
        result: { winner: 'a', reason: 'captured' },
      });
      expect(done.view.log.at(-2)).toMatchObject({ type: 'capture', side: 'b', caught: true });
      expect(await charmsLeft(mapId, kid)).toBe(1);

      // The dev squishy is a level-40 Moonpuff too; the new friend is the other row.
      const mine = await squishiesOf(mapId, kid);
      expect(mine).toHaveLength(2);
      const friend = mine.find((s) => s.level !== 40)!;
      expect(friend).toMatchObject({
        level: wild.level,
        element: wild.element,
        feeling: wild.feeling,
        state: 'active',
      });
      expect(await seenOf(mapId, kid)).toEqual([
        expect.objectContaining({ speciesId: wild.speciesId, firstCaughtAt: clock }),
      ]);
      const events = (await eventsOf(mapId)).slice(-2);
      expect(events.map((e) => e.type)).toEqual(['battle.ended', 'squishy.captured']);
      expect(events[1]!.payload).toEqual({
        battleId: battle.id,
        userId: kid.id,
        squishyId: friend.id,
        speciesId: wild.speciesId,
        level: wild.level,
      });
      // Members who never met a secret squishy don't learn its species.
      const view = publicViewFor(PUBLIC_VIEWS, events[1]!, { userId: kid.id });
      expect(view).toEqual({ userId: kid.id, squishyId: friend.id });

      // The record replays to the same end.
      const row = await db.query.battles.findFirst({ where: (t, { eq }) => eq(t.id, battle.id) });
      const content = contentWith(captureRules(100));
      expect(
        replayBattle(
          content,
          { seed: row!.seed, sides: row!.setup as never },
          row!.actions as never,
        ),
      ).toEqual(row!.state);

      // Gone for this player for the rest of the window, back in the next one.
      const tile = { q: row!.spawnQ!, r: row!.spawnR! };
      const hintsAfter = (await spawns.wildHints(kid, mapId)).tiles;
      expect(hintsAfter).not.toContainEqual(tile);
      expect(hintsAfter.length).toBe(hintsBefore.length - 1);
      await expect(battles.startWild(kid, mapId, { tile })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      clock.setTime(clock.getTime() + SPAWN_RULES.windowHours * HOUR_MS);
      expect((await spawns.wildHints(kid, mapId)).tiles).toContainEqual(tile);
    });

    it('a squishy that wiggles free keeps the battle going and still costs the charm', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patchWithSquishy(server, kid);
      // 1%: try a few battles so one surely says no.
      const { battles } = services({ rules: captureRules(1) });
      await giveCharms(mapId, kid, 10);
      let missed: PlayerBattle | null = null;
      for (let i = 0; i < 5 && !missed; i++) {
        const { battle } = await battles.startWild(kid, mapId);
        const next = await capture(battles, kid, battle);
        if (next.status === 'active') missed = next;
      }
      expect(missed).not.toBeNull();
      expect(missed!.view.turn).toBe(1);
      expect(missed!.view.log.find((e) => e.type === 'capture')).toMatchObject({ caught: false });
      const tries = 10 - (await charmsLeft(mapId, kid));
      expect(tries).toBeGreaterThanOrEqual(1);
      expect((await squishiesOf(mapId, kid)).length).toBe(1 + (tries - 1));
    });

    it('needs a Heart Charm, and changes nothing without one', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patchWithSquishy(server, kid);
      const { battles } = services();
      await giveCharms(mapId, kid, 0);
      const { battle } = await battles.startWild(kid, mapId);
      await expect(capture(battles, kid, battle)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await battles.get(kid, battle.id)).toEqual(battle);
      expect(await squishiesOf(mapId, kid)).toHaveLength(1);

      // A refused step hands the charm back: a stale turn is refused first,
      // and an engine refusal after the charm was taken rolls it all back.
      await giveCharms(mapId, kid, 1);
      await expect(
        battles.act(kid, battle.id, { action: { type: 'capture' }, turn: 5 }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await charmsLeft(mapId, kid)).toBe(1);
      await db.execute(`
        update battles set state = jsonb_set(state, '{phase}', '{"type":"replace","sides":["a"]}')
        where id = ${id(battle.id)}`);
      await expect(capture(battles, kid, battle)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await charmsLeft(mapId, kid)).toBe(1);

      const noItems = services({ withItems: false }).battles;
      await expect(capture(noItems, kid, battle)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringMatching(/Heart Charms/) as unknown,
      });
    });

    it('always works on the tutorial map (tutorialOverrides.captureAlwaysSucceeds)', async () => {
      const server = await start();
      const kid = await player();
      const started = await call(server, 'POST', '/tutorial/start', kid);
      const mapId = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
      const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {});
      SquishyResponseSchema.parse(granted.json());
      // Default rules, where a secret squishy at full energy is a long shot.
      const { battles } = services({ rules: BATTLE_RULES });
      await giveCharms(mapId, kid, 1);
      const { battle } = await battles.startWild(kid, mapId);
      const done = await capture(battles, kid, battle);
      expect(done.view.phase).toMatchObject({ type: 'over', result: { reason: 'captured' } });
    });
  });

  describe('catalog', () => {
    it('shows what each player has seen and befriended; secrets only once met', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patchWithSquishy(server, kid);
      const read = async (who: Player) => {
        const res = await call(server, 'GET', `/maps/${mapId}/catalog`, who);
        expect(res.statusCode).toBe(200);
        return CatalogResponseSchema.parse(res.json()).catalog;
      };
      expect(await read(kid)).toEqual({ entries: [], speciesDefs: [] });

      const { battles } = services();
      await giveCharms(mapId, kid, 1);
      const { battle } = await battles.startWild(kid, mapId);
      const seen = await read(kid);
      expect(seen.entries).toEqual([
        { speciesId: MOONPUFF, firstSeenAt: clock.toISOString(), firstCaughtAt: null },
      ]);
      expect(seen.speciesDefs.map((s) => s.id)).toEqual([MOONPUFF]);

      await capture(battles, kid, battle);
      expect((await read(kid)).entries[0]!.firstCaughtAt).toBe(clock.toISOString());

      // Not a member: nothing. Another player's catalog is their own.
      expect((await call(server, 'GET', `/maps/${mapId}/catalog`, await player())).statusCode).toBe(
        404,
      );
      const err = ApiErrorSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/catalog`, null)).json(),
      );
      expect(err.error.code).toBe('UNAUTHENTICATED');
    });
  });
});
