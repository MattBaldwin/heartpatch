// Rate limits for the mini-boss endpoints (#190, tech spec §5): only stops tap-spamming.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const BOSS_RATE_LIMITS = {
  // The map screen reads the visit as it opens, like the wild spawns list.
  view: {
    perIp: { max: 240, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
  // A battle start, as wild battles' own.
  battle: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 20, windowMs: MINUTE_MS }, // TUNE: guess
  },
  // "Ask it to be your friend?": two asks a win, plus room for double taps
  // and retries (a replayed ask spends nothing), as the battle start.
  befriend: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 20, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type BossAction = keyof typeof BOSS_RATE_LIMITS;
