// Rate limits for care actions (tech spec §5: tighter limits on care). Each
// action is one short transaction; diminishing returns and the debounce in
// care-action data keep spam from counting, these keep it from costing.
import type { RateLimit } from '../auth/limits.js';

const MINUTE_MS = 60_000;

export const CARE_RATE_LIMITS = {
  care: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess; a kid booping everyone, with retries
  },
} as const satisfies Record<string, { perIp: RateLimit; perUser: RateLimit }>;

export type CareRateAction = keyof typeof CARE_RATE_LIMITS;
