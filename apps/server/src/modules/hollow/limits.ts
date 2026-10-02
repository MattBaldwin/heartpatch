// Rate limits for the Hollow Man's endpoints (tech spec §5). Rescues start a
// battle, so they match starting one; these only stop tap-spamming.
import type { RateLimit } from '../auth/limits.js';

const MINUTE_MS = 60_000;

export const HOLLOW_RATE_LIMITS = {
  rescue: {
    perIp: { max: 200, windowMs: 15 * MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 60, windowMs: 15 * MINUTE_MS }, // TUNE: guess; matches starting a battle
  },
  dev: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; e2e runs from one IP
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies Record<string, { perIp: RateLimit; perUser: RateLimit }>;

export type HollowAction = keyof typeof HOLLOW_RATE_LIMITS;
