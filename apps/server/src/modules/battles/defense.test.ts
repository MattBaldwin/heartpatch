import {
  AnswerChallengeResponseSchema,
  ApiErrorSchema,
  BattleResponseSchema,
  GAME_EVENTS,
  BATTLE_RULES,
  ChallengeResponseSchema,
  hexKey,
  hexNeighbors,
  JoinMapResponseSchema,
  LIVE_BATTLE_RULES,
  LiveBattleRulesSchema,
  MapResponseSchema,
  RaidReportResponseSchema,
  replayBattle,
  SquishyResponseSchema,
  TERRITORY_RULES,
  WS_PROTOCOL_VERSION,
  WsServerMessageSchema,
  type PlayerBattle,
  type PlayerBattleAction,
  type WsServerMessage,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, sessions, users } from '../../db/schema.js';
import { runConsumer } from '../../jobs/consumers.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { createRaidsConsumer } from '../raids/consumer.js';
import { createTileBattlePort } from '../territory/service.js';
import { createBattlesRepo, setupOf } from './repo.js';
import { createBattlesService, defaultBattleContent } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const ORIGIN = 'http://localhost:5173';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SECOND_MS = 1000;
const START = '2026-10-10T18:00:00Z';
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
const DEFENSE_TYPES = ['defense.prompted', 'defense.answered'];
const UUID = /^[0-9a-f-]{36}$/;
const uuid = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return value;
};

describe('live defense rules (#29-C)', () => {
  it('ship valid, with potions off until the owner says', () => {
    expect(LiveBattleRulesSchema.parse(LIVE_BATTLE_RULES)).toEqual(LIVE_BATTLE_RULES);
    expect(LIVE_BATTLE_RULES.defensePromptSeconds).toBe(20);
    expect(LIVE_BATTLE_RULES.liveDefenseItems).toBe(false);
  });
});

interface Player {
  id: string;
  token: string;
}

/** A real socket that records what it receives (the ws.test.ts pattern). */
class TestClient {
  readonly messages: WsServerMessage[] = [];
  readonly socket: WebSocket;
  private waiters: (() => void)[] = [];
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

describe.skipIf(!url)('live tile defense (#29-C, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let port = 0;
  const clock = new Date(START);
  let counter = 0;
  const sockets: WebSocket[] = [];

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await app?.close();
    app = undefined;
    clock.setTime(Date.parse(START));
  });

  async function start(): Promise<FastifyInstance> {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: url!,
      HP_DEV_SQUISHY_GRANTS: 'true',
      PUBLIC_ORIGIN: ORIGIN,
    });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
    return app;
  }

  async function player(): Promise<Player> {
    const username = `defkid_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
      .returning({ id: users.id });
    const { token, tokenHash } = newSessionToken();
    await db
      .insert(sessions)
      .values({ userId: user!.id, tokenHash, expiresAt: new Date(Date.now() + 30 * DAY_MS) });
    await db.insert(keepers).values({ userId: user!.id, ...TEST_KEEPER });
    return { id: user!.id, token };
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
  const battleOf = (res: LightMyRequestResponse) => {
    expect(res.statusCode, res.body).toBeLessThan(300);
    return BattleResponseSchema.parse(res.json()).battle;
  };

  /**
   * Lee (the challenger) and Sam (the defender) on Lee's patch, with Kit
   * looking on. Sam holds the tile next to Lee's land, with a squishy on
   * watch; everyone is past the new-player shield.
   */
  async function rivals(server: FastifyInstance) {
    const [lee, sam, kit] = [await player(), await player(), await player()];
    const res = await call(server, 'POST', '/maps', lee, {
      name: 'Defense Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode, res.body).toBe(201);
    const map = MapResponseSchema.parse(res.json()).map;
    for (const other of [sam, kit]) {
      const joined = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      const request = JoinMapResponseSchema.parse(joined.json()).request;
      const ok = await call(server, 'POST', `/maps/${map.id}/requests/${request.id}/approve`, lee);
      expect(ok.statusCode, ok.body).toBe(204);
    }
    const grant = async (who: Player, level: number, speciesId: string) => {
      const granted = await call(server, 'POST', `/maps/${map.id}/dev/squishies`, who, {
        speciesId,
        level,
      });
      expect(granted.statusCode, granted.body).toBe(201);
      return SquishyResponseSchema.parse(granted.json()).squishy;
    };
    await grant(lee, 12, 'emberbun');
    const guard = await grant(sam, 12, 'puddlepuff');
    await grant(kit, 5, 'puddlepuff');
    clock.setTime(clock.getTime() + (TERRITORY_RULES.newPlayerShieldHours + 1) * HOUR_MS);

    const tiles = await db.query.tiles.findMany({
      where: (t, { eq }) => eq(t.mapId, map.id),
      orderBy: (t, { asc }) => [asc(t.q), asc(t.r)],
    });
    const mine = new Set(tiles.filter((t) => t.ownerUserId === lee.id).map(hexKey));
    const near = tiles.find(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        hexNeighbors(t).some((n) => mine.has(hexKey(n))),
    )!;
    // Our own uuids, so raw SQL is safe.
    await db.execute(
      `update tiles set owner_user_id = '${uuid(sam.id)}' where id = '${uuid(near.id)}'`,
    );
    const watch = await call(server, 'POST', `/maps/${map.id}/defenders`, sam, {
      q: near.q,
      r: near.r,
      squishyIds: [guard.id],
    });
    expect(watch.statusCode, watch.body).toBe(200);
    return { lee, sam, kit, mapId: map.id, near, guard };
  }

  /** Opens the app on the patch: a subscribed socket, so the player shows as here. */
  async function online(who: Player, mapId: string): Promise<TestClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      headers: { cookie: `hp_session=${who.token}`, origin: ORIGIN },
    });
    sockets.push(socket);
    const test = new TestClient(socket);
    await test.next((m) => m.type === 'ws.ready');
    socket.send(JSON.stringify({ v: WS_PROTOCOL_VERSION, type: 'subscribe', mapId, afterSeq: 0 }));
    await test.next((m) => m.type === 'ws.subscribed');
    return test;
  }

  const attack = (
    server: FastifyInstance,
    who: Player,
    mapId: string,
    h: { q: number; r: number },
  ) => call(server, 'POST', `/maps/${mapId}/attacks`, who, { q: h.q, r: h.r });
  const act = (server: FastifyInstance, who: Player, b: PlayerBattle, action: PlayerBattleAction) =>
    call(server, 'POST', `/battles/${b.id}/actions`, who, { action, turn: b.view.turn });
  const get = async (server: FastifyInstance, who: Player, b: PlayerBattle) =>
    battleOf(await call(server, 'GET', `/battles/${b.id}`, who));
  const answer = (server: FastifyInstance, who: Player, id: string, reply: 'yes' | 'not-now') =>
    call(server, 'POST', `/challenges/${id}/answer`, who, { answer: reply });
  const promptOf = async (ws: TestClient) => {
    const m = await ws.next((x) => x.type === 'defense.prompted');
    return GAME_EVENTS['defense.prompted'].public.parse('data' in m ? m.data : null);
  };
  const answeredOf = async (ws: TestClient) => {
    const m = await ws.next((x) => x.type === 'defense.answered');
    return GAME_EVENTS['defense.answered'].public.parse('data' in m ? m.data : null);
  };
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { eq }) => eq(t.mapId, mapId),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  /** A move or a send-out for whoever `b` belongs to: their active squishy's first move. */
  const nextAction = (b: PlayerBattle): PlayerBattleAction => {
    const side = b.view.sides[b.mySide];
    return b.view.phase.type === 'replace'
      ? { type: 'replace', slot: side.squishies.findIndex((s) => s.energy > 0) }
      : { type: 'move', move: side.squishies[side.active]!.moves[0]! };
  };

  it('Defend now? → yes: the defender plays their squishies on watch live, the raid log says so, and it replays', async () => {
    const server = await start();
    const { lee, sam, kit, mapId, near, guard } = await rivals(server);
    const [leeWs, samWs, kitWs] = [
      await online(lee, mapId),
      await online(sam, mapId),
      await online(kit, mapId),
    ];

    const started = battleOf(await attack(server, lee, mapId, near));
    expect(started.kind).toBe('rival-tile');
    // The challenger waits for the answer, on the game clock.
    expect(started.defensePrompt).toEqual({
      expiresAt: new Date(
        clock.getTime() + LIVE_BATTLE_RULES.defensePromptSeconds * SECOND_MS,
      ).toISOString(),
      now: clock.toISOString(),
    });
    // The try, the cooldown and the loss-cap slot are taken now, as offline.
    const [attackRow] = await db.query.tileAttacks.findMany({
      where: (t, { eq }) => eq(t.battleId, started.id),
    });
    expect(attackRow).toMatchObject({ defenderUserId: sam.id, outcome: 'active' });

    const prompt = await promptOf(samWs);
    expect(prompt).toMatchObject({ battleId: started.id, fromUserId: lee.id, toUserId: sam.id });
    expect((await promptOf(leeWs)).challengeId).toBe(prompt.challengeId);

    // Nobody moves while Sam is asked.
    const early = await act(server, lee, started, nextAction(started));
    expect(early.statusCode).toBe(409);
    expect(errorOf(early).message).toMatch(/might come and defend/);

    const res = await answer(server, sam, prompt.challengeId, 'yes');
    expect(res.statusCode, res.body).toBe(200);
    const { challenge, battle } = AnswerChallengeResponseSchema.parse(res.json());
    expect(challenge).toMatchObject({ kind: 'defense', status: 'accepted', battleId: started.id });
    expect(battle?.mySide).toBe('b');
    expect(battle?.view.sides.b.controller).toEqual({ type: 'player' });
    expect(battle?.view.sides.b.squishies.map((s) => s.id)).toEqual([guard.id]);
    expect(battle?.live).toMatchObject({ opponentUserId: lee.id, myPick: null });
    expect(battle?.seed).toBeNull();
    expect((await answeredOf(leeWs)).answer).toBe('yes');
    // Their defense style covers them if their time runs out.
    const live = await db.query.liveBattles.findFirst({
      where: (t, { eq }) => eq(t.battleId, started.id),
    });
    expect(live).toMatchObject({
      bUserId: sam.id,
      coverPolicyA: 'balanced',
      coverPolicyB: 'balanced',
    });

    // Lee's view no longer waits; both pick, then each turn plays.
    let leeView = await get(server, lee, started);
    expect(leeView.defensePrompt).toBeUndefined();
    expect(leeView.live?.opponentUserId).toBe(sam.id);
    let samView = battle!;
    for (let i = 0; i < BATTLE_RULES.maxTurns + 5 && leeView.status === 'active'; i++) {
      for (const [who, b] of [
        [lee, leeView],
        [sam, samView],
      ] as const) {
        const owes =
          b.view.phase.type === 'turn'
            ? b.live?.myPick === null
            : b.view.phase.type === 'replace' && b.view.phase.sides.includes(b.mySide);
        if (b.status === 'active' && owes) battleOf(await act(server, who, b, nextAction(b)));
      }
      [leeView, samView] = [await get(server, lee, started), await get(server, sam, started)];
    }
    expect(leeView.status).toBe('finished');

    // Rule 3: the stored setup (side b a player) and actions replay to the end state.
    const row = (await createBattlesRepo(db).findBattle(started.id))!;
    expect(row.setup.b.controller).toEqual({ type: 'player' });
    expect(replayBattle(defaultBattleContent(), setupOf(row), row.actions)).toEqual(row.state);

    // The raid log: defended live, no defense style.
    await runConsumer(db, createRaidsConsumer(), mapId);
    const report = RaidReportResponseSchema.parse(
      (await call(server, 'GET', `/maps/${mapId}/raids`, sam)).json(),
    ).report;
    expect(report.raids[0]).toMatchObject({ battleId: started.id, live: true, stance: null });

    // Kit saw the battle start, never the prompt or the answer.
    await kitWs.next((m) => m.type === 'battle.started');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(kitWs.messages.filter((m) => DEFENSE_TYPES.includes(m.type))).toEqual([]);
  });

  it('a defender who is away, or has no squishy on watch, is never asked: the defense style plays', async () => {
    const server = await start();
    const { lee, mapId, near } = await rivals(server);
    await online(lee, mapId);
    const away = battleOf(await attack(server, lee, mapId, near));
    expect(away.defensePrompt).toBeUndefined();
    expect(away.view.sides.b.controller).toEqual({ type: 'ai', policy: 'balanced' });
    expect((await eventsOf(mapId)).some((e) => e.type === 'defense.prompted')).toBe(false);
    battleOf(await act(server, lee, away, nextAction(away)));

    // With nobody on watch the land's guardians stand in, and Sam isn't asked even when here.
    const second = await rivals(server);
    await online(second.sam, second.mapId);
    await call(server, 'POST', `/maps/${second.mapId}/defenders`, second.sam, {
      q: second.near.q,
      r: second.near.r,
      squishyIds: [],
    });
    const guarded = battleOf(await attack(server, second.lee, second.mapId, second.near));
    expect(guarded.view.sides.b.controller).toEqual({ type: 'ai', policy: 'guardian' });
    expect(guarded.defensePrompt).toBeUndefined();
  });

  it('Not now!: the defense style plays at once, and a late yes is too late', async () => {
    const server = await start();
    const { lee, sam, mapId, near } = await rivals(server);
    const leeWs = await online(lee, mapId);
    const samWs = await online(sam, mapId);
    const started = battleOf(await attack(server, lee, mapId, near));
    const prompt = await promptOf(samWs);

    const res = await answer(server, sam, prompt.challengeId, 'not-now');
    expect(res.statusCode, res.body).toBe(200);
    expect(AnswerChallengeResponseSchema.parse(res.json())).toMatchObject({
      challenge: { status: 'declined' },
      battle: null,
    });
    expect((await answeredOf(leeWs)).answer).toBe('not-now');
    const view = await get(server, lee, started);
    expect(view.defensePrompt).toBeUndefined();
    expect(view.view.sides.b.controller).toEqual({ type: 'ai', policy: 'balanced' });
    battleOf(await act(server, lee, view, nextAction(view)));

    const late = await answer(server, sam, prompt.challengeId, 'yes');
    expect(late.statusCode).toBe(409);
    expect(errorOf(late).message).toMatch(/Too late/);
  });

  it('no answer in time: it expires on the next look, and the challenger plays on against the defense style', async () => {
    const server = await start();
    const { lee, sam, mapId, near } = await rivals(server);
    await online(lee, mapId);
    const samWs = await online(sam, mapId);
    const started = battleOf(await attack(server, lee, mapId, near));
    const prompt = await promptOf(samWs);

    clock.setTime(clock.getTime() + (LIVE_BATTLE_RULES.defensePromptSeconds - 1) * SECOND_MS);
    expect((await get(server, lee, started)).defensePrompt).toBeDefined();
    clock.setTime(clock.getTime() + SECOND_MS);
    const view = await get(server, lee, started);
    expect(view.defensePrompt).toBeUndefined();
    const answered = await answeredOf(samWs);
    expect(answered).toMatchObject({ challengeId: prompt.challengeId, answer: 'expired' });
    battleOf(await act(server, lee, view, nextAction(view)));

    const late = await answer(server, sam, prompt.challengeId, 'yes');
    expect(late.statusCode).toBe(409);
    const row = await db.query.challenges.findFirst({
      where: (t, { eq }) => eq(t.id, prompt.challengeId),
    });
    expect(row?.status).toBe('expired');
  });

  it('a defender answering late still can’t take over once the window passed, even with no look in between', async () => {
    const server = await start();
    const { lee, sam, mapId, near } = await rivals(server);
    await online(lee, mapId);
    const samWs = await online(sam, mapId);
    const started = battleOf(await attack(server, lee, mapId, near));
    const prompt = await promptOf(samWs);
    clock.setTime(clock.getTime() + LIVE_BATTLE_RULES.defensePromptSeconds * SECOND_MS);
    const late = await answer(server, sam, prompt.challengeId, 'yes');
    expect(late.statusCode).toBe(409);
    expect((await answeredOf(samWs)).answer).toBe('expired');
    expect((await get(server, lee, started)).view.sides.b.controller).toEqual({
      type: 'ai',
      policy: 'balanced',
    });
  });

  it('giving up while waiting calls the prompt off and counts as leaving: the land holds', async () => {
    const server = await start();
    const { lee, sam, mapId, near } = await rivals(server);
    await online(lee, mapId);
    const samWs = await online(sam, mapId);
    const started = battleOf(await attack(server, lee, mapId, near));
    await promptOf(samWs);

    const gone = battleOf(await act(server, lee, started, { type: 'forfeit' }));
    expect(gone.status).toBe('finished');
    expect(gone.view.phase).toMatchObject({
      type: 'over',
      result: { winner: 'b', reason: 'forfeit' },
    });
    expect((await answeredOf(samWs)).answer).toBe('called-off');
    const tile = await db.query.tiles.findFirst({ where: (t, { eq }) => eq(t.id, near.id) });
    expect(tile?.ownerUserId).toBe(sam.id);
    // The try stays used: waiting dodges nothing.
    const [attackRow] = await db.query.tileAttacks.findMany({
      where: (t, { eq }) => eq(t.battleId, started.id),
    });
    expect(attackRow?.outcome).not.toBe('no-contest');
  });

  it('live: the defender can’t give up their land, and no potions until the owner says', async () => {
    const server = await start();
    const { lee, sam, mapId, near } = await rivals(server);
    await online(lee, mapId);
    const samWs = await online(sam, mapId);
    battleOf(await attack(server, lee, mapId, near));
    const prompt = await promptOf(samWs);
    const { battle } = AnswerChallengeResponseSchema.parse(
      (await answer(server, sam, prompt.challengeId, 'yes')).json(),
    );

    const stay = await act(server, sam, battle!, { type: 'forfeit' });
    expect(stay.statusCode).toBe(409);
    expect(errorOf(stay).message).toMatch(/Your land needs you/);
    const potion = await act(server, lee, battle!, { type: 'item', item: 'brave-brew' });
    expect(potion.statusCode).toBe(409);
    expect(errorOf(potion).message).toMatch(/No potions in a live defense/);
  });

  it('the challenger’s own waiting Battle me? goes when the challenge starts', async () => {
    const server = await start();
    const { lee, sam, kit, mapId, near } = await rivals(server);
    const leeWs = await online(lee, mapId);
    await online(sam, mapId);
    await online(kit, mapId);
    const asked = await call(server, 'POST', `/maps/${mapId}/challenges`, lee, {
      toUserId: kit.id,
    });
    expect(asked.statusCode, asked.body).toBe(201);
    const askId = ChallengeResponseSchema.parse(asked.json()).challenge.id;

    const started = battleOf(await attack(server, lee, mapId, near));
    expect(started.defensePrompt).toBeDefined();
    const cancelled = await leeWs.next((m) => m.type === 'challenge.cancelled');
    expect(cancelled.type === 'challenge.cancelled' && cancelled.data).toMatchObject({
      challengeId: askId,
      reason: 'cancelled',
    });
  });

  it('with potions switched on: a potion is a first pick, out of the bag at once, and final', async () => {
    const server = await start();
    const { lee, sam, mapId, near } = await rivals(server);
    await online(lee, mapId);
    const samWs = await online(sam, mapId);
    const started = battleOf(await attack(server, lee, mapId, near));
    const prompt = await promptOf(samWs);
    const { battle } = AnswerChallengeResponseSchema.parse(
      (await answer(server, sam, prompt.challengeId, 'yes')).json(),
    );
    const given = await call(server, 'POST', `/maps/${mapId}/dev/items`, sam, {
      items: { 'brave-brew': 1 },
    });
    expect(given.statusCode, given.body).toBe(201);
    const brews = async () =>
      (
        await db.query.inventories.findFirst({
          where: (t, { and, eq }) =>
            and(eq(t.mapId, mapId), eq(t.userId, sam.id), eq(t.itemId, 'brave-brew')),
        })
      )?.quantity ?? 0;

    // The same battle, stepped by a service with the switch on.
    const battles = createBattlesService({
      db,
      clock: () => clock,
      tileBattles: createTileBattlePort(),
      liveRules: { ...LIVE_BATTLE_RULES, liveDefenseItems: true },
    });
    const samUser = { id: sam.id, username: 'sam' };
    const picked = await battles.act(samUser, battle!.id, {
      action: { type: 'item', item: 'brave-brew' },
      turn: 0,
    });
    expect(picked.live?.myPick).toEqual({ type: 'item', item: 'brave-brew' });
    expect(await brews()).toBe(0);
    // Final for the turn: no swapping it for a move.
    await expect(
      battles.act(samUser, battle!.id, { action: nextAction(battle!), turn: 0 }),
    ).rejects.toThrow(/on its way/);
    // Lee picks, the turn plays with Sam's potion in it.
    const leeView = await get(server, lee, started);
    const played = await battles.act({ id: lee.id, username: 'lee' }, started.id, {
      action: nextAction(leeView),
      turn: 0,
    });
    expect(played.view.turn).toBe(1);
    expect(played.view.sides.b.itemsUsed).toEqual(['brave-brew']);
  });

  it('a defender already weighing a prompt isn’t asked again', async () => {
    const server = await start();
    const { lee, sam, kit, mapId, near } = await rivals(server);
    await online(lee, mapId);
    await online(sam, mapId);
    await online(kit, mapId);
    // Sam's second tile, next to Kit's land, with Sam's squishy on watch there instead.
    const tiles = await db.query.tiles.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
    const kits = new Set(tiles.filter((t) => t.ownerUserId === kit.id).map(hexKey));
    const other = tiles.find(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        t.id !== near.id &&
        hexNeighbors(t).some((n) => kits.has(hexKey(n))),
    )!;
    await db.execute(
      `update tiles set owner_user_id = '${uuid(sam.id)}' where id = '${uuid(other.id)}'`,
    );
    const extra = await call(server, 'POST', `/maps/${mapId}/dev/squishies`, sam, {
      speciesId: 'puddlepuff',
      level: 12,
    });
    const second = SquishyResponseSchema.parse(extra.json()).squishy;
    expect(
      (
        await call(server, 'POST', `/maps/${mapId}/defenders`, sam, {
          q: other.q,
          r: other.r,
          squishyIds: [second.id],
        })
      ).statusCode,
    ).toBe(200);

    // Up to three of Sam's tiles a day on PvP On (Gentle allows one).
    await db.execute(`update maps set pvp_mode = 'on' where id = '${uuid(mapId)}'`);
    const first = battleOf(await attack(server, lee, mapId, near));
    expect(first.defensePrompt).toBeDefined();
    // Sam is weighing Lee's: Kit's challenge goes to Sam's defense style.
    const weighing = battleOf(await attack(server, kit, mapId, other));
    expect(weighing.defensePrompt).toBeUndefined();
    expect(weighing.view.sides.b.controller).toEqual({ type: 'ai', policy: 'balanced' });
    const prompts = (await eventsOf(mapId)).filter((e) => e.type === 'defense.prompted');
    expect(prompts).toHaveLength(1);
  });
});
