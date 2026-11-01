// Rate limits for push nudges' endpoints (#726, tech spec §5). A phone posts
// its subscription at every start and the Settings rows flip switches; these
// only stop tap-spamming and a looping client.
import type { RateLimitTable } from '../../lib/rate-limit.js';
import { MINUTE_MS } from '../../lib/time.js';

export const PUSH_RATE_LIMITS = {
  // Reading the key and switches, and flipping a switch.
  settings: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess, as the Long Night's owner switch
    perUser: { max: 30, windowMs: MINUTE_MS }, // TUNE: guess
  },
  // Subscribing and unsubscribing this device.
  subscription: {
    perIp: { max: 60, windowMs: MINUTE_MS }, // TUNE: guess; a family behind one router
    perUser: { max: 10, windowMs: MINUTE_MS }, // TUNE: guess; one post per app start
  },
} as const satisfies RateLimitTable;

export type PushAction = keyof typeof PUSH_RATE_LIMITS;
