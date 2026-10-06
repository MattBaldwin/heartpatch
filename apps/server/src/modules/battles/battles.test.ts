import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  CARE_RULES,
  contentmentAt,
  createBattleContent,
  CurrentBattleResponseSchema,
  GAME_DATA,
  grantedXp,
  GROWTH_RULES,
  heartSeedOf,
  MAP_GEN,
  MapResponseSchema,
  replayBattle,
  SquishyResponseSchema,
  TUTORIAL_OVERRIDES,
  TutorialResponseSchema,
  xpForLevel,
  xpMultiplier,
  type PlayerBattle,
  type PlayerBattleAction,
} from '@heartpatch/shared';
import { SERVER_GAME_DATA, serverBattleData } from '@heartpatch/shared/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { KEY_TTL_MS } from '../../lib/idempotency.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createBattlesRepo } from './repo.js';
import { createBattlesService, defaultBattleContent, playerBattleView } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };

interface Player {
  id: string;
  username: string;
  token: string;
}

/** A secret line's first and grown forms: two secret squishies the client has never met. */
const SECRET_LINE = SERVER_GAME_DATA.secretEvolutions.find((e) =>
  SERVER_GAME_DATA.secretSpecies.some((s) => s.id === e.from),
)!;
const SECRET = [SECRET_LINE.from, SECRET_LINE.into].map((id) =>
  SERVER_GAME_DATA.secretSpecies.find((s) => s.id === id)!,
);
const SECRET_IDS = SECRET.map((s) => s.id);

/** XP a brand-new squishy (start contentment, no habitat) gets for `base`. */
const newSquishyXp = (base: number) =>
  grantedXp(
    base,
    xpMultiplier(
      CARE_RULES.startContentment,
      null,
      { element: 'light', feeling: 'cozy' },
      GROWTH_RULES,
    ),
  );

describe.skipIf(!url)('battles (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date('2026-10-02T12:00:00Z');
  let counter = 0;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse('2026-10-02T12:00:00Z'));
  });

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

  async function player(): Promise<Player> {
    const username = `battler_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    // Every player has picked a Keeper (the map gate, #42; keepers.test.ts covers it).
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
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

  const errorOf = (res: LightMyRequestResponse) => ApiErrorSchema.parse(res.json()).error;
  const battleOf = (res: LightMyRequestResponse) => BattleResponseSchema.parse(res.json()).battle;

  async function newMap(server: FastifyInstance, who: Player): Promise<string> {
    const res = await call(server, 'POST', '/maps', who, {
      name: 'Battle Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode).toBe(201);
    return MapResponseSchema.parse(res.json()).map.id;
  }

  async function grant(server: FastifyInstance, who: Player, mapId: string, body: object = {}) {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, body);
    expect(res.statusCode).toBe(201);
    return SquishyResponseSchema.parse(res.json()).squishy;
  }

  async function pickFight(
    server: FastifyInstance,
    who: Player,
    mapId: string,
    body: object = {},
  ): Promise<PlayerBattle> {
    const res = await call(server, 'POST', `/maps/${mapId}/dev/battles`, who, body);
    expect(res.statusCode).toBe(201);
    return battleOf(res);
  }

  function act(
    server: FastifyInstance,
    who: Player,
    battle: PlayerBattle,
    action: PlayerBattleAction,
    headers: Record<string, string> = {},
  ) {
    return call(
      server,
      'POST',
      `/battles/${battle.id}/actions`,
      who,
      { action, turn: battle.view.turn },
      headers,
    );
  }

  const myActive = (battle: PlayerBattle) => {
    const side = battle.view.sides[battle.mySide];
    return side.squishies[side.active]!;
  };

  /** Plays the player's first move every turn until the battle ends. */
  async function playOut(server: FastifyInstance, who: Player, battle: PlayerBattle) {
    let current = battle;
    for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && current.status === 'active'; i++) {
      const phase = current.view.phase;
      const action: PlayerBattleAction =
        phase.type === 'replace'
          ? { type: 'replace', slot: 1 }
          : { type: 'move', move: myActive(current).moves[0]! };
      const res = await act(server, who, current, action);
      expect(res.statusCode).toBe(200);
      current = battleOf(res);
    }
    expect(current.status).toBe('finished');
    return current;
  }

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  const rowOf = (battleId: string) =>
    db.query.battles.findFirst({ where: (t, { eq }) => eq(t.id, battleId) });

  const squishyOf = (id: string) =>
    db.query.squishies.findFirst({ where: (t, { eq }) => eq(t.id, id) });

  it('has secret species to battle with (public roster arrives with #10)', () => {
    expect(SECRET.length).toBeGreaterThan(0);
    expect(GAME_DATA.species.map((s) => s.id)).not.toContain(SECRET_IDS[0]);
  });

  describe('access', () => {
    it('needs a logged-in player', async () => {
      const server = await start();
      const id = '00000000-0000-7000-8000-000000000000';
      // Bodies are valid: Fastify checks the body before the auth preHandler runs.
      for (const [method, path, body] of [
        ['GET', `/maps/${id}/battles/current`, undefined],
        ['POST', `/maps/${id}/battles`, undefined],
        ['GET', `/battles/${id}`, undefined],
        ['POST', `/battles/${id}/actions`, { action: { type: 'forfeit' }, turn: 0 }],
        ['POST', `/maps/${id}/dev/squishies`, {}],
        ['POST', `/maps/${id}/dev/battles`, {}],
      ] as const) {
        const res = await call(server, method, path, null, body);
        expect(res.statusCode, path).toBe(401);
        expect(errorOf(res).code).toBe('UNAUTHENTICATED');
      }
    });

    it("hides other players' patches and battles (NOT_FOUND)", async () => {
      const server = await start();
      const [owner, stranger] = [await player(), await player()];
      const mapId = await newMap(server, owner);
      await grant(server, owner, mapId);
      const battle = await pickFight(server, owner, mapId);
      for (const [method, path, body] of [
        ['GET', `/maps/${mapId}/battles/current`, undefined],
        ['POST', `/maps/${mapId}/battles`, undefined],
        ['GET', `/battles/${battle.id}`, undefined],
        ['POST', `/battles/${battle.id}/actions`, { action: { type: 'forfeit' }, turn: 0 }],
        ['POST', `/maps/${mapId}/dev/squishies`, {}],
        ['POST', `/maps/${mapId}/dev/battles`, {}],
      ] as const) {
        const res = await call(server, method, path, stranger, body);
        expect(res.statusCode, path).toBe(404);
        expect(errorOf(res).code).toBe('NOT_FOUND');
      }
    });

    it('stops a player who left the patch from playing on', async () => {
      const server = await start();
      const [owner, friend] = [await player(), await player()];
      const mapId = await newMap(server, owner);
      // The friend joins through the real flow, so the owner can remove them.
      const detail = () =>
        call(server, 'GET', `/maps/${mapId}`, owner).then(
          (res) => MapResponseSchema.parse(res.json()).map,
        );
      const code = (await detail()).admin!.invite!.code;
      expect((await call(server, 'POST', '/maps/join', friend, { code })).statusCode).toBe(201);
      const requestId = (await detail()).admin!.requests[0]!.id;
      const approve = `/maps/${mapId}/requests/${requestId}/approve`;
      expect((await call(server, 'POST', approve, owner)).statusCode).toBe(204);
      await grant(server, friend, mapId);
      const battle = await pickFight(server, friend, mapId);

      const remove = `/maps/${mapId}/members/${friend.id}/remove`;
      expect((await call(server, 'POST', remove, owner)).statusCode).toBe(204);
      expect((await call(server, 'GET', `/battles/${battle.id}`, friend)).statusCode).toBe(404);
      expect((await act(server, friend, battle, { type: 'forfeit' })).statusCode).toBe(404);
    });

    it('registers the dev routes only with HP_DEV_SQUISHY_GRANTS', async () => {
      const server = await start({ HP_DEV_SQUISHY_GRANTS: 'false' });
      const kid = await player();
      const mapId = await newMap(server, kid);
      const res = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {});
      expect(res.statusCode).toBe(404);
    });
  });

  describe('starting', () => {
    it('needs a squishy', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      expect(
        CurrentBattleResponseSchema.parse(
          (await call(server, 'GET', `/maps/${mapId}/battles/current`, kid)).json(),
        ).battle,
      ).toBeNull();

      const noTeam = await call(server, 'POST', `/maps/${mapId}/dev/battles`, kid, {});
      expect(noTeam.statusCode).toBe(409);
      expect(errorOf(noTeam).message).toBe('You need a squishy friend first!');
      // Wild spawns (#14) are covered in modules/spawns/spawns.test.ts.
    });

    it('hands out a squishy (dev) and starts a battle the client can draw', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const squishy = await grant(server, kid, mapId, { speciesId: SECRET_IDS[1], level: 8 });
      expect(squishy).toMatchObject({
        mapId,
        ownerUserId: kid.id,
        speciesId: SECRET_IDS[1],
        level: 8,
        xp: 0,
        state: 'active',
      });
      const unknown = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, kid, {
        speciesId: 'nope-not-a-squishy',
      });
      expect(unknown.statusCode).toBe(400);

      const battle = await pickFight(server, kid, mapId, {
        opponent: { speciesId: SECRET_IDS[0], level: 5 },
      });
      expect(battle).toMatchObject({
        mapId,
        kind: 'wild',
        status: 'active',
        mySide: 'a',
        seed: null,
        endedAt: null,
      });
      expect(battle.view).toMatchObject({ version: 1, turn: 0, phase: { type: 'turn' } });
      expect(battle.view).not.toHaveProperty('rng');
      expect(JSON.stringify(battle)).not.toContain('"rng"');
      expect(battle.view.sides.a.controller).toEqual({ type: 'player' });
      expect(battle.view.sides.b.controller).toEqual({ type: 'ai', policy: 'wild' });
      expect(battle.view.sides.a.squishies).toEqual([
        expect.objectContaining({ id: squishy.id, speciesId: SECRET_IDS[1], level: 8 }),
      ]);
      expect(battle.view.sides.b.squishies).toEqual([
        expect.objectContaining({ speciesId: SECRET_IDS[0], level: 5, joined: true }),
      ]);
      // Secret species the client has never seen come along, with their moves.
      const inBattle = SECRET.slice(0, 2);
      expect(battle.speciesDefs.map((s) => s.id).sort()).toEqual(inBattle.map((s) => s.id).sort());
      const theirMoves = new Set(inBattle.flatMap((s) => s.moves));
      expect(battle.moveDefs.map((m) => m.id).sort()).toEqual(
        SERVER_GAME_DATA.secretMoves
          .filter((m) => theirMoves.has(m.id))
          .map((m) => m.id)
          .sort(),
      );

      const events = await eventsOf(mapId);
      expect(events.at(-1)).toMatchObject({
        type: 'battle.started',
        actorUserId: kid.id,
        payload: {
          battleId: battle.id,
          kind: 'wild',
          userId: kid.id,
          teamSpecies: [SECRET_IDS[1]],
          opponentSpecies: [SECRET_IDS[0]],
        },
      });
      const row = await rowOf(battle.id);
      expect(row).toMatchObject({
        status: 'active',
        playerUserId: kid.id,
        result: null,
        log: null,
      });
      expect(row!.seed).toMatch(/^[A-Za-z0-9_-]{22}$/);

      // Live sync tells the other members only who's battling, never the
      // species: a secret squishy stays secret until they meet it (rule 6).
      const view = publicViewFor(PUBLIC_VIEWS, events.at(-1)!, { userId: 'someone-else' });
      expect(view).toEqual({ battleId: battle.id, kind: 'wild', userId: kid.id });
      for (const id of SECRET_IDS) expect(JSON.stringify(view)).not.toContain(id);
    });

    it('resumes the battle already going instead of starting another', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await grant(server, kid, mapId);
      const battle = await pickFight(server, kid, mapId);

      const again = await call(server, 'POST', `/maps/${mapId}/dev/battles`, kid, {});
      expect(again.statusCode).toBe(200);
      expect(battleOf(again).id).toBe(battle.id);
      const wild = await call(server, 'POST', `/maps/${mapId}/battles`, kid);
      expect(wild.statusCode).toBe(200);
      expect(battleOf(wild).id).toBe(battle.id);

      const current = await call(server, 'GET', `/maps/${mapId}/battles/current`, kid);
      expect(CurrentBattleResponseSchema.parse(current.json()).battle?.id).toBe(battle.id);
      const got = await call(server, 'GET', `/battles/${battle.id}`, kid);
      expect(battleOf(got)).toEqual(battle);
    });

    it('scripts the opponent on a tutorial map (tutorialOverrides)', async () => {
      const server = await start();
      const kid = await player();
      const started = await call(server, 'POST', '/tutorial/start', kid);
      const mapId = TutorialResponseSchema.parse(started.json()).tutorial.mapId!;
      await grant(server, kid, mapId);
      const battle = await pickFight(server, kid, mapId, { opponent: { level: 50 } });
      expect(battle.view.sides.b.controller).toEqual({
        type: 'ai',
        policy: TUTORIAL_OVERRIDES.opponent.ai,
      });
      expect(battle.view.sides.b.squishies[0]!.level).toBe(TUTORIAL_OVERRIDES.opponent.level);
    });
  });

  describe('actions (the client cannot forge outcomes)', () => {
    it('refuses moves the squishy lacks, stale turns and out-of-phase actions', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      // The same secret squishy on both sides, so one move can't end the battle before the stale submit.
      await grant(server, kid, mapId, { speciesId: SECRET_IDS[0], level: 10 });
      const battle = await pickFight(server, kid, mapId, {
        opponent: { speciesId: SECRET_IDS[0] },
      });

      const unknown = await act(server, kid, battle, { type: 'move', move: 'mega-blast' });
      expect(unknown.statusCode).toBe(409);
      expect(errorOf(unknown).message).toMatch(/not a move you can make/);
      // Only one squishy: nothing to swap to, nobody to replace.
      expect((await act(server, kid, battle, { type: 'swap', slot: 1 })).statusCode).toBe(409);
      expect((await act(server, kid, battle, { type: 'replace', slot: 1 })).statusCode).toBe(409);
      // A client naming a side, or sending the engine's own action shape, fails validation.
      const forged = await call(server, 'POST', `/battles/${battle.id}/actions`, kid, {
        action: { type: 'turn', choices: { b: { type: 'move', move: 'x' } } },
        turn: 0,
      });
      expect(forged.statusCode).toBe(400);
      expect(errorOf(forged).code).toBe('VALIDATION_FAILED');
      // A sure capture is the server's call (tutorial maps), never the client's.
      const sure = await call(server, 'POST', `/battles/${battle.id}/actions`, kid, {
        action: { type: 'capture', sure: true },
        turn: 0,
      });
      expect(sure.statusCode).toBe(400);
      expect(errorOf(sure).code).toBe('VALIDATION_FAILED');

      const move = myActive(battle).moves[0]!;
      const first = await act(server, kid, battle, { type: 'move', move });
      expect(first.statusCode).toBe(200);
      const after = battleOf(first);
      expect(after.view.turn).toBe(1);
      // The same submit again (turn 0) is stale: the battle has moved on.
      const stale = await act(server, kid, battle, { type: 'move', move });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale).message).toMatch(/moved on/);
      expect(battleOf(await call(server, 'GET', `/battles/${battle.id}`, kid)).view.turn).toBe(1);
      // Nothing about the roll leaks: the log has numbers the server chose, no RNG.
      expect(JSON.stringify(after)).not.toContain('"rng"');
      expect(after.seed).toBeNull();
    });

    it('replays a retried submit from its Idempotency-Key instead of applying it twice', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await grant(server, kid, mapId, { level: 10 });
      const battle = await pickFight(server, kid, mapId);
      const move = myActive(battle).moves[0]!;
      const key = { 'idempotency-key': 'tap-1' };

      const first = await act(server, kid, battle, { type: 'move', move }, key);
      expect(first.statusCode).toBe(200);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      const retry = await act(server, kid, battle, { type: 'move', move }, key);
      expect(retry.statusCode).toBe(200);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(first.json());
      expect((await rowOf(battle.id))!.actions).toHaveLength(1);

      // The same key with a different body is refused; errors replay too.
      const reused = await act(server, kid, battle, { type: 'forfeit' }, key);
      expect(reused.statusCode).toBe(409);
      expect(errorOf(reused).message).toMatch(/already used/);
      const stale = await act(
        server,
        kid,
        battle,
        { type: 'move', move },
        {
          'idempotency-key': 'tap-2',
        },
      );
      expect(stale.statusCode).toBe(409);
      const staleAgain = await act(
        server,
        kid,
        battle,
        { type: 'move', move },
        {
          'idempotency-key': 'tap-2',
        },
      );
      expect(staleAgain.statusCode).toBe(409);
      expect(staleAgain.headers['idempotent-replayed']).toBe('true');
      // A stored reply expires after KEY_TTL_MS: the key is new again.
      clock.setTime(clock.getTime() + KEY_TTL_MS + 1);
      const expired = await act(server, kid, battle, { type: 'move', move }, key);
      expect(expired.statusCode).toBe(409); // ran again: that turn is stale now
      expect(expired.headers['idempotent-replayed']).toBeUndefined();
      clock.setTime(Date.parse('2026-10-02T12:00:00Z'));
      // Keys are per player: another player's key doesn't collide.
      const other = await player();
      const otherMap = await newMap(server, other);
      await grant(server, other, otherMap);
      const otherBattle = await pickFight(server, other, otherMap);
      const theirs = await act(server, other, otherBattle, { type: 'forfeit' }, key);
      expect(theirs.statusCode).toBe(200);
      expect(theirs.headers['idempotent-replayed']).toBeUndefined();
    });

    it('running away ends the battle, reveals the seed and earns nothing', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const squishy = await grant(server, kid, mapId);
      const battle = await pickFight(server, kid, mapId);
      const res = await act(server, kid, battle, { type: 'forfeit' });
      expect(res.statusCode).toBe(200);
      const over = battleOf(res);
      expect(over.status).toBe('finished');
      expect(over.endedAt).toBe(clock.toISOString());
      expect(over.view.phase).toMatchObject({
        type: 'over',
        result: { winner: 'b', reason: 'forfeit', turns: 0 },
      });
      const row = await rowOf(battle.id);
      expect(over.seed).toBe(row!.seed);
      expect(row).toMatchObject({ status: 'finished', endedAt: clock });
      expect((await squishyOf(squishy.id))!.xp).toBe(0);
      expect((await eventsOf(mapId)).at(-1)).toMatchObject({
        type: 'battle.ended',
        payload: { battleId: battle.id, winner: 'b', reason: 'forfeit', turns: 0, xp: [] },
      });
      // Over means over.
      const more = await act(server, kid, over, { type: 'forfeit' });
      expect(more.statusCode).toBe(409);
      expect(errorOf(more).message).toBe('That battle is already over.');
    });

    it('plays a whole battle, grants XP, and stores a record that replays exactly', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const squishy = await grant(server, kid, mapId, { speciesId: SECRET_IDS[1], level: 20 });
      const battle = await pickFight(server, kid, mapId, {
        opponent: { speciesId: SECRET_IDS[0], level: 3 },
      });
      const over = await playOut(server, kid, battle);
      expect(over.view.phase.type).toBe('over');
      if (over.view.phase.type !== 'over') return;
      const { result } = over.view.phase;
      expect(result.winner).toBe('a');
      expect(result.reason).toBe('tuckered-out');
      expect(over.view.sides.b.squishies[0]!.energy).toBe(0);
      expect(over.view.log.filter((e) => e.type === 'hit').length).toBeGreaterThan(0);
      expect(over.view.log.at(-1)).toMatchObject({ type: 'battle-end', winner: 'a' });

      const award = result.xp.find((x) => x.squishyId === squishy.id)!;
      expect(award.xp).toBeGreaterThan(0);
      // New (start contentment, the clock hasn't moved), no habitat: the base XP
      // × that care bonus (design doc §7), counted from the start of its level
      // (#19 `applyXp`).
      expect((await squishyOf(squishy.id))!.xp).toBe(
        xpForLevel(20, GROWTH_RULES) + newSquishyXp(award.xp),
      );
      expect((await eventsOf(mapId)).at(-1)).toMatchObject({
        type: 'battle.ended',
        actorUserId: kid.id,
        payload: {
          battleId: battle.id,
          winner: 'a',
          reason: 'tuckered-out',
          turns: result.turns,
          xp: [{ squishyId: squishy.id, xp: newSquishyXp(award.xp) }],
        },
      });

      // The stored record: seed + setup + actions replays to the stored state.
      const row = (await rowOf(battle.id))!;
      const content = createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA));
      expect(row.contentHash).toBe(content.contentHash);
      const replayed = replayBattle(
        content,
        { seed: row.seed, sides: row.setup as never },
        row.actions as never,
      );
      expect(replayed).toEqual(row.state);
      expect(row.result).toEqual(result);
      expect(row.log).toEqual(over.view.log);
      expect(over.seed).toBe(row.seed);
    });
  });

  describe('daily XP falloff (owner decision 2026-10-06)', () => {
    const falloff = GROWTH_RULES.battleXpFalloff!;

    /** One dev battle against `opponent`; the XP each squishy was paid and the engine's base. */
    async function fight(
      server: FastifyInstance,
      who: Player,
      mapId: string,
      opponent: { speciesId: string; level: number },
    ) {
      const battle = await pickFight(server, who, mapId, { opponent });
      const over = await playOut(server, who, battle);
      if (over.view.phase.type !== 'over') throw new Error('not over');
      const { result } = over.view.phase;
      const row = (await rowOf(battle.id))!;
      const paid = new Map(
        (row.rewards as { xp: { squishyId: string; xp: number }[] }).xp.map((x) => [
          x.squishyId,
          x.xp,
        ]),
      );
      const base = new Map(result.xp.map((x) => [x.squishyId, x.xp]));
      return { winner: result.winner, paid, base };
    }
    /**
     * XP a squishy granted at `GRANTED` (no care since, no habitat) gets for
     * `base` now: contentment slides down as the test clock moves on.
     */
    const GRANTED = new Date('2026-10-02T12:00:00Z');
    const paidNow = (base: number) =>
      grantedXp(
        base,
        xpMultiplier(
          contentmentAt(
            { contentment: CARE_RULES.startContentment, lastCaredAt: GRANTED },
            clock,
            CARE_RULES,
          ),
          null,
          { element: 'light', feeling: 'cozy' },
          GROWTH_RULES,
        ),
      );
    const full = (base: number) => paidNow(base);
    const share = (base: number) => paidNow(Math.floor((base * falloff.afterPercent) / 100));
    const weak = { speciesId: SECRET_IDS[0]!, level: 3 };

    it('counts only wins a squishy came out for, and starts again at map-local midnight', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const lead = await grant(server, kid, mapId, { speciesId: SECRET_IDS[1], level: 20 });
      const bench = await grant(server, kid, mapId, { speciesId: SECRET_IDS[1], level: 20 });
      const team = (ids: string[]) =>
        call(server, 'POST', `/maps/${mapId}/team`, kid, { squishyIds: ids });
      expect((await team([lead.id, bench.id])).statusCode).toBe(200);

      // A loss doesn't count: the lead comes out and loses to a much stronger squishy.
      const lost = await fight(server, kid, mapId, { speciesId: SECRET_IDS[0]!, level: 90 });
      expect(lost.winner).toBe('b');
      // All the wins before the limit pay in full; the bench never comes out.
      for (let i = 0; i < falloff.fullWinsPerDay; i++) {
        const won = await fight(server, kid, mapId, weak);
        expect(won.winner).toBe('a');
        expect(won.paid.get(lead.id)).toBe(full(won.base.get(lead.id)!));
        expect(won.base.has(bench.id)).toBe(false);
      }
      // Past the limit, the lead gets the share, still on Oct 2 in Denver (23:59).
      clock.setTime(Date.parse('2026-10-03T05:59:00Z'));
      const tired = await fight(server, kid, mapId, weak);
      expect(tired.paid.get(lead.id)).toBe(share(tired.base.get(lead.id)!));
      // The squishy that sat on the bench has won nothing today: full XP.
      expect((await team([bench.id])).statusCode).toBe(200);
      const fresh = await fight(server, kid, mapId, weak);
      expect(fresh.paid.get(bench.id)).toBe(full(fresh.base.get(bench.id)!));
      // Midnight in Denver (06:00 UTC): the lead's count starts again.
      clock.setTime(Date.parse('2026-10-03T06:00:00Z'));
      expect((await team([lead.id])).statusCode).toBe(200);
      const morning = await fight(server, kid, mapId, weak);
      expect(morning.paid.get(lead.id)).toBe(full(morning.base.get(lead.id)!));
    });
  });

  describe('teams (swap and replace)', () => {
    it('swaps on the bench, and asks who comes out when one is tuckered out', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const first = await grant(server, kid, mapId, { speciesId: SECRET_IDS[0], level: 2 });
      const second = await grant(server, kid, mapId, { speciesId: SECRET_IDS[1], level: 1 });
      // Strongest first: the level-2 squishy leads.
      const battle = await pickFight(server, kid, mapId, {
        opponent: { speciesId: SECRET_IDS[1], level: 30 },
      });
      expect(battle.view.sides.a.squishies.map((s) => s.id)).toEqual([first.id, second.id]);
      expect(battle.view.sides.a.squishies.map((s) => s.joined)).toEqual([true, false]);

      // A swap costs the turn; the bench squishy is out and has joined.
      const swapped = battleOf(await act(server, kid, battle, { type: 'swap', slot: 1 }));
      expect(swapped.view.sides.a.active).toBe(1);
      expect(swapped.view.sides.a.squishies[1]!.joined).toBe(true);
      expect(swapped.view.log[0]).toMatchObject({ type: 'swap', side: 'a', slot: 0, to: 1 });
      // Swapping to the one that's already out is refused.
      expect((await act(server, kid, swapped, { type: 'swap', slot: 1 })).statusCode).toBe(409);

      // A level-30 wild squishy soon tuckers one out: the server then waits
      // for a `replace`, and refuses moves until it gets one.
      let current = swapped;
      for (let i = 0; i < 20 && current.view.phase.type === 'turn'; i++) {
        const move = myActive(current).moves[0]!;
        current = battleOf(await act(server, kid, current, { type: 'move', move }));
      }
      expect(current.status).toBe('active');
      expect(current.view.phase).toEqual({ type: 'replace', sides: ['a'] });
      expect(myActive(current).energy).toBe(0);
      const move = current.view.sides.a.squishies[0]!.moves[0]!;
      expect((await act(server, kid, current, { type: 'move', move })).statusCode).toBe(409);
      // Only a squishy with energy left can come out.
      expect((await act(server, kid, current, { type: 'replace', slot: 1 })).statusCode).toBe(409);
      const replaced = battleOf(await act(server, kid, current, { type: 'replace', slot: 0 }));
      expect(replaced.view.phase).toEqual({ type: 'turn' });
      expect(replaced.view.sides.a.active).toBe(0);
      expect(replaced.view.turn).toBe(current.view.turn); // replacing is free
      expect(replaced.view.log.at(-1)).toMatchObject({ type: 'replace', side: 'a', slot: 0 });

      const over = await playOut(server, kid, replaced);
      if (over.view.phase.type !== 'over') throw new Error('not over');
      expect(over.view.phase.result.winner).toBe('b');
      // Both took part, so both earn the minimum XP (design doc §7).
      const xp = over.view.phase.result.xp.filter((x) => x.side === 'a');
      expect(xp.map((x) => x.squishyId).sort()).toEqual([first.id, second.id].sort());
      expect((await squishyOf(first.id))!.xp).toBe(
        xpForLevel(2, GROWTH_RULES) + newSquishyXp(BATTLE_RULES.xp.minimum),
      );
      expect((await squishyOf(second.id))!.xp).toBe(newSquishyXp(BATTLE_RULES.xp.minimum));
    });
  });

  describe('content re-tuned mid-battle', () => {
    it('ends the battle as no contest on the next read or action', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      const squishy = await grant(server, kid, mapId);
      const battle = await pickFight(server, kid, mapId);
      const move = myActive(battle).moves[0]!;
      expect((await act(server, kid, battle, { type: 'move', move })).statusCode).toBe(200);

      const retuned = createBattlesService({
        db,
        clock: () => clock,
        content: createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA), {
          ...BATTLE_RULES,
          damage: { ...BATTLE_RULES.damage, flat: BATTLE_RULES.damage.flat + 1 },
        }),
      });
      const user = { id: kid.id, username: kid.username };
      const ended = await retuned.get(user, battle.id);
      expect(ended.status).toBe('no-contest');
      expect(ended.seed).toEqual(expect.any(String) as unknown);
      expect(ended.view.phase.type).toBe('turn'); // the state is kept as it was
      expect(ended.view.turn).toBe(1);
      expect(await retuned.current(user, mapId)).toBeNull();
      await expect(
        retuned.act(user, battle.id, { action: { type: 'forfeit' }, turn: 1 }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const row = await rowOf(battle.id);
      expect(row).toMatchObject({ status: 'no-contest', result: null, endedAt: clock });
      expect(row!.log).toEqual(ended.view.log);
      expect((await squishyOf(squishy.id))!.xp).toBe(0);
      expect((await eventsOf(mapId)).at(-1)).toMatchObject({
        type: 'battle.ended',
        actorUserId: null,
        payload: { battleId: battle.id, winner: null, reason: 'no-contest', xp: [] },
      });
      // A new battle can start now.
      const next = await pickFight(server, kid, mapId);
      expect(next.id).not.toBe(battle.id);
    });
  });

  describe('where it happens (the arena, owner decision 2026-10-04)', () => {
    const tilesOf = (mapId: string) =>
      db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });

    /** The player's Heart Seed tile: the middle of their home base. */
    async function seedTile(mapId: string, who: Player) {
      const member = await db.query.mapMembers.findFirst({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.userId, who.id)),
      });
      const home = (await tilesOf(mapId)).filter((t) => t.homeSlot === member!.homeSlot);
      const seed = heartSeedOf(home)!;
      return home.find((t) => t.q === seed.q && t.r === seed.r)!;
    }

    /** A neutral tile whose terrain isn't the Heart Seed's, so the two can't be mixed up. */
    async function awayTile(mapId: string, seedTerrain: string) {
      const away = (await tilesOf(mapId)).find(
        (t) => t.homeSlot === null && t.terrain !== seedTerrain,
      );
      expect(away).toBeDefined();
      return away!;
    }

    const wildTeam = () => [{ id: 'wild-1', speciesId: SECRET_IDS[0]!, level: 3 }];

    it('plays a battle with no tile at the Heart Seed, and keeps it on refresh', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await grant(server, kid, mapId);
      const seed = await seedTile(mapId, kid);
      const battle = await pickFight(server, kid, mapId);
      expect(battle).toMatchObject({ terrain: seed.terrain, timeOfDay: 'day' });
      expect(GAME_DATA.terrains.map((t) => t.id)).toContain(battle.terrain);
      expect(await rowOf(battle.id)).toMatchObject({
        terrain: seed.terrain,
        timeOfDay: 'day',
      });
      // Stored when it started: later in the evening it still looks like the day it began.
      clock.setTime(Date.parse('2026-10-03T04:00:00Z')); // 10 PM in Denver
      const got = battleOf(await call(server, 'GET', `/battles/${battle.id}`, kid));
      expect(got).toMatchObject({ terrain: seed.terrain, timeOfDay: 'day' });
    });

    it("plays a wild squishy on its spawn tile's terrain, at the patch's time of day", async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await grant(server, kid, mapId);
      const tile = await awayTile(mapId, (await seedTile(mapId, kid)).terrain);
      // 10 PM in Denver: after nightfall (9 PM), so the arena is drawn at night.
      clock.setTime(Date.parse('2026-10-03T04:00:00Z'));
      const service = createBattlesService({ db, clock: () => clock });
      const { battle } = await service.startAgainst({ id: kid.id, username: kid.username }, mapId, {
        squishies: wildTeam(),
        spawn: { q: tile.q, r: tile.r, window: '2026-10-02/5' },
      });
      expect(battle).toMatchObject({ kind: 'wild', terrain: tile.terrain, timeOfDay: 'night' });
      // The client gets it on every read, through the response schema.
      const got = battleOf(await call(server, 'GET', `/battles/${battle.id}`, kid));
      expect(got).toMatchObject({ terrain: tile.terrain, timeOfDay: 'night' });
    });

    it("plays a tile battle on the tile's terrain, at dusk before nightfall", async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await grant(server, kid, mapId);
      const tile = await awayTile(mapId, (await seedTile(mapId, kid)).terrain);
      clock.setTime(Date.parse('2026-10-03T02:00:00Z')); // 8 PM in Denver
      const service = createBattlesService({ db, clock: () => clock });
      const { battle } = await service.startTile(
        { id: kid.id, username: kid.username },
        mapId,
        () =>
          Promise.resolve({
            kind: 'tile',
            tile: { q: tile.q, r: tile.r },
            side: { controller: { type: 'ai', policy: 'guardian' }, squishies: wildTeam() },
            started: () => Promise.resolve([]),
          }),
      );
      expect(battle).toMatchObject({ kind: 'tile', terrain: tile.terrain, timeOfDay: 'dusk' });
    });

    it('shows a battle from before arenas were stored on the home terrain, by day', async () => {
      const server = await start();
      const kid = await player();
      const mapId = await newMap(server, kid);
      await grant(server, kid, mapId);
      const battle = await pickFight(server, kid, mapId);
      const row = await createBattlesRepo(db).findBattle(battle.id);
      expect(row?.arena).not.toBeNull();
      const old = playerBattleView(defaultBattleContent(), { ...row!, arena: null });
      expect(old).toMatchObject({ terrain: MAP_GEN.homeTerrain, timeOfDay: 'day' });
    });
  });
});
