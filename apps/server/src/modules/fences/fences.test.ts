import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  borderEdges,
  edgeNeighbor,
  FENCE_RULES,
  FenceTileResponseSchema,
  hexDistance,
  hexKey,
  hexNeighbors,
  JoinMapResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  parseGameEventPayload,
  RaidReportResponseSchema,
  SquishyResponseSchema,
  TERRITORY_RULES,
  TerritoryResponseSchema,
  type HexEdge,
  type MapDetail,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, withTransaction, type Database, type DbClient } from '../../db/client.js';
import { fenceSegments, keepers, sessions, users } from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { grantItems } from '../inventory/service.js';
import { createRaidsConsumer } from '../raids/consumer.js';

/*
 * Fences (#203, #204): building, upgrading, repairing and taking down
 * segments on a tile's edges, and the two-part challenge on a fenced tile
 * (break the weakest exposed segment, then beat the guard), in one go or in
 * two visits; damage that stays; fences coming down with lost land.
 */

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const ZONE = 'America/Denver';
// Noon in Denver: a whole map-local day either side to move around in.
const START = '2026-10-02T18:00:00Z';
const PLENTY = { timber: 80, stone: 80, emberwood: 60, glimmer: 6 };
/** A Fire squishy cracks a wood fence fast; a Water one barely dents it. */
const EMBER = 'emberbun';
const SPLASH = 'puddlepuff';

interface Player extends PublicUser {
  token: string;
}

interface Tile {
  id: string;
  q: number;
  r: number;
  ownerUserId: string | null;
  homeSlot: number | null;
}

describe.skipIf(!url)('fences (needs DATABASE_URL)', () => {
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
    const username = `fencer_${String((counter += 1))}`;
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

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;
  const battleOf = (res: LightMyRequestResponse) => BattleResponseSchema.parse(res.json()).battle;
  const fencesOf = (res: LightMyRequestResponse) => FenceTileResponseSchema.parse(res.json());

  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, { name: 'Fence Patch', timeZone: ZONE });
    expect(res.statusCode, res.body).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const join = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      const request = JoinMapResponseSchema.parse(join.json()).request;
      const ok = await call(
        server,
        'POST',
        `/maps/${map.id}/requests/${request.id}/approve`,
        owner,
      );
      expect(ok.statusCode).toBe(204);
    }
    return map.id;
  }

  async function grant(
    server: FastifyInstance,
    who: Player,
    mapId: string,
    level: number,
    speciesId: string,
  ) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, {
      level,
      speciesId,
    });
    expect(res.statusCode, res.body).toBe(201);
    return SquishyResponseSchema.parse(res.json()).squishy;
  }

  const give = (mapId: string, who: Player, items: Record<string, number>) =>
    withTransaction(db, (tx) => grantItems(tx, { mapId, userId: who.id }, items, 'dev-grant'));

  const tilesOf = async (mapId: string): Promise<Tile[]> =>
    db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
  const tileAt = async (mapId: string, h: { q: number; r: number }) =>
    (await tilesOf(mapId)).find((t) => t.q === h.q && t.r === h.r)!;
  const setOwner = (tileId: string, userId: string) =>
    db.execute(`update tiles set owner_user_id = '${userId}' where id = '${tileId}'`);

  /** Neutral, non-home tiles next to `who`'s land, in (q, r) order. */
  async function edgeOf(mapId: string, who: PublicUser): Promise<Tile[]> {
    const all = await tilesOf(mapId);
    const mine = new Set(all.filter((t) => t.ownerUserId === who.id).map(hexKey));
    return all.filter(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        hexNeighbors(t).some((n) => mine.has(hexKey(n))),
    );
  }

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });
  const segmentsOn = (tileId: string) =>
    db.query.fenceSegments.findMany({
      where: (t, { eq }) => eq(t.tileId, tileId),
      orderBy: (t, { asc }) => [asc(t.edge)],
    });
  const attacksOf = (mapId: string) =>
    db.query.tileAttacks.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.startedAt), asc(t.id)],
    });
  const ledgerOf = (mapId: string, userId: string, reason: string) =>
    db.query.resourceLedger.findMany({
      where: (t, { and, eq }) =>
        and(eq(t.mapId, mapId), eq(t.userId, userId), eq(t.reason, reason)),
    });
  const sumOf = (rows: { itemId: string; delta: number }[]) => {
    const total: Record<string, number> = {};
    for (const r of rows) total[r.itemId] = (total[r.itemId] ?? 0) + r.delta;
    return total;
  };

  const attack = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    h: { q: number; r: number },
  ) => call(server, 'POST', `/maps/${mapId}/attacks`, who, { q: h.q, r: h.r });
  const act = (server: FastifyInstance, who: Player, b: PlayerBattle, action: PlayerBattleAction) =>
    call(server, 'POST', `/battles/${b.id}/actions`, who, { action, turn: b.view.turn });
  const status = async (server: FastifyInstance, who: Player, mapId: string) =>
    TerritoryResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/territory`, who)).json(),
    ).territory;

  /** Plays the player's first move every turn until the battle ends. */
  async function playOut(server: FastifyInstance, who: Player, battle: PlayerBattle) {
    let current = battle;
    for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && current.status === 'active'; i++) {
      const side = current.view.sides[current.mySide];
      const action: PlayerBattleAction =
        current.view.phase.type === 'replace'
          ? { type: 'replace', slot: side.squishies.findIndex((s) => s.energy > 0) }
          : { type: 'move', move: side.squishies[side.active]!.moves[0]! };
      const res = await act(server, who, current, action);
      expect(res.statusCode, res.body).toBe(200);
      current = battleOf(res);
    }
    expect(current.status).toBe('finished');
    return current;
  }

  /**
   * Two players; the rival holds a tile next to the kid's land, fenced on
   * every edge that faces land they don't hold (#204). Past the shield.
   */
  async function fencedRival(
    server: FastifyInstance,
    options: {
      team: { level: number; speciesId: string }[];
      fence?: { level: number; hp: number };
    },
  ) {
    const kid = await player();
    const rival = await player();
    const mapId = await patch(server, kid, [rival]);
    const team = [];
    for (const s of options.team) team.push(await grant(server, kid, mapId, s.level, s.speciesId));
    const guard = await grant(server, rival, mapId, 3, SPLASH);
    clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);
    const [near] = await edgeOf(mapId, kid);
    await setOwner(near!.id, rival.id);
    const rivalTiles = (await tilesOf(mapId)).filter((t) => t.ownerUserId === rival.id);
    const edges = borderEdges(near!, rivalTiles);
    const { level = 1, hp = 70 } = options.fence ?? {};
    await db.insert(fenceSegments).values(
      edges.map((edge) => ({
        mapId,
        ownerUserId: rival.id,
        tileId: near!.id,
        edge,
        buildingId: 'emberwood-fence',
        level,
        hp,
      })),
    );
    // The edges between the tile and the kid's land are the exposed ones.
    const kidTiles = new Set(
      (await tilesOf(mapId)).filter((t) => t.ownerUserId === kid.id).map(hexKey),
    );
    const exposed = edges.filter((e) => kidTiles.has(hexKey(edgeNeighbor(near!, e))));
    return { kid, rival, mapId, near: near!, team, guard, edges, exposed };
  }

  describe('building fences', () => {
    it('fences edges of my land, everyone sees them, and it costs Emberwood', async () => {
      const server = await start();
      const [kid, friend] = [await player(), await player()];
      const mapId = await patch(server, kid, [friend]);
      await give(mapId, kid, PLENTY);
      const [tile] = await edgeOf(mapId, kid);
      await setOwner(tile!.id, kid.id);

      const res = await call(server, 'POST', `/maps/${mapId}/fences`, kid, {
        buildingId: 'emberwood-fence',
        q: tile!.q,
        r: tile!.r,
        edges: [3, 0],
      });
      expect(res.statusCode, res.body).toBe(201);
      const built = fencesOf(res);
      expect(built.fences.map((f) => [f.edge, f.level, f.hp, f.maxHp])).toEqual([
        [0, 1, 70, 70],
        [3, 1, 70, 70],
      ]);
      // Two segments' worth, ledgered against each.
      expect(sumOf(await ledgerOf(mapId, kid.id, 'build'))).toEqual({ emberwood: -12, timber: -4 });
      expect(built.items).toMatchObject({ emberwood: 48, timber: 76 });

      const shown = MapViewSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/view`, friend)).json(),
      ).tiles.find((t) => t.q === tile!.q && t.r === tile!.r)!;
      expect(shown.fences?.map((f) => f.edge)).toEqual([0, 3]);
      const types = (await eventsOf(mapId)).map((e) => e.type);
      expect(types.filter((t) => t === 'fence.built')).toHaveLength(2);
    });

    it('refuses someone else’s land, a taken edge, and a short bag, building nothing', async () => {
      const server = await start();
      const [kid, rival] = [await player(), await player()];
      const mapId = await patch(server, kid, [rival]);
      const [mine, theirs] = await edgeOf(mapId, kid);
      await setOwner(mine!.id, kid.id);
      await setOwner(theirs!.id, rival.id);
      const build = (h: Tile, edges: number[]) =>
        call(server, 'POST', `/maps/${mapId}/fences`, kid, {
          buildingId: 'emberwood-fence',
          q: h.q,
          r: h.r,
          edges,
        });

      // Its recipe page opens once the kid has collected Emberwood and Timber.
      const sealed = await build(mine!, [0]);
      expect(sealed.statusCode).toBe(403);
      await give(mapId, kid, { emberwood: 6, timber: 2 });

      expect((await build(theirs!, [0])).statusCode).toBe(403);
      const short = await build(mine!, [0, 1]);
      expect(short.statusCode).toBe(409);
      expect(errorOf(short).message).toMatch(/Emberwood|Timber/);
      expect(await segmentsOn(mine!.id)).toEqual([]);

      expect((await build(mine!, [2])).statusCode).toBe(201);
      await give(mapId, kid, PLENTY);
      const taken = await build(mine!, [2, 4]);
      expect(taken.statusCode).toBe(409);
      expect((await segmentsOn(mine!.id)).map((s) => s.edge)).toEqual([2]);
      // Fences don't go through the home build sheet's spots.
      const viaSpot = await call(server, 'POST', `/maps/${mapId}/buildings`, kid, {
        buildingId: 'emberwood-fence',
        q: mine!.q,
        r: mine!.r,
        spot: 1,
      });
      expect(viaSpot.statusCode).toBe(409);
    });

    it('upgrades, repairs cheaply, and takes down for half back', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await give(mapId, kid, PLENTY);
      const [tile] = await edgeOf(mapId, kid);
      await setOwner(tile!.id, kid.id);
      const built = fencesOf(
        await call(server, 'POST', `/maps/${mapId}/fences`, kid, {
          buildingId: 'emberwood-fence',
          q: tile!.q,
          r: tile!.r,
          edges: [1],
        }),
      ).fences[0]!;
      const path = (action: string) => `/maps/${mapId}/fences/${built.id}/${action}`;

      // Nothing to mend at full energy.
      expect((await call(server, 'POST', path('repair'), kid)).statusCode).toBe(409);
      // A challenger knocked 28 off (60% left).
      await db.execute(`update fence_segments set hp = 42 where id = '${built.id}'`);
      const repaired = await call(server, 'POST', path('repair'), kid);
      expect(repaired.statusCode, repaired.body).toBe(200);
      expect(fencesOf(repaired).fences[0]).toMatchObject({ hp: 70, maxHp: 70 });
      expect(sumOf(await ledgerOf(mapId, kid.id, 'repair'))).toEqual({ emberwood: -1, timber: -1 });

      const up = await call(server, 'POST', path('upgrade'), kid);
      expect(up.statusCode, up.body).toBe(200);
      expect(fencesOf(up).fences[0]).toMatchObject({ level: 2, hp: 100, maxHp: 100 });

      const down = await call(server, 'POST', path('remove'), kid);
      expect(down.statusCode, down.body).toBe(200);
      // Half of 6+8 Emberwood and 2+4 Timber.
      expect(fencesOf(down)).toMatchObject({ fences: [], refund: { emberwood: 7, timber: 3 } });
      const removed = (await eventsOf(mapId)).find((e) => e.type === 'fence.removed')!;
      expect(parseGameEventPayload('fence.removed', removed.payload)).toMatchObject({
        userId: kid.id,
        fenceId: built.id,
        edge: 1,
        refund: { emberwood: 7, timber: 3 },
      });
      expect(removed.payload).not.toHaveProperty('lost');
    });
  });

  describe('challenging a fenced tile (#203)', () => {
    it('breaks the fence then beats the guard in one go, using one try', async () => {
      const server = await start();
      const { kid, rival, mapId, near, team, exposed, edges } = await fencedRival(server, {
        team: [
          { level: 40, speciesId: EMBER },
          { level: 30, speciesId: EMBER },
        ],
      });

      // Part one: the strongest squishy alone, against the weakest exposed segment.
      const first = await attack(server, kid, mapId, near);
      expect(first.statusCode, first.body).toBe(201);
      const fenceBattle = battleOf(first);
      expect(fenceBattle.view.turnLimit).toBe(FENCE_RULES.battleTurns);
      expect(fenceBattle.view.sides.a.squishies.map((s) => s.id)).toEqual([team[0]!.id]);
      const wall = fenceBattle.view.sides.b.squishies[0]!;
      expect(wall).toMatchObject({ fence: 'emberwood-fence', moves: [], energy: 70 });
      const brokenEdge = (await segmentsOn(near.id)).find((s) => s.id === wall.id)!.edge;
      expect(exposed).toContain(brokenEdge as HexEdge);
      const broke = await playOut(server, kid, fenceBattle);
      expect(broke.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });

      // The segment is gone, nothing back; the land is still the rival's.
      expect((await segmentsOn(near.id)).map((s) => s.edge)).toEqual(
        edges.filter((e) => e !== brokenEdge),
      );
      expect((await tileAt(mapId, near)).ownerUserId).toBe(rival.id);
      expect(await ledgerOf(mapId, rival.id, 'build-refund')).toEqual([]);
      const before = await status(server, kid, mapId);
      expect(before.attemptsLeft).toBe(TERRITORY_RULES.attemptsPerDay - 1);
      expect(before.fenceBroken).toEqual([expect.objectContaining({ q: near.q, r: near.r })]);

      // Part two: the rest of the team, no new try, the same cooldown.
      const second = await attack(server, kid, mapId, near);
      expect(second.statusCode, second.body).toBe(201);
      const guardBattle = battleOf(second);
      expect(guardBattle.view.turnLimit).toBeUndefined();
      expect(guardBattle.view.sides.a.squishies.map((s) => s.id)).toEqual([team[1]!.id]);
      await playOut(server, kid, guardBattle);
      expect((await tileAt(mapId, near)).ownerUserId).toBe(kid.id);
      const after = await status(server, kid, mapId);
      expect(after.attemptsLeft).toBe(TERRITORY_RULES.attemptsPerDay - 1);
      expect(after.fenceBroken).toEqual([]);
      const [fenceAttack, guardAttack] = await attacksOf(mapId);
      expect(fenceAttack).toMatchObject({ part: 'fence', outcome: 'won', fenceHpAfter: 0 });
      expect(guardAttack).toMatchObject({
        part: 'guard',
        outcome: 'captured',
        followsAttackId: fenceAttack!.id,
        cooldownUntil: fenceAttack!.cooldownUntil,
      });

      // The rival's other segments came down with the land, for half back.
      expect(await segmentsOn(near.id)).toEqual([]);
      const standing = edges.length - 1;
      expect(sumOf(await ledgerOf(mapId, rival.id, 'build-refund'))).toEqual({
        emberwood: 3 * standing,
        timber: 1 * standing,
      });
      const types = (await eventsOf(mapId)).map((e) => e.type);
      expect(types).toContain('fence.broken');
      expect(types.filter((t) => t === 'fence.removed')).toHaveLength(standing);

      // The rival's Challenge report: the fence broken, then the land taken.
      await runConsumer(db, createRaidsConsumer(), mapId);
      const report = RaidReportResponseSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/raids`, rival)).json(),
      ).report;
      expect(report.raids.map((r) => [r.outcome, r.fence])).toEqual([
        ['taken', null],
        ['lost', { buildingId: 'emberwood-fence', broken: true, percent: 0 }],
      ]);
      expect(report.raids[0]!.lostFences).toEqual({ emberwood: 3 * standing, timber: standing });
    });

    it('only breaks the fence when nobody is left to fight the guard: a second visit takes it', async () => {
      const server = await start();
      const { kid, rival, mapId, near } = await fencedRival(server, {
        team: [{ level: 40, speciesId: EMBER }],
      });
      await playOut(server, kid, battleOf(await attack(server, kid, mapId, near)));
      const again = await attack(server, kid, mapId, near);
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).message).toMatch(/fence breaker needs a rest/);

      // The window passes: now it's a new challenge, after the tile's rest.
      clock.setTime(clock.getTime() + 15 * MINUTE_MS);
      const resting = await attack(server, kid, mapId, near);
      expect(resting.statusCode).toBe(409);
      expect(errorOf(resting).message).toMatch(/little rest/);
      clock.setTime(clock.getTime() + TERRITORY_RULES.cooldownHours * HOUR_MS);
      const visit = await attack(server, kid, mapId, near);
      expect(visit.statusCode, visit.body).toBe(201);
      // The gap is still there: an ordinary guard battle, with the whole team.
      const guardBattle = battleOf(visit);
      expect(guardBattle.view.sides.b.squishies.some((s) => s.fence !== undefined)).toBe(false);
      await playOut(server, kid, guardBattle);
      expect((await tileAt(mapId, near)).ownerUserId).toBe(kid.id);
      expect((await status(server, kid, mapId)).attemptsLeft).toBe(
        TERRITORY_RULES.attemptsPerDay - 2,
      );
      void rival;
    });

    it('a fence that holds keeps the energy it lost, and its owner hears about it', async () => {
      const server = await start();
      const { kid, rival, mapId, near } = await fencedRival(server, {
        team: [{ level: 5, speciesId: SPLASH }],
        fence: { level: 3, hp: 140 },
      });
      const held = await playOut(server, kid, battleOf(await attack(server, kid, mapId, near)));
      expect(held.view.phase).toMatchObject({
        type: 'over',
        result: { winner: 'b', reason: 'turn-limit' },
      });
      const fought = held.view.sides.b.squishies[0]!;
      const segment = (await segmentsOn(near.id)).find((s) => s.id === fought.id)!;
      expect(segment.hp).toBe(fought.energy);
      expect(segment.hp).toBeLessThan(140);
      expect((await tileAt(mapId, near)).ownerUserId).toBe(rival.id);
      const damaged = (await eventsOf(mapId)).find((e) => e.type === 'fence.damaged')!;
      expect(parseGameEventPayload('fence.damaged', damaged.payload)).toMatchObject({
        userId: rival.id,
        attackerUserId: kid.id,
        fence: { id: fought.id, hp: segment.hp, maxHp: 140 },
      });
      await runConsumer(db, createRaidsConsumer(), mapId);
      const report = RaidReportResponseSchema.parse(
        (await call(server, 'GET', `/maps/${mapId}/raids`, rival)).json(),
      ).report;
      expect(report.raids[0]).toMatchObject({
        outcome: 'held',
        fence: { broken: false, percent: Math.floor((segment.hp * 100) / 140) },
      });
      // A try spent, and no "Keep going".
      const after = await status(server, kid, mapId);
      expect(after.attemptsLeft).toBe(TERRITORY_RULES.attemptsPerDay - 1);
      expect(after.fenceBroken).toEqual([]);
    });

    it('a tile with an open border edge isn’t fenced: an ordinary challenge', async () => {
      const server = await start();
      const { kid, mapId, near, edges } = await fencedRival(server, {
        team: [{ level: 40, speciesId: EMBER }],
      });
      await db.execute(
        `delete from fence_segments where tile_id = '${near.id}' and edge = ${String(edges[0])}`,
      );
      const res = await attack(server, kid, mapId, near);
      expect(res.statusCode, res.body).toBe(201);
      expect(battleOf(res).view.sides.b.squishies.some((s) => s.fence !== undefined)).toBe(false);
      expect((await attacksOf(mapId))[0]).toMatchObject({ part: 'guard', followsAttackId: null });
    });

    it('keeps the new-player shield: a fenced tile can’t be challenged early either', async () => {
      const server = await start();
      const { kid, mapId, near } = await fencedRival(server, {
        team: [{ level: 40, speciesId: EMBER }],
      });
      clock.setTime(Date.parse(START));
      const res = await attack(server, kid, mapId, near);
      expect(res.statusCode).toBe(403);
      expect(await attacksOf(mapId)).toEqual([]);
    });
  });

  it('fences on land that goes wild come down, with the take-down share back', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    await give(mapId, kid, PLENTY);
    const all = await tilesOf(mapId);
    const home = all.filter((t) => t.ownerUserId === kid.id && t.homeSlot !== null);
    const seed = {
      q: home.reduce((n, t) => n + t.q, 0) / home.length,
      r: home.reduce((n, t) => n + t.r, 0) / home.length,
    };
    // Past the ring that never fades (`keepRadius`).
    const far = all.find(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        hexDistance(t, seed) === TERRITORY_RULES.tending.keepRadius + 3,
    )!;
    await setOwner(far.id, kid.id);
    const built = await call(server, 'POST', `/maps/${mapId}/fences`, kid, {
      buildingId: 'emberwood-fence',
      q: far.q,
      r: far.r,
      edges: [0],
    });
    expect(built.statusCode, built.body).toBe(201);
    const age = await call(server, 'POST', `/maps/${mapId}/dev/territory/age`, kid, {
      days: TERRITORY_RULES.tending.wildAfterDays + 1,
    });
    expect(age.statusCode, age.body).toBe(200);
    expect((await tileAt(mapId, far)).ownerUserId).toBeNull();
    expect(await segmentsOn(far.id)).toEqual([]);
    expect(sumOf(await ledgerOf(mapId, kid.id, 'build-refund'))).toEqual({
      emberwood: 3,
      timber: 1,
    });
    const lost = (await eventsOf(mapId)).find((e) => e.type === 'fence.removed')!;
    expect(parseGameEventPayload('fence.removed', lost.payload).lost).toBe('wild');
  });

  it('a leaver’s fences come down, with the take-down share back', async () => {
    const server = await start();
    const [owner, kid] = [await player(), await player()];
    const mapId = await patch(server, owner, [kid]);
    await give(mapId, kid, PLENTY);
    const [tile] = await edgeOf(mapId, kid);
    await setOwner(tile!.id, kid.id);
    const built = await call(server, 'POST', `/maps/${mapId}/fences`, kid, {
      buildingId: 'stone-wall',
      q: tile!.q,
      r: tile!.r,
      edges: [0, 1],
    });
    expect(built.statusCode, built.body).toBe(201);
    expect((await call(server, 'POST', `/maps/${mapId}/leave`, kid)).statusCode).toBe(204);
    expect(await segmentsOn(tile!.id)).toEqual([]);
    expect(sumOf(await ledgerOf(mapId, kid.id, 'build-refund'))).toEqual({ stone: 8, timber: 2 });
    const lost = (await eventsOf(mapId)).filter((e) => e.type === 'fence.removed');
    expect(lost.map((e) => parseGameEventPayload('fence.removed', e.payload).lost)).toEqual([
      'left',
      'left',
    ]);
  });
});
