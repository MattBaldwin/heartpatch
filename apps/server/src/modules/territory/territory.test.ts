import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  createBattleContent,
  GAME_DATA,
  hexKey,
  hexNeighbors,
  JoinMapResponseSchema,
  MapResponseSchema,
  MapViewSchema,
  parseGameEventPayload,
  SquishyResponseSchema,
  TERRITORY_RULES,
  TerritoryResponseSchema,
  type MapDetail,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
  type TerritoryRules,
} from '@heartpatch/shared';
import { GUARDIAN_RULES, SERVER_GAME_DATA, serverBattleData } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesService } from '../battles/service.js';
import { createTerritoryService, createTileBattlePort, defaultGuardianData } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const UUID = /^[0-9a-f-]{36}$/;
const uuid = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
};
// Noon in Denver: a whole map-local day either side to move around in.
const START = '2026-10-02T18:00:00Z';

interface Player extends PublicUser {
  token: string;
}

interface Tile {
  id: string;
  q: number;
  r: number;
  ownerUserId: string | null;
  homeSlot: number | null;
  guardianStrength: number | null;
}

describe.skipIf(!url)('territory (needs DATABASE_URL)', () => {
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
    const username = `claimer_${String((counter += 1))}`;
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
  ) {
    return server.inject({
      method,
      url: `/api/v1${path}`,
      headers: HEADERS,
      ...(who ? { cookies: { [SESSION_COOKIE]: who.token } } : {}),
      ...(payload ? { payload } : {}),
    });
  }

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;
  const battleOf = (res: LightMyRequestResponse) => BattleResponseSchema.parse(res.json()).battle;
  const territoryOf = (res: LightMyRequestResponse) =>
    TerritoryResponseSchema.parse(res.json()).territory;

  /** A patch for `owner` (and `others`, joined through invite → approve). */
  async function patch(server: FastifyInstance, owner: Player, others: Player[] = []) {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Land Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const map: MapDetail = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const join = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      expect(join.statusCode).toBe(201);
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

  async function grant(server: FastifyInstance, who: Player, mapId: string, level: number) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, { level });
    expect(res.statusCode).toBe(201);
    return SquishyResponseSchema.parse(res.json()).squishy;
  }

  const tilesOf = async (mapId: string): Promise<Tile[]> =>
    db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
  const tileAt = async (mapId: string, h: { q: number; r: number }) =>
    (await tilesOf(mapId)).find((t) => t.q === h.q && t.r === h.r)!;
  /** Hands a tile to a player (as if they'd claimed it). Our own uuids, so raw SQL is safe. */
  const setOwner = (tileId: string, userId: string | null) =>
    db.execute(
      `update tiles set owner_user_id = ${userId === null ? 'null' : `'${uuid(userId)}'`} where id = '${uuid(tileId)}'`,
    );

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
  const attacksOf = (mapId: string) =>
    db.query.tileAttacks.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.startedAt)],
    });
  const defendersOf = (mapId: string) =>
    db.query.tileDefenders.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });

  const attack = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    h: { q: number; r: number },
  ) => call(server, 'POST', `/maps/${mapId}/attacks`, who, { q: h.q, r: h.r });
  const act = (server: FastifyInstance, who: Player, b: PlayerBattle, action: PlayerBattleAction) =>
    call(server, 'POST', `/battles/${b.id}/actions`, who, { action, turn: b.view.turn });
  const forfeit = async (server: FastifyInstance, who: Player, b: PlayerBattle) => {
    const res = await act(server, who, b, { type: 'forfeit' });
    expect(res.statusCode).toBe(200);
    return battleOf(res);
  };
  const status = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/territory`, who);
    expect(res.statusCode).toBe(200);
    return territoryOf(res);
  };
  const view = async (server: FastifyInstance, who: Player, mapId: string) =>
    MapViewSchema.parse((await call(server, 'GET', `/maps/${mapId}/view`, who)).json());

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

  /** Two players on one patch, each with a squishy; `rival`'s join is past the shield. */
  async function rivals(server: FastifyInstance) {
    const kid = await player();
    const rival = await player();
    const mapId = await patch(server, kid, [rival]);
    const hero = await grant(server, kid, mapId, 40);
    const buddy = await grant(server, rival, mapId, 3);
    clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);
    // Two of the rival's tiles right next to the kid's land (as if they'd claimed them).
    const [near, near2] = await edgeOf(mapId, kid);
    await setOwner(near!.id, rival.id);
    await setOwner(near2!.id, rival.id);
    return { kid, rival, mapId, hero, buddy, near: near!, near2: near2! };
  }

  describe('claiming neutral land', () => {
    it('beats the guardians, takes the tile, and every member sees the new owner (acceptance)', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      await grant(server, kid, mapId, 40);
      const [target] = await edgeOf(mapId, kid);

      const res = await attack(server, kid, mapId, target!);
      expect(res.statusCode, res.body).toBe(201);
      const battle = battleOf(res);
      expect(battle.kind).toBe('tile');
      // The guardians are played by the engine's guardian AI; their ids say nothing.
      expect(battle.view.sides.b.controller).toEqual({ type: 'ai', policy: 'guardian' });
      expect(battle.view.sides.b.squishies.map((s) => s.id)).toEqual(
        battle.view.sides.b.squishies.map((_, i) => `guardian-${String(i + 1)}`),
      );
      // Never the seed while it runs, nor anything about guardian strength.
      expect(battle.seed).toBeNull();
      expect(res.body).not.toMatch(/guardianStrength|guardian_strength/);

      const [attackRow] = await attacksOf(mapId);
      expect(attackRow).toMatchObject({
        attackerUserId: kid.id,
        defenderUserId: null,
        battleId: battle.id,
        outcome: 'active',
        startedAt: clock,
        cooldownUntil: new Date(clock.getTime() + TERRITORY_RULES.cooldownHours * HOUR_MS),
      });
      expect((await status(server, kid, mapId)).attemptsLeft).toBe(
        TERRITORY_RULES.attemptsPerDay - 1,
      );

      const done = await playOut(server, kid, battle);
      expect(done.view.phase).toMatchObject({ type: 'over', result: { winner: 'a' } });
      expect((await tileAt(mapId, target!)).ownerUserId).toBe(kid.id);
      expect((await attacksOf(mapId))[0]).toMatchObject({ outcome: 'captured', endedAt: clock });

      // Events: started, attacked … ended, captured — in the battle's transaction.
      const events = (await eventsOf(mapId)).map((e) => e.type);
      expect(events.slice(-2)).toEqual(['battle.ended', 'tile.captured']);
      expect(events).toContain('tile.attacked');
      const captured = (await eventsOf(mapId)).at(-1)!;
      expect(parseGameEventPayload('tile.captured', captured.payload)).toMatchObject({
        userId: kid.id,
        fromUserId: null,
        q: target!.q,
        r: target!.r,
        rewardPercent: 100,
        returnedSquishyIds: [],
      });
      // The friend hears it live, with only the public fields.
      expect(publicViewFor(PUBLIC_VIEWS, captured, { userId: friend.id })).toEqual({
        userId: kid.id,
        fromUserId: null,
        q: target!.q,
        r: target!.r,
      });
      const attacked = (await eventsOf(mapId)).find((e) => e.type === 'tile.attacked')!;
      expect(publicViewFor(PUBLIC_VIEWS, attacked, { userId: friend.id })).toEqual({
        attackerUserId: kid.id,
        defenderUserId: null,
        q: target!.q,
        r: target!.r,
        cooldownUntil: attackRow!.cooldownUntil.toISOString(),
      });

      // …and when they fetch the map.
      const seen = (await view(server, friend, mapId)).tiles.find(
        (t) => t.q === target!.q && t.r === target!.r,
      )!;
      expect(seen).toMatchObject({
        ownerUserId: kid.id,
        cooldownUntil: attackRow!.cooldownUntil.toISOString(),
        defenders: 0,
      });
      expect(Object.keys(seen)).not.toContain('guardianStrength');
    });

    it('keeps a tile’s guardians for the whole window (no rerolls)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await grant(server, kid, mapId, 40);
      const [target] = await edgeOf(mapId, kid);
      const first = battleOf(await attack(server, kid, mapId, target!));
      await forfeit(server, kid, first);
      clock.setTime(clock.getTime() + TERRITORY_RULES.cooldownHours * HOUR_MS + MINUTE_MS);
      const again = battleOf(await attack(server, kid, mapId, target!));
      const team = (b: PlayerBattle) =>
        b.view.sides.b.squishies.map(({ speciesId, level }) => ({ speciesId, level }));
      expect(team(again)).toEqual(team(first));
    });

    it('refuses home bases, my own land and land too far away, using no attempt', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      await grant(server, kid, mapId, 40);
      const all = await tilesOf(mapId);
      const myHome = all.find((t) => t.ownerUserId === kid.id && t.homeSlot !== null)!;
      const friendHome = all.find((t) => t.ownerUserId === friend.id && t.homeSlot !== null)!;
      // Give the kid a tile right next to the friend's home ring.
      const besideFriend = all.find(
        (t) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          hexNeighbors(t).some((n) => n.q === friendHome.q && n.r === friendHome.r),
      )!;
      const far = all.find(
        (t) => t.ownerUserId === null && t.homeSlot === null && t.guardianStrength === 5,
      )!;

      const home = await attack(server, kid, mapId, myHome);
      expect(home.statusCode).toBe(403);
      expect(errorOf(home).message).toMatch(/Nobody can ever take one/);
      await setOwner(besideFriend.id, kid.id);
      clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);
      const theirs = await attack(server, kid, mapId, friendHome);
      expect(theirs.statusCode).toBe(403);
      expect(errorOf(theirs).message).toMatch(/Home bases are safe/);
      expect((await attack(server, kid, mapId, besideFriend)).statusCode).toBe(409);
      const tooFar = await attack(server, kid, mapId, far);
      expect(tooFar.statusCode).toBe(403);
      expect(errorOf(tooFar).message).toMatch(/too far away/);
      expect((await attack(server, kid, mapId, { q: 99, r: 99 })).statusCode).toBe(404);
      expect(await attacksOf(mapId)).toEqual([]);
      expect((await status(server, kid, mapId)).attemptsLeft).toBe(TERRITORY_RULES.attemptsPerDay);
      // Not a member: nothing to see.
      expect((await attack(server, await player(), mapId, far)).statusCode).toBe(404);
    });

    it('needs a squishy first, and uses no attempt without one', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      const [target] = await edgeOf(mapId, kid);
      const res = await attack(server, kid, mapId, target!);
      expect(res.statusCode).toBe(409);
      expect(errorOf(res).message).toMatch(/squishy friend first/);
      expect(await attacksOf(mapId)).toEqual([]);
    });
  });

  describe('raid rules (design doc §11)', () => {
    it('puts the tile on cooldown for everyone after a battle starts, win or lose', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      await grant(server, kid, mapId, 40);
      await grant(server, friend, mapId, 40);
      const [wild] = await edgeOf(mapId, kid);
      // The friend owns a tile next to it too.
      const beside = (await tilesOf(mapId)).find(
        (t) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          t.id !== wild!.id &&
          hexNeighbors(t).some((n) => n.q === wild!.q && n.r === wild!.r),
      )!;
      await setOwner(beside.id, friend.id);

      await forfeit(server, kid, battleOf(await attack(server, kid, mapId, wild!)));
      for (const who of [kid, friend]) {
        const again = await attack(server, who, mapId, wild!);
        expect(again.statusCode).toBe(409);
        expect(errorOf(again).message).toMatch(/needs a little rest/);
      }
      clock.setTime(clock.getTime() + TERRITORY_RULES.cooldownHours * HOUR_MS + MINUTE_MS);
      expect((await attack(server, friend, mapId, wild!)).statusCode).toBe(201);
    });

    it('allows the daily attempts per map-local day, then refuses until tomorrow', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await grant(server, kid, mapId, 40);
      const edge = await edgeOf(mapId, kid);
      expect(edge.length).toBeGreaterThan(TERRITORY_RULES.attemptsPerDay);
      for (const tile of edge.slice(0, TERRITORY_RULES.attemptsPerDay)) {
        await forfeit(server, kid, battleOf(await attack(server, kid, mapId, tile)));
      }
      expect((await status(server, kid, mapId)).attemptsLeft).toBe(0);
      const more = await attack(server, kid, mapId, edge[TERRITORY_RULES.attemptsPerDay]!);
      expect(more.statusCode).toBe(409);
      expect(errorOf(more).message).toMatch(/all your tries for today/);
      // 23:59 Denver is still today; one minute later is tomorrow.
      clock.setTime(Date.parse('2026-10-03T05:59:00Z'));
      expect((await attack(server, kid, mapId, edge.at(-1)!)).statusCode).toBe(409);
      clock.setTime(Date.parse('2026-10-03T06:00:00Z'));
      expect((await status(server, kid, mapId)).attemptsLeft).toBe(TERRITORY_RULES.attemptsPerDay);
      expect((await attack(server, kid, mapId, edge.at(-1)!)).statusCode).toBe(201);
    });

    it('counts leaving as a loss: a forfeit, or no action for the abandon time', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await grant(server, kid, mapId, 40);
      // Three sleepy guardians: one move can't end the battle, and they can't win it.
      const battles = createBattlesService({
        db,
        clock: () => clock,
        tileBattles: createTileBattlePort(),
      });
      const territory = createTerritoryService({
        db,
        clock: () => clock,
        battles,
        guardians: {
          ...defaultGuardianData(),
          rules: {
            ...GUARDIAN_RULES,
            strengths: [{ strength: 1, count: 3, levels: { min: 1, max: 1 } }],
          },
        },
      });
      const [one, two] = await edgeOf(mapId, kid);

      const ran = await forfeit(server, kid, battleOf(await attack(server, kid, mapId, one!)));
      expect(ran.view.phase).toMatchObject({ result: { winner: 'b', reason: 'forfeit' } });
      expect((await tileAt(mapId, one!)).ownerUserId).toBeNull();

      const { battle: left } = await territory.attack(kid, mapId, two!);
      // Acting keeps it going: the abandon time starts again.
      clock.setTime(clock.getTime() + (TERRITORY_RULES.abandonMinutes - 1) * MINUTE_MS);
      const side = left.view.sides.a;
      const going = await battles.act(kid, left.id, {
        action: { type: 'move', move: side.squishies[side.active]!.moves[0]! },
        turn: left.view.turn,
      });
      expect(going.status).toBe('active');
      expect((await attacksOf(mapId))[1]).toMatchObject({ lastActionAt: clock });
      clock.setTime(clock.getTime() + (TERRITORY_RULES.abandonMinutes - 1) * MINUTE_MS);
      expect((await battles.get(kid, left.id)).status).toBe('active');

      // Nothing for longer than the abandon time: a loss, noticed on the next look.
      clock.setTime(clock.getTime() + 2 * MINUTE_MS);
      const ended = battleOf(await call(server, 'GET', `/battles/${left.id}`, kid));
      expect(ended.status).toBe('finished');
      expect(ended.view.phase).toMatchObject({ result: { winner: 'b', reason: 'forfeit' } });
      expect(ended.seed).not.toBeNull();
      // A late tap can't bring it back.
      expect((await act(server, kid, going, { type: 'forfeit' })).statusCode).toBe(409);
      expect((await attacksOf(mapId)).map((a) => a.outcome)).toEqual(['lost', 'lost']);
      expect((await tileAt(mapId, two!)).ownerUserId).toBeNull();
      expect((await status(server, kid, mapId)).attemptsLeft).toBe(
        TERRITORY_RULES.attemptsPerDay - 2,
      );
    });

    it('ends a left battle when the player starts another, so they are never stuck', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await grant(server, kid, mapId, 40);
      const [one, two] = await edgeOf(mapId, kid);
      const left = battleOf(await attack(server, kid, mapId, one!));
      // Within the abandon time, attacking again resumes the battle going.
      const resumed = await attack(server, kid, mapId, two!);
      expect(resumed.statusCode).toBe(200);
      expect(battleOf(resumed).id).toBe(left.id);
      clock.setTime(clock.getTime() + (TERRITORY_RULES.abandonMinutes + 1) * MINUTE_MS);
      const next = await attack(server, kid, mapId, two!);
      expect(next.statusCode).toBe(201);
      expect((await attacksOf(mapId)).map((a) => a.outcome)).toEqual(['lost', 'active']);
    });

    it('refunds the attempt when the server calls a tile battle off (no contest)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await grant(server, kid, mapId, 40);
      const [target] = await edgeOf(mapId, kid);
      const battle = battleOf(await attack(server, kid, mapId, target!));
      expect((await status(server, kid, mapId)).attemptsLeft).toBe(
        TERRITORY_RULES.attemptsPerDay - 1,
      );
      // The content is re-tuned mid-battle.
      const retuned = createBattlesService({
        db,
        clock: () => clock,
        content: createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA), {
          ...BATTLE_RULES,
          maxTurns: BATTLE_RULES.maxTurns + 1,
        }),
        tileBattles: createTileBattlePort(),
      });
      expect((await retuned.get(kid, battle.id)).status).toBe('no-contest');
      expect((await attacksOf(mapId))[0]).toMatchObject({ outcome: 'no-contest' });
      expect((await status(server, kid, mapId)).attemptsLeft).toBe(TERRITORY_RULES.attemptsPerDay);
      expect((await tileAt(mapId, target!)).ownerUserId).toBeNull();
    });

    it('uses the rules it is given (tests can shrink them)', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await patch(server, kid);
      await grant(server, kid, mapId, 40);
      const rules: TerritoryRules = { ...TERRITORY_RULES, attemptsPerDay: 1 };
      const battles = createBattlesService({
        db,
        clock: () => clock,
        tileBattles: createTileBattlePort(rules),
      });
      const territory = createTerritoryService({ db, clock: () => clock, battles, rules });
      const [one, two] = await edgeOf(mapId, kid);
      const first = await territory.attack(kid, mapId, one!);
      await battles.act(kid, first.battle.id, { action: { type: 'forfeit' }, turn: 0 });
      await expect(territory.attack(kid, mapId, two!)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect((await territory.status(kid, mapId)).attemptsLeft).toBe(0);
    });
  });

  describe('challenging another player', () => {
    it('battles the squishies on watch, sends them home on a capture, and caps Gentle losses at one a day', async () => {
      const server = await start();
      const { kid, rival, mapId, buddy, near, near2 } = await rivals(server);
      const watch = await call(server, 'POST', `/maps/${mapId}/defenders`, rival, {
        q: near.q,
        r: near.r,
        squishyIds: [buddy.id],
      });
      expect(watch.statusCode, watch.body).toBe(200);
      expect(territoryOf(watch).defenders).toEqual([
        { q: near.q, r: near.r, squishyIds: [buddy.id] },
      ]);
      // The picker can name the rival's own (secret) squishy; nothing else secret comes along.
      expect(territoryOf(watch).speciesDefs.map((s) => s.id)).toEqual([buddy.speciesId]);

      const res = await attack(server, kid, mapId, near);
      expect(res.statusCode, res.body).toBe(201);
      const battle = battleOf(res);
      expect(battle.kind).toBe('rival-tile');
      // Phase 1: the engine's opponent AI plays the squishies on watch (#16 adds stances).
      expect(battle.view.sides.b.controller).toEqual({ type: 'ai', policy: 'balanced' });
      expect(battle.view.sides.b.squishies.map((s) => s.id)).toEqual([buddy.id]);
      expect((await attacksOf(mapId))[0]).toMatchObject({ defenderUserId: rival.id });

      await playOut(server, kid, battle);
      expect((await tileAt(mapId, near)).ownerUserId).toBe(kid.id);
      // Gone home, never lost.
      expect(await defendersOf(mapId)).toEqual([]);
      const squishy = await db.query.squishies.findFirst({
        where: (t, { eq }) => eq(t.id, buddy.id),
      });
      expect(squishy).toMatchObject({ ownerUserId: rival.id, state: 'active' });
      const captured = (await eventsOf(mapId)).at(-1)!;
      expect(captured.type).toBe('tile.captured');
      expect(parseGameEventPayload('tile.captured', captured.payload)).toMatchObject({
        kind: 'rival-tile',
        fromUserId: rival.id,
        returnedSquishyIds: [buddy.id],
      });

      // Gentle (the default): one lost tile a day per player. Refused, no attempt used.
      const left = (await status(server, kid, mapId)).attemptsLeft;
      const capped = await attack(server, kid, mapId, near2);
      expect(capped.statusCode).toBe(409);
      expect(errorOf(capped).message).toMatch(/enough fun for today/);
      expect((await status(server, kid, mapId)).attemptsLeft).toBe(left);

      // On: up to three a day.
      const mode = await call(server, 'POST', `/maps/${mapId}/pvp-mode`, kid, { pvpMode: 'on' });
      expect(mode.statusCode).toBe(200);
      expect((await attack(server, kid, mapId, near2)).statusCode).toBe(201);
    });

    it('counts a challenge still going toward the daily loss cap', async () => {
      const server = await start();
      const { kid, mapId, near, near2 } = await rivals(server);
      const other = await player();
      // A third player next to the rival's land too.
      const res = await call(server, 'GET', `/maps/${mapId}`, kid);
      const code = MapResponseSchema.parse(res.json()).map.admin!.invite!.code;
      const join = await call(server, 'POST', '/maps/join', other, { code });
      const request = JoinMapResponseSchema.parse(join.json()).request;
      await call(server, 'POST', `/maps/${mapId}/requests/${request.id}/approve`, kid);
      await grant(server, other, mapId, 40);
      const all = await tilesOf(mapId);
      const nextToNear2 = all.find(
        (t) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          hexNeighbors(t).some((n) => n.q === near2.q && n.r === near2.r),
      )!;
      await setOwner(nextToNear2.id, other.id);
      // The kid's challenge is going, so the rival's one loss for today is spoken for.
      expect((await attack(server, kid, mapId, near)).statusCode).toBe(201);
      const second = await attack(server, other, mapId, near2);
      expect(second.statusCode).toBe(409);
      expect(errorOf(second).message).toMatch(/enough fun for today/);
    });

    it('protects new players for the shield time, and blocks challenges when PvP is Off', async () => {
      const server = await start();
      const kid = await player();
      const rival = await player();
      const mapId = await patch(server, kid, [rival]);
      await grant(server, kid, mapId, 40);
      const [near] = await edgeOf(mapId, kid);
      await setOwner(near!.id, rival.id);

      const shielded = await attack(server, kid, mapId, near!);
      expect(shielded.statusCode).toBe(403);
      expect(errorOf(shielded).message).toMatch(/new here/);
      expect((await status(server, rival, mapId)).shieldUntil).toBe(
        new Date(clock.getTime() + TERRITORY_RULES.newPlayerShieldHours * HOUR_MS).toISOString(),
      );

      clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);
      expect((await status(server, rival, mapId)).shieldUntil).toBeNull();
      await call(server, 'POST', `/maps/${mapId}/pvp-mode`, kid, { pvpMode: 'off' });
      const off = await attack(server, kid, mapId, near!);
      expect(off.statusCode).toBe(403);
      expect(errorOf(off).message).toMatch(/Challenges are off/);
      // Wild land is still fair game.
      const [wild] = await edgeOf(mapId, kid);
      expect((await attack(server, kid, mapId, wild!)).statusCode).toBe(201);
      expect(await attacksOf(mapId)).toHaveLength(1);
    });

    it('earns half the capture rewards for picking on a much smaller player under Gentle', async () => {
      const server = await start();
      const { kid, mapId, near } = await rivals(server);
      // The kid has lots of land; the rival only the two tiles from `rivals`.
      const extra = (await edgeOf(mapId, kid)).slice(0, 6);
      for (const tile of extra) await setOwner(tile.id, kid.id);
      await playOut(server, kid, battleOf(await attack(server, kid, mapId, near)));
      const captured = (await eventsOf(mapId)).at(-1)!;
      expect(parseGameEventPayload('tile.captured', captured.payload).rewardPercent).toBe(
        TERRITORY_RULES.gentle.rewardPercent,
      );
    });

    it('fights the land’s own guardians when nobody stands watch', async () => {
      const server = await start();
      const { kid, mapId, near } = await rivals(server);
      const battle = battleOf(await attack(server, kid, mapId, near));
      expect(battle.kind).toBe('rival-tile');
      expect(battle.view.sides.b.controller).toEqual({ type: 'ai', policy: 'guardian' });
    });
  });

  describe('standing watch', () => {
    it('puts up to the max on a tile, moves a squishy between tiles, and shows only the count', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      const squishies = [];
      for (let i = 0; i < TERRITORY_RULES.maxDefenders + 1; i++) {
        squishies.push(await grant(server, kid, mapId, 3));
      }
      const [a, b] = await edgeOf(mapId, kid);
      await setOwner(a!.id, kid.id);
      await setOwner(b!.id, kid.id);
      const ids = squishies.map((s) => s.id);

      const tooMany = await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: a!.q,
        r: a!.r,
        squishyIds: ids,
      });
      expect(tooMany.statusCode).toBe(400);

      const set = await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: a!.q,
        r: a!.r,
        squishyIds: ids.slice(0, 3),
      });
      expect(set.statusCode).toBe(200);
      const moved = await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: b!.q,
        r: b!.r,
        squishyIds: [ids[0]!],
      });
      expect(territoryOf(moved).defenders).toEqual([
        { q: a!.q, r: a!.r, squishyIds: ids.slice(1, 3) },
        { q: b!.q, r: b!.r, squishyIds: [ids[0]!] },
      ]);
      const tileA = (await view(server, friend, mapId)).tiles.find(
        (t) => t.q === a!.q && t.r === a!.r,
      )!;
      expect(tileA.defenders).toBe(2);

      const changed = (await eventsOf(mapId)).filter((e) => e.type === 'defenders.changed');
      expect(changed).toHaveLength(2);
      expect(publicViewFor(PUBLIC_VIEWS, changed[0]!, { userId: friend.id })).toEqual({
        userId: kid.id,
        q: a!.q,
        r: a!.r,
        count: 3,
      });

      // The same again changes nothing and writes no event.
      await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: b!.q,
        r: b!.r,
        squishyIds: [ids[0]!],
      });
      expect((await eventsOf(mapId)).filter((e) => e.type === 'defenders.changed')).toHaveLength(2);
      // An empty list sends them home.
      const home = await call(server, 'POST', `/maps/${mapId}/defenders`, kid, {
        q: b!.q,
        r: b!.r,
        squishyIds: [],
      });
      expect(territoryOf(home).defenders).toHaveLength(1);
    });

    it('only guards your own land outside your home, with your own squishies', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      const mine = await grant(server, kid, mapId, 3);
      const theirs = await grant(server, friend, mapId, 3);
      const all = await tilesOf(mapId);
      const myHome = all.find((t) => t.ownerUserId === kid.id && t.homeSlot !== null)!;
      const [land] = await edgeOf(mapId, kid);
      const post = (h: { q: number; r: number }, squishyIds: string[]) =>
        call(server, 'POST', `/maps/${mapId}/defenders`, kid, { q: h.q, r: h.r, squishyIds });

      expect((await post(land!, [mine.id])).statusCode).toBe(403);
      await setOwner(land!.id, kid.id);
      const home = await post(myHome, [mine.id]);
      expect(home.statusCode).toBe(403);
      expect(errorOf(home).message).toMatch(/Home bases are safe already/);
      expect((await post(land!, [theirs.id])).statusCode).toBe(403);
      expect((await post(land!, [mine.id, mine.id])).statusCode).toBe(400);
      expect((await post(land!, [mine.id])).statusCode).toBe(200);
    });

    it('sends squishies on watch home when their owner leaves the map', async () => {
      const server = await start();
      const kid = await player();
      const friend = await player();
      const mapId = await patch(server, kid, [friend]);
      const squishy = await grant(server, friend, mapId, 3);
      const [land] = await edgeOf(mapId, friend);
      await setOwner(land!.id, friend.id);
      await call(server, 'POST', `/maps/${mapId}/defenders`, friend, {
        q: land!.q,
        r: land!.r,
        squishyIds: [squishy.id],
      });
      expect(await defendersOf(mapId)).toHaveLength(1);
      expect((await call(server, 'POST', `/maps/${mapId}/leave`, friend)).statusCode).toBe(204);
      expect(await defendersOf(mapId)).toEqual([]);
    });
  });
});
