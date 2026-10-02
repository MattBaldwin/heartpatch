import {
  ApiErrorSchema,
  WS_CLOSE_CODES,
  WS_PROTOCOL_VERSION,
  WsServerMessageSchema,
  type WsServerMessage,
} from '@heartpatch/shared';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';
import { buildApp, type BuildAppOptions } from '../app.js';
import { loadConfig } from '../config.js';
import { createDbClient, type Database, type DbClient } from '../db/client.js';
import { appendGameEvent } from '../db/game-events.js';
import { mapMembers, maps } from '../db/schema.js';
import { createAuthRepo, type AuthRepo } from '../modules/auth/repo.js';
import { hashSessionToken, newSessionToken } from '../modules/auth/secrets.js';
import { definePublicView, type PublicViews } from './public-views.js';
import { createWsRepo } from './repo.js';

const url = inject('testDatabaseUrl');
const ORIGIN = 'http://localhost:5173';
const DAY_MS = 24 * 60 * 60 * 1000;

// Test-only event types. `test.pinged` stores a secret the view must drop;
// `test.whisper` is for one player only; `test.hidden` has no view at all.
const PingedPayload = z.object({ note: z.string(), secret: z.string() });
const WhisperPayload = z.object({ to: z.string(), note: z.string() });
const TEST_VIEWS: PublicViews = {
  'test.pinged': definePublicView({
    schema: z.object({ note: z.string() }),
    // Deliberately careless: spreads the internal payload. The schema strips it.
    build: (event) => ({ ...PingedPayload.parse(event.payload) }),
  }),
  'test.whisper': definePublicView({
    schema: z.object({ note: z.string() }),
    build: (event, recipient) => {
      const payload = WhisperPayload.parse(event.payload);
      return payload.to === recipient.userId ? { note: payload.note } : null;
    },
  }),
};

/** A real socket that records what it receives. */
class TestClient {
  readonly messages: WsServerMessage[] = [];
  readonly raw: string[] = [];
  readonly closed: Promise<{ code: number }>;
  private waiters: (() => void)[] = [];
  readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data: Buffer) => {
      const text = data.toString('utf8');
      this.raw.push(text);
      this.messages.push(WsServerMessageSchema.parse(JSON.parse(text)));
      for (const wake of this.waiters.splice(0)) wake();
    });
    this.closed = new Promise((resolve) => {
      socket.on('close', (code) => {
        resolve({ code });
      });
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  subscribe(mapId: string, afterSeq = 0): void {
    this.send({ v: WS_PROTOCOL_VERSION, type: 'subscribe', mapId, afterSeq });
  }

  /** Waits for the first message (from `from` on) that matches. */
  async next(
    match: (m: WsServerMessage) => boolean,
    { from = 0, timeoutMs = 2000 } = {},
  ): Promise<WsServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.slice(from).find(match);
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

  /** Lets in-flight messages arrive, then returns what came after `from`. */
  async settle(from = 0, ms = 150): Promise<WsServerMessage[]> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return this.messages.slice(from);
  }

  close(): void {
    this.socket.close();
  }
}

const ofType =
  (type: string) =>
  (m: WsServerMessage): boolean =>
    m.type === type;

describe.skipIf(!url)('live sync over /ws (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let authRepo: AuthRepo;
  let app: FastifyInstance | undefined;
  let port = 0;
  let counter = 0;
  const sockets: TestClient[] = [];

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
    authRepo = createAuthRepo(db);
  });
  afterAll(() => client.close());
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.socket.terminate();
    await app?.close();
    app = undefined;
  });

  async function start(hubOptions: BuildAppOptions['wsHubOptions'] = {}): Promise<FastifyInstance> {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, PUBLIC_ORIGIN: ORIGIN });
    app = await buildApp({
      config,
      authRepo,
      wsRepo: createWsRepo(db),
      wsHubOptions: { views: TEST_VIEWS, ...hubOptions },
      logger: false,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
    return app;
  }

  const hub = () => {
    if (!app?.wsHub) throw new Error('no hub');
    return app.wsHub;
  };

  /** A player with a live session; returns the raw session token. */
  async function newPlayer(): Promise<{ id: string; token: string }> {
    const { token, tokenHash } = newSessionToken();
    const user = await authRepo.createAccount({
      username: `wskid_${String((counter += 1))}`,
      passwordHash: 'not-a-hash',
      birthYear: 2014,
      timeZone: 'UTC',
      recoveryCodeHash: 'not-a-hash',
      session: { tokenHash, expiresAt: new Date(Date.now() + DAY_MS) },
    });
    return { id: user!.id, token };
  }

  async function newMap(memberIds: string[]): Promise<string> {
    const [map] = await db
      .insert(maps)
      .values({ kind: 'multiplayer', name: 'Live Patch', timeZone: 'UTC' })
      .returning({ id: maps.id });
    await db.insert(mapMembers).values(
      memberIds.map((userId, i) => ({
        mapId: map!.id,
        userId,
        role: i === 0 ? ('owner' as const) : ('member' as const),
      })),
    );
    return map!.id;
  }

  /** Commits an event, then publishes it, the way modules will. */
  async function commitEvent(
    mapId: string,
    type: string,
    payload: Record<string, unknown> = { note: 'boo', secret: 'internal-only-xyzzy' },
  ): Promise<number> {
    const event = await db.transaction((tx) =>
      appendGameEvent(tx, { mapId, type, actorUserId: null, payload }),
    );
    await hub().publish(mapId);
    return event.seq;
  }

  function open(
    token: string | null,
    origin: string | null = ORIGIN,
    options: { autoPong?: boolean } = {},
  ): WebSocket {
    const headers: Record<string, string> = {};
    if (token !== null) headers['cookie'] = `hp_session=${token}`;
    if (origin !== null) headers['origin'] = origin;
    return new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, { headers, ...options });
  }

  /** Connects and waits for `ws.ready`. */
  async function connect(token: string, options: { autoPong?: boolean } = {}) {
    const socket = new TestClient(open(token, ORIGIN, options));
    sockets.push(socket);
    await socket.next(ofType('ws.ready'));
    return socket;
  }

  /** The HTTP status and error code of a refused upgrade. */
  function refused(socket: WebSocket): Promise<{ status: number; code: string }> {
    return new Promise((resolve, reject) => {
      socket.on('open', () => {
        reject(new Error('upgrade should have been refused'));
      });
      socket.on('error', () => undefined);
      socket.on('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            code: ApiErrorSchema.parse(JSON.parse(body)).error.code,
          });
        });
      });
    });
  }

  describe('connecting', () => {
    it('needs a session', async () => {
      await start();
      expect(await refused(open(null))).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
      expect(await refused(open('not-a-real-token'))).toEqual({
        status: 401,
        code: 'UNAUTHENTICATED',
      });
    });

    it('only accepts our own page as the origin', async () => {
      await start();
      const { token } = await newPlayer();
      const evil = await refused(open(token, 'https://pumpkinpatchgames.com'));
      expect(evil).toEqual({ status: 403, code: 'FORBIDDEN' });
      expect(await refused(open(token, null))).toEqual({ status: 403, code: 'FORBIDDEN' });
    });

    it('says ready, and answers pings', async () => {
      await start();
      const { token } = await newPlayer();
      const socket = await connect(token);
      socket.send({ v: 1, type: 'ping' });
      await socket.next(ofType('ws.pong'));
    });

    it('answers a malformed message with BAD_REQUEST and stays open', async () => {
      await start();
      const { token } = await newPlayer();
      const socket = await connect(token);
      socket.socket.send('not json');
      socket.send({ v: 1, type: 'subscribe', mapId: 'nope', afterSeq: 0 });
      await socket.next((m) => m.type === 'ws.error' && 'code' in m && m.code === 'BAD_REQUEST');
      socket.send({ v: 1, type: 'ping' });
      await socket.next(ofType('ws.pong'));
    });

    it('caps open sockets per player', async () => {
      await start();
      const { token } = await newPlayer();
      for (let i = 0; i < 5; i += 1) await connect(token);
      const extra = new TestClient(open(token));
      sockets.push(extra);
      expect((await extra.closed).code).toBe(WS_CLOSE_CODES.TOO_MANY_CONNECTIONS);
    });
  });

  describe('subscribing', () => {
    it('refuses maps the player is not an active member of', async () => {
      await start();
      const alice = await newPlayer();
      const outsider = await newPlayer();
      const mapId = await newMap([alice.id]);
      const socket = await connect(outsider.token);

      socket.subscribe(mapId);
      const error = await socket.next(ofType('ws.error'));
      expect(error).toMatchObject({ code: 'FORBIDDEN', mapId });

      const missing = '0190a8c4-0000-7000-8000-000000000000';
      socket.subscribe(missing);
      await socket.next((m) => m.type === 'ws.error' && m.mapId === missing);
    });

    it('acks with the current seq', async () => {
      await start();
      const alice = await newPlayer();
      const mapId = await newMap([alice.id]);
      await commitEvent(mapId, 'test.pinged');
      await commitEvent(mapId, 'test.pinged');
      const socket = await connect(alice.token);
      socket.subscribe(mapId, 2);
      expect(await socket.next(ofType('ws.subscribed'))).toMatchObject({ mapId, seq: 2 });
    });
  });

  describe('broadcast', () => {
    it("two players see each other's events within a second, and outsiders don't", async () => {
      await start();
      const alice = await newPlayer();
      const bob = await newPlayer();
      const carol = await newPlayer();
      const mapId = await newMap([alice.id, bob.id]);
      const otherMap = await newMap([carol.id]);

      const [a, b, c] = await Promise.all([
        connect(alice.token),
        connect(bob.token),
        connect(carol.token),
      ]);
      a.subscribe(mapId);
      b.subscribe(mapId);
      c.subscribe(otherMap);
      await Promise.all([a, b, c].map((s) => s.next(ofType('ws.subscribed'))));

      const startedAt = Date.now();
      const seq = await commitEvent(mapId, 'test.pinged');
      const [seenByA, seenByB] = await Promise.all([
        a.next(ofType('test.pinged'), { timeoutMs: 1000 }),
        b.next(ofType('test.pinged'), { timeoutMs: 1000 }),
      ]);
      expect(Date.now() - startedAt).toBeLessThan(1000);
      for (const seen of [seenByA, seenByB]) {
        expect(seen).toMatchObject({ v: 1, mapId, seq, data: { note: 'boo' } });
      }
      expect((await c.settle()).filter((m) => m.type === 'test.pinged')).toEqual([]);
    });

    it('sends nothing for events that have not committed yet', async () => {
      await start();
      const alice = await newPlayer();
      const mapId = await newMap([alice.id]);
      const socket = await connect(alice.token);
      socket.subscribe(mapId);
      await socket.next(ofType('ws.subscribed'));
      const before = socket.messages.length;

      await db.transaction(async (tx) => {
        await appendGameEvent(tx, {
          mapId,
          type: 'test.pinged',
          actorUserId: null,
          payload: { note: 'early', secret: 's' },
        });
        // The mistake this design forgives: publishing inside the transaction.
        await hub().publish(mapId);
        expect(await socket.settle(before)).toEqual([]);
      });

      await hub().publish(mapId);
      expect(await socket.next(ofType('test.pinged'), { from: before })).toMatchObject({
        seq: 1,
        data: { note: 'early' },
      });
    });

    it('sends public views only, never internal payload fields', async () => {
      await start();
      const alice = await newPlayer();
      const bob = await newPlayer();
      const mapId = await newMap([alice.id, bob.id]);
      const socket = await connect(alice.token);
      socket.subscribe(mapId);
      await socket.next(ofType('ws.subscribed'));

      await commitEvent(mapId, 'test.pinged');
      const event = await socket.next(ofType('test.pinged'));
      if (event.type !== 'test.pinged' || !('data' in event)) throw new Error('not an event');
      expect(event.data).toEqual({ note: 'boo' });
      expect(socket.raw.join('\n')).not.toContain('internal-only-xyzzy');
    });

    it('skips types without a view and per-recipient skips, moving the cursor instead', async () => {
      await start();
      const alice = await newPlayer();
      const bob = await newPlayer();
      const mapId = await newMap([alice.id, bob.id]);
      const [a, b] = await Promise.all([connect(alice.token), connect(bob.token)]);
      a.subscribe(mapId);
      b.subscribe(mapId);
      await Promise.all([a, b].map((s) => s.next(ofType('ws.subscribed'))));
      const fromA = a.messages.length;
      const fromB = b.messages.length;

      await commitEvent(mapId, 'test.hidden', { secret: 'internal-only-xyzzy' }); // seq 1
      await commitEvent(mapId, 'test.whisper', { to: bob.id, note: 'psst' }); // seq 2
      await commitEvent(mapId, 'test.pinged'); // seq 3

      await a.next(ofType('test.pinged'), { from: fromA });
      await b.next(ofType('test.pinged'), { from: fromB });
      const seqsOf = (ms: WsServerMessage[]) =>
        ms.map((m) => `${m.type}:${'seq' in m ? String(m.seq) : ''}`);
      // Each commit was published on its own, so each skip is its own cursor.
      expect(seqsOf(a.messages.slice(fromA))).toEqual([
        'ws.cursor:1',
        'ws.cursor:2',
        'test.pinged:3',
      ]);
      expect(seqsOf(b.messages.slice(fromB))).toEqual([
        'ws.cursor:1',
        'test.whisper:2',
        'test.pinged:3',
      ]);
      expect([...a.raw, ...b.raw].join('\n')).not.toContain('internal-only-xyzzy');
      expect(a.raw.join('\n')).not.toContain('psst');
    });

    it('stops at once when a player is removed from the map', async () => {
      await start();
      const alice = await newPlayer();
      const bob = await newPlayer();
      const mapId = await newMap([alice.id, bob.id]);
      const b = await connect(bob.token);
      b.subscribe(mapId);
      await b.next(ofType('ws.subscribed'));
      const from = b.messages.length;

      await db.execute(
        `update map_members set status = 'removed' where map_id = '${mapId}' and user_id = '${bob.id}'`,
      );
      await commitEvent(mapId, 'test.pinged');
      expect(await b.next(ofType('ws.error'), { from })).toMatchObject({
        code: 'FORBIDDEN',
        mapId,
      });
      expect((await b.settle(from)).some((m) => m.type === 'test.pinged')).toBe(false);
    });
  });

  describe('replay', () => {
    it('replays what a reconnecting player missed, in order', async () => {
      await start();
      const alice = await newPlayer();
      const mapId = await newMap([alice.id]);
      const first = await connect(alice.token);
      first.subscribe(mapId);
      await first.next(ofType('ws.subscribed'));
      await commitEvent(mapId, 'test.pinged');
      await first.next(ofType('test.pinged'));
      first.close();
      await first.closed;

      await commitEvent(mapId, 'test.pinged', { note: 'two', secret: 's' });
      await commitEvent(mapId, 'test.hidden');
      await commitEvent(mapId, 'test.pinged', { note: 'four', secret: 's' });

      const again = await connect(alice.token);
      again.subscribe(mapId, 1);
      await again.next(ofType('ws.subscribed'));
      expect(again.messages.slice(1)).toEqual([
        expect.objectContaining({ type: 'test.pinged', seq: 2, data: { note: 'two' } }),
        { v: 1, type: 'ws.cursor', mapId, seq: 3 },
        expect.objectContaining({ type: 'test.pinged', seq: 4, data: { note: 'four' } }),
        { v: 1, type: 'ws.subscribed', mapId, seq: 4 },
      ]);
    });

    it('replays across several read batches', async () => {
      await start({ replayBatch: 2 });
      const alice = await newPlayer();
      const mapId = await newMap([alice.id]);
      for (let i = 0; i < 5; i += 1) await commitEvent(mapId, 'test.pinged');
      const socket = await connect(alice.token);
      socket.subscribe(mapId, 0);
      await socket.next(ofType('ws.subscribed'));
      expect(socket.messages.filter(ofType('test.pinged')).map((m) => 'seq' in m && m.seq)).toEqual(
        [1, 2, 3, 4, 5],
      );
    });

    it('answers a re-subscribe (the client asking after a gap) by replaying again', async () => {
      await start();
      const alice = await newPlayer();
      const mapId = await newMap([alice.id]);
      const socket = await connect(alice.token);
      socket.subscribe(mapId);
      await socket.next(ofType('ws.subscribed'));
      await commitEvent(mapId, 'test.pinged');
      await commitEvent(mapId, 'test.pinged');
      await socket.next((m) => m.type === 'test.pinged' && m.seq === 2);
      const from = socket.messages.length;

      socket.subscribe(mapId, 1);
      await socket.next(ofType('ws.subscribed'), { from });
      expect(socket.messages.slice(from).map((m) => m.type)).toEqual([
        'test.pinged',
        'ws.subscribed',
      ]);
    });

    it('asks for a full refetch when the gap is too big, pruned, or ahead of the map', async () => {
      await start({ replayWindow: 3 });
      const alice = await newPlayer();
      const mapId = await newMap([alice.id]);
      for (let i = 0; i < 5; i += 1) await commitEvent(mapId, 'test.pinged');
      const socket = await connect(alice.token);

      socket.subscribe(mapId, 1); // 4 behind > window 3
      await socket.next(ofType('ws.resync'));

      await db.execute(`delete from game_events where map_id = '${mapId}' and seq <= 3`);
      let from = socket.messages.length;
      socket.subscribe(mapId, 2); // seq 3 is gone
      expect(await socket.next(ofType('ws.resync'), { from })).toEqual({
        v: 1,
        type: 'ws.resync',
        mapId,
      });

      from = socket.messages.length;
      socket.subscribe(mapId, 9); // newer than the map itself
      await socket.next(ofType('ws.resync'), { from });

      from = socket.messages.length;
      socket.subscribe(mapId, 3); // within the window and still stored
      expect(await socket.next(ofType('ws.subscribed'), { from })).toMatchObject({ seq: 5 });
      // The resync dropped the subscription; resubscribing caught up from seq 3.
      expect(socket.messages.slice(from).filter(ofType('test.pinged'))).toHaveLength(2);
    });
  });

  describe('heartbeat and sessions', () => {
    it('closes a socket that stops answering pings, and keeps healthy ones', async () => {
      await start({ heartbeatMs: 100 });
      const alice = await newPlayer();
      const healthy = await connect(alice.token);
      const dead = await connect(alice.token, { autoPong: false });
      const { code } = await dead.closed;
      expect(code).toBe(1006); // terminated, no close frame
      expect(healthy.socket.readyState).toBe(WebSocket.OPEN);
    });

    it('closes the socket when the session ends', async () => {
      await start({ heartbeatMs: 100 });
      const alice = await newPlayer();
      const socket = await connect(alice.token);
      await authRepo.deleteSession(hashSessionToken(alice.token));
      expect((await socket.closed).code).toBe(WS_CLOSE_CODES.UNAUTHENTICATED);
      expect(socket.messages.find(ofType('ws.error'))).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('closes every socket when the server shuts down', async () => {
      await start();
      const alice = await newPlayer();
      const socket = await connect(alice.token);
      await app!.close();
      app = undefined;
      expect((await socket.closed).code).toBe(1001);
    });
  });
});
