import { normalizeIP } from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { requireUser } from '../modules/auth/hooks.js';
import { AppError } from './errors.js';

// Route rate limits (tech spec §5), on @fastify/rate-limit's counters. Each
// module keeps its numbers in its own `limits.ts` table; this is the one
// preHandler that enforces them.

/** Kid-readable (style guide §6), whichever limit was hit. */
export const RATE_LIMITED_MESSAGE = 'Too many tries! Take a little break and try again soon.';

export interface RateLimit {
  max: number;
  windowMs: number;
}

/**
 * A module's limits, per action: a looser per-IP limit, because a whole family
 * shares one home IP, and a per-player one. Declare tables with
 * `as const satisfies RateLimitTable` so actions stay a closed set.
 */
export type RateLimitTable = Record<string, { perIp: RateLimit; perUser: RateLimit }>;

/** One limit and the key its counter is kept under. */
export interface RateLimitCheck {
  limit: RateLimit;
  key: (request: FastifyRequest) => string;
}

/**
 * A preHandler that counts each check (each with its own counters) in order
 * and answers `RATE_LIMITED`, with `Retry-After`, at the first one over its
 * limit. Every attempt counts, successful or not.
 */
export function rateLimit(
  fastify: FastifyInstance,
  checks: readonly RateLimitCheck[],
): preHandlerAsyncHookHandler {
  const limiters = checks.map(({ limit, key }) =>
    fastify.createRateLimit({ max: limit.max, timeWindow: limit.windowMs, keyGenerator: key }),
  );
  return async (request, reply) => {
    for (const limiter of limiters) {
      const result = await limiter(request);
      if (!result.isAllowed && result.isExceeded) {
        void reply.header('retry-after', result.ttlInSeconds);
        throw new AppError('RATE_LIMITED', RATE_LIMITED_MESSAGE);
      }
    }
  };
}

/**
 * `rateLimit` for a logged-in module's actions: per IP, then per player, keyed
 * `<scope>:<action>:ip:…` and `<scope>:<action>:user:…`. Runs after
 * `requireAuth`. Each call makes fresh counters, so every route that calls it
 * is limited on its own.
 */
export function playerRateLimit<Action extends string>(
  fastify: FastifyInstance,
  scope: string,
  table: Readonly<Record<Action, { perIp: RateLimit; perUser: RateLimit }>>,
): (action: Action) => preHandlerAsyncHookHandler {
  return (action) =>
    rateLimit(fastify, [
      {
        limit: table[action].perIp,
        key: (request) => `${scope}:${action}:ip:${normalizeIP(request.ip)}`,
      },
      {
        limit: table[action].perUser,
        key: (request) => `${scope}:${action}:user:${requireUser(request).id}`,
      },
    ]);
}
