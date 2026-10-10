import {
  ApiErrorSchema,
  BATTLE_RULES,
  BattleResponseSchema,
  CurrentBattleResponseSchema,
  JoinMapResponseSchema,
  LIVE_BATTLE_RULES,
  MapResponseSchema,
  replayBattle,
  startBattle,
  WS_PROTOCOL_VERSION,
  WsServerMessageSchema,
  type BattleSetup,
  type LiveBattleRules,
  type PlayerBattle,
  type PlayerBattleAction,
  type WsServerMessage,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { settleTimeouts } from './live.js';
import { setupOf, type LiveRow } from './repo.js';
import { createBattlesService, defaultBattleContent } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const ORIGIN = 'http://localhost:5173';
const DAY_MS = 24 * 60 * 60 * 1000;
const SECOND_MS = 1000;
const RULES: LiveBattleRules = LIVE_BATTLE_RULES;
const TEST_KEEPER = {
  base: 'pip',
  hairColor: 'honey',
  eyeColor: 'sky',
  outfit: 'sunflower',
  skinTone: 'tone-1',
  eyes: 'round' as const,
  brows: 'arched',
  mouth: 'smile',
  extras: [],
};

describe('settleTimeouts (#29)', () => {
  const at0 = new Date('2026-10-10T12:00:00Z');
  const fixtureContent = defaultBattleContent();
  const setup: BattleSetup = {
    seed: 'live-settle',
    sides: {
      a: {
        controller: { type: 'player' },
        squishies: [{ id: 'a-1', speciesId: 'emberbun', level: 5 }],
      },
      b: {
        controller: { type: 'player' },
        squishies: [{ id: 'b-1', speciesId: 'puddlepuff', level: 5 }],
      },
    },
  };
  const fresh = () => startBattle(fixtureContent, setup);
  const firstMove = fixtureContent.species.get('emberbun')!.moves[0]!;
  const liveRow = (patch: Partial<LiveRow> = {}): LiveRow => ({
    battleId: '00000000-0000-7000-8000-000000000001',
    mapId: '00000000-0000-7000-8000-000000000002',
    bUserId: '00000000-0000-7000-8000-000000000003',
    active: true,
    picks: {},
    deadlineAt: new Date(at0.getTime() + RULES.turnSeconds * SECOND_MS),
    graceUsed: { a: false, b: false },
    coverPolicy: { a: 'balanced', b: 'balanced' },
    covered: [],
    ...patch,
  });
  const settle = (live: LiveRow, at: Date, online = true) =>
    settleTimeouts({
      content: fixtureContent,
      seed: 'live-settle',
      state: fresh(),
      live,
      at,
      rules: RULES,
      isOnline: () => online,
    });

  it('does nothing before the deadline', () => {
    const step = settle(liveRow(), new Date(at0.getTime() + 10 * SECOND_MS));
    expect(step.actions).toEqual([]);
    expect(step.state.turn).toBe(0);
  });

  it('the AI picks for whoever ran out of time, and keeps a pick that was in', () => {
    const pick = { type: 'move', move: firstMove } as const;
    const step = settle(
      liveRow({ picks: { a: pick } }),
      new Date(at0.getTime() + (RULES.turnSeconds + 1) * SECOND_MS),
    );
    expect(step.actions).toHaveLength(1);
    const [action] = step.actions;
    expect(action?.type === 'turn' && action.choices.a).toEqual(pick);
    expect(step.live.covered).toEqual([{ turn: 1, side: 'b' }]);
    expect(step.live.picks).toEqual({});
    expect(step.state.turn).toBe(1);
  });

  it('a side that is away gets one grace before the AI steps in', () => {
    const late = new Date(at0.getTime() + (RULES.turnSeconds + 1) * SECOND_MS);
    const first = settle(liveRow(), late, false);
    expect(first.actions).toEqual([]);
    expect(first.live.graceUsed).toEqual({ a: true, b: true });
    expect(first.live.deadlineAt.getTime()).toBe(
      at0.getTime() + (RULES.turnSeconds + RULES.awayGraceSeconds) * SECOND_MS,
    );
    const later = settle(
      liveRow({ ...first.live }),
      new Date(first.live.deadlineAt.getTime() + SECOND_MS),
      false,
    );
    expect(later.actions).toHaveLength(1);
    expect(later.live.covered.map((c) => c.side)).toEqual(['a', 'b']);
  });

  it('catches up every passed turn the same way, however late someone looks', () => {
    const long = new Date(at0.getTime() + 60 * 60 * SECOND_MS);
    const once = settle(liveRow(), long);
    const twice = settle(liveRow(), new Date(long.getTime() + 60 * 60 * SECOND_MS));
    expect(once.state.phase.type).toBe('over');
    expect(twice.actions).toEqual(once.actions);
    // Covered picks are concrete choices: the record replays to the same end.
    expect(replayBattle(fixtureContent, setup, once.actions)).toEqual(once.state);
  });
});

interface Player {
  id: string;
  username: string;
  token: string;
}

/** A real socket that records what it receives (the ws.test.ts pattern). */
class TestClient {
  readonly messages: WsServerMessage[] = [];
  private waiters: (() => void)[] = [];
  readonly socket: WebSocket;
  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data: Buffer) => {
      this.messages.push(WsServerMessageSchema.parse(JSON.parse(data.toString('utf8'))));
      for (const wake of this.waiters.splice(0)) wake();
    });
  }
  async next(match: (m: WsServerMessage) => boolean, timeoutMs = 2000): Promise<WsServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(match);
      if (found) return found;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out; got ${JSON.stringify(this.messages)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

describe.skipIf(!url)('live battles (#29, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  const clock = new Date('2026-10-10T12:00:00Z');
  let counter = 0;
  const sockets: WebSocket[] = [];
  const content = defaultBattleContent();

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse('2026-10-10T12:00:00Z'));
  });

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: 'true',
      PUBLIC_ORIGIN: ORIGIN,
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `livekid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
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

  /** Lee owns a patch and everyone else joins it; each gets one squishy. */
  async function patch(server: FastifyInstance, lee: Player, ...others: Player[]) {
    const res = await call(server, 'POST', '/maps', lee, {
      name: 'Showdown Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const map = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const joined = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      expect(joined.statusCode, joined.body).toBe(201);
      const request = JoinMapResponseSchema.parse(joined.json()).request;
      const ok = await call(server, 'POST', `/maps/${map.id}/requests/${request.id}/approve`, lee);
      expect(ok.statusCode, ok.body).toBe(204);
    }
    for (const kid of [lee, ...others]) {
      const granted = await call(server, 'POST', `/maps/${map.id}/dev/squishies`, kid, {
        speciesId: 'puddlepuff',
        level: 5,
      });
      expect(granted.statusCode, granted.body).toBe(201);
    }
    return map.id;
  }

  /** The app's own battles service is private; this one shares its database and hub. */
  const service = (server: FastifyInstance) =>
    createBattlesService({
      db,
      clock: () => clock,
      ...(server.wsHub ? { publish: server.wsHub.publish, isOnline: server.wsHub.isOnline } : {}),
    });

  const get = async (server: FastifyInstance, who: Player, battleId: string) => {
    const res = await call(server, 'GET', `/battles/${battleId}`, who);
    expect(res.statusCode, res.body).toBe(200);
    return battleOf(res);
  };

  const pick = (
    server: FastifyInstance,
    who: Player,
    battle: PlayerBattle,
    action: PlayerBattleAction,
  ) =>
    call(server, 'POST', `/battles/${battle.id}/actions`, who, { action, turn: battle.view.turn });

  const myMove = (battle: PlayerBattle) => {
    const side = battle.view.sides[battle.mySide];
    return side.squishies[side.active]!.moves[0]!;
  };

  const liveRowOf = (battleId: string) =>
    db.query.liveBattles.findFirst({ where: (t, { eq }) => eq(t.battleId, battleId) });

  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  it('plays a friendly battle to the end: hidden picks, both sides, nothing at stake', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const mapId = await patch(server, lee, sam);
    const battleId = await service(server).startFriendly({
      mapId,
      aUserId: lee.id,
      bUserId: sam.id,
    });
    const xpBefore = await db.query.squishies.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
    });

    let mine = await get(server, lee, battleId);
    let theirs = await get(server, sam, battleId);
    expect(mine.kind).toBe('friendly');
    expect([mine.mySide, theirs.mySide]).toEqual(['a', 'b']);
    expect(mine.live?.opponentUserId).toBe(sam.id);
    expect(theirs.live?.opponentUserId).toBe(lee.id);
    expect(mine.live?.deadlineAt).toBe(
      new Date(clock.getTime() + RULES.turnSeconds * SECOND_MS).toISOString(),
    );
    // Side b's "current battle" is the live one too.
    const current = await call(server, 'GET', `/maps/${mapId}/battles/current`, sam);
    expect(CurrentBattleResponseSchema.parse(current.json()).battle?.id).toBe(battleId);

    // Lee picks: the turn waits, and Sam sees only that Lee picked.
    const res = await pick(server, lee, mine, { type: 'move', move: myMove(mine) });
    expect(res.statusCode, res.body).toBe(200);
    mine = battleOf(res);
    expect(mine.view.turn).toBe(0);
    expect(mine.live?.myPick).toEqual({ type: 'move', move: myMove(mine) });
    expect(mine.live?.opponentPicked).toBe(false);
    theirs = await get(server, sam, battleId);
    expect(theirs.live?.myPick).toBeNull();
    expect(theirs.live?.opponentPicked).toBe(true);
    expect(JSON.stringify(theirs)).not.toContain('"picks"');
    const picked = (await eventsOf(mapId)).filter((e) => e.type === 'battle.picked');
    expect(picked.map((e) => e.payload)).toEqual([
      { battleId, aUserId: lee.id, bUserId: sam.id, side: 'a', turn: 0 },
    ]);

    // Both pick every turn until it ends.
    for (let i = 0; i < 2 * BATTLE_RULES.maxTurns && theirs.status === 'active'; i++) {
      for (const [who, view] of [
        [lee, await get(server, lee, battleId)],
        [sam, await get(server, sam, battleId)],
      ] as const) {
        if (view.status !== 'active') break;
        const phase = view.view.phase;
        if (phase.type === 'replace') {
          if (!phase.sides.includes(view.mySide)) continue;
          const bench = view.view.sides[view.mySide].squishies.findIndex(
            (s, slot) => slot !== view.view.sides[view.mySide].active && s.energy > 0,
          );
          expect((await pick(server, who, view, { type: 'replace', slot: bench })).statusCode).toBe(
            200,
          );
        } else if (view.live?.myPick === null) {
          expect(
            (await pick(server, who, view, { type: 'move', move: myMove(view) })).statusCode,
          ).toBe(200);
        }
      }
      theirs = await get(server, sam, battleId);
    }
    expect(theirs.status).toBe('finished');
    mine = await get(server, lee, battleId);
    expect(mine.live?.deadlineAt).toBeNull();
    expect(mine.seed).not.toBeNull();
    // Nothing at stake: no XP for anyone.
    const xpAfter = await db.query.squishies.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
    expect(xpAfter.map((s) => [s.id, s.xp]).sort()).toEqual(
      xpBefore.map((s) => [s.id, s.xp]).sort(),
    );
    expect((await liveRowOf(battleId))?.active).toBe(false);
    // The record replays: seed, setup and every action (rule 3).
    const row = (await db.query.battles.findFirst({ where: (t, { eq }) => eq(t.id, battleId) }))!;
    const stored = BattleResponseSchema.parse({ battle: mine }).battle;
    const replayed = replayBattle(
      content,
      setupOf({ seed: row.seed, setup: row.setup as never, state: row.state as never }),
      row.actions as never,
    );
    expect(replayed.log).toEqual(stored.view.log);
    // No choice ever reaches an event.
    for (const event of await eventsOf(mapId)) {
      if (!event.type.startsWith('battle.')) continue;
      expect(JSON.stringify(event.payload)).not.toMatch(/"move"|"choices"|"picks"/);
    }
  });

  it('a timeout lets the AI pick (never a loss), after one grace for an away player', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const mapId = await patch(server, lee, sam);
    const battleId = await service(server).startFriendly({
      mapId,
      aUserId: lee.id,
      bUserId: sam.id,
    });
    let mine = await get(server, lee, battleId);
    expect((await pick(server, lee, mine, { type: 'move', move: myMove(mine) })).statusCode).toBe(
      200,
    );

    // Sam's app isn't open (no socket): the first deadline gives a grace.
    clock.setTime(clock.getTime() + (RULES.turnSeconds + 1) * SECOND_MS);
    mine = await get(server, lee, battleId);
    expect(mine.view.turn).toBe(0);
    expect((await liveRowOf(battleId))?.graceUsedB).toBe(true);

    // After the grace, the AI picks for Sam and the turn plays.
    clock.setTime(clock.getTime() + RULES.awayGraceSeconds * SECOND_MS);
    mine = await get(server, lee, battleId);
    expect(mine.view.turn).toBe(1);
    expect(mine.status).toBe('active');
    expect(mine.live?.covered).toEqual([{ turn: 1, side: 'b' }]);

    // Sam comes back and picks: that turn is Sam's own, and the grace is back.
    const theirs = await get(server, sam, battleId);
    expect(theirs.live?.covered).toEqual([{ turn: 1, side: 'b' }]);
    if (theirs.view.phase.type === 'turn') {
      const res = await pick(server, sam, theirs, { type: 'move', move: myMove(theirs) });
      expect(res.statusCode, res.body).toBe(200);
      expect((await liveRowOf(battleId))?.graceUsedB).toBe(false);
    }

    // A pick for a turn that already played is refused, not applied to the next.
    const stale = await call(server, 'POST', `/battles/${battleId}/actions`, lee, {
      action: { type: 'move', move: myMove(mine) },
      turn: 0,
    });
    expect(stale.statusCode).toBe(409);
  });

  it('only the two players hear picks, turns and cheers; a third member never does', async () => {
    const server = await start();
    await server.listen({ port: 0, host: '127.0.0.1' });
    const port = (server.server.address() as AddressInfo).port;
    const [lee, sam, kit] = [await player(), await player(), await player()];
    const mapId = await patch(server, lee, sam, kit);

    const connect = async (who: Player) => {
      const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
        headers: { cookie: `hp_session=${who.token}`, origin: ORIGIN },
      });
      sockets.push(socket);
      const test = new TestClient(socket);
      await test.next((m) => m.type === 'ws.ready');
      socket.send(
        JSON.stringify({ v: WS_PROTOCOL_VERSION, type: 'subscribe', mapId, afterSeq: 0 }),
      );
      await test.next((m) => m.type === 'ws.subscribed');
      return test;
    };
    const [leeWs, samWs, kitWs] = [await connect(lee), await connect(sam), await connect(kit)];
    expect(server.wsHub?.isOnline(mapId, sam.id)).toBe(true);

    const battleId = await service(server).startFriendly({
      mapId,
      aUserId: lee.id,
      bUserId: sam.id,
    });
    const mine = await get(server, lee, battleId);
    // Sam's app is open on the patch: Lee sees Sam as here.
    expect(mine.live?.opponentHere).toBe(true);
    expect((await pick(server, lee, mine, { type: 'move', move: myMove(mine) })).statusCode).toBe(
      200,
    );
    const theirs = await get(server, sam, battleId);
    expect(
      (await pick(server, sam, theirs, { type: 'move', move: myMove(theirs) })).statusCode,
    ).toBe(200);
    const cheer = await call(server, 'POST', `/battles/${battleId}/cheer`, sam, {
      messageId: 'nice-move',
    });
    expect(cheer.statusCode, cheer.body).toBe(204);

    for (const ws of [leeWs, samWs]) {
      const picked = await ws.next((m) => m.type === 'battle.picked');
      expect(picked.type === 'battle.picked' && picked.data).toEqual({
        battleId,
        aUserId: lee.id,
        bUserId: sam.id,
        side: 'a',
        turn: 0,
      });
      await ws.next((m) => m.type === 'battle.turned');
      await ws.next((m) => m.type === 'battle.cheered');
    }
    // Kit sees the battle start, and nothing of its turns.
    await kitWs.next((m) => m.type === 'battle.started');
    const last = (await eventsOf(mapId)).at(-1)!.seq;
    await kitWs.next((m) => 'seq' in m && m.seq >= last);
    expect(kitWs.messages.map((m) => m.type)).not.toEqual(
      expect.arrayContaining(['battle.picked']),
    );
    expect(
      kitWs.messages.filter((m) =>
        ['battle.picked', 'battle.turned', 'battle.cheered'].includes(m.type),
      ),
    ).toEqual([]);

    // Replay from seq 0 (a reconnect) is built by the same views: still nothing for Kit.
    for (const event of await eventsOf(mapId)) {
      if (!['battle.picked', 'battle.turned', 'battle.cheered'].includes(event.type)) continue;
      expect(publicViewFor(PUBLIC_VIEWS, event, { userId: kit.id })).toBeNull();
      expect(publicViewFor(PUBLIC_VIEWS, event, { userId: lee.id })).not.toBeNull();
    }

    // Sam's app goes to the background (the socket closes): Lee now sees Sam stepped away.
    const samSocket = sockets.at(-2)!; // connected Lee, Sam, Kit
    const closed = new Promise((resolve) => samSocket.once('close', resolve));
    samSocket.close();
    await closed;
    await vi.waitFor(() => {
      expect(server.wsHub?.isOnline(mapId, sam.id)).toBe(false);
    });
    expect((await get(server, lee, battleId)).live?.opponentHere).toBe(false);
  });

  it('cheers are preset ids only, in a live battle, and rate-limited', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const mapId = await patch(server, lee, sam);
    const battleId = await service(server).startFriendly({
      mapId,
      aUserId: lee.id,
      bUserId: sam.id,
    });
    const send = (body: object) => call(server, 'POST', `/battles/${battleId}/cheer`, lee, body);

    expect((await send({ messageId: 'no-such-cheer' })).statusCode).toBe(400);
    // No text, ever: the body is strict.
    expect((await send({ messageId: 'hi', text: 'hello there' })).statusCode).toBe(400);
    // The unknown id above counted as one try (a strict body never reaches the limit).
    for (let i = 0; i < 5; i++)
      expect((await send({ messageId: 'sparkles' })).statusCode).toBe(204);
    expect((await send({ messageId: 'sparkles' })).statusCode).toBe(429);
    const cheered = (await eventsOf(mapId)).filter((e) => e.type === 'battle.cheered');
    expect(cheered[0]?.payload).toEqual({
      battleId,
      aUserId: lee.id,
      bUserId: sam.id,
      side: 'a',
      messageId: 'sparkles',
    });
  });

  it('one battle at a time on either side, and no potions with a friend', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const mapId = await patch(server, lee, sam);
    const battles = service(server);
    const battleId = await battles.startFriendly({ mapId, aUserId: lee.id, bUserId: sam.id });

    // Sam (side b) starting a wild battle resumes the friendly one.
    const wild = await call(server, 'POST', `/maps/${mapId}/dev/battles`, sam, {});
    expect(wild.statusCode, wild.body).toBe(200);
    expect(battleOf(wild).id).toBe(battleId);
    await expect(
      battles.startFriendly({ mapId, aUserId: sam.id, bUserId: lee.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const mine = await get(server, lee, battleId);
    const potion = await pick(server, lee, mine, { type: 'item', item: 'brave-brew' });
    expect(potion.statusCode).toBe(409);
    expect(errorOf(potion).message).toMatch(/potions/);
    const charm = await pick(server, lee, mine, { type: 'capture' });
    expect(charm.statusCode).toBe(409);

    // Giving up ends it at once; the other side wins, nobody loses anything.
    const gaveUp = battleOf(await pick(server, lee, mine, { type: 'forfeit' }));
    expect(gaveUp.status).toBe('finished');
    expect(gaveUp.view.phase.type === 'over' && gaveUp.view.phase.result.winner).toBe('b');
    expect((await liveRowOf(battleId))?.active).toBe(false);
  });

  it('a start for side b racing a friendly battle never seats them twice', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const mapId = await patch(server, lee, sam);
    const battles = service(server);
    const results = await Promise.allSettled([
      battles.startFriendly({ mapId, aUserId: lee.id, bUserId: sam.id }),
      call(server, 'POST', `/maps/${mapId}/dev/battles`, sam, {}),
    ]);
    expect(results.map((r) => r.status)).toContain('fulfilled');
    const seated = await db.query.battles.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.status, 'active')),
    });
    const asB = await db.query.liveBattles.findMany({
      where: (t, { and, eq }) => and(eq(t.bUserId, sam.id), eq(t.active, true)),
    });
    const samSeats = seated.filter((b) => b.playerUserId === sam.id).length + asB.length;
    expect(samSeats).toBe(1);
  });

  it('nobody has a friendly battle with themselves', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const mapId = await patch(server, lee, sam);
    const battles = service(server);
    await expect(
      battles.startFriendly({ mapId, aUserId: lee.id, bUserId: lee.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    // The owner's switch is checked here too; 29-B's route test flips it.
  });

  it('teams of two: a changed pick, sending someone out, and an AI send-out on a timeout', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const mapId = await patch(server, lee, sam);
    // Lee brings a much stronger squishy, so Sam's first one is tuckered out fast.
    for (const [who, level] of [
      [lee, 30],
      [sam, 4],
      [sam, 3],
    ] as const) {
      const granted = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, who, {
        speciesId: 'emberbun',
        level,
      });
      expect(granted.statusCode, granted.body).toBe(201);
    }
    const battleId = await service(server).startFriendly({
      mapId,
      aUserId: lee.id,
      bUserId: sam.id,
    });

    // A changed pick replaces the first and tells Sam nothing new.
    let mine = await get(server, lee, battleId);
    const moves = mine.view.sides.a.squishies[mine.view.sides.a.active]!.moves;
    expect((await pick(server, lee, mine, { type: 'move', move: moves[0]! })).statusCode).toBe(200);
    const changed = await pick(server, lee, mine, { type: 'move', move: moves[1]! });
    expect(changed.statusCode, changed.body).toBe(200);
    mine = battleOf(changed);
    expect(mine.live?.myPick).toEqual({ type: 'move', move: moves[1] });
    const picked = (await eventsOf(mapId)).filter((e) => e.type === 'battle.picked');
    expect(picked).toHaveLength(1);

    // Play until Sam has to send someone out; Sam does it once by hand.
    let sentOut = false;
    for (let i = 0; i < 40; i++) {
      const theirs = await get(server, sam, battleId);
      if (theirs.status !== 'active') break;
      const phase = theirs.view.phase;
      if (phase.type === 'replace') {
        if (sentOut) break;
        const res = await pick(server, sam, theirs, { type: 'replace', slot: 1 });
        expect(res.statusCode, res.body).toBe(200);
        sentOut = true;
        continue;
      }
      mine = await get(server, lee, battleId);
      if (mine.live?.myPick === null) {
        await pick(server, lee, mine, { type: 'move', move: myMove(mine) });
      }
      if (theirs.live?.myPick === null) {
        await pick(server, sam, theirs, { type: 'move', move: myMove(theirs) });
      }
    }
    expect(sentOut).toBe(true);

    // Sam's next one is tuckered out too, and Sam (no socket) doesn't send
    // anyone out: after the turn time and the away-grace, the AI does.
    let theirs = await get(server, sam, battleId);
    for (let i = 0; i < 40 && theirs.view.phase.type !== 'replace'; i++) {
      mine = await get(server, lee, battleId);
      if (mine.live?.myPick === null)
        await pick(server, lee, mine, { type: 'move', move: myMove(mine) });
      if (theirs.live?.myPick === null) {
        await pick(server, sam, theirs, { type: 'move', move: myMove(theirs) });
      }
      theirs = await get(server, sam, battleId);
    }
    expect(theirs.view.phase).toMatchObject({ type: 'replace', sides: ['b'] });
    clock.setTime(clock.getTime() + (RULES.turnSeconds + RULES.awayGraceSeconds + 2) * SECOND_MS);
    const after = await get(server, sam, battleId);
    expect(after.view.phase.type).not.toBe('replace');
    expect(after.live?.covered.at(-1)).toEqual({ turn: after.view.turn, side: 'b' });
  });

  it('one battle.turned per step, in order, when a late pick lands right after the AI played', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const mapId = await patch(server, lee, sam);
    const battleId = await service(server).startFriendly({
      mapId,
      aUserId: lee.id,
      bUserId: sam.id,
    });
    const mine = await get(server, lee, battleId);
    expect((await pick(server, lee, mine, { type: 'move', move: myMove(mine) })).statusCode).toBe(
      200,
    );
    // Sam is away past the turn time and the grace: nobody has looked yet.
    clock.setTime(clock.getTime() + (RULES.turnSeconds + RULES.awayGraceSeconds + 1) * SECOND_MS);
    // Sam's pick for turn 1 settles turn 1 (the AI's) first, then waits as a pick.
    const theirs = { ...(await get(server, lee, battleId)), id: battleId };
    const late = await call(server, 'POST', `/battles/${battleId}/actions`, sam, {
      action: { type: 'move', move: myMove({ ...theirs, mySide: 'b' }) },
      turn: 1,
    });
    expect(late.statusCode, late.body).toBe(200);
    const now = await get(server, lee, battleId);
    // Turn 1 played (the AI's pick for Sam); turn 2 waits on Lee, with Sam's pick in.
    expect(now.status).toBe('active');
    expect(now.view.phase.type).toBe('turn');
    expect(now.live?.opponentPicked).toBe(true);
    expect((await pick(server, lee, now, { type: 'move', move: myMove(now) })).statusCode).toBe(
      200,
    );
    const turned = (await eventsOf(mapId))
      .filter((e) => e.type === 'battle.turned')
      .map((e) => (e.payload as { turn: number }).turn);
    const row = (await db.query.battles.findFirst({ where: (t, { eq }) => eq(t.id, battleId) }))!;
    expect(turned).toHaveLength((row.actions as unknown[]).length);
    expect([...turned].sort((x, y) => x - y)).toEqual(turned);
  });
});
