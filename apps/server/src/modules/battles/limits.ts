// Rate limits for battles (tech spec §5). Starting a battle writes a game
// event and a battle row; each action runs the engine once. Dev grants are
// dev/test only but still limited, since e2e shares one IP.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const BATTLE_RATE_LIMITS = {
  start: {
    perIp: { max: 200, windowMs: 15 * MINUTE_MS }, // TUNE: guess
    perUser: { max: 60, windowMs: 15 * MINUTE_MS }, // TUNE: guess
  },
  act: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 240, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
  dev: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: e2e signs up and grants from one IP
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type BattleAction = keyof typeof BATTLE_RATE_LIMITS;

/** Level of a wild squishy the dev route picks a fight with, when none is given. */
export const DEV_WILD_LEVEL = 3; // TUNE: a fair fight for a fresh squishy
