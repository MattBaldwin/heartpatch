// Rate limits for journeys (#270, tech spec §5). Setting off starts a battle,
// so it matches starting one; this only stops tap-spamming.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { BATTLE_RATE_LIMITS } from '../battles/limits.js';

export const JOURNEY_RATE_LIMITS = {
  start: BATTLE_RATE_LIMITS.start,
} as const satisfies RateLimitTable;

export type JourneyAction = keyof typeof JOURNEY_RATE_LIMITS;
