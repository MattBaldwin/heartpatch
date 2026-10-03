// Session and rate-limit settings for accounts (tech spec §5).
import type { RateLimit } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

const DAY_MS = 24 * 60 * MINUTE_MS;

/** The `hp_session` cookie. */
export const SESSION_COOKIE = 'hp_session';
/** Rolling session lifetime (tech spec §5). */
export const SESSION_TTL_MS = 30 * DAY_MS;
/** Push the expiry forward at most this often, so most requests don't write. */
export const SESSION_RENEW_AFTER_MS = DAY_MS; // TUNE: guess

/**
 * Per-IP limits are looser than per-username ones, because a whole family
 * shares one home IP. Every attempt counts, successful or not.
 */
export const AUTH_RATE_LIMITS = {
  login: {
    perIp: { max: 30, windowMs: 15 * MINUTE_MS }, // TUNE: guess
    perUsername: { max: 10, windowMs: 15 * MINUTE_MS }, // TUNE: guess
  },
  signup: {
    perIp: { max: 10, windowMs: 60 * MINUTE_MS }, // TUNE: guess
    perUsername: { max: 5, windowMs: 60 * MINUTE_MS }, // TUNE: guess
  },
  recover: {
    perIp: { max: 10, windowMs: 60 * MINUTE_MS }, // TUNE: guess
    perUsername: { max: 5, windowMs: 60 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies Record<string, { perIp: RateLimit; perUsername: RateLimit }>;

export type AuthAction = keyof typeof AUTH_RATE_LIMITS;
