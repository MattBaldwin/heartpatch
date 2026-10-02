import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Executor } from './client.js';
import { idempotencyKeys } from './schema.js';

/**
 * Storage for `lib/idempotency.ts` (tech spec §5, "Idempotency"). One row per
 * player and key; the first request claims it, and its reply is stored for
 * retries. Lives next to `game-events.ts` because, like it, several modules
 * share it and it must touch the database.
 */

export type IdempotencyClaim =
  /** This request is the first with the key: run it and store the reply. */
  | { kind: 'claimed' }
  /** The first request is still running (or died less than `pendingTtlMs` ago). */
  | { kind: 'pending'; scope: string; requestHash: string }
  /** The first request finished; this is its reply. */
  | {
      kind: 'done';
      scope: string;
      requestHash: string;
      statusCode: number;
      response: unknown;
    };

export interface IdempotencyStore {
  claim: (input: {
    userId: string;
    key: string;
    scope: string;
    requestHash: string;
    now: Date;
    /** A claim this old with no reply is treated as abandoned and taken over. */
    pendingTtlMs: number;
  }) => Promise<IdempotencyClaim>;
  /** Stores the reply the first request produced. */
  complete: (input: {
    userId: string;
    key: string;
    statusCode: number;
    response: unknown;
  }) => Promise<void>;
  /** Drops the claim (the request failed on our side), so a retry runs again. */
  release: (userId: string, key: string) => Promise<void>;
}

export function createIdempotencyStore(db: Executor): IdempotencyStore {
  return {
    claim: async ({ userId, key, scope, requestHash, now, pendingTtlMs }) => {
      const inserted = await db
        .insert(idempotencyKeys)
        .values({ userId, key, scope, requestHash, createdAt: now })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });
      if (inserted.length > 0) return { kind: 'claimed' };

      const [row] = await db
        .select({
          scope: idempotencyKeys.scope,
          requestHash: idempotencyKeys.requestHash,
          statusCode: idempotencyKeys.statusCode,
          response: idempotencyKeys.response,
        })
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
      // Deleted between the insert and the select (a release): try once more.
      if (!row) return { kind: 'pending', scope, requestHash };
      if (row.statusCode !== null) {
        return {
          kind: 'done',
          scope: row.scope,
          requestHash: row.requestHash,
          statusCode: row.statusCode,
          response: row.response,
        };
      }
      // Abandoned claim (the process died mid-request): take it over.
      const abandonedBefore = new Date(now.getTime() - pendingTtlMs);
      const taken = await db
        .update(idempotencyKeys)
        .set({ scope, requestHash, createdAt: now })
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.key, key),
            isNull(idempotencyKeys.statusCode),
            lt(idempotencyKeys.createdAt, abandonedBefore),
          ),
        )
        .returning({ key: idempotencyKeys.key });
      if (taken.length > 0) return { kind: 'claimed' };
      return { kind: 'pending', scope: row.scope, requestHash: row.requestHash };
    },

    complete: async ({ userId, key, statusCode, response }) => {
      await db
        .update(idempotencyKeys)
        .set({ statusCode, response: sql`${JSON.stringify(response ?? null)}::jsonb` })
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    },

    release: async (userId, key) => {
      await db
        .delete(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    },
  };
}
