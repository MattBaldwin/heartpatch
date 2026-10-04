import { eq, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { users } from '../../db/schema.js';

/** The opening cinematic's flag on the account (`users.cinematic_seen_at`). */
export interface CinematicRepo {
  /** When the player first saw it; null before. */
  seenAt: (userId: string) => Promise<Date | null>;
  /** Marks it seen at `at` unless it already was; returns the first time it was seen. */
  markSeen: (userId: string, at: Date) => Promise<Date | null>;
}

export function createCinematicRepo(db: Executor): CinematicRepo {
  return {
    seenAt: async (userId) => {
      const [row] = await db
        .select({ seenAt: users.cinematicSeenAt })
        .from(users)
        .where(eq(users.id, userId));
      return row?.seenAt ?? null;
    },

    markSeen: async (userId, at) => {
      // One statement, so two devices finishing at once keep the earlier time.
      const [row] = await db
        .update(users)
        .set({
          cinematicSeenAt: sql`coalesce(${users.cinematicSeenAt}, ${at.toISOString()}::timestamptz)`,
        })
        .where(eq(users.id, userId))
        .returning({ seenAt: users.cinematicSeenAt });
      return row?.seenAt ?? null;
    },
  };
}
