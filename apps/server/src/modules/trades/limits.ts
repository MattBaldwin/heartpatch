// Rate limits for trades and the mailbox (#271, tech spec §5). Each command
// is one transaction a kid taps by hand; this only stops tap-spamming.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const TRADE_RATE_LIMITS = {
  read: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess; every shelf the post screen opens
  },
  send: {
    perIp: { max: 200, windowMs: 15 * MINUTE_MS }, // TUNE: guess
    perUser: { max: 40, windowMs: 15 * MINUTE_MS }, // TUNE: guess; 5 open at a time
  },
  answer: {
    perIp: { max: 300, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
  },
  owner: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess
    perUser: { max: 20, windowMs: MINUTE_MS }, // TUNE: guess
  },
} as const satisfies RateLimitTable;

export type TradeAction = keyof typeof TRADE_RATE_LIMITS;
