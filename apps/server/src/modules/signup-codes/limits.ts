// Family signup code settings (#195, owner decisions 2026-10-06) and rate
// limits (tech spec §5).
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

const DAY_MS = 24 * 60 * MINUTE_MS;

export const SIGNUP_CODE_RULES = {
  /** Live codes one patch owner may have at once. The operator has no cap. */
  ownerLiveMax: 3, // TUNE: owner decision 2026-10-06
  /** Sign-ups per code, about one family. */
  defaultMaxUses: 8, // TUNE: owner decision 2026-10-06
  /** How long a code works. */
  ttlMs: 14 * DAY_MS, // TUNE: owner decision 2026-10-06
  /** Ended codes stay on the owner's list this long after they were made. */
  listedForMs: 28 * DAY_MS, // TUNE: guess
  /** At most this many on a list. */
  listMax: 20, // TUNE: guess
  /** The operator's list (every maker's codes) shows at most this many. */
  operatorListMax: 500,
} as const;

export const SIGNUP_CODE_RATE_LIMITS = {
  create: {
    perIp: { max: 20, windowMs: 60 * MINUTE_MS }, // TUNE: guess
    perUser: { max: 10, windowMs: 60 * MINUTE_MS }, // TUNE: guess
  },
  revoke: {
    perIp: { max: 60, windowMs: 15 * MINUTE_MS }, // TUNE: guess
    perUser: { max: 30, windowMs: 15 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type SignupCodeAction = keyof typeof SIGNUP_CODE_RATE_LIMITS;
