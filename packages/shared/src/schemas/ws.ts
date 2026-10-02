import { z } from 'zod';
import { ErrorCodeSchema } from './errors.js';

// Live world sync over `/ws` (tech spec §5 "WebSocket" and §7 "Game event
// stream"). Every message is JSON, zod-validated on both ends, and carries
// the protocol version `v`.

export const WS_PROTOCOL_VERSION = 1;
const Version = z.literal(WS_PROTOCOL_VERSION);

/** A per-map event seq (`game_events.seq`); 0 means "before the first event". */
export const WsSeqSchema = z.number().int().nonnegative();

/**
 * Game event types are dotted lowercase names (`tile.updated`). The `ws.`
 * prefix is reserved for the protocol's own messages below.
 */
export const WsEventTypeSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)+$/)
  .refine((type) => !type.startsWith('ws.'), 'ws.* is reserved for protocol messages');

/**
 * A game event as a client sees it: the event's **public view** in `data`,
 * never the internal `game_events.payload` (tech spec §7).
 */
export const WsEventMessageSchema = z.object({
  v: Version,
  type: WsEventTypeSchema,
  mapId: z.uuid(),
  seq: WsSeqSchema.min(1),
  /** When the event was committed (ISO 8601, UTC). */
  at: z.iso.datetime({ offset: true }),
  data: z.record(z.string(), z.unknown()),
});
export type WsEventMessage = z.infer<typeof WsEventMessageSchema>;

// Server → client protocol messages.

/** The connection is authenticated and ready for `subscribe`. */
export const WsReadyMessageSchema = z.object({ v: Version, type: z.literal('ws.ready') });

/**
 * Catch-up after `subscribe` is done: every event up to `seq` meant for this
 * player has been sent, and live events follow.
 */
export const WsSubscribedMessageSchema = z.object({
  v: Version,
  type: z.literal('ws.subscribed'),
  mapId: z.uuid(),
  seq: WsSeqSchema,
});

/**
 * Every event up to `seq` meant for this player has been sent; the rest of
 * those seqs aren't for this player. Lets the client move past seqs it will
 * never see without mistaking them for a gap.
 */
export const WsCursorMessageSchema = z.object({
  v: Version,
  type: z.literal('ws.cursor'),
  mapId: z.uuid(),
  seq: WsSeqSchema,
});

/**
 * Too much was missed to replay (or old events were pruned): refetch the
 * map's full state over REST, then `subscribe` again with its seq. The
 * server has already dropped this subscription.
 */
export const WsResyncMessageSchema = z.object({
  v: Version,
  type: z.literal('ws.resync'),
  mapId: z.uuid(),
});

/** A request failed. With `mapId`, that map's subscription has ended. */
export const WsErrorMessageSchema = z.object({
  v: Version,
  type: z.literal('ws.error'),
  code: ErrorCodeSchema,
  /** Kid-readable (style guide §6). */
  message: z.string(),
  mapId: z.uuid().optional(),
});

export const WsPongMessageSchema = z.object({ v: Version, type: z.literal('ws.pong') });

export const WsControlMessageSchema = z.discriminatedUnion('type', [
  WsReadyMessageSchema,
  WsSubscribedMessageSchema,
  WsCursorMessageSchema,
  WsResyncMessageSchema,
  WsErrorMessageSchema,
  WsPongMessageSchema,
]);
export type WsControlMessage = z.infer<typeof WsControlMessageSchema>;

/** Anything the server sends. Protocol messages are tried first (`ws.*`). */
export const WsServerMessageSchema = z.union([WsControlMessageSchema, WsEventMessageSchema]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

// Client → server messages.

/**
 * Follow one map (one at a time per connection; a new `subscribe` replaces
 * the old one). `afterSeq` is the last seq the client has applied, from its
 * REST snapshot or its last event: the server replays everything after it,
 * then sends `ws.subscribed`. Sending it again while subscribed is how the
 * client asks for a replay after a gap.
 */
export const WsSubscribeMessageSchema = z.object({
  v: Version,
  type: z.literal('subscribe'),
  mapId: z.uuid(),
  afterSeq: WsSeqSchema,
});
export type WsSubscribeMessage = z.infer<typeof WsSubscribeMessageSchema>;

export const WsUnsubscribeMessageSchema = z.object({
  v: Version,
  type: z.literal('unsubscribe'),
  mapId: z.uuid(),
});

/** App-level ping, so the client can tell a dead socket (answered by `ws.pong`). */
export const WsPingMessageSchema = z.object({ v: Version, type: z.literal('ping') });

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  WsSubscribeMessageSchema,
  WsUnsubscribeMessageSchema,
  WsPingMessageSchema,
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

/**
 * Close codes the server uses beyond the standard ones. The client doesn't
 * reconnect after `UNAUTHENTICATED` (the player must log in again).
 */
export const WS_CLOSE_CODES = {
  /** The session ended (logout, password reset, expiry). */
  UNAUTHENTICATED: 4401,
  /** This player already has the maximum number of open connections. */
  TOO_MANY_CONNECTIONS: 4429,
} as const;
