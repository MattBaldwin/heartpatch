import {
  AnswerChallengeResponseSchema,
  ApiErrorSchema,
  CHALLENGE_RULES,
  ChallengeResponseSchema,
  ChallengeRulesSchema,
  ChallengesResponseSchema,
  CurrentBattleResponseSchema,
  JoinMapResponseSchema,
  levelGapNote,
  MapResponseSchema,
  WS_PROTOCOL_VERSION,
  WsServerMessageSchema,
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
import { SESSION_COOKIE } from '../auth/limits.js';
import { createBattlesService } from '../battles/service.js';
import { newSessionToken } from '../auth/secrets.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const ORIGIN = 'http://localhost:5173';
const DAY_MS = 24 * 60 * 60 * 1000;
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
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
const CHALLENGE_TYPES = ['challenge.sent', 'challenge.answered', 'challenge.cancelled'];

describe('challenge rules (#29)', () => {
  it('ship valid', () => {
    expect(ChallengeRulesSchema.parse(CHALLENGE_RULES)).toEqual(CHALLENGE_RULES);
  });

  it('a big level gap gets a heads-up, from each side', () => {
    const gap = CHALLENGE_RULES.levelGapNote;
    expect(levelGapNote(5, 5 + gap)).toBe('they-are-stronger');
    expect(levelGapNote(5 + gap, 5)).toBe('they-are-newer');
    expect(levelGapNote(5, 5 + gap - 1)).toBeNull();
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

describe.skipIf(!url)('friendly challenges (#29, needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let app: FastifyInstance | undefined;
  let port = 0;
  const clock = new Date('2026-10-10T12:00:00Z');
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
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
    return app;
  }

  async function player(): Promise<Player> {
    const username = `askkid_${String((counter += 1))}`;
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

  /** Lee owns a patch and everyone else joins it; each gets a squishy at `levels[i]`. */
  async function patch(server: FastifyInstance, players: Player[], levels: number[] = []) {
    const [lee, ...others] = players;
    const res = await call(server, 'POST', '/maps', lee!, {
      name: 'Asking Patch',
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
      const ok = await call(server, 'POST', `/maps/${map.id}/requests/${request.id}/approve`, lee!);
      expect(ok.statusCode, ok.body).toBe(204);
    }
    for (const [i, kid] of players.entries()) {
      const granted = await call(server, 'POST', `/maps/${map.id}/dev/squishies`, kid, {
        speciesId: 'puddlepuff',
        level: levels[i] ?? 5,
      });
      expect(granted.statusCode, granted.body).toBe(201);
    }
    return map.id;
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

  const view = async (server: FastifyInstance, who: Player, mapId: string) => {
    const res = await call(server, 'GET', `/maps/${mapId}/challenges`, who);
    expect(res.statusCode, res.body).toBe(200);
    return ChallengesResponseSchema.parse(res.json());
  };
  const ask = (server: FastifyInstance, who: Player, mapId: string, to: Player) =>
    call(server, 'POST', `/maps/${mapId}/challenges`, who, { toUserId: to.id });
  const answer = (server: FastifyInstance, who: Player, id: string, reply: 'yes' | 'not-now') =>
    call(server, 'POST', `/challenges/${id}/answer`, who, { answer: reply });
  const askedId = (res: LightMyRequestResponse) => {
    expect(res.statusCode, res.body).toBe(201);
    return ChallengeResponseSchema.parse(res.json()).challenge.id;
  };

  it("shows who's here now, with their team level, and never you", async () => {
    const server = await start();
    const [lee, sam, kit] = [await player(), await player(), await player()];
    const mapId = await patch(server, [lee, sam, kit], [5, 12, 3]);
    await online(lee, mapId);
    await online(sam, mapId);
    const seen = await view(server, lee, mapId);
    expect(seen.friendlyChallenges).toBe(true);
    expect(seen.myTeamLevel).toBe(5);
    // Kit's app isn't open: not here.
    expect(
      seen.online.map(({ userId, inBattle, teamLevel }) => ({ userId, inBattle, teamLevel })),
    ).toEqual([{ userId: sam.id, inBattle: false, teamLevel: 12 }]);
    expect(seen.online[0]?.username).toMatch(/^askkid_/);
    expect(seen.incoming).toEqual([]);
    expect(seen.outgoing).toBeNull();
  });

  it('Battle me? → Battle! starts a friendly battle; only the two Keepers hear the ask', async () => {
    const server = await start();
    const [lee, sam, kit] = [await player(), await player(), await player()];
    const mapId = await patch(server, [lee, sam, kit], [5, 12, 5]);
    const [leeWs, samWs, kitWs] = [
      await online(lee, mapId),
      await online(sam, mapId),
      await online(kit, mapId),
    ];

    const id = askedId(await ask(server, lee, mapId, sam));
    const incoming = (await view(server, sam, mapId)).incoming;
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({
      id,
      fromUserId: lee.id,
      toUserId: sam.id,
      fromTeamLevel: 5,
      toTeamLevel: 12,
      status: 'pending',
      expiresAt: new Date(
        clock.getTime() + CHALLENGE_RULES.expireSeconds * SECOND_MS,
      ).toISOString(),
    });
    expect((await view(server, lee, mapId)).outgoing?.id).toBe(id);
    await samWs.next((m) => m.type === 'challenge.sent');

    const res = await answer(server, sam, id, 'yes');
    expect(res.statusCode, res.body).toBe(200);
    const { challenge, battle } = AnswerChallengeResponseSchema.parse(res.json());
    expect(challenge.status).toBe('accepted');
    expect(battle?.kind).toBe('friendly');
    expect(battle?.mySide).toBe('b');
    expect(challenge.battleId).toBe(battle?.id);
    const current = await call(server, 'GET', `/maps/${mapId}/battles/current`, lee);
    expect(CurrentBattleResponseSchema.parse(current.json()).battle?.id).toBe(battle?.id);

    const answered = await leeWs.next((m) => m.type === 'challenge.answered');
    expect(answered.type === 'challenge.answered' && answered.data).toMatchObject({
      challengeId: id,
      answer: 'yes',
      battleId: battle?.id,
    });
    // Kit sees the battle start, never the ask.
    await kitWs.next((m) => m.type === 'battle.started');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(kitWs.messages.filter((m) => CHALLENGE_TYPES.includes(m.type))).toEqual([]);

    // A player in a battle can't be asked, and can't ask.
    const busy = await ask(server, kit, mapId, sam);
    expect(busy.statusCode).toBe(409);
  });

  it('Not now! is kind and sticks for a little while; asks are limited per pair', async () => {
    const server = await start();
    const [lee, sam] = [await player(), await player()];
    const mapId = await patch(server, [lee, sam]);
    await online(lee, mapId);
    await online(sam, mapId);

    const id = askedId(await ask(server, lee, mapId, sam));
    const declined = await answer(server, sam, id, 'not-now');
    expect(declined.statusCode, declined.body).toBe(200);
    expect(AnswerChallengeResponseSchema.parse(declined.json())).toMatchObject({
      challenge: { status: 'declined' },
      battle: null,
    });
    // A rest before asking Sam again.
    const tooSoon = await ask(server, lee, mapId, sam);
    expect(tooSoon.statusCode).toBe(429);
    expect(errorOf(tooSoon).message).toMatch(/Not now/);

    clock.setTime(clock.getTime() + (CHALLENGE_RULES.notNowRestMinutes + 1) * MINUTE_MS);
    for (let i = 1; i < CHALLENGE_RULES.perPair.max; i++) {
      const again = askedId(await ask(server, lee, mapId, sam));
      expect((await call(server, 'POST', `/challenges/${again}/cancel`, lee)).statusCode).toBe(204);
    }
    // That's the most asks to one player in the window (the first counts too).
    const spam = await ask(server, lee, mapId, sam);
    expect(spam.statusCode).toBe(429);
    clock.setTime(clock.getTime() + CHALLENGE_RULES.perPair.minutes * MINUTE_MS);
    askedId(await ask(server, lee, mapId, sam));
  });

  it('an ask floats away after its time, and only the asker can call it off', async () => {
    const server = await start();
    const [lee, sam, kit] = [await player(), await player(), await player()];
    const mapId = await patch(server, [lee, sam, kit]);
    await online(lee, mapId);
    const samWs = await online(sam, mapId);
    await online(kit, mapId);

    const id = askedId(await ask(server, lee, mapId, sam));
    // One ask at a time.
    expect((await ask(server, lee, mapId, kit)).statusCode).toBe(409);
    // Only Sam answers; only Lee calls it off.
    expect((await answer(server, kit, id, 'yes')).statusCode).toBe(404);
    expect((await call(server, 'POST', `/challenges/${id}/cancel`, sam)).statusCode).toBe(404);

    clock.setTime(clock.getTime() + (CHALLENGE_RULES.expireSeconds + 1) * SECOND_MS);
    const late = await answer(server, sam, id, 'yes');
    expect(late.statusCode).toBe(409);
    expect(errorOf(late).message).toMatch(/floated away/);
    expect((await view(server, sam, mapId)).incoming).toEqual([]);
    const gone = await samWs.next((m) => m.type === 'challenge.cancelled');
    expect(gone.type === 'challenge.cancelled' && gone.data).toMatchObject({
      challengeId: id,
      reason: 'expired',
    });
    // Lee is free to ask again.
    askedId(await ask(server, lee, mapId, kit));
  });

  it('works in every PvP mode; the owner can switch it off; nobody asks the absent or themselves', async () => {
    const server = await start();
    const [lee, sam, kit] = [await player(), await player(), await player()];
    const mapId = await patch(server, [lee, sam, kit]);
    await online(lee, mapId);
    await online(sam, mapId);

    // Kit's app isn't open.
    expect((await ask(server, lee, mapId, kit)).statusCode).toBe(409);
    expect((await ask(server, lee, mapId, lee)).statusCode).toBe(400);

    // PvP Off still allows friendly battles: nothing is at stake.
    const off = await call(server, 'POST', `/maps/${mapId}/pvp-mode`, lee, { pvpMode: 'off' });
    expect(off.statusCode, off.body).toBe(200);
    const id = askedId(await ask(server, sam, mapId, lee));

    // Only the owner switches; switching off calls off the waiting ask.
    const notOwner = await call(server, 'POST', `/maps/${mapId}/friendly-challenges`, sam, {
      friendlyChallenges: false,
    });
    expect(notOwner.statusCode).toBe(403);
    const switched = await call(server, 'POST', `/maps/${mapId}/friendly-challenges`, lee, {
      friendlyChallenges: false,
    });
    expect(switched.statusCode, switched.body).toBe(200);
    expect((await view(server, lee, mapId)).incoming).toEqual([]);
    const row = await db.query.challenges.findFirst({ where: (t, { eq }) => eq(t.id, id) });
    expect(row?.status).toBe('cancelled');
    const map = await call(server, 'GET', `/maps/${mapId}`, sam);
    expect(MapResponseSchema.parse(map.json()).map.friendlyChallenges).toBe(false);
    const refused = await ask(server, sam, mapId, lee);
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).message).toMatch(/switched off/);
    // The battles service checks the switch itself too, whoever calls it.
    await expect(
      createBattlesService({ db }).startFriendly({ mapId, aUserId: sam.id, bUserId: lee.id }),
    ).rejects.toThrow(/switched off/);

    // Back on.
    await call(server, 'POST', `/maps/${mapId}/friendly-challenges`, lee, {
      friendlyChallenges: true,
    });
    const res = await answer(server, lee, askedId(await ask(server, sam, mapId, lee)), 'yes');
    expect(res.statusCode, res.body).toBe(200);
    expect(AnswerChallengeResponseSchema.parse(res.json()).battle?.mySide).toBe('b');
  });

  describe('races (#29: atomic accept, limits that hold against a double tap)', () => {
    const pendingFrom = (mapId: string, who: Player) =>
      db.query.challenges.findMany({
        where: (t, { and, eq }) =>
          and(eq(t.mapId, mapId), eq(t.fromUserId, who.id), eq(t.status, 'pending')),
      });
    const activeBattles = (mapId: string) =>
      db.query.battles.findMany({
        where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.status, 'active')),
      });

    it('a double tap sends one ask', async () => {
      const server = await start();
      const [lee, sam] = [await player(), await player()];
      const mapId = await patch(server, [lee, sam]);
      await online(lee, mapId);
      await online(sam, mapId);
      const codes = (
        await Promise.all([ask(server, lee, mapId, sam), ask(server, lee, mapId, sam)])
      ).map((r) => r.statusCode);
      expect(codes.sort()).toEqual([201, 409]);
      expect(await pendingFrom(mapId, lee)).toHaveLength(1);
    });

    it('two Keepers asking the same friend at once: one ask waits, the other is told', async () => {
      const server = await start();
      const [lee, sam, kit] = [await player(), await player(), await player()];
      const mapId = await patch(server, [lee, sam, kit]);
      for (const who of [lee, sam, kit]) await online(who, mapId);
      const [fromLee, fromKit] = await Promise.all([
        ask(server, lee, mapId, sam),
        ask(server, kit, mapId, sam),
      ]);
      expect([fromLee.statusCode, fromKit.statusCode].sort()).toEqual([201, 409]);
      const refused = fromLee.statusCode === 409 ? fromLee : fromKit;
      expect(errorOf(refused).message).toMatch(/thinking about another battle/);
      expect((await view(server, sam, mapId)).incoming).toHaveLength(1);
    });

    it('Battle! against Never mind: a battle with an accepted ask, or neither', async () => {
      const server = await start();
      const [lee, sam] = [await player(), await player()];
      const mapId = await patch(server, [lee, sam]);
      await online(lee, mapId);
      await online(sam, mapId);
      const id = askedId(await ask(server, lee, mapId, sam));
      await Promise.all([
        answer(server, sam, id, 'yes'),
        call(server, 'POST', `/challenges/${id}/cancel`, lee),
      ]);
      const row = await db.query.challenges.findFirst({ where: (t, { eq }) => eq(t.id, id) });
      const battles = await activeBattles(mapId);
      if (row?.status === 'accepted') {
        expect(battles.map((b) => b.id)).toEqual([row.battleId]);
      } else {
        expect(row?.status).toBe('cancelled');
        expect(battles).toEqual([]);
      }
    });

    it("Battle! against the owner's switch-off: a battle with an accepted ask, or neither", async () => {
      const server = await start();
      const [lee, sam] = [await player(), await player()];
      const mapId = await patch(server, [lee, sam]);
      await online(lee, mapId);
      await online(sam, mapId);
      const id = askedId(await ask(server, sam, mapId, lee));
      await Promise.all([
        answer(server, lee, id, 'yes'),
        call(server, 'POST', `/maps/${mapId}/friendly-challenges`, lee, {
          friendlyChallenges: false,
        }),
      ]);
      const row = await db.query.challenges.findFirst({ where: (t, { eq }) => eq(t.id, id) });
      const battles = await activeBattles(mapId);
      if (row?.status === 'accepted') {
        expect(battles.map((b) => b.id)).toEqual([row.battleId]);
      } else {
        expect(row?.status).toBe('cancelled');
        expect(battles).toEqual([]);
      }
    });
  });

  it("a battle calls off its Keepers' other asks; leaving the patch calls off a Keeper's asks", async () => {
    const server = await start();
    const [lee, sam, kit, ivy] = [await player(), await player(), await player(), await player()];
    const mapId = await patch(server, [lee, sam, kit, ivy]);
    for (const who of [lee, sam, kit, ivy]) await online(who, mapId);
    const leeToSam = askedId(await ask(server, lee, mapId, sam));
    const kitToLee = askedId(await ask(server, kit, mapId, lee));
    const ivyToKit = askedId(await ask(server, ivy, mapId, kit));
    expect((await answer(server, sam, leeToSam, 'yes')).statusCode).toBe(200);
    const status = async (id: string) =>
      (await db.query.challenges.findFirst({ where: (t, { eq }) => eq(t.id, id) }))?.status;
    // Lee is in a battle now: Kit's ask to Lee goes; Ivy's to Kit stays.
    expect(await status(kitToLee)).toBe('cancelled');
    expect(await status(ivyToKit)).toBe('pending');

    // Ivy leaves the patch: Ivy's ask goes too.
    const left = await call(server, 'POST', `/maps/${mapId}/leave`, ivy);
    expect(left.statusCode, left.body).toBe(204);
    expect(await status(ivyToKit)).toBe('cancelled');
  });
});
