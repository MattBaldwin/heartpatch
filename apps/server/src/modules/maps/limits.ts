// Invite and rate-limit settings for maps (design doc §3, tech spec §5).
import type { RateLimit } from '../auth/limits.js';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** How long an invite code works (design doc §3). */
export const INVITE_CODE_TTL_MS = 7 * DAY_MS; // TUNE: design doc §3 default

/**
 * Per-player limits, plus a looser per-IP one because a family shares a home
 * IP. Joining is limited hardest, since that's where codes could be guessed.
 */
export const MAP_RATE_LIMITS = {
  create: {
    perIp: { max: 20, windowMs: 60 * MINUTE_MS }, // TUNE: guess
    perUser: { max: 5, windowMs: 60 * MINUTE_MS }, // TUNE: guess
  },
  join: {
    perIp: { max: 30, windowMs: 15 * MINUTE_MS }, // TUNE: guess
    perUser: { max: 10, windowMs: 15 * MINUTE_MS }, // TUNE: guess
  },
  resetPassword: {
    perIp: { max: 20, windowMs: 60 * MINUTE_MS }, // TUNE: guess
    perUser: { max: 10, windowMs: 60 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies Record<string, { perIp: RateLimit; perUser: RateLimit }>;

export type MapAction = keyof typeof MAP_RATE_LIMITS;
