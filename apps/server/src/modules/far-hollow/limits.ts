// Rate limits for the far Hollow (#306 PR 6, tech spec §5): searching is
// exploring, so it shares exploring's numbers.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { EXPLORE_RATE_LIMITS } from '../explore/limits.js';

export const FAR_HOLLOW_RATE_LIMITS = {
  farHollow: EXPLORE_RATE_LIMITS.explore,
  dev: EXPLORE_RATE_LIMITS.dev,
} as const satisfies RateLimitTable;

export type FarHollowAction = keyof typeof FAR_HOLLOW_RATE_LIMITS;
