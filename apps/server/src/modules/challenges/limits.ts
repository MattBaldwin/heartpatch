// Rate limits for friendly battles (#29, tech spec §5). The asks themselves
// are limited by `CHALLENGE_RULES` (per pair, per player, after a "Not now!"),
// counted from the `challenges` table; these only stop tap-spamming.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const CHALLENGE_RATE_LIMITS = {
  read: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess; the sheet refreshes while open
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
  send: {
    perIp: { max: 60, windowMs: 15 * MINUTE_MS }, // TUNE: a family on one Wi-Fi
    perUser: { max: 20, windowMs: 15 * MINUTE_MS }, // TUNE: above CHALLENGE_RULES.perPlayer
  },
  answer: {
    perIp: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 30, windowMs: MINUTE_MS }, // TUNE: guess
  },
  owner: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 20, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;
