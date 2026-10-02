import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  CARE_RULES,
  CareListResponseSchema,
  CareResponseSchema,
  GROWTH_RULES,
  HomeResponseSchema,
  MapResponseSchema,
  SquishyResponseSchema,
  xpForLevel,
  type CareSquishy,
  type PlayerBattle,
  type PlayerBattleAction,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, squishies, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { appendGrowthEvents, applyXp } from './service.js';
import { createCareRepo } from './repo.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
/** The players' account time zone: the care day turns at their midnight. */
const ZONE = 'America/Denver';
/** Oct 2, 6:00 AM in Denver. */
const START = '2026-10-02T12:00:00Z';
const MOONPUFF = 'placeholder-moonpuff';
const MOONMALLOW = 'placeholder-moonmallow';

interface Player {
  id: string;
  token: string;
}

describe.skipIf(!url)('care (needs DATABASE_URL)', () => {
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
    const username = `carer_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: ZONE })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db.insert(sessions).values({
      userId: user!.id,
      tokenHash,
      expiresAt: new Date(Date.parse(START) + 365 * DAY_MS),
    });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, token };
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

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;

  /** A patch in UTC, so the care day can only come from the account's zone. */
  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, { name: 'Care Patch', timeZone: 'UTC' });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function squishy(
    mapId: string,
    who: Player,
    values: Partial<typeof squishies.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await db
      .insert(squishies)
      .values({
        mapId,
        ownerUserId: who.id,
        speciesId: MOONPUFF,
        element: 'shadow',
        feeling: 'sleepy',
        ...values,
      })
      .returning({ id: squishies.id });
    return row!.id;
  }

  async function list(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'GET', `/maps/${mapId}/care`, who);
    expect(res.statusCode, res.body).toBe(200);
    return CareListResponseSchema.parse(res.json());
  }

  async function one(server: FastifyInstance, who: Player, mapId: string, id: string) {
    const found = (await list(server, who, mapId)).squishies.find((s) => s.id === id);
    expect(found).toBeDefined();
    return found!;
  }

  const care = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    id: string,
    action: string,
    headers: Record<string, string> = {},
  ) => call(server, 'POST', `/maps/${mapId}/squishies/${id}/care`, who, { action }, headers);

  async function cared(
    server: FastifyInstance,
    who: Player,
    mapId: string,
    id: string,
    action: string,
  ) {
    const res = await care(server, who, mapId, id, action);
    expect(res.statusCode, res.body).toBe(200);
    return CareResponseSchema.parse(res.json());
  }

  /** Moves the clock past the care debounce. */
  const later = () => {
    clock.setTime(clock.getTime() + 11_000);
  };

  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  const rowOf = (id: string) =>
    db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, id) });

  describe('access', () => {
    it('needs a logged-in member, and only ever touches your own squishies', async () => {
      const server = await start();
      const [kid, stranger] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      const theirs = await squishy(mapId, kid);
      expect((await call(server, 'GET', `/maps/${mapId}/care`, null)).statusCode).toBe(401);
      expect((await call(server, 'GET', `/maps/${mapId}/care`, stranger)).statusCode).toBe(404);
      expect((await care(server, stranger, mapId, theirs, 'pet')).statusCode).toBe(404);
      const strangerMap = await newMap(server, stranger);
      expect((await care(server, stranger, strangerMap, theirs, 'pet')).statusCode).toBe(404);
      const unknown = await care(server, kid, mapId, theirs, 'tickle-fight');
      expect(unknown.statusCode).toBe(400);
      expect(errorOf(unknown).message).toBe("We don't know that kind of care.");
    });

    it("can't care for a squishy in the Hollow", async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const away = await squishy(mapId, kid, { state: 'hollowed' });
      const res = await care(server, kid, mapId, away, 'pet');
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).message).toContain('Rescue them first!');
      expect((await list(server, kid, mapId)).squishies).toEqual([]);
    });
  });

  describe('care actions', () => {
    it('starts with no contentment, no bonus and three full actions to go', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid, { level: 3 });
      const sheet = await one(server, kid, mapId, id);
      expect(sheet).toMatchObject({
        speciesId: MOONPUFF,
        level: 3,
        contentment: 0,
        mood: 'cuddly',
        xpBonusPercent: 100,
        caredToday: 0,
        fullCareLeft: 3,
        nextCareAt: {},
        newEvolution: null,
        xpIntoLevel: 0,
        xpToNext: xpForLevel(4, GROWTH_RULES) - xpForLevel(3, GROWTH_RULES),
      });
      // A secret species the player owns comes with its row.
      expect((await list(server, kid, mapId)).speciesDefs.map((s) => s.id)).toEqual([MOONPUFF]);
    });

    it('pets: contentment up, a debounce, an event members see without the numbers', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid);

      const reply = await cared(server, kid, mapId, id, 'pet');
      expect(reply.result).toEqual({
        action: 'pet',
        squishyId: id,
        contentmentGained: 10,
        full: true,
        coins: 1,
      });
      const sheet = reply.squishies.find((s) => s.id === id)!;
      expect(sheet).toMatchObject({
        contentment: 10,
        mood: 'calm',
        caredToday: 1,
        fullCareLeft: 2,
      });
      expect(sheet.nextCareAt['pet']).toBe(new Date(clock.getTime() + 10_000).toISOString());
      expect(reply.coinsToday).toBe(1);

      // Same action again straight away: one gesture counts once.
      const again = await care(server, kid, mapId, id, 'pet');
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).message).toBe('Moonpuff needs a tiny moment. Try again soon!');
      // Another action is fine.
      await cared(server, kid, mapId, id, 'play');

      const event = (await eventsOf(mapId)).find((e) => e.type === 'squishy.cared')!;
      expect(event.payload).toMatchObject({
        userId: kid.id,
        squishyId: id,
        contentment: 10,
        coins: 1,
      });
      expect(publicViewFor(PUBLIC_VIEWS, event, { userId: friend.id })).toEqual({
        userId: kid.id,
        squishyId: id,
        action: 'pet',
        mood: 'calm',
      });
    });

    it('gives less after three actions a day, and coins only for the full ones', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid);
      const results = [];
      for (const action of ['pet', 'play', 'pet', 'play', 'pet', 'play', 'pet']) {
        later();
        results.push((await cared(server, kid, mapId, id, action)).result);
      }
      expect(results.map((r) => [r.contentmentGained, r.full, r.coins])).toEqual([
        [10, true, 1],
        [10, true, 1],
        [10, true, 1],
        [5, false, 0],
        [2, false, 0],
        [1, false, 0],
        [1, false, 0],
      ]);
      const sheet = await one(server, kid, mapId, id);
      expect(sheet).toMatchObject({ contentment: 39, caredToday: 7, fullCareLeft: 0 });
    });

    it("starts a fresh day at the player's midnight, not the patch's", async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid);
      // 11:30 PM in Denver (already Oct 3 in UTC, the patch's zone).
      clock.setTime(Date.parse('2026-10-03T05:30:00Z'));
      for (const action of ['pet', 'play', 'pet']) {
        later();
        expect((await cared(server, kid, mapId, id, action)).result.full).toBe(true);
      }
      later();
      expect((await cared(server, kid, mapId, id, 'play')).result.full).toBe(false);
      // 12:30 AM in Denver: a new day, full care again.
      clock.setTime(Date.parse('2026-10-03T06:30:00Z'));
      const fresh = await cared(server, kid, mapId, id, 'pet');
      expect(fresh.result).toMatchObject({ full: true, contentmentGained: 10 });
      expect(fresh.squishies[0]).toMatchObject({ caredToday: 1, fullCareLeft: 2 });
    });

    it('caps Patch Coins from care per account per day, across every patch', async () => {
      const server = await start();
      const kid = await player();
      const [mapA, mapB] = [await newMap(server, kid), await newMap(server, kid)];
      const ids = [
        [mapA, await squishy(mapA, kid)],
        [mapA, await squishy(mapA, kid)],
        [mapB, await squishy(mapB, kid)],
        [mapB, await squishy(mapB, kid)],
      ] as const;
      let coins = 0;
      for (const action of ['pet', 'play', 'pet']) {
        later();
        for (const [mapId, id] of ids)
          coins += (await cared(server, kid, mapId, id, action)).result.coins;
      }
      expect(coins).toBe(CARE_RULES.dailyCoinCap);
      expect((await list(server, kid, mapB)).coinsToday).toBe(CARE_RULES.dailyCoinCap);
      // Tomorrow the cap starts over.
      clock.setTime(clock.getTime() + DAY_MS);
      expect((await cared(server, kid, mapA, ids[0][1], 'pet')).result.coins).toBe(1);
    });

    it('feeds with a Treat, ledgered as care, and nothing changes without one', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid);

      const hungry = await care(server, kid, mapId, id, 'feed');
      expect(hungry.statusCode).toBe(409);
      expect(errorOf(hungry).message).toContain('Treats');
      expect(await one(server, kid, mapId, id)).toMatchObject({ contentment: 0, caredToday: 0 });
      expect((await eventsOf(mapId)).some((e) => e.type === 'squishy.cared')).toBe(false);

      await give(mapId, kid, { treats: 2 });
      const fed = await cared(server, kid, mapId, id, 'feed');
      expect(fed.result.contentmentGained).toBe(20);
      expect(fed.items['treats']).toBe(1);
      const ledger = await db.query.resourceLedger.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.reason, 'care')),
      });
      const log = await db.query.careLog.findMany({ where: (t, { eq }) => eq(t.squishyId, id) });
      expect(ledger).toEqual([
        expect.objectContaining({ itemId: 'treats', delta: -1, refId: log[0]!.id }),
      ]);
    });

    it('replays a retried care action instead of caring twice', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid);
      const key = { 'idempotency-key': 'care-retry-1' };
      const first = await care(server, kid, mapId, id, 'pet', key);
      const retry = await care(server, kid, mapId, id, 'pet', key);
      expect(retry.statusCode).toBe(200);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(first.json());
      expect((await one(server, kid, mapId, id)).caredToday).toBe(1);
    });
  });

  describe('contentment over time', () => {
    it('slides from full to nothing over a day, worked out on read', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid, {
        contentmentAtLastCare: 100,
        lastCaredAt: new Date(START),
      });
      const at = async (hours: number) => {
        clock.setTime(Date.parse(START) + hours * HOUR_MS);
        const s = await one(server, kid, mapId, id);
        return [s.contentment, s.mood, s.xpBonusPercent];
      };
      expect(await at(0)).toEqual([100, 'glowing', 175]);
      expect(await at(6)).toEqual([75, 'glowing', 156]);
      expect(await at(12)).toEqual([50, 'happy', 137]);
      expect(await at(24)).toEqual([0, 'cuddly', 100]);
      expect(await at(24 * 9)).toEqual([0, 'cuddly', 100]);
      // Nothing was written while it slid: the row still says 100.
      expect((await rowOf(id))?.contentmentAtLastCare).toBe(100);
    });

    it('builds care on what is left, and caps at full', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid, {
        contentmentAtLastCare: 95,
        lastCaredAt: new Date(START),
      });
      expect((await cared(server, kid, mapId, id, 'pet')).squishies[0]!.contentment).toBe(100);
      clock.setTime(Date.parse(START) + 12 * HOUR_MS);
      expect((await cared(server, kid, mapId, id, 'play')).squishies[0]!.contentment).toBe(60);
      const row = await rowOf(id);
      expect(row).toMatchObject({ contentmentAtLastCare: 60, lastCaredAt: clock });
    });
  });

  describe('XP, levels and evolution', () => {
    /** `applyXp` and its events in one transaction, as the battles module runs them. */
    const grantXp = (id: string, baseXp: number) =>
      createCareRepo(db).transaction(async (repo, tx) => {
        const growth = await applyXp(tx, id, baseXp, clock);
        if (growth) await appendGrowthEvents(repo.appendEvent, [growth]);
        return growth;
      });

    it('gives a neglected squishy exactly its base XP', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid);
      expect(await grantXp(id, 20)).toMatchObject({ xp: 20, multiplier: 100, level: 1 });
      expect(await rowOf(id)).toMatchObject({ xp: 20, level: 1 });
    });

    it('multiplies by care and a matching habitat, capped at 3×', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      // An Ember Den (fire, cozy) and a fire/cozy squishy living in it.
      const home = HomeResponseSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/home`, kid)).json(),
      );
      const seed = home.tiles.find((t) => t.heartSeed)!;
      await give(mapId, kid, { timber: 10, stone: 10 });
      const built = await call(server, 'POST', `/maps/${mapId}/buildings`, kid, {
        buildingId: 'ember-den',
        q: seed.q,
        r: seed.r,
        spot: 1,
      });
      expect(built.statusCode, built.body).toBe(201);
      const den = HomeResponseSchema.parse(built.json()).buildings[0]!;
      const id = await squishy(mapId, kid, { element: 'fire', feeling: 'cozy' });
      const housed = await call(server, 'POST', `/maps/${mapId}/squishies/${id}/habitat`, kid, {
        habitatId: den.id,
      });
      expect(housed.statusCode).toBe(200);

      // Habitat only: 1.75×.
      expect((await one(server, kid, mapId, id)).xpBonusPercent).toBe(175);
      expect(await grantXp(id, 20)).toMatchObject({ xp: 35, multiplier: 175 });
      // Full contentment too: 1.75 × 1.75 = 3.06×, capped at 3×.
      await createCareRepo(db).setContentment(id, 100, clock);
      expect((await one(server, kid, mapId, id)).xpBonusPercent).toBe(GROWTH_RULES.capPercent);
      expect(await grantXp(id, 20)).toMatchObject({ xp: 60, multiplier: 300 });
      expect((await rowOf(id))?.xp).toBe(95);
    });

    it('levels up from the XP curve and says so', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid);
      expect(await grantXp(id, xpForLevel(4, GROWTH_RULES))).toMatchObject({
        fromLevel: 1,
        level: 4,
      });
      const sheet = await one(server, kid, mapId, id);
      expect(sheet.level).toBe(4);
      expect(sheet.stats.hp).toBeGreaterThan((await statsAt(server, kid, mapId, 1)).hp);
      const event = (await eventsOf(mapId)).find((e) => e.type === 'squishy.leveled')!;
      expect(event.payload).toEqual({
        userId: kid.id,
        squishyId: id,
        fromLevel: 1,
        level: 4,
        xp: xpForLevel(4, GROWTH_RULES),
      });
    });

    /** A level-`level` Moonpuff's stats, from a fresh one. */
    async function statsAt(server: FastifyInstance, who: Player, mapId: string, level: number) {
      const id = await squishy(mapId, who, { level });
      return (await one(server, who, mapId, id)).stats;
    }

    it('evolves at the threshold, keeps the secret form secret, and celebrates once', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await newMap(server, kid);
      const id = await squishy(mapId, kid, { level: 19 });

      // One XP short of level 20: still a Moonpuff.
      const toTwenty = xpForLevel(20, GROWTH_RULES) - xpForLevel(19, GROWTH_RULES);
      expect(await grantXp(id, toTwenty - 1)).toMatchObject({ level: 19, evolutions: [] });
      expect((await rowOf(id))?.speciesId).toBe(MOONPUFF);
      // Not a word about what it might become.
      const before = await list(server, kid, mapId);
      expect(before.speciesDefs.map((s) => s.id)).toEqual([MOONPUFF]);
      expect(JSON.stringify(before)).not.toContain(MOONMALLOW);

      expect(await grantXp(id, 1)).toMatchObject({
        level: 20,
        evolutions: [{ fromSpeciesId: MOONPUFF, intoSpeciesId: MOONMALLOW }],
      });
      expect(await rowOf(id)).toMatchObject({
        speciesId: MOONMALLOW,
        level: 20,
        element: 'shadow',
      });

      const events = await eventsOf(mapId);
      const evolved = events.find((e) => e.type === 'squishy.evolved')!;
      expect(evolved.payload).toMatchObject({ fromSpeciesId: MOONPUFF, intoSpeciesId: MOONMALLOW });
      expect(publicViewFor(PUBLIC_VIEWS, evolved, { userId: friend.id })).toEqual({
        userId: kid.id,
        squishyId: id,
        level: 20,
      });

      const after = await one(server, kid, mapId, id);
      expect(after.newEvolution).toMatchObject({
        fromSpeciesId: MOONPUFF,
        intoSpeciesId: MOONMALLOW,
        level: 20,
      });
      expect((await list(server, kid, mapId)).speciesDefs.map((s) => s.id).sort()).toEqual(
        [MOONMALLOW, MOONPUFF].sort(),
      );
      const seen = await call(server, 'POST', `/maps/${mapId}/squishies/${id}/care/seen`, kid);
      expect(seen.statusCode).toBe(200);
      const sheet: CareSquishy = CareListResponseSchema.parse(seen.json()).squishies[0]!;
      expect(sheet.newEvolution).toBeNull();
      // Someone else can't mark it seen.
      const theirs = await call(server, 'POST', `/maps/${mapId}/squishies/${id}/care/seen`, friend);
      expect(theirs.statusCode).toBe(404);
    });

    it('evolves after a real battle, through the battles module', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
        speciesId: MOONPUFF,
        level: 19,
      });
      const pal = SquishyResponseSchema.parse(granted.json()).squishy;
      // Just short of level 20: any battle that plays a turn gets it there.
      await createCareRepo(db).setGrowth(pal.id, {
        xp: xpForLevel(20, GROWTH_RULES) - BATTLE_RULES.xp.minimum,
        level: 19,
        speciesId: MOONPUFF,
        element: 'shadow',
      });
      const fight = await call(server, 'POST', `/maps/${mapId}/dev/battles`, kid, {
        opponent: { speciesId: MOONPUFF, level: 3 },
      });
      let battle: PlayerBattle = BattleResponseSchema.parse(fight.json()).battle;
      for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && battle.status === 'active'; i++) {
        const side = battle.view.sides.a;
        const action: PlayerBattleAction = {
          type: 'move',
          move: side.squishies[side.active]!.moves[0]!,
        };
        const res = await call(server, 'POST', `/battles/${battle.id}/actions`, kid, {
          action,
          turn: battle.view.turn,
        });
        expect(res.statusCode).toBe(200);
        battle = BattleResponseSchema.parse(res.json()).battle;
      }
      expect(battle.status).toBe('finished');
      expect(await rowOf(pal.id)).toMatchObject({ speciesId: MOONMALLOW, level: 20 });
      const types = (await eventsOf(mapId)).map((e) => e.type);
      expect(types.slice(-3)).toEqual(['battle.ended', 'squishy.leveled', 'squishy.evolved']);
      const ended = (await eventsOf(mapId)).find((e) => e.type === 'battle.ended')!;
      expect(ended.payload).toMatchObject({ xp: [{ squishyId: pal.id }] });
    });
  });
});
