// Grown-up helper settings (#197, owner decisions 2026-10-07) and rate limits
// (tech spec §5).
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const HELPER_RULES = {
  /** Helpers per player, counting asks not answered yet. */
  helpersPerPlayer: 2, // TUNE: owner decision 2026-10-07
  /** Players one helper may help, counting asks not answered yet. */
  playersPerHelper: 10, // TUNE: owner decision 2026-10-07
  /** Password resets one helper may do in a rolling day, across everyone they help. */
  resetsPerDay: 3, // TUNE: owner decision 2026-10-07
  /** The rolling window `resetsPerDay` counts over. */
  resetWindowMs: 24 * 60 * MINUTE_MS,
} as const;

export const HELPER_RATE_LIMITS = {
  /** Asking, answering and removing. */
  change: {
    perIp: { max: 60, windowMs: 15 * MINUTE_MS }, // TUNE: guess
    perUser: { max: 20, windowMs: 15 * MINUTE_MS }, // TUNE: guess
  },
  /** On top of the daily cap above, which survives restarts. */
  reset: {
    perIp: { max: 10, windowMs: 60 * MINUTE_MS }, // TUNE: guess
    perUser: { max: 5, windowMs: 60 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type HelperAction = keyof typeof HELPER_RATE_LIMITS;
