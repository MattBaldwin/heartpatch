// Rate limits for the computer patch-mates switch (#386, tech spec §5), as
// the Long Night's weekday: a setting, so this only stops tap-spamming. The
// real brake is `COMPUTER_MATE_RULES.toggleCooldownHours`.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const COMPUTER_MATES_RATE_LIMITS = {
  owner: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess, as the Long Night's switch
    perUser: { max: 20, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type ComputerMatesAction = keyof typeof COMPUTER_MATES_RATE_LIMITS;
