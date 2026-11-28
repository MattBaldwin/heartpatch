// Rate limits for research commands (Clockwork Isle #874 C3, tech spec §5):
// each is one short transaction, and a kid starts a node every hour or two.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const RESEARCH_RATE_LIMITS = {
  research: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 30, windowMs: MINUTE_MS }, // TUNE: guess; a few taps on the bench sheet
  },
} as const satisfies RateLimitTable;

export type ResearchAction = keyof typeof RESEARCH_RATE_LIMITS;
