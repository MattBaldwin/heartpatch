// Rate limits for the tutorial (tech spec §5). Starting and replaying each
// build a whole Tutorial Glade, so they're limited like making a map; each
// acknowledgement writes a game event.
import type { RateLimit } from '../auth/limits.js';

const MINUTE_MS = 60_000;

export const TUTORIAL_RATE_LIMITS = {
  newRun: {
    perIp: { max: 30, windowMs: 60 * MINUTE_MS }, // TUNE: guess
    perUser: { max: 10, windowMs: 60 * MINUTE_MS }, // TUNE: guess
  },
  acknowledge: {
    perIp: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 30, windowMs: MINUTE_MS }, // TUNE: guess; a fast reader taps a lot
  },
} as const satisfies Record<string, { perIp: RateLimit; perUser: RateLimit }>;

export type TutorialAction = keyof typeof TUTORIAL_RATE_LIMITS;
