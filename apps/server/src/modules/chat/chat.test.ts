import {
  ApiErrorSchema,
  JoinMapResponseSchema,
  MapResponseSchema,
  QUICK_MESSAGES,
  QuickMessageFeedResponseSchema,
  SendQuickMessageResponseSchema,
  type PublicUser,
} from '@heartpatch/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDbClient, type Database, type DbClient } from '../../db/client.js';
import { keepers, mapMembers, maps, sessions, users } from '../../db/schema.js';
import { PUBLIC_VIEWS, publicViewFor } from '../../ws/public-views.js';
import { SESSION_COOKIE } from '../auth/limits.js';
import { newSessionToken } from '../auth/secrets.js';
import { CHAT_MAP_SEND_LIMIT, CHAT_RATE_LIMITS } from './limits.js';
import { createChatService } from './service.js';

const url = inject('testDatabaseUrl');
const HEADERS = { 'x-requested-with': 'heartpatch' };
const DAY_MS = 24 * 60 * 60 * 1000;
const TEST_KEEPER = { base: 'pip', hairColor: 'honey', eyeColor: 'sky', outfit: 'sunflower' };
const START = '2026-10-02T18:00:00Z';

interface Player extends PublicUser {
  token: string;
}

describe.skipIf(!url)('quick messages (needs DATABASE_URL)', () => {
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
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! });
    app = await buildApp({ config, db, clock: () => clock, logger: false });
    return app;
  }

  async function player(): Promise<Player> {
    const username = `chatter_${String((counter += 1))}`;
    const [user] = await db
      .insert(users)
      .values({ username, passwordHash: 'not-a-hash', birthYear: 2014, timeZone: 'America/Denver' })
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
  const send = (server: FastifyInstance, who: Player, mapId: string, messageId: string) =>
    call(server, 'POST', `/maps/${mapId}/chat`, who, { messageId });
  async function feed(server: FastifyInstance, who: Player, mapId: string) {
    const res = await call(server, 'GET', `/maps/${mapId}/chat`, who);
    expect(res.statusCode, res.body).toBe(200);
    return QuickMessageFeedResponseSchema.parse(res.json()).messages;
  }

  /** A patch made by `owner` with `others` approved into it. */
  async function patch(server: FastifyInstance, owner: Player, ...others: Player[]) {
    const res = await call(server, 'POST', '/maps', owner, {
      name: 'Chatty Patch',
      timeZone: 'America/Denver',
    });
    expect(res.statusCode).toBe(201);
    const map = MapResponseSchema.parse(res.json()).map;
    for (const other of others) {
      const joined = await call(server, 'POST', '/maps/join', other, {
        code: map.admin!.invite!.code,
      });
      expect(joined.statusCode).toBe(201);
      const request = JoinMapResponseSchema.parse(joined.json()).request;
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

  const rowsOf = (mapId: string) =>
    db.query.quickMessages.findMany({ where: (t, { eq }) => eq(t.mapId, mapId) });
  const eventsOf = (mapId: string) =>
    db.query.gameEvents.findMany({
      where: (t, { and, eq }) => and(eq(t.mapId, mapId), eq(t.type, 'chat.quick')),
      orderBy: (t, { asc }) => [asc(t.seq)],
    });

  it('sends a preset by id to everyone on the patch, with a chat.quick event', async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch(server, kid, pal);

    const res = await send(server, kid, mapId, 'getting-dark');
    expect(res.statusCode, res.body).toBe(200);
    const { message } = SendQuickMessageResponseSchema.parse(res.json());
    expect(message).toMatchObject({
      userId: kid.id,
      username: kid.username,
      messageId: 'getting-dark',
      sentAt: START.replace('Z', '.000Z'),
    });

    // Only the id and the sender are stored: no words, no free text.
    const row = await db.query.quickMessages.findFirst({
      where: (t, { eq }) => eq(t.id, message.id),
    });
    expect(row).toMatchObject({ mapId, userId: kid.id, messageId: 'getting-dark' });

    const [event] = await eventsOf(mapId);
    expect(event).toMatchObject({ actorUserId: kid.id });
    const expected = {
      chatId: message.id,
      userId: kid.id,
      username: kid.username,
      messageId: 'getting-dark',
    };
    expect(event!.payload).toEqual(expected);
    expect(publicViewFor(PUBLIC_VIEWS, event!, { userId: pal.id })).toEqual(expected);

    // Both see it in the feed.
    clock.setTime(clock.getTime() + 1000);
    expect((await send(server, pal, mapId, 'sticker-glowboo')).statusCode).toBe(200);
    for (const who of [kid, pal]) {
      expect((await feed(server, who, mapId)).map((m) => [m.username, m.messageId])).toEqual([
        [kid.username, 'getting-dark'],
        [pal.username, 'sticker-glowboo'],
      ]);
    }
  });

  it('sends a retried tap once (same Idempotency-Key)', async () => {
    const server = await start();
    const kid = await player();
    const mapId = await patch(server, kid);
    const tap = (key: string) =>
      server.inject({
        method: 'POST',
        url: `/api/v1/maps/${mapId}/chat`,
        headers: { ...HEADERS, 'idempotency-key': key },
        cookies: { [SESSION_COOKIE]: kid.token },
        payload: { messageId: 'heart' },
      });
    const first = await tap('chat-retry-1');
    expect(first.statusCode, first.body).toBe(200);
    const again = await tap('chat-retry-1');
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const sent = SendQuickMessageResponseSchema.parse(first.json()).message;
    expect(SendQuickMessageResponseSchema.parse(again.json()).message.id).toBe(sent.id);
    expect(await rowsOf(mapId)).toHaveLength(1);
    expect(await eventsOf(mapId)).toHaveLength(1);

    // A new tap is a new message.
    expect((await tap('chat-retry-2')).statusCode).toBe(200);
    expect(await rowsOf(mapId)).toHaveLength(2);
    expect(await eventsOf(mapId)).toHaveLength(2);
  });

  it('refuses unknown ids, non-members, strangers and the Tutorial Glade', async () => {
    const server = await start();
    const kid = await player();
    const stranger = await player();
    const mapId = await patch(server, kid);

    const unknown = await send(server, kid, mapId, 'free-text-please');
    expect(unknown.statusCode).toBe(400);
    expect(errorOf(unknown).code).toBe('VALIDATION_FAILED');
    // Not an id at all: the shared request schema stops it.
    const text = await call(server, 'POST', `/maps/${mapId}/chat`, kid, {
      messageId: 'Hello, my phone is 555-1234',
    });
    expect(text.statusCode).toBe(400);
    const extra = await call(server, 'POST', `/maps/${mapId}/chat`, kid, {
      messageId: 'hi',
      text: 'sneaky',
    });
    expect(extra.statusCode).toBe(400);

    expect((await send(server, stranger, mapId, 'hi')).statusCode).toBe(404);
    expect((await call(server, 'GET', `/maps/${mapId}/chat`, stranger)).statusCode).toBe(404);
    expect((await call(server, 'GET', `/maps/${mapId}/chat`, null)).statusCode).toBe(401);

    const [glade] = await db
      .insert(maps)
      .values({ kind: 'tutorial', name: 'Tutorial Glade', timeZone: 'UTC', maxPlayers: 1 })
      .returning({ id: maps.id });
    await db.insert(mapMembers).values({ mapId: glade!.id, userId: kid.id, role: 'owner' });
    const quiet = await send(server, kid, glade!.id, 'hi');
    expect(quiet.statusCode).toBe(403);
    expect(errorOf(quiet).message).toMatch(/Tutorial Glade/);
    expect((await call(server, 'GET', `/maps/${glade!.id}/chat`, kid)).statusCode).toBe(403);

    expect(await eventsOf(mapId)).toEqual([]);
    expect(await feed(server, kid, mapId)).toEqual([]);
  });

  it('rate limits each player (standing in for mute in Phase 1)', async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch(server, kid, pal);
    const max = CHAT_RATE_LIMITS.send.perUser.max;
    for (let i = 0; i < max; i++) {
      expect((await send(server, kid, mapId, 'heart')).statusCode).toBe(200);
    }
    const slow = await send(server, kid, mapId, 'heart');
    expect(slow.statusCode).toBe(429);
    expect(errorOf(slow).code).toBe('RATE_LIMITED');
    expect(slow.headers['retry-after']).toBeDefined();
    // Someone else still gets a word in.
    expect((await send(server, pal, mapId, 'giggle')).statusCode).toBe(200);
    expect(await eventsOf(mapId)).toHaveLength(max + 1);
  });

  it('rate limits a whole patch together', async () => {
    const server = await start();
    const perUser = CHAT_RATE_LIMITS.send.perUser.max;
    const crowd = await Promise.all(
      Array.from({ length: Math.ceil((CHAT_MAP_SEND_LIMIT.max + 1) / perUser) }, () => player()),
    );
    const [owner, ...rest] = crowd;
    const mapId = await patch(server, owner!, ...rest);
    // Another patch's limit is its own.
    const other = await player();
    const otherMap = await patch(server, other);

    const codes: number[] = [];
    for (const who of crowd) {
      for (let i = 0; i < perUser; i++)
        codes.push((await send(server, who, mapId, 'wave')).statusCode);
    }
    expect(codes.filter((c) => c === 200)).toHaveLength(CHAT_MAP_SEND_LIMIT.max);
    expect(codes.slice(CHAT_MAP_SEND_LIMIT.max).every((c) => c === 429)).toBe(true);
    expect((await send(server, other, otherMap, 'wave')).statusCode).toBe(200);
  });

  it('keeps only the latest messages per patch, newest last', async () => {
    const server = await start();
    const kid = await player();
    const pal = await player();
    const mapId = await patch(server, kid, pal);
    const otherMap = await patch(server, pal);
    const service = createChatService({ db, clock: () => clock, feedLimit: 3 });
    const ids = ['hi', 'so-cute', 'nice-move', 'thank-you', 'good-night'];
    for (const id of ids) {
      clock.setTime(clock.getTime() + 1000);
      await service.send(kid, mapId, id);
    }
    await service.send(pal, otherMap, 'oops');

    expect((await service.feed(pal, mapId)).map((m) => m.messageId)).toEqual([
      'nice-move',
      'thank-you',
      'good-night',
    ]);
    const rows = await rowsOf(mapId);
    expect(rows).toHaveLength(3);
    // Another patch's messages are untouched.
    expect((await service.feed(pal, otherMap)).map((m) => m.messageId)).toEqual(['oops']);
    // Every send was still an event (live sync and replay).
    expect(await eventsOf(mapId)).toHaveLength(ids.length);
    // The real feed is the data's length.
    expect(QUICK_MESSAGES.feedLimit).toBeGreaterThanOrEqual(3);
  });

  it('keeps a patch’s messages consistent when many players send at once', async () => {
    const server = await start();
    // A full patch (four players), three taps each.
    const crowd = await Promise.all(Array.from({ length: 4 }, () => player()));
    const [owner, ...rest] = crowd;
    const mapId = await patch(server, owner!, ...rest);
    const service = createChatService({ db, clock: () => clock, feedLimit: 4 });
    await Promise.all(
      crowd.flatMap((who) => ['heart', 'wave', 'giggle'].map((id) => service.send(who, mapId, id))),
    );
    const events = await eventsOf(mapId);
    expect(events).toHaveLength(12);
    // Gap-free seqs, one per send.
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => seqs[0]! + i));
    // Skipped prunes catch up on the next send.
    await service.send(owner!, mapId, 'sparkles');
    expect(await rowsOf(mapId)).toHaveLength(4);
  });
});
