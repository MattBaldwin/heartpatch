// Rate limits for the raid log and defense style (tech spec §5). Reads and
// one-tap settings; these only stop tap-spamming the endpoints.
import type { RateLimit } from '../auth/limits.js';

const MINUTE_MS = 60_000;

export const RAID_RATE_LIMITS = {
  read: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; every map open, plus replays
  },
  write: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
} as const satisfies Record<string, { perIp: RateLimit; perUser: RateLimit }>;

export type RaidAction = keyof typeof RAID_RATE_LIMITS;
