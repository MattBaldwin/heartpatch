// Rate limits for quick messages (tech spec §5: tighter limits on chat). In
// Phase 1 these stand in for the owner's mute button, so a burst of taps from
// one player, or a whole map, slows to a calm trickle.
import type { RateLimit, RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const CHAT_RATE_LIMITS = {
  send: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 8, windowMs: 30_000 }, // TUNE: guess; a quick back-and-forth, not a flood
  },
  read: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess; every map open and reconnect
  },
} as const satisfies RateLimitTable;

export type ChatAction = keyof typeof CHAT_RATE_LIMITS;

/** Everyone on one map together, so a busy patch never turns into a wall of bubbles. */
export const CHAT_MAP_SEND_LIMIT: RateLimit = { max: 30, windowMs: MINUTE_MS }; // TUNE: guess
