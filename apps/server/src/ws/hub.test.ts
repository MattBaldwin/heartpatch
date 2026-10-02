import type { WebSocket } from '@fastify/websocket';
import type { WsServerMessage } from '@heartpatch/shared';
import type { FastifyBaseLogger } from 'fastify';
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
  close(): void {
    this.readyState = 3;
  }
  terminate(): void {
    this.readyState = 3;
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

  it('refuses a public view for an event type clients cannot parse', () => {
    const { repo } = gatedRepo(0);
    const views: PublicViews = { tile_updated: VIEWS['test.pinged'] };
    expect(() =>
      createWsHub({ repo, views, sessionIsValid: () => Promise.resolve(true), logger: silent }),
    ).toThrow(/invalid event type/);
  });
});
