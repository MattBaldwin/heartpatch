// Rate limits for Keepers (tech spec §5). Only saving calls the server (the
// picker tries colours on the device), so a few saves a minute is plenty.
import type { RateLimit } from '../auth/limits.js';

const MINUTE_MS = 60_000;

export const KEEPER_RATE_LIMITS = {
  save: {
    perIp: { max: 120, windowMs: 10 * MINUTE_MS }, // TUNE: guess; a family shares one IP
    perUser: { max: 30, windowMs: 10 * MINUTE_MS }, // TUNE: guess
  },
} as const satisfies Record<string, { perIp: RateLimit; perUser: RateLimit }>;

export type KeeperAction = keyof typeof KEEPER_RATE_LIMITS;
