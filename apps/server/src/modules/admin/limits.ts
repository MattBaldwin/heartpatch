// Admin console settings (#196) and rate limits (tech spec §5).
import type { RateLimit } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

/** The admin session cookie. Separate from `hp_session`, and only sent to the admin API. */
export const ADMIN_COOKIE = 'hp_admin';
export const ADMIN_COOKIE_PATH = '/api/v1/admin';

export const ADMIN_RULES = {
  /** An admin session ends after this long without a request (owner request, #196). */
  idleMs: 30 * MINUTE_MS, // TUNE: issue #196
  /** And after this long regardless. */
  maxMs: 8 * 60 * MINUTE_MS, // TUNE: guess
  /** TOTP steps of clock drift allowed either side (30 s each). */
  totpDriftSteps: 1,
  /** How many nights a patch's page shows. */
  nightsShown: 7, // TUNE: guess
  /** Days a family code can be extended by at once. */
  extendMaxDays: 90,
} as const;

/** Sign-in: per IP and per typed username; every try counts. */
export const ADMIN_LOGIN_LIMITS = {
  perIp: { max: 10, windowMs: 15 * MINUTE_MS }, // TUNE: guess
  perUsername: { max: 5, windowMs: 15 * MINUTE_MS }, // TUNE: guess
} as const satisfies Record<string, RateLimit>;

/** Signed-in admin requests, per admin: reads, actions, and showing a secret. */
export const ADMIN_RATE_LIMITS = {
  read: { max: 300, windowMs: 15 * MINUTE_MS }, // TUNE: guess
  act: { max: 60, windowMs: 15 * MINUTE_MS }, // TUNE: guess
  secret: { max: 20, windowMs: 15 * MINUTE_MS }, // TUNE: guess
} as const satisfies Record<string, RateLimit>;

export type AdminRateAction = keyof typeof ADMIN_RATE_LIMITS;
