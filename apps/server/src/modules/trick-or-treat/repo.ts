import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { mapMembers, trickOrTreatVisits, users } from '../../db/schema.js';

/** A visit as stored (`trick_or_treat_visits`). */
export type VisitRow = typeof trickOrTreatVisits.$inferSelect;
export type NewVisit = typeof trickOrTreatVisits.$inferInsert;

/**
 * Storage for trick-or-treat (#515): the visits table. The unique key on
 * (map, visitor, host, day) is the once-a-day rule.
 */
export interface TrickOrTreatRepo {
  transaction: <T>(fn: (repo: TrickOrTreatTxRepo, tx: Transaction) => Promise<T>) => Promise<T>;
  /**
   * Row-locks the account's `users` row (tech spec §7 step 4, `FOR NO KEY
   * UPDATE`): one knock at a time per account, on every patch, so the
   * owned-costume check holds.
   */
  lockAccount: (userId: string) => Promise<void>;
  /** Other active members of the patch with a home there: the doors I can knock on. */
  hostsOf: (mapId: string, visitorUserId: string) => Promise<string[]>;
  /** The homes I've visited on this patch day. */
  visitedOn: (mapId: string, visitorUserId: string, day: string) => Promise<string[]>;
  /** Who came to my home on this patch day, and the thank-you Heartdust they left. */
  visitorsOn: (
    mapId: string,
    hostUserId: string,
    day: string,
  ) => Promise<{ visitors: number; heartdust: number }>;
  /**
   * Stores a visit unless that visitor already visited that home that day
   * (ON CONFLICT DO NOTHING on the unique key). True if this call stored it.
   */
  insertVisit: (visit: NewVisit) => Promise<boolean>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface TrickOrTreatTxRepo extends TrickOrTreatRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

function createTxRepo(tx: Transaction): TrickOrTreatTxRepo {
  return { ...createTrickOrTreatRepo(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

export function createTrickOrTreatRepo(db: Executor): TrickOrTreatRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createTxRepo(tx), tx)),

    lockAccount: async (userId) => {
      // NO KEY UPDATE, not UPDATE: it still serialises one knock per account,
      // but lets a patch-mate's knock key-share this row (their visit's
      // `host_user_id`, my bag's rows) so two Keepers knocking on each
      // other's doors at once don't deadlock.
      await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for('no key update');
    },

    hostsOf: async (mapId, visitorUserId) => {
      const rows = await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(
          and(
            eq(mapMembers.mapId, mapId),
            eq(mapMembers.status, 'active'),
            isNotNull(mapMembers.homeSlot),
            ne(mapMembers.userId, visitorUserId),
          ),
        )
        .orderBy(mapMembers.userId);
      return rows.map((r) => r.userId);
    },

    visitedOn: async (mapId, visitorUserId, day) => {
      const rows = await db
        .select({ hostUserId: trickOrTreatVisits.hostUserId })
        .from(trickOrTreatVisits)
        .where(
          and(
            eq(trickOrTreatVisits.mapId, mapId),
            eq(trickOrTreatVisits.visitorUserId, visitorUserId),
            eq(trickOrTreatVisits.day, day),
          ),
        );
      return rows.map((r) => r.hostUserId);
    },

    visitorsOn: async (mapId, hostUserId, day) => {
      const [row] = await db
        .select({
          visitors: sql<number>`count(*)::int`,
          heartdust: sql<number>`coalesce(sum(${trickOrTreatVisits.hostHeartdust}), 0)::int`,
        })
        .from(trickOrTreatVisits)
        .where(
          and(
            eq(trickOrTreatVisits.mapId, mapId),
            eq(trickOrTreatVisits.hostUserId, hostUserId),
            eq(trickOrTreatVisits.day, day),
          ),
        );
      return { visitors: row?.visitors ?? 0, heartdust: row?.heartdust ?? 0 };
    },

    insertVisit: async (visit) => {
      const rows = await db
        .insert(trickOrTreatVisits)
        .values(visit)
        .onConflictDoNothing({
          target: [
            trickOrTreatVisits.mapId,
            trickOrTreatVisits.visitorUserId,
            trickOrTreatVisits.hostUserId,
            trickOrTreatVisits.day,
          ],
        })
        .returning({ id: trickOrTreatVisits.id });
      return rows.length > 0;
    },
  };
}
