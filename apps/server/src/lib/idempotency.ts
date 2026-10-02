import { createHash } from 'node:crypto';
import type { FastifyInstance, onSendAsyncHookHandler, preHandlerAsyncHookHandler } from 'fastify';
import type { IdempotencyStore } from '../db/idempotency-keys.js';
import { requireUser } from '../modules/auth/hooks.js';
import { AppError } from './errors.js';
import type { Clock } from './time.js';

/**
 * `Idempotency-Key` (tech spec §5): a retry of a mutating request on a flaky
 * phone connection must not apply twice (a battle move, later purchases and
 * trades). A route opts in with `preHandler: [requireAuth, idempotency.preHandler]`
 * and `onSend: idempotency.onSend`:
 *
 * - no header: the request runs as usual;
 * - first time this player uses the key: the request runs, and `onSend`
 *   stores the status and body it produced (errors too, except 5xx, which
 *   release the key so the retry runs again);
 * - the same key again, same route and body: the stored reply is sent back,
 *   with `Idempotent-Replayed: true`, and nothing runs;
 * - the same key with a different route or body: `CONFLICT`;
 * - the same key while the first request is still running: `CONFLICT`,
 *   unless that claim is older than `PENDING_TTL_MS` (the process died), in
 *   which case this request takes it over.
 *
 * Keys are per player, so one player can't replay another's reply. Rows are
 * kept `KEY_TTL_MS`; a cleanup job is a follow-up.
 */

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const KEY_MAX_LENGTH = 128;
/** A claim with no reply after this long is treated as abandoned. */
export const PENDING_TTL_MS = 30_000; // TUNE: longer than any request should take
/** How long a stored reply is replayable. */
export const KEY_TTL_MS = 24 * 60 * 60_000; // TUNE: a day covers any phone retry

const MESSAGES = {
  badKey: "That request's key doesn't look right. Please try again!",
  stillWorking: 'Still working on your last tap. One moment!',
  reused: 'That request was already used for something else. Please try again!',
} as const;

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the idempotency preHandler when this request claimed a key. */
    idempotency: { userId: string; key: string } | null;
  }
}

export interface Idempotency {
  /** Runs after `requireAuth`. */
  preHandler: preHandlerAsyncHookHandler;
  onSend: onSendAsyncHookHandler;
}

/** The reply body as JSON, or null for an empty or non-JSON body (204s). */
function parseBody(payload: unknown): unknown {
  if (typeof payload !== 'string' || payload.length === 0) return null;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

/** What makes two requests "the same": the method, the exact URL and the body. */
export function requestFingerprint(method: string, url: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${url}\n${JSON.stringify(body ?? null)}`)
    .digest('hex');
}

/**
 * Builds the hooks for one routes plugin. Decorates the plugin's requests, so
 * call it once per plugin, before its routes.
 */
export function registerIdempotency(
  fastify: FastifyInstance,
  options: { store: IdempotencyStore; clock: Clock },
): Idempotency {
  const { store, clock } = options;
  fastify.decorateRequest('idempotency', null);

  return {
    preHandler: async (request, reply) => {
      const header = request.headers[IDEMPOTENCY_HEADER];
      if (header === undefined) return;
      const key = Array.isArray(header) ? header[0] : header;
      if (!key || key.length > KEY_MAX_LENGTH) throw new AppError('BAD_REQUEST', MESSAGES.badKey);

      const user = requireUser(request);
      const scope = request.routeOptions.url ?? request.url;
      const requestHash = requestFingerprint(request.method, request.url, request.body);
      const claim = await store.claim({
        userId: user.id,
        key,
        scope,
        requestHash,
        now: clock(),
        pendingTtlMs: PENDING_TTL_MS,
      });
      switch (claim.kind) {
        case 'claimed':
          request.idempotency = { userId: user.id, key };
          return;
        case 'pending':
          throw new AppError('CONFLICT', MESSAGES.stillWorking);
        case 'done':
          if (claim.scope !== scope || claim.requestHash !== requestHash) {
            throw new AppError('CONFLICT', MESSAGES.reused);
          }
          // The stored body was already serialized by the route's schema once.
          // Returning the reply from an async hook ends the request here.
          return reply
            .code(claim.statusCode)
            .header('idempotent-replayed', 'true')
            .type('application/json; charset=utf-8')
            .serializer(JSON.stringify)
            .send(claim.response);
      }
    },

    onSend: async (request, reply, payload) => {
      const claim = request.idempotency;
      if (!claim) return payload;
      request.idempotency = null;
      if (reply.statusCode >= 500) {
        await store.release(claim.userId, claim.key);
        return payload;
      }
      await store.complete({
        ...claim,
        statusCode: reply.statusCode,
        response: parseBody(payload),
      });
      return payload;
    },
  };
}
