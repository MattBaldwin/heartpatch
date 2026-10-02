import {
  WS_CLOSE_CODES,
  WS_PROTOCOL_VERSION,
  WsControlMessageSchema,
  WsEventMessageSchema,
  type ErrorCode,
  type WsClientMessage,
  type WsEventMessage,
} from '@heartpatch/shared';
import { authApi } from '../ui/auth/auth-api.js';
import { reconnectDelay } from './ws-backoff.js';
import { ReorderBuffer } from './ws-reorder.js';

/** How long an early event waits for the ones before it before asking for a replay. */
export const GAP_TIMEOUT_MS = 1_000; // TUNE: guess
/** App-level ping while connected, matching the server heartbeat (tech spec §5). */
export const PING_INTERVAL_MS = 25_000;
/** No reply this long after a ping means the socket is dead. */
export const PONG_TIMEOUT_MS = 10_000; // TUNE: guess
/** A socket not ready this long after opening is given up on (iOS network handovers). */
export const CONNECT_TIMEOUT_MS = 10_000; // TUNE: guess
/**
 * Every this many failed connects in a row, check the session. A refused upgrade
 * (expired session) looks like any other failure to a browser socket.
 */
export const FAILURES_BEFORE_SESSION_CHECK = 3; // TUNE: guess

/**
 * - `connecting`: first connection.
 * - `live`: connected; events flow.
 * - `reconnecting`: lost; trying again (show the friendly "reconnecting" state).
 * - `logged-out`: the session ended; the player must log in again.
 */
export type WsStatus = 'connecting' | 'live' | 'reconnecting' | 'logged-out';

export interface WsServerError {
  code: ErrorCode;
  message: string;
  mapId?: string;
}

/** The parts of a browser `WebSocket` the client uses (tests pass a fake). */
export interface WsSocket {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

/** The parts of `document` the client uses. */
export interface WsPage {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
}

export interface WsClientOptions {
  /** Applies one event to the client store. Called in `seq` order, once per event. */
  onEvent: (event: WsEventMessage) => void;
  /**
   * Too much was missed to replay: refetch the map's state over REST, then
   * call `subscribe(mapId, seqOfThatState)`. Live events for it stop until then.
   */
  onResync: (mapId: string) => void;
  /** A refused subscription (`FORBIDDEN`) or other server error. */
  onError?: (error: WsServerError) => void;
  onStatus?: (status: WsStatus) => void;
  /** Defaults to `/ws` on this page's host. */
  url?: string;
  createSocket?: (url: string) => WsSocket;
  page?: WsPage;
  random?: () => number;
  /** True while logged in; defaults to `GET /api/v1/me`. Errors count as "can't tell". */
  checkSession?: () => Promise<boolean>;
}

export interface WsClient {
  /**
   * Follow a map. `afterSeq` is the seq of the state the client already has
   * (from its REST snapshot); everything after it is replayed, then live.
   */
  subscribe: (mapId: string, afterSeq: number) => void;
  unsubscribe: () => void;
  readonly status: WsStatus;
  /** Closes the socket for good and removes every listener and timer. */
  close: () => void;
}

const OPEN = 1;

function defaultUrl(): string {
  const url = new URL('/ws', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/**
 * One live connection to `/ws` (tech spec §5, §6 "Offline"). Reconnects with
 * exponential backoff and jitter, resumes the map from its last applied seq,
 * applies events in seq order, and resyncs when the page comes back to the
 * foreground (iOS suspends background tabs and their sockets).
 */
export function createWsClient(options: WsClientOptions): WsClient {
  const url = options.url ?? defaultUrl();
  const createSocket = options.createSocket ?? ((u: string): WsSocket => new WebSocket(u));
  const page = options.page ?? document;
  const random = options.random ?? Math.random;
  const checkSession = options.checkSession ?? (async () => (await authApi.me()) !== null);

  let socket: WsSocket | null = null;
  /** `ws.ready` received on the current socket. */
  let ready = false;
  let status: WsStatus = 'connecting';
  let attempt = 0;
  /** Connects in a row that never reached `ws.ready`. */
  let failures = 0;
  /** Bumped on every `ws.ready`, so a stale session check can't end a newer connection. */
  let readyCount = 0;
  let closedForGood = false;
  let sub: { mapId: string; buffer: ReorderBuffer } | null = null;

  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;

  const setStatus = (next: WsStatus): void => {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  };

  const send = (message: WsClientMessage): void => {
    if (socket?.readyState === OPEN && ready) socket.send(JSON.stringify(message));
  };

  const sendSubscribe = (): void => {
    if (sub) {
      send({
        v: WS_PROTOCOL_VERSION,
        type: 'subscribe',
        mapId: sub.mapId,
        afterSeq: sub.buffer.applied,
      });
    }
  };

  const ping = (): void => {
    if (!ready) return;
    send({ v: WS_PROTOCOL_VERSION, type: 'ping' });
    pongTimer ??= setTimeout(() => {
      // Nothing came back: the socket is dead even if it looks open.
      lose();
    }, PONG_TIMEOUT_MS);
  };

  const apply = (events: readonly WsEventMessage[]): void => {
    for (const event of events) options.onEvent(event);
    updateGapTimer();
  };

  /** A gap that outlasts the timeout asks the server to replay from our cursor. */
  const updateGapTimer = (): void => {
    if (!sub?.buffer.hasGap) {
      clearTimeout(gapTimer);
      gapTimer = undefined;
      return;
    }
    gapTimer ??= setTimeout(() => {
      gapTimer = undefined;
      if (sub?.buffer.hasGap) sendSubscribe();
    }, GAP_TIMEOUT_MS);
  };

  const onMessage = (raw: unknown): void => {
    clearTimeout(pongTimer);
    pongTimer = undefined;
    if (typeof raw !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const control = WsControlMessageSchema.safeParse(json);
    if (!control.success) {
      const event = WsEventMessageSchema.safeParse(json);
      // Anything else (a newer server's message type) is ignored.
      if (event.success && sub?.mapId === event.data.mapId) apply(sub.buffer.push(event.data));
      return;
    }
    const message = control.data;
    switch (message.type) {
      case 'ws.ready':
        ready = true;
        attempt = 0;
        failures = 0;
        readyCount += 1;
        clearTimeout(connectTimer);
        connectTimer = undefined;
        setStatus('live');
        sendSubscribe();
        return;
      case 'ws.pong':
        return;
      case 'ws.cursor':
      case 'ws.subscribed':
        if (sub?.mapId === message.mapId) apply(sub.buffer.advanceTo(message.seq));
        return;
      case 'ws.resync':
        if (sub?.mapId === message.mapId) {
          sub = null;
          updateGapTimer();
          options.onResync(message.mapId);
        }
        return;
      case 'ws.error':
        if (message.mapId !== undefined && sub?.mapId === message.mapId) {
          sub = null;
          updateGapTimer();
        }
        options.onError?.({
          code: message.code,
          message: message.message,
          ...(message.mapId !== undefined ? { mapId: message.mapId } : {}),
        });
        return;
    }
  };

  const stopTimers = (): void => {
    clearTimeout(connectTimer);
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    clearTimeout(gapTimer);
    clearTimeout(reconnectTimer);
    connectTimer = pingTimer = pongTimer = gapTimer = reconnectTimer = undefined;
  };

  const detach = (): void => {
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    socket = null;
    ready = false;
  };

  const connect = (): void => {
    stopTimers();
    const current = createSocket(url);
    socket = current;
    current.onmessage = (event) => {
      onMessage(event.data);
    };
    current.onclose = (event) => {
      if (event.code === WS_CLOSE_CODES.UNAUTHENTICATED) {
        loggedOut();
        return;
      }
      lose();
    };
    current.onerror = () => undefined; // `onclose` follows.
    connectTimer = setTimeout(lose, CONNECT_TIMEOUT_MS);
    pingTimer = setInterval(ping, PING_INTERVAL_MS);
  };

  const loggedOut = (): void => {
    const current = socket;
    detach();
    current?.close();
    stopTimers();
    setStatus('logged-out');
  };

  /** The connection is gone: try again after a backoff delay. */
  function lose(): void {
    const wasReady = ready;
    const dead = socket;
    detach();
    dead?.close();
    stopTimers();
    if (closedForGood) return;
    setStatus('reconnecting');
    reconnectTimer = setTimeout(connect, reconnectDelay(attempt, random));
    attempt += 1;
    if (!wasReady) failures += 1;
    if (!wasReady && failures % FAILURES_BEFORE_SESSION_CHECK === 0) {
      const readyAtCheck = readyCount;
      checkSession().then(
        (loggedIn) => {
          if (!loggedIn && !closedForGood && readyCount === readyAtCheck) loggedOut();
        },
        () => undefined, // Offline or server down: keep retrying.
      );
    }
  }

  const onVisibility = (): void => {
    if (page.visibilityState !== 'visible' || closedForGood || status === 'logged-out') return;
    if (!socket) {
      // Waiting to reconnect: don't make a returning player wait out the backoff.
      attempt = 0;
      failures = 0;
      connect();
    } else if (ready) {
      // The socket may have died while suspended: catch up, and check it's alive.
      sendSubscribe();
      ping();
    }
  };
  page.addEventListener('visibilitychange', onVisibility);

  connect();

  return {
    subscribe: (mapId, afterSeq) => {
      sub = { mapId, buffer: new ReorderBuffer(afterSeq) };
      updateGapTimer();
      sendSubscribe();
    },
    unsubscribe: () => {
      if (!sub) return;
      send({ v: WS_PROTOCOL_VERSION, type: 'unsubscribe', mapId: sub.mapId });
      sub = null;
      updateGapTimer();
    },
    get status() {
      return status;
    },
    close: () => {
      closedForGood = true;
      page.removeEventListener('visibilitychange', onVisibility);
      const current = socket;
      detach();
      stopTimers();
      current?.close(1000, 'bye');
    },
  };
}
