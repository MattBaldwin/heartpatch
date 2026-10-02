// Live sync settings (tech spec §5 "WebSocket", §7 "Game event stream").

/** Server ping interval; a socket that misses one pong is closed (tech spec §5). */
export const HEARTBEAT_MS = 25_000;

/**
 * Most events a reconnecting client is replayed. Further behind than this, it
 * gets `ws.resync` and refetches full state instead.
 */
export const REPLAY_WINDOW = 500; // TUNE: guess; a busy evening on a 4-player map

/** Events read from `game_events` per query while catching a map's sockets up. */
export const REPLAY_BATCH = 200; // TUNE: guess

/** Open sockets per player (phone + iPad + a spare tab). Extra ones are refused. */
export const MAX_SOCKETS_PER_USER = 5; // TUNE: guess

/** Largest client message. Client messages are tiny (`subscribe`, `ping`). */
export const MAX_CLIENT_MESSAGE_BYTES = 4096;

/** Client messages per socket per window; more closes the socket. */
export const CLIENT_MESSAGE_LIMIT = { max: 30, windowMs: 10_000 } as const; // TUNE: guess

/** A socket this far behind on sending is dropped; it replays on reconnect. */
export const MAX_BUFFERED_BYTES = 1_000_000; // TUNE: guess
