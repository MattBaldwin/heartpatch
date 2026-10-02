import { and, eq, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
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
    /** A stored reply this old is expired: the key is taken over and the request runs again. */
    keyTtlMs: number;
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
    claim: async ({ userId, key, scope, requestHash, now, pendingTtlMs, keyTtlMs }) => {
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
          createdAt: idempotencyKeys.createdAt,
        })
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
      // Released between the insert and the select (the first request failed
      // on our side): reported as still running, so this retry gets CONFLICT
      // and the client's next retry runs it.
      if (!row) return { kind: 'pending', scope, requestHash };

      /** Takes the row over if it's still in the state we saw and old enough. */
      const takeOver = async (olderThanMs: number, state: SQL): Promise<boolean> => {
        const before = new Date(now.getTime() - olderThanMs);
        const taken = await db
          .update(idempotencyKeys)
          .set({ scope, requestHash, statusCode: null, response: null, createdAt: now })
          .where(
            and(
              eq(idempotencyKeys.userId, userId),
              eq(idempotencyKeys.key, key),
              state,
              lt(idempotencyKeys.createdAt, before),
            ),
          )
          .returning({ key: idempotencyKeys.key });
        return taken.length > 0;
      };

      if (row.statusCode !== null) {
        // An expired reply: the key is new again.
        if (await takeOver(keyTtlMs, isNotNull(idempotencyKeys.statusCode))) {
          return { kind: 'claimed' };
        }
        return {
          kind: 'done',
          scope: row.scope,
          requestHash: row.requestHash,
          statusCode: row.statusCode,
          response: row.response,
        };
      }
      // Abandoned claim (the process died mid-request): take it over.
      if (await takeOver(pendingTtlMs, isNull(idempotencyKeys.statusCode))) {
        return { kind: 'claimed' };
      }
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
