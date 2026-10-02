import type { WsClientMessage, WsEventMessage } from '@heartpatch/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_BACKOFF } from './ws-backoff.js';
import {
  CONNECT_TIMEOUT_MS,
  createWsClient,
  FAILURES_BEFORE_SESSION_CHECK,
  GAP_TIMEOUT_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  type WsClient,
  type WsClientOptions,
  type WsPage,
  type WsSocket,
} from './ws-client.js';

const MAP = '0190a8c4-0000-7000-8000-000000000001';

class FakeSocket implements WsSocket {
  readyState = 0;
  onopen: WsSocket['onopen'] = null;
  onmessage: WsSocket['onmessage'] = null;
  onclose: WsSocket['onclose'] = null;
  onerror: WsSocket['onerror'] = null;
  readonly sent: WsClientMessage[] = [];
  closedWith: number | undefined;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as WsClientMessage);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1005;
    this.readyState = 3;
  }

  /** The server accepts the connection. */
  ready(): void {
    this.readyState = 1;
    this.receive({ v: 1, type: 'ws.ready' });
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

class FakePage implements WsPage {
  visibilityState: DocumentVisibilityState = 'visible';
  private listeners = new Set<() => void>();
  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.delete(listener);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
  show(): void {
    this.visibilityState = 'visible';
    for (const l of this.listeners) l();
  }
}

const ev = (seq: number): WsEventMessage => ({
  v: 1,
  type: 'tile.updated',
  mapId: MAP,
  seq,
  at: '2026-10-31T21:00:00.000Z',
  data: { q: seq },
});

describe('createWsClient', () => {
  let sockets: FakeSocket[];
  let page: FakePage;
  let applied: number[];
  let resyncs: string[];
  let statuses: string[];
  let client: WsClient | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    page = new FakePage();
    applied = [];
    resyncs = [];
    statuses = [];
  });
  afterEach(() => {
    client?.close();
    client = undefined;
    vi.useRealTimers();
  });

  function start(extra: Partial<WsClientOptions> = {}): WsClient {
    client = createWsClient({
      url: 'ws://test/ws',
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      page,
      random: () => 0.999,
      onEvent: (e) => applied.push(e.seq),
      onResync: (mapId) => resyncs.push(mapId),
      onStatus: (s) => statuses.push(s),
      checkSession: () => Promise.resolve(true),
      ...extra,
    });
    return client;
  }

  const last = () => sockets.at(-1)!;
  const subscribes = (s: FakeSocket) => s.sent.filter((m) => m.type === 'subscribe');

  it('subscribes once ready, from the seq it already has', () => {
    const c = start();
    c.subscribe(MAP, 7);
    expect(last().sent).toEqual([]);
    last().ready();
    expect(c.status).toBe('live');
    expect(last().sent).toEqual([{ v: 1, type: 'subscribe', mapId: MAP, afterSeq: 7 }]);
  });

  it('applies events in seq order, dropping duplicates', () => {
    start().subscribe(MAP, 0);
    last().ready();
    for (const seq of [2, 1, 1, 3, 2]) last().receive(ev(seq));
    expect(applied).toEqual([1, 2, 3]);
  });

  it('moves past skipped seqs on ws.cursor without asking for a replay', () => {
    start().subscribe(MAP, 0);
    last().ready();
    last().receive({ v: 1, type: 'ws.cursor', mapId: MAP, seq: 2 });
    last().receive(ev(3));
    expect(applied).toEqual([3]);
    vi.advanceTimersByTime(GAP_TIMEOUT_MS * 2);
    expect(subscribes(last())).toHaveLength(1);
  });

  it('asks for a replay only when a gap outlasts the timeout', () => {
    start().subscribe(MAP, 0);
    last().ready();
    last().receive(ev(1));
    last().receive(ev(3));
    vi.advanceTimersByTime(GAP_TIMEOUT_MS - 1);
    expect(subscribes(last())).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(subscribes(last()).at(-1)).toMatchObject({ afterSeq: 1 });
    last().receive(ev(2));
    expect(applied).toEqual([1, 2, 3]);
  });

  it('a gap that fills in time asks for nothing', () => {
    start().subscribe(MAP, 0);
    last().ready();
    last().receive(ev(2));
    vi.advanceTimersByTime(GAP_TIMEOUT_MS / 2);
    last().receive(ev(1));
    vi.advanceTimersByTime(GAP_TIMEOUT_MS * 2);
    expect(subscribes(last())).toHaveLength(1);
    expect(applied).toEqual([1, 2]);
  });

  it('reconnects with growing backoff and resumes from the last applied seq', () => {
    start().subscribe(MAP, 0);
    last().ready();
    last().receive(ev(1));
    last().drop();
    expect(statuses.at(-1)).toBe('reconnecting');

    // random() = 0.999: just under the ceiling, which doubles per attempt.
    vi.advanceTimersByTime(RECONNECT_BACKOFF.baseMs - 2);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().drop();
    vi.advanceTimersByTime(RECONNECT_BACKOFF.baseMs * 2 - 1);
    expect(sockets).toHaveLength(3);

    last().ready();
    expect(statuses.at(-1)).toBe('live');
    expect(subscribes(last())).toEqual([{ v: 1, type: 'subscribe', mapId: MAP, afterSeq: 1 }]);

    // Ready resets the backoff.
    last().drop();
    vi.advanceTimersByTime(RECONNECT_BACKOFF.baseMs - 1);
    expect(sockets).toHaveLength(4);
  });

  it('stops after the session ends', () => {
    start();
    last().ready();
    last().drop(4401);
    expect(statuses.at(-1)).toBe('logged-out');
    vi.advanceTimersByTime(RECONNECT_BACKOFF.maxMs * 2);
    page.show();
    expect(sockets).toHaveLength(1);
  });

  it('gives up on a socket that never gets ready', () => {
    start();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(sockets[0]!.closedWith).toBeDefined();
    expect(statuses.at(-1)).toBe('reconnecting');
  });

  it('checks the session after repeated failed connects, and stops if logged out', async () => {
    let checks = 0;
    let loggedIn = true;
    start({
      checkSession: () => {
        checks += 1;
        return Promise.resolve(loggedIn);
      },
    });
    for (let i = 0; i < FAILURES_BEFORE_SESSION_CHECK; i += 1) {
      last().drop();
      vi.runOnlyPendingTimers();
    }
    await Promise.resolve();
    expect(checks).toBe(1);
    expect(statuses.at(-1)).not.toBe('logged-out');

    loggedIn = false;
    for (let i = 0; i < FAILURES_BEFORE_SESSION_CHECK; i += 1) {
      last().drop();
      if (i < FAILURES_BEFORE_SESSION_CHECK - 1) vi.runOnlyPendingTimers();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(checks).toBe(2);
    expect(statuses.at(-1)).toBe('logged-out');
    const count = sockets.length;
    vi.advanceTimersByTime(RECONNECT_BACKOFF.maxMs * 2);
    expect(sockets).toHaveLength(count);
  });

  it('a socket that was live does not count as a failed connect', () => {
    let checks = 0;
    start({
      checkSession: () => {
        checks += 1;
        return Promise.resolve(true);
      },
    });
    for (let i = 0; i < FAILURES_BEFORE_SESSION_CHECK * 2; i += 1) {
      last().ready();
      last().drop();
      vi.runOnlyPendingTimers();
    }
    expect(checks).toBe(0);
  });

  it('hands a resync to the app and stops applying until it resubscribes', () => {
    const c = start();
    c.subscribe(MAP, 3);
    last().ready();
    last().receive({ v: 1, type: 'ws.resync', mapId: MAP });
    expect(resyncs).toEqual([MAP]);
    last().receive(ev(4));
    expect(applied).toEqual([]);
    c.subscribe(MAP, 40);
    expect(subscribes(last()).at(-1)).toMatchObject({ afterSeq: 40 });
  });

  it('reports a refused subscription', () => {
    const errors: unknown[] = [];
    start({ onError: (e) => errors.push(e) }).subscribe(MAP, 0);
    last().ready();
    last().receive({ v: 1, type: 'ws.error', code: 'FORBIDDEN', message: 'Nope!', mapId: MAP });
    expect(errors).toEqual([{ code: 'FORBIDDEN', message: 'Nope!', mapId: MAP }]);
    last().receive(ev(1));
    expect(applied).toEqual([]);
  });

  it('ignores junk and unknown message types', () => {
    start().subscribe(MAP, 0);
    last().ready();
    last().onmessage?.({ data: 'not json' } as MessageEvent);
    last().receive({ v: 1, type: 'ws.someday', mapId: MAP });
    last().receive(ev(1));
    expect(applied).toEqual([1]);
  });

  it('pings, and treats a missing reply as a dead socket', () => {
    start();
    last().ready();
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(last().sent.at(-1)).toEqual({ v: 1, type: 'ping' });
    last().receive({ v: 1, type: 'ws.pong' });
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(PING_INTERVAL_MS - PONG_TIMEOUT_MS);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS);
    expect(sockets[0]!.closedWith).toBeDefined();
    expect(statuses.at(-1)).toBe('reconnecting');
  });

  describe('coming back to the foreground', () => {
    it('reconnects at once instead of waiting out the backoff', () => {
      start();
      last().ready();
      for (let i = 0; i < 6; i += 1) {
        last().drop();
        vi.runOnlyPendingTimers();
      }
      last().drop();
      const count = sockets.length;
      page.show();
      expect(sockets).toHaveLength(count + 1);
    });

    it('catches up and checks a socket that still looks open', () => {
      start().subscribe(MAP, 0);
      last().ready();
      last().receive(ev(1));
      page.show();
      expect(last().sent.slice(-2)).toEqual([
        { v: 1, type: 'subscribe', mapId: MAP, afterSeq: 1 },
        { v: 1, type: 'ping' },
      ]);
      vi.advanceTimersByTime(PONG_TIMEOUT_MS);
      expect(statuses.at(-1)).toBe('reconnecting');
    });
  });

  it('close() stops everything', () => {
    const c = start();
    last().ready();
    c.close();
    client = undefined;
    expect(last().closedWith).toBe(1000);
    expect(page.listenerCount).toBe(0);
    vi.advanceTimersByTime(RECONNECT_BACKOFF.maxMs * 2);
    expect(sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
