import type { MapView, WsEventMessage } from '@heartpatch/shared';
import { ApiRequestError } from '../net/api.js';
import type { WsClient, WsServerError } from '../net/ws-client.js';
import { MapState } from './map-state.js';

// Keeps the open map in step with the server (tech spec §5 "WebSocket", #22):
// a REST snapshot first, then live events from that snapshot's seq. No DOM or
// Babylon here, so the resync rules are unit-tested.

/** First wait before refetching after a failed resync; doubles up to the max. */
export const RESYNC_RETRY_MS = 2_000; // TUNE: guess
export const RESYNC_RETRY_MAX_MS = 30_000; // TUNE: guess

/** Shown in the lobby when the server stops this player following a map. */
export const NOT_A_MEMBER_MESSAGE = "You're not in that patch anymore.";

/** Failures a later retry can fix. */
const RETRYABLE = new Set<string>(['OFFLINE', 'INTERNAL', 'RATE_LIMITED']);

export interface MapSyncOptions {
  fetchView: (mapId: string) => Promise<MapView>;
  /** The live socket (made on first use). */
  socket: () => Pick<WsClient, 'subscribe' | 'unsubscribe'>;
  /** A fresh view of the open map arrived (resync): redraw from it. */
  onRedraw: (state: MapState) => void;
  /** The server won't let this player follow the map anymore. */
  onLeave: (message: string) => void;
}

export class MapSync {
  private current: MapState | null = null;
  /** Bumped by every open and close, so a slow fetch can't bring back a map the player left. */
  private generation = 0;
  private resyncing = false;
  /** The generation the running resync belongs to (its answer is dropped otherwise). */
  private resyncAt = 0;
  /** Live events are off (unsubscribed for a resync) until a fresh view is in. */
  private unsynced = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = RESYNC_RETRY_MS;
  private readonly options: MapSyncOptions;

  constructor(options: MapSyncOptions) {
    this.options = options;
  }

  /** The open map, or null. */
  get state(): MapState | null {
    return this.current;
  }

  /**
   * Fetches a map and follows it live from the view's seq. Resolves to null
   * if another open or a close came first; rejects (player-safe message) if
   * the view can't be fetched.
   */
  async open(mapId: string): Promise<MapState | null> {
    const at = ++this.generation;
    let view: MapView;
    try {
      view = await this.options.fetchView(mapId);
    } catch (err) {
      // The map on screen stays; a resync this open cut short is started again.
      // (One started during this open is still live; leave it be.)
      if (at === this.generation && this.current && !(this.resyncing && this.resyncAt === at)) {
        this.resyncing = false;
        if (this.unsynced) this.resync();
      }
      throw err;
    }
    if (at !== this.generation) return null;
    this.reset();
    this.current = new MapState(view);
    this.options.socket().subscribe(mapId, view.seq);
    return this.current;
  }

  close(): void {
    this.generation += 1;
    this.reset();
    if (this.current) this.options.socket().unsubscribe();
    this.current = null;
  }

  /** ws-client `onEvent`: one event, in seq order. */
  event(event: WsEventMessage): void {
    const state = this.current;
    if (!state || this.resyncing || event.mapId !== state.id) return;
    if (state.apply(event) === 'resync') this.resync();
  }

  /** ws-client `onResync`: too much was missed to replay. */
  serverResync(mapId: string): void {
    if (this.current?.id === mapId) this.resync();
  }

  /** ws-client `onError`: with this map's id, the server ended its subscription. */
  serverError(error: WsServerError): void {
    if (error.mapId === undefined || error.mapId !== this.current?.id) return;
    this.leave(error.code === 'FORBIDDEN' ? NOT_A_MEMBER_MESSAGE : error.message);
  }

  /**
   * Refetch the whole map, then follow it live from the new view's seq: when
   * the server says too much was missed (`ws.resync`), or after a change only
   * the server can describe. Never replays on top of a stale copy, and one
   * resync runs at a time.
   */
  resync(): void {
    const state = this.current;
    if (!state || this.resyncing) return;
    const at = this.generation;
    this.resyncAt = at;
    this.resyncing = true;
    this.unsynced = true;
    clearTimeout(this.retryTimer);
    // Live events stop until the fresh view is in (the server may have already dropped them).
    this.options.socket().unsubscribe();
    this.options.fetchView(state.id).then(
      (view) => {
        if (at !== this.generation) return;
        this.resyncing = false;
        this.unsynced = false;
        this.retryDelay = RESYNC_RETRY_MS;
        state.replace(view);
        this.options.onRedraw(state);
        this.options.socket().subscribe(view.map.id, view.seq);
      },
      (err: unknown) => {
        if (at !== this.generation) return;
        this.resyncing = false;
        if (err instanceof ApiRequestError && !RETRYABLE.has(err.code)) {
          // Removed from the map, or logged out: retrying can't bring it back.
          const gone = err.code === 'FORBIDDEN' || err.code === 'NOT_FOUND';
          this.leave(gone ? NOT_A_MEMBER_MESSAGE : err.message);
          return;
        }
        // Offline or a server hiccup: keep the map on screen and try again.
        this.retryTimer = setTimeout(() => {
          this.resync();
        }, this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, RESYNC_RETRY_MAX_MS);
      },
    );
  }

  private leave(message: string): void {
    this.close();
    this.options.onLeave(message);
  }

  private reset(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.resyncing = false;
    this.unsynced = false;
    this.retryDelay = RESYNC_RETRY_MS;
  }
}
