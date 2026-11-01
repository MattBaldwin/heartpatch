import type { WebSocket } from '@fastify/websocket';
import type { WsServerMessage } from '@heartpatch/shared';
import type { FastifyBaseLogger } from 'fastify';
import { PUSH_RULES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { GameEvent } from '../db/game-events.js';
import { createWsHub, type WsHub } from './hub.js';
import { definePublicView, type PublicViews } from './public-views.js';
import type { WsRepo } from './repo.js';

// Unit tests with a fake repo whose reads the test releases by hand, so
// races between a running catch-up and a new client message are exact.

const MAP_A = '0190a8c4-0000-7000-8000-00000000000a';
const MAP_B = '0190a8c4-0000-7000-8000-00000000000b';
const USER = { id: '0190a8c4-0000-7000-8000-0000000000f1', username: 'pip' };

const VIEWS: PublicViews = {
  'test.pinged': definePublicView({ schema: z.object({}), build: () => ({}) }),
};

const silent = { error: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;

const row = (mapId: string, seq: number): GameEvent => ({
  id: `0190a8c4-0000-7000-8000-${String(seq).padStart(12, '0')}`,
  mapId,
  seq,
  type: 'test.pinged',
  actorUserId: null,
  payload: {},
  createdAt: new Date('2026-10-31T21:00:00Z'),
});

/** `eventsAfter` calls wait in `pending` until the test releases them. */
function gatedRepo(head: number) {
  const pending: { mapId: string; afterSeq: number; release: () => void }[] = [];
  const repo: WsRepo = {
    isActiveMember: () => Promise.resolve(true),
    activeMemberIds: () => Promise.resolve(new Set([USER.id])),
    headSeq: () => Promise.resolve(head),
    eventsAfter: (mapId, afterSeq, limit) =>
      new Promise((resolve) => {
        const rows: GameEvent[] = [];
        for (let s = afterSeq + 1; s <= Math.min(head, afterSeq + limit); s += 1) {
          rows.push(row(mapId, s));
        }
        pending.push({
          mapId,
          afterSeq,
          release: () => {
            resolve(rows);
          },
        });
      }),
  };
  return { repo, pending };
}

class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: WsServerMessage[] = [];
  private handlers = new Map<string, (...args: unknown[]) => void>();
  on(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers.set(event, handler);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as WsServerMessage);
  }
  receive(message: unknown): void {
    this.handlers.get('message')?.(Buffer.from(JSON.stringify(message)), false);
  }
  ping(): void {}
  closedWith: number | undefined;
  close(code?: number): void {
    this.closedWith = code;
    this.readyState = 3;
  }
  terminate(): void {
    this.readyState = 3;
  }
  /** The phone went away: the socket's `close` event. */
  emitClose(): void {
    this.readyState = 3;
    this.handlers.get('close')?.();
  }
}

const flush = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i += 1) await flush();
  expect(check()).toBe(true);
}

function setup(head: number): {
  hub: WsHub;
  socket: FakeSocket;
  pending: ReturnType<typeof gatedRepo>['pending'];
} {
  const { repo, pending } = gatedRepo(head);
  const hub = createWsHub({
    repo,
    views: VIEWS,
    sessionIsValid: () => Promise.resolve(true),
    logger: silent,
  });
  const socket = new FakeSocket();
  hub.accept(socket as unknown as WebSocket, USER, 'token');
  return { hub, socket, pending };
}

const seqs = (socket: FakeSocket) =>
  socket.sent.filter((m) => m.type === 'test.pinged').map((m) => ('seq' in m ? m.seq : -1));

describe('WsHub catch-up races', () => {
  it('a re-subscribe mid-read drops the stale rows and replays from the new cursor, in order', async () => {
    const { hub, socket, pending } = setup(5);
    socket.receive({ v: 1, type: 'subscribe', mapId: MAP_A, afterSeq: 3 });
    await until(() => pending.length === 1);

    // While rows 4..5 are being read, the client asks to replay from 1.
    socket.receive({ v: 1, type: 'subscribe', mapId: MAP_A, afterSeq: 1 });
    await flush();
    pending[0]!.release();
    await until(() => pending.length === 2);
    expect(pending[1]!.afterSeq).toBe(1);
    pending[1]!.release();
    await until(() => socket.sent.some((m) => m.type === 'ws.subscribed'));

    expect(seqs(socket)).toEqual([2, 3, 4, 5]);
    expect(socket.sent.filter((m) => m.type === 'ws.subscribed')).toHaveLength(1);
    await hub.close();
  });

  it('switching maps mid-read sends nothing from the old map', async () => {
    const { hub, socket, pending } = setup(2);
    socket.receive({ v: 1, type: 'subscribe', mapId: MAP_A, afterSeq: 0 });
    await until(() => pending.length === 1);
    socket.receive({ v: 1, type: 'subscribe', mapId: MAP_B, afterSeq: 0 });
    await until(() => pending.length === 2);
    pending[0]!.release();
    pending[1]!.release();
    await until(() => socket.sent.some((m) => m.type === 'ws.subscribed'));
    expect(socket.sent.filter((m) => 'mapId' in m && m.mapId === MAP_A)).toEqual([]);
    expect(seqs(socket)).toEqual([1, 2]);
    await hub.close();
  });

  it('unsubscribing mid-read sends nothing', async () => {
    const { hub, socket, pending } = setup(2);
    socket.receive({ v: 1, type: 'subscribe', mapId: MAP_A, afterSeq: 0 });
    await until(() => pending.length === 1);
    socket.receive({ v: 1, type: 'unsubscribe', mapId: MAP_A });
    await flush();
    pending[0]!.release();
    await flush();
    await flush();
    expect(socket.sent.map((m) => m.type)).toEqual(['ws.ready']);
    await hub.close();
  });

  it('close() waits for a read in flight', async () => {
    const { hub, socket, pending } = setup(1);
    socket.receive({ v: 1, type: 'subscribe', mapId: MAP_A, afterSeq: 0 });
    await until(() => pending.length === 1);
    let closed = false;
    const closing = hub.close().then(() => {
      closed = true;
    });
    await flush();
    expect(closed).toBe(false);
    pending[0]!.release();
    await closing;
    expect(closed).toBe(true);
  });

  it('turns away a socket that arrives during shutdown with "going away"', async () => {
    const { hub } = setup(0);
    await hub.close();
    const late = new FakeSocket();
    hub.accept(late as unknown as WebSocket, USER, 'token');
    expect(late.closedWith).toBe(1001);
    expect(late.sent).toEqual([]);
  });

  it('logs a view that throws (a bad stored payload) and skips just that event', async () => {
    const { repo, pending } = gatedRepo(3);
    const errors: unknown[] = [];
    const logger = {
      error: (obj: unknown) => errors.push(obj),
      warn: () => undefined,
    } as unknown as FastifyBaseLogger;
    const views: PublicViews = {
      'test.pinged': definePublicView({
        schema: z.object({}),
        build: (event) => {
          if (event.seq === 2) throw new Error('payload does not match its schema');
          return {};
        },
      }),
    };
    const hub = createWsHub({ repo, views, sessionIsValid: () => Promise.resolve(true), logger });
    const socket = new FakeSocket();
    hub.accept(socket as unknown as WebSocket, USER, 'token');
    socket.receive({ v: 1, type: 'subscribe', mapId: MAP_A, afterSeq: 0 });
    await until(() => pending.length === 1);
    pending[0]!.release();
    await until(() => socket.sent.some((m) => m.type === 'ws.subscribed'));

    expect(seqs(socket)).toEqual([1, 3]);
    expect(errors).toEqual([expect.objectContaining({ seq: 2, type: 'test.pinged' })]);
    await hub.close();
  });

  it('refuses a public view for an event type clients cannot parse', () => {
    const { repo } = gatedRepo(0);
    const views: PublicViews = { tile_updated: VIEWS['test.pinged'] };
    expect(() =>
      createWsHub({ repo, views, sessionIsValid: () => Promise.resolve(true), logger: silent }),
    ).toThrow(/invalid event type/);
  });
});

describe('WsHub arrivals (#726d, the friend nudge)', () => {
  const MINUTE = 60_000;

  function arrivals() {
    const { repo } = gatedRepo(0);
    const clock = new Date('2026-10-14T18:00:00Z');
    const seen: { mapId: string; userId: string; awayMs: number | null }[] = [];
    const errors: unknown[] = [];
    const logger = {
      error: (obj: unknown) => errors.push(obj),
      warn: () => undefined,
    } as unknown as FastifyBaseLogger;
    let throws = false;
    const hub = createWsHub({
      repo,
      views: VIEWS,
      sessionIsValid: () => Promise.resolve(true),
      logger,
      clock: () => clock,
      onSubscribed: (mapId, userId, awayMs) => {
        seen.push({ mapId, userId, awayMs });
        if (throws) throw new Error('push is having a day');
      },
    });
    /** A new socket for USER, subscribed to `mapId` (`afterSeq` 0 is caught up). */
    const arrive = async (mapId = MAP_A, afterSeq = 0) => {
      const socket = new FakeSocket();
      hub.accept(socket as unknown as WebSocket, USER, 'token');
      socket.receive({ v: 1, type: 'subscribe', mapId, afterSeq });
      await until(() =>
        socket.sent.some((m) => m.type === 'ws.subscribed' || m.type === 'ws.resync'),
      );
      return socket;
    };
    const later = (minutes: number) => {
      clock.setTime(clock.getTime() + minutes * MINUTE);
    };
    return { hub, seen, errors, arrive, later, clock, throwing: () => (throws = true) };
  }

  it('counts the first arrival since the server started as long ago (awayMs null)', async () => {
    const { hub, seen, arrive } = arrivals();
    expect(hub.lastOfflineAt(MAP_A, USER.id)).toBeNull();
    await arrive();
    expect(seen).toEqual([{ mapId: MAP_A, userId: USER.id, awayMs: null }]);
    await hub.close();
  });

  it('remembers when the last socket left, and fires only after the away threshold', async () => {
    const { hub, seen, arrive, later, clock } = arrivals();
    const first = await arrive();
    later(1);
    first.emitClose();
    expect(hub.lastOfflineAt(MAP_A, USER.id)).toEqual(clock);

    // A quick reconnect (the app resuming) is not an arrival.
    later(PUSH_RULES.friendArriverAwayMinutes - 1);
    const resumed = await arrive();
    expect(seen).toHaveLength(1);
    resumed.emitClose();

    // Back after the threshold: an arrival, with how long they were gone.
    later(PUSH_RULES.friendArriverAwayMinutes);
    await arrive();
    expect(seen).toEqual([
      { mapId: MAP_A, userId: USER.id, awayMs: null },
      { mapId: MAP_A, userId: USER.id, awayMs: PUSH_RULES.friendArriverAwayMinutes * MINUTE },
    ]);
    await hub.close();
  });

  it('a second device on the same map is not an arrival, and a replay is not either', async () => {
    const { hub, seen, arrive } = arrivals();
    const phone = await arrive();
    await arrive();
    phone.receive({ v: 1, type: 'subscribe', mapId: MAP_A, afterSeq: 0 });
    await until(() => phone.sent.filter((m) => m.type === 'ws.subscribed').length === 2);
    expect(seen).toHaveLength(1);
    await hub.close();
  });

  it('switching maps leaves the old one (its time is kept) and arrives on the new one', async () => {
    const { hub, seen, arrive, clock } = arrivals();
    const socket = await arrive(MAP_A);
    socket.receive({ v: 1, type: 'subscribe', mapId: MAP_B, afterSeq: 0 });
    await until(() => seen.length === 2);
    expect(seen[1]).toEqual({ mapId: MAP_B, userId: USER.id, awayMs: null });
    expect(hub.lastOfflineAt(MAP_A, USER.id)).toEqual(clock);
    expect(hub.lastOfflineAt(MAP_B, USER.id)).toBeNull();
    await hub.close();
  });

  it('a subscription sent to resync before ws.subscribed keeps the old time', async () => {
    const { hub, seen, arrive } = arrivals();
    // Its cursor is ahead of the map's head: resync, never subscribed.
    const stale = await arrive(MAP_A, 5);
    expect(stale.sent.map((m) => m.type)).toContain('ws.resync');
    expect(seen).toEqual([]);
    expect(hub.lastOfflineAt(MAP_A, USER.id)).toBeNull();
    // The client's fresh subscribe right after is still the arrival.
    stale.receive({ v: 1, type: 'subscribe', mapId: MAP_A, afterSeq: 0 });
    await until(() => seen.length === 1);
    expect(seen[0]!.awayMs).toBeNull();
    await hub.close();
  });

  it('logs an onSubscribed that throws and carries on', async () => {
    const { hub, seen, errors, arrive, throwing } = arrivals();
    throwing();
    const socket = await arrive();
    expect(seen).toHaveLength(1);
    expect(errors).toEqual([expect.objectContaining({ mapId: MAP_A })]);
    socket.receive({ v: 1, type: 'ping' });
    await until(() => socket.sent.some((m) => m.type === 'ws.pong'));
    await hub.close();
  });
});
