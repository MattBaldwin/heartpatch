import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  CatalogResponseSchema,
  createBattleContent,
  JoinMapResponseSchema,
  GAME_DATA,
  hexKey,
  hexNeighbors,
  MapResponseSchema,
  replayBattle,
  type MapDetail,
  SquishyResponseSchema,
  STARTERS,
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
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { createClock, spawnWindowId } from '../../lib/time.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesService } from '../battles/service.js';
import { grantItems } from '../inventory/service.js';
import { createSpawnsService, defaultSpawnData, gladeSpawn } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const HOUR_MS = 60 * 60 * 1000;
/** A secret squishy that isn't a grown-up form, so it can be met wild (CLAUDE.md rule 6). */
const SECRET_WILD = SERVER_GAME_DATA.secretSpecies.find(
  (s) => !SERVER_GAME_DATA.secretEvolutions.some((e) => e.into === s.id),
)!.id;
/** The dev squishy's level: strong enough to win any wild battle here. */
const STRONG_LEVEL = 40;
/** A year-round public squishy that grows up before `STRONG_LEVEL`, so battle XP evolves it. */
const STRONG = GAME_DATA.species.find(
  (s) => !s.season && s.evolutions.some((e) => e.level < STRONG_LEVEL),
)!.id;
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

/** Every tile has a secret squishy (any season, any time), whatever the shipped tables hold. */
const EVERYWHERE: SpawnData = {
  ...defaultSpawnData(),
  tables: [
    {
      id: 'secrets-everywhere',
      terrains: GAME_DATA.terrains.map((t) => t.id),
      entries: [{ species: SECRET_WILD, weight: 1 }],
    },
  ],
  rules: { ...SPAWN_RULES, chance: 100 },
};

describe.skipIf(!url)('wild squishies and capture (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date('2026-10-02T18:00:00Z');
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse('2026-10-02T18:00:00Z'));
  });

  /** Heart Charms into the player's bag (#17's inventory, as the dev route does). */
  const giveCharms = async (mapId: string, who: PublicUser, quantity: number) => {
    if (quantity > 0) {
      await grantItems(db, { mapId, userId: who.id }, { 'heart-charm': quantity }, 'dev-grant');
    }
  };
  const charmsLeft = async (mapId: string, who: PublicUser) => {
    const row = await db.query.inventories.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.mapId, mapId), eq(t.userId, who.id), eq(t.itemId, 'heart-charm')),
    });
    return row?.quantity ?? 0;
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
  function services(options: { data?: SpawnData; rules?: BattleRules } = {}) {
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
    });
    return { spawns, battles };
  }

  async function player(): Promise<Player> {
    const username = `finder_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    // Every player has picked a Keeper (the map gate, #42).
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
    who: Player | null,
    payload?: object,
    headers: Record<string, string> = {},
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: { ...HEADERS, ...headers },
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
      speciesId: STRONG,
      level: STRONG_LEVEL,
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
      expect(wild.speciesId).toBe(SECRET_WILD);
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
        expect.objectContaining({
          speciesId: SECRET_WILD,
          firstSeenAt: clock,
          firstCaughtAt: null,
        }),
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
            entries: [{ species: SECRET_WILD, weight: 1 }],
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
      expect(res.body).not.toContain(SECRET_WILD);
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

  /** Plays the player's first move until the battle ends (a level-40 squishy wins). */
  const fight = async (
    battles: ReturnType<typeof services>['battles'],
    who: PublicUser,
    start: PlayerBattle,
  ): Promise<PlayerBattle> => {
    let b = start;
    for (let i = 0; i < 50 && b.status === 'active'; i++) {
      const side = b.view.sides.a;
      const move = side.squishies[side.active]!.moves[0]!;
      b = await battles.act(who, b.id, { action: { type: 'move', move }, turn: b.view.turn });
    }
    return b;
  };

  describe('beaten wild squishies wander off (owner decision 2026-10-03)', () => {
    /** A patch for `kid` with a level-40 squishy, and `other` joined through invite → approve. */
    async function sharedPatch(server: FastifyInstance, kid: Player, other: Player) {
      const res = await call(server, 'POST', '/maps', kid, {
        name: 'Squishy Patch',
        timeZone: 'America/Denver',
      });
      expect(res.statusCode, res.body).toBe(201);
      const map: MapDetail = MapResponseSchema.parse(res.json()).map;
      const join = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      expect(join.statusCode).toBe(201);
      const request = JoinMapResponseSchema.parse(join.json()).request;
      const ok = await call(server, 'POST', `/maps/${map.id}/requests/${request.id}/approve`, kid);
      expect(ok.statusCode).toBe(204);
      for (const who of [kid, other]) {
        const granted = await call(server, 'POST', `/maps/${map.id}/dev/squishies`, who, {
          speciesId: STRONG,
          level: STRONG_LEVEL,
        });
        expect(granted.statusCode).toBe(201);
      }
      return map.id;
    }
    const spawnTileOf = async (battleId: string) => {
      const row = await db.query.battles.findFirst({ where: (t, { eq }) => eq(t.id, battleId) });
      return { q: row!.spawnQ!, r: row!.spawnR! };
    };

    it('a win without a capture: gone for the winner this window, still there for others', async () => {
      const server = await start();
      const kid = await player();
      const other = await player();
      const mapId = await sharedPatch(server, kid, other);
      const { battles, spawns } = services();
      const hintsBefore = (await spawns.wildHints(kid, mapId)).tiles;

      const { battle } = await battles.startWild(kid, mapId);
      const wild = battle.view.sides.b.squishies[0]!;
      const tile = await spawnTileOf(battle.id);
      const done = await fight(battles, kid, battle);
      expect(done.view.phase).toMatchObject({
        type: 'over',
        result: { winner: 'a', reason: 'tuckered-out' },
      });
      // No new friend: it toddled away.
      expect(await squishiesOf(mapId, kid)).toHaveLength(1);

      const hintsAfter = (await spawns.wildHints(kid, mapId)).tiles;
      expect(hintsAfter).not.toContainEqual(tile);
      expect(hintsAfter).toHaveLength(hintsBefore.length - 1);
      await expect(battles.startWild(kid, mapId, { tile })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      // "Find a squishy" moves on to the next one rather than the beaten one.
      const next = await battles.startWild(kid, mapId);
      expect(await spawnTileOf(next.battle.id)).not.toEqual(tile);
      await battles.act(kid, next.battle.id, { action: { type: 'forfeit' }, turn: 0 });

      // Asking again changes nothing (it's read from the finished battle).
      expect((await spawns.wildHints(kid, mapId)).tiles).toEqual(hintsAfter);
      // Another member still finds it there: same squishy, same level. (Their
      // reach is their own land, so hand them the tile for the test.)
      await db.execute(`
        update tiles set owner_user_id = ${id(other.id)}
        where map_id = ${id(mapId)} and q = ${String(tile.q)} and r = ${String(tile.r)}`);
      const theirs = await battles.startWild(other, mapId, { tile });
      expect(theirs.battle.view.sides.b.squishies[0]).toMatchObject({
        speciesId: wild.speciesId,
        level: wild.level,
      });

      // Back for everyone in the next window.
      clock.setTime(clock.getTime() + SPAWN_RULES.windowHours * HOUR_MS);
      await db.execute(`
        update tiles set owner_user_id = ${id(kid.id)}
        where map_id = ${id(mapId)} and q = ${String(tile.q)} and r = ${String(tile.r)}`);
      expect((await spawns.wildHints(kid, mapId)).tiles).toContainEqual(tile);
    });

    it('on the Tutorial Glade a beaten one stays, and only befriending moves it on (#24)', async () => {
      const server = await start();
      const kid = await player();
      const started = await call(server, 'POST', '/tutorial/start', kid);
      const mapId = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
      const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
        speciesId: STRONG,
        level: STRONG_LEVEL,
      });
      expect(granted.statusCode).toBe(201);
      const { battles, spawns } = services();
      const hintsBefore = (await spawns.wildHints(kid, mapId)).tiles;

      // The Glade's wild squishies are the three starters (the Partner is one).
      const tile = { q: 0, r: 1 };
      const { battle } = await battles.startWild(kid, mapId, { tile });
      expect(STARTERS.speciesIds).toContain(battle.view.sides.b.squishies[0]!.speciesId);
      const done = await fight(battles, kid, battle);
      expect(done.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
      // Beaten, not befriended: still there, so the kid can try again.
      expect((await spawns.wildHints(kid, mapId)).tiles).toEqual(hintsBefore);
      const again = await battles.startWild(kid, mapId, { tile });
      expect(await spawnTileOf(again.battle.id)).toEqual(tile);

      // Befriended: gone for this window, as anywhere.
      await giveCharms(mapId, kid, 1);
      await capture(battles, kid, again.battle);
      expect((await spawns.wildHints(kid, mapId)).tiles).not.toContainEqual(tile);
      // Three tiles that all touch show three different starters.
      const near = [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 0, r: 1 },
      ].map(gladeSpawn);
      expect(new Set(near.map((n) => n.speciesId)).size).toBe(3);
    });

    it('a loss or a run home leaves it there', async () => {
      const server = await start();
      const kid = await player();
      const res = await call(server, 'POST', '/maps', kid, {
        name: 'Squishy Patch',
        timeZone: 'America/Denver',
      });
      const mapId = MapResponseSchema.parse(res.json()).map.id;
      // A level-1 squishy against level-60 wild ones: a sure loss.
      await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
        speciesId: STRONG,
        level: 1,
      });
      const { battles, spawns } = services({
        data: { ...EVERYWHERE, rules: { ...EVERYWHERE.rules, levels: { min: 60, max: 60 } } },
      });
      const hintsBefore = (await spawns.wildHints(kid, mapId)).tiles;

      // Run home.
      const first = await battles.startWild(kid, mapId);
      const tile = await spawnTileOf(first.battle.id);
      await battles.act(kid, first.battle.id, { action: { type: 'forfeit' }, turn: 0 });
      expect((await spawns.wildHints(kid, mapId)).tiles).toEqual(hintsBefore);

      // Lose.
      const second = await battles.startWild(kid, mapId, { tile });
      const lost = await fight(battles, kid, second.battle);
      expect(lost.view.phase).toMatchObject({ type: 'over', result: { winner: 'b' } });
      expect((await spawns.wildHints(kid, mapId)).tiles).toEqual(hintsBefore);
      const third = await battles.startWild(kid, mapId, { tile });
      expect(third.created).toBe(true);
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
      // The charm is ledgered against this battle (#17's resource_ledger).
      const spent = await db.query.resourceLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'capture')),
      });
      expect(spent).toEqual([
        expect.objectContaining({ itemId: 'heart-charm', delta: -1, refId: battle.id }),
      ]);

      // The dev squishy is level 40; the new friend is the other row.
      const mine = await squishiesOf(mapId, kid);
      expect(mine).toHaveLength(2);
      const friend = mine.find((s) => s.level !== STRONG_LEVEL)!;
      expect(friend).toMatchObject({
        level: wild.level,
        element: wild.element,
        feeling: wild.feeling,
        state: 'active',
      });
      // (The dev squishy's new form, below, is caught too: #19.)
      expect(await seenOf(mapId, kid)).toContainEqual(
        expect.objectContaining({ speciesId: wild.speciesId, firstCaughtAt: clock }),
      );
      // The level-40 dev squishy is past its evolution level, so its battle XP
      // grows it up too (#19's `applyXp`).
      const all = (await eventsOf(mapId)).slice(-3);
      expect(all.map((e) => e.type)).toEqual([
        'battle.ended',
        'squishy.evolved',
        'squishy.captured',
      ]);
      const events = [all[0]!, all[2]!];
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
      // #17's kid-readable line ("You need 1 more Heart Charm first!").
      await expect(capture(battles, kid, battle)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringMatching(/Heart Charm/) as unknown,
      });
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
    });

    it('always works on the tutorial map (tutorialOverrides.captureAlwaysSucceeds)', async () => {
      const server = await start();
      const kid = await player();
      const started = await call(server, 'POST', '/tutorial/start', kid);
      const mapId = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
      const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
        speciesId: STRONG,
      });
      SquishyResponseSchema.parse(granted.json());
      // Default rules, where a secret squishy at full energy is a long shot.
      const { battles } = services({ rules: BATTLE_RULES });
      await giveCharms(mapId, kid, 1);
      const { battle } = await battles.startWild(kid, mapId);
      const done = await capture(battles, kid, battle);
      expect(done.view.phase).toMatchObject({ type: 'over', result: { reason: 'captured' } });
    });
  });

  describe('capture over HTTP (the real app, #17 inventory)', () => {
    it('spends one Heart Charm per try, and a retried submit replays instead of spending another', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patchWithSquishy(server, kid);
      const granted = await call(server, 'POST', `/maps/${mapId}/dev/items`, kid, {
        items: { 'heart-charm': 3 },
      });
      expect(granted.statusCode, granted.body).toBe(201);
      const fight = await call(server, 'POST', `/maps/${mapId}/dev/battles`, kid, {});
      const battle = BattleResponseSchema.parse(fight.json()).battle;

      const submit = () =>
        call(
          server,
          'POST',
          `/battles/${battle.id}/actions`,
          kid,
          { action: { type: 'capture' }, turn: battle.view.turn },
          { 'idempotency-key': 'charm-try-1' },
        );
      const first = await submit();
      expect(first.statusCode, first.body).toBe(200);
      const after = BattleResponseSchema.parse(first.json()).battle;
      expect(after.view.log.some((e) => e.type === 'capture')).toBe(true);
      expect(await charmsLeft(mapId, kid)).toBe(2);

      const retry = await submit();
      expect(retry.statusCode).toBe(200);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(first.json());
      expect(await charmsLeft(mapId, kid)).toBe(2);
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
        { speciesId: SECRET_WILD, firstSeenAt: clock.toISOString(), firstCaughtAt: null },
      ]);
      expect(seen.speciesDefs.map((s) => s.id)).toEqual([SECRET_WILD]);

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
