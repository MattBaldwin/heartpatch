import type { WebSocket } from '@fastify/websocket';
import {
  DEFAULT_ERROR_MESSAGES,
  WS_CLOSE_CODES,
  WS_PROTOCOL_VERSION,
  WsClientMessageSchema,
  WsEventTypeSchema,
  type ErrorCode,
  type PublicUser,
  type WsClientMessage,
  type WsServerMessage,
} from '@heartpatch/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { GameEvent } from '../db/game-events.js';
import {
  CLIENT_MESSAGE_LIMIT,
  HEARTBEAT_MS,
  MAX_BUFFERED_BYTES,
  MAX_SOCKETS_PER_USER,
  REPLAY_BATCH,
  REPLAY_WINDOW,
} from './limits.js';
import { publicViewFor, type PublicViews } from './public-views.js';
import type { WsRepo } from './repo.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Live sync; null when `buildApp` got no `wsRepo` (tests without the database). */
    wsHub: WsHub | null;
  }
}

/**
 * Live world sync (tech spec §5 "WebSocket", §7 "Game event stream").
 *
 * The hub never takes events from callers. `publish(mapId)` only says "this
 * map has new committed events"; the hub then reads them from `game_events`
 * on its own connection and sends each subscriber the public views it hasn't
 * had yet. So:
 * - only **committed** events can go out. A `publish` from inside a
 *   transaction sees nothing new and is harmless; the events go out on the
 *   next publish or heartbeat instead.
 * - live delivery and reconnect replay are the same code path, and each
 *   socket gets its events in `seq` order.
 * - commits happen in `seq` order (the `maps` row lock in `appendGameEvent`),
 *   so the committed events of a map are always a gap-free run of seqs.
 */
export interface WsHub {
  /**
   * Call **after** a transaction that appended game events to `mapId` has
   * committed. Never rejects; resolves once the new events are sent.
   */
  publish: (mapId: string) => Promise<void>;
  /** Serves an authenticated socket until it closes. */
  accept: (socket: WebSocket, user: PublicUser, sessionToken: string) => void;
  /** Stops the heartbeat, closes every socket and waits for in-flight reads. */
  close: () => Promise<void>;
}

export interface WsHubOptions {
  repo: WsRepo;
  views: PublicViews;
  /** Re-checked every heartbeat, so logout or a password reset ends live sync too. */
  sessionIsValid: (sessionToken: string) => Promise<boolean>;
  logger: FastifyBaseLogger;
  /** Tests shorten it. */
  heartbeatMs?: number;
  replayWindow?: number;
  replayBatch?: number;
}

interface Connection {
  socket: WebSocket;
  userId: string;
  sessionToken: string;
  subscription: Subscription | null;
  alive: boolean;
  /** Client messages are handled one at a time, in order. */
  queue: Promise<void>;
  windowStart: number;
  windowCount: number;
}

interface Subscription {
  conn: Connection;
  mapId: string;
  /** Everything up to here that is for this player has been sent. */
  cursor: number;
  /** Bumped when the client re-subscribes, so in-flight work for the old cursor is dropped. */
  gen: number;
  /** `ws.subscribed` is still owed once the subscriber catches up. */
  needsAck: boolean;
}

// Kid-readable (style guide §6).
const NOT_MEMBER_MESSAGE = "That map isn't one of yours. Ask its owner for an invite!";

export function createWsHub(options: WsHubOptions): WsHub {
  const { repo, views, logger } = options;
  const replayWindow = options.replayWindow ?? REPLAY_WINDOW;
  const replayBatch = options.replayBatch ?? REPLAY_BATCH;
  // A type the client can't parse would be ignored there, leave a gap and
  // trigger replays forever, so refuse it up front.
  for (const type of Object.keys(views)) {
    if (!WsEventTypeSchema.safeParse(type).success) {
      throw new Error(`public view for invalid event type: ${type}`);
    }
  }

  const connections = new Set<Connection>();
  const byUser = new Map<string, Set<Connection>>();
  const channels = new Map<string, Set<Subscription>>();
  /** A running catch-up per map; `again` asks it to go round once more. */
  const pumps = new Map<string, { again: boolean; done: Promise<void> }>();
  let closed = false;

  const send = (conn: Connection, message: WsServerMessage): void => {
    const { socket } = conn;
    if (socket.readyState !== socket.OPEN) return;
    // A socket that can't keep up is dropped; it replays on reconnect.
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(message));
  };

  const sendError = (conn: Connection, code: ErrorCode, mapId?: string): void => {
    const message = code === 'FORBIDDEN' ? NOT_MEMBER_MESSAGE : DEFAULT_ERROR_MESSAGES[code];
    send(conn, {
      v: WS_PROTOCOL_VERSION,
      type: 'ws.error',
      code,
      message,
      ...(mapId ? { mapId } : {}),
    });
  };

  const unsubscribe = (conn: Connection): void => {
    const sub = conn.subscription;
    if (!sub) return;
    conn.subscription = null;
    const channel = channels.get(sub.mapId);
    channel?.delete(sub);
    if (channel?.size === 0) channels.delete(sub.mapId);
  };

  /** Ends a subscription the server can't continue, telling the client why. */
  const endSubscription = (sub: Subscription, reason: 'forbidden' | 'resync'): void => {
    if (sub.conn.subscription !== sub) return;
    unsubscribe(sub.conn);
    if (reason === 'resync') {
      send(sub.conn, { v: WS_PROTOCOL_VERSION, type: 'ws.resync', mapId: sub.mapId });
    } else {
      sendError(sub.conn, 'FORBIDDEN', sub.mapId);
    }
  };

  const isCurrent = (sub: Subscription, gen: number): boolean =>
    sub.gen === gen && sub.conn.subscription === sub;

  /**
   * Sends `sub` its events from `rows` (a gap-free run of seqs, oldest
   * first), as public views. Events with no view for this player are
   * skipped, and a `ws.cursor` tells the client those seqs are done, so it
   * never waits for them as a gap.
   */
  const deliver = (sub: Subscription, rows: readonly GameEvent[]): void => {
    let through = sub.cursor;
    for (const row of rows) {
      if (row.seq <= through) continue;
      if (row.seq !== through + 1) break;
      let data: Record<string, unknown> | null;
      try {
        data = publicViewFor(views, row, { userId: sub.conn.userId });
      } catch (err) {
        logger.error({ err, mapId: row.mapId, seq: row.seq, type: row.type }, 'public view failed');
        data = null;
      }
      if (data !== null) {
        if (through > sub.cursor) {
          send(sub.conn, {
            v: WS_PROTOCOL_VERSION,
            type: 'ws.cursor',
            mapId: sub.mapId,
            seq: through,
          });
        }
        send(sub.conn, {
          v: WS_PROTOCOL_VERSION,
          type: row.type,
          mapId: row.mapId,
          seq: row.seq,
          at: row.createdAt.toISOString(),
          data,
        });
        sub.cursor = row.seq;
      }
      through = row.seq;
    }
    if (through > sub.cursor) {
      send(sub.conn, { v: WS_PROTOCOL_VERSION, type: 'ws.cursor', mapId: sub.mapId, seq: through });
      sub.cursor = through;
    }
  };

  /** Brings every subscriber of `mapId` up to the latest committed seq. */
  const catchUp = async (mapId: string): Promise<void> => {
    for (;;) {
      const channel = channels.get(mapId);
      if (!channel || closed) return;
      const targets = [...channel].map((sub) => ({ sub, gen: sub.gen }));
      const [head, members] = await Promise.all([repo.headSeq(mapId), repo.activeMemberIds(mapId)]);

      const behind: typeof targets = [];
      for (const target of targets) {
        const { sub } = target;
        if (!isCurrent(sub, target.gen)) continue;
        // Removed from the map (or the map is gone): stop at once.
        if (head === null || !members.has(sub.conn.userId)) {
          endSubscription(sub, 'forbidden');
        } else if (sub.cursor > head || head - sub.cursor > replayWindow) {
          endSubscription(sub, 'resync');
        } else if (sub.cursor < head) {
          behind.push(target);
        } else if (sub.needsAck) {
          sub.needsAck = false;
          send(sub.conn, {
            v: WS_PROTOCOL_VERSION,
            type: 'ws.subscribed',
            mapId,
            seq: sub.cursor,
          });
        }
      }
      if (behind.length === 0) return;

      const from = Math.min(...behind.map((t) => t.sub.cursor));
      const rows = await repo.eventsAfter(mapId, from, replayBatch);
      const first = rows[0]?.seq;
      for (const { sub, gen } of behind) {
        if (!isCurrent(sub, gen)) continue;
        // The events right after its cursor were pruned: it can't be replayed.
        if (first === undefined || sub.cursor + 1 < first) endSubscription(sub, 'resync');
        else deliver(sub, rows);
      }
    }
  };

  const pump = (mapId: string): Promise<void> => {
    const running = pumps.get(mapId);
    if (running) {
      running.again = true;
      return running.done;
    }
    const state = { again: true, done: Promise.resolve() };
    state.done = (async () => {
      while (state.again) {
        state.again = false;
        try {
          await catchUp(mapId);
        } catch (err) {
          // Subscribers stay; the next publish or heartbeat tries again.
          logger.error({ err, mapId }, 'live sync catch-up failed');
        }
      }
      pumps.delete(mapId);
    })();
    pumps.set(mapId, state);
    return state.done;
  };

  const subscribe = async (conn: Connection, mapId: string, afterSeq: number): Promise<void> => {
    if (!(await repo.isActiveMember(mapId, conn.userId))) {
      // A new subscribe replaces the old one, even when it is refused.
      unsubscribe(conn);
      sendError(conn, 'FORBIDDEN', mapId);
      return;
    }
    if (!connections.has(conn)) return;
    const current = conn.subscription;
    if (current?.mapId === mapId) {
      // A replay request: rewind and catch up again.
      current.cursor = afterSeq;
      current.gen += 1;
      current.needsAck = true;
    } else {
      unsubscribe(conn);
      const sub: Subscription = { conn, mapId, cursor: afterSeq, gen: 0, needsAck: true };
      conn.subscription = sub;
      const channel = channels.get(mapId) ?? new Set<Subscription>();
      channel.add(sub);
      channels.set(mapId, channel);
    }
    // Not awaited, so this socket's next message (a ping) doesn't wait on a long replay.
    void pump(mapId);
  };

  const handle = async (conn: Connection, message: WsClientMessage): Promise<void> => {
    switch (message.type) {
      case 'subscribe':
        await subscribe(conn, message.mapId, message.afterSeq);
        return;
      case 'unsubscribe':
        if (conn.subscription?.mapId === message.mapId) unsubscribe(conn);
        return;
      case 'ping':
        send(conn, { v: WS_PROTOCOL_VERSION, type: 'ws.pong' });
        return;
    }
  };

  /** Counts a client message; false (and the socket closing) once over the limit. */
  const withinLimit = (conn: Connection): boolean => {
    conn.alive = true;
    const now = Date.now();
    if (now - conn.windowStart >= CLIENT_MESSAGE_LIMIT.windowMs) {
      conn.windowStart = now;
      conn.windowCount = 0;
    }
    conn.windowCount += 1;
    if (conn.windowCount <= CLIENT_MESSAGE_LIMIT.max) return true;
    sendError(conn, 'RATE_LIMITED');
    drop(conn);
    conn.socket.close(1008, 'rate limited');
    return false;
  };

  const onMessage = (conn: Connection, raw: string): void => {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = undefined;
    }
    const parsed = WsClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      sendError(conn, 'BAD_REQUEST');
      return;
    }
    conn.queue = conn.queue
      .then(() => handle(conn, parsed.data))
      .catch((err: unknown) => {
        logger.error({ err, type: parsed.data.type }, 'live sync message failed');
        sendError(conn, 'INTERNAL');
      });
  };

  const drop = (conn: Connection): void => {
    if (!connections.delete(conn)) return;
    unsubscribe(conn);
    const mine = byUser.get(conn.userId);
    mine?.delete(conn);
    if (mine?.size === 0) byUser.delete(conn.userId);
  };

  const checkSession = async (conn: Connection): Promise<void> => {
    let valid: boolean;
    try {
      valid = await options.sessionIsValid(conn.sessionToken);
    } catch (err) {
      logger.warn({ err }, 'live sync session check failed');
      return; // Database hiccup: keep the socket, check again next beat.
    }
    if (valid || !connections.has(conn)) return;
    sendError(conn, 'UNAUTHENTICATED');
    drop(conn);
    conn.socket.close(WS_CLOSE_CODES.UNAUTHENTICATED, 'session ended');
  };

  const heartbeat = setInterval(() => {
    for (const conn of connections) {
      // No pong since the last ping: the phone went away without closing.
      if (!conn.alive) {
        drop(conn);
        conn.socket.terminate();
        continue;
      }
      conn.alive = false;
      conn.socket.ping();
      void checkSession(conn);
    }
    // Safety net for a missed publish: nothing to do if everyone is caught up.
    for (const mapId of channels.keys()) void pump(mapId);
  }, options.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref();

  return {
    publish: (mapId) => (channels.has(mapId) ? pump(mapId) : Promise.resolve()),

    accept: (socket, user, sessionToken) => {
      const conn: Connection = {
        socket,
        userId: user.id,
        sessionToken,
        subscription: null,
        alive: true,
        queue: Promise.resolve(),
        windowStart: Date.now(),
        windowCount: 0,
      };
      if (closed) {
        socket.close(1001, 'server shutting down');
        return;
      }
      const mine = byUser.get(user.id) ?? new Set<Connection>();
      if (mine.size >= MAX_SOCKETS_PER_USER) {
        socket.close(WS_CLOSE_CODES.TOO_MANY_CONNECTIONS, 'too many connections');
        return;
      }
      mine.add(conn);
      byUser.set(user.id, mine);
      connections.add(conn);

      socket.on('pong', () => {
        conn.alive = true;
      });
      socket.on('message', (data, isBinary) => {
        if (!withinLimit(conn)) return;
        if (isBinary) {
          sendError(conn, 'BAD_REQUEST');
          return;
        }
        // ws hands text frames over as a Buffer (its default binaryType).
        const text = Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Buffer.concat(Array.isArray(data) ? data : [new Uint8Array(data)]).toString('utf8');
        onMessage(conn, text);
      });
      socket.on('close', () => {
        drop(conn);
      });
      send(conn, { v: WS_PROTOCOL_VERSION, type: 'ws.ready' });
    },

    close: async () => {
      closed = true;
      clearInterval(heartbeat);
      const queues = [...connections].map((conn) => conn.queue);
      for (const conn of [...connections]) {
        drop(conn);
        conn.socket.close(1001, 'server shutting down');
      }
      // Let in-flight reads finish before the app closes the database pool.
      await Promise.all([...queues, ...[...pumps.values()].map((p) => p.done)]);
    },
  };
}
