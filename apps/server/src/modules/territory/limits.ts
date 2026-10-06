// Rate limits for territory (tech spec §5). The raid rules already cap tile
// battles at a handful a day; these only stop tap-spamming the endpoints.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const TERRITORY_RATE_LIMITS = {
  attack: {
    perIp: { max: 200, windowMs: 15 * MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 60, windowMs: 15 * MINUTE_MS }, // TUNE: guess; matches starting a battle
  },
  defenders: {
    perIp: { max: 600, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 120, windowMs: MINUTE_MS }, // TUNE: guess; a fast tapper, with retries
  },
  visit: {
    perIp: { max: 300, windowMs: 15 * MINUTE_MS }, // TUNE: guess; a family on one Wi-Fi
    perUser: { max: 60, windowMs: 15 * MINUTE_MS }, // TUNE: guess; Visit is one tap now and then
  },
} as const satisfies RateLimitTable;

export type TerritoryAction = keyof typeof TERRITORY_RATE_LIMITS;
