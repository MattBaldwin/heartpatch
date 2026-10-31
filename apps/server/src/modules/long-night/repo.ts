import {
  LongNightOutcomeRowSchema,
  LongNightWeekdaySchema,
  type LocalDate,
  type LongNightOutcomeRow,
  type LongNightWeekday,
} from '@heartpatch/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { gameEvents, longNights, mapMembers, maps, users } from '../../db/schema.js';
import { activeMember } from '../maps/repo.js';

/** A patch's Long Night as `long_nights` holds it (#727). Server-only (rule 6). */
export interface LongNightRow {
  id: string;
  night: LocalDate;
  ranAt: Date;
  strikeAt: Date;
  held: boolean;
  outcomes: LongNightOutcomeRow[];
  keeperOfNightUserId: string | null;
  gapOpensAt: Date | null;
  gapClosesAt: Date | null;
}

/** A Night to record: the row less its id. */
export type NewLongNightRow = Omit<LongNightRow, 'id'> & {
  mapId: string;
  seed: string;
  contentHash: string;
};

const OutcomesSchema = z.array(LongNightOutcomeRowSchema);

const rowColumns = {
  id: longNights.id,
  night: longNights.night,
  ranAt: longNights.ranAt,
  strikeAt: longNights.strikeAt,
  held: longNights.held,
  outcomes: longNights.outcomes,
  keeperOfNightUserId: longNights.keeperOfNightUserId,
  gapOpensAt: longNights.gapOpensAt,
  gapClosesAt: longNights.gapClosesAt,
};

export interface LongNightRepo {
  transaction: <T>(fn: (repo: LongNightTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** The patch's weekday (0 is Sunday), or null: Off. Undefined for a missing map. */
  weekday: (mapId: string) => Promise<LongNightWeekday | null | undefined>;
  /** Sets the weekday; false if it already was that. */
  setWeekday: (mapId: string, weekday: LongNightWeekday | null) => Promise<boolean>;
  /** The active members' usernames, for the testers switch. */
  usernames: (mapId: string) => Promise<{ username: string }[]>;
  /** The patch's newest Long Night, or null before its first. */
  latest: (mapId: string) => Promise<LongNightRow | null>;
  /**
   * The patch's newest Long Night, row-locked `FOR UPDATE` (tech spec §7
   * step 9, with the Hollow's rows): a Gap claim (#727d) holds it until commit.
   */
  lockLatest: (mapId: string) => Promise<LongNightRow | null>;
  /** Moves a Night's Gap window (the dev "Gap now" route alone, under `lockLatest`). */
  setGapWindow: (id: string, opensAt: Date, closesAt: Date) => Promise<void>;
  /** Writes a Night's `outcomes` (a Gap claim, under `lockLatest`). */
  setOutcomes: (id: string, outcomes: readonly LongNightOutcomeRow[]) => Promise<void>;
  /** Records a Night (nightfall's own transaction; the `(map_id, night)` key makes it once). */
  insert: (row: NewLongNightRow) => Promise<void>;
  /**
   * When each Keeper last did something on the patch: their newest
   * `game_events` row there (real clock). Missing: none.
   */
  lastActive: (mapId: string, userIds: readonly string[]) => Promise<Map<string, Date>>;
}

export interface LongNightTxRepo extends LongNightRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

export function createLongNightRepo(db: Executor): LongNightRepo {
  return {
    transaction: (fn) =>
      withTransaction(db, (tx) =>
        fn({ ...createLongNightRepo(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
      ),

    weekday: async (mapId) => {
      const [row] = await db
        .select({ weekday: maps.longNightWeekday })
        .from(maps)
        .where(eq(maps.id, mapId));
      if (!row) return undefined;
      return row.weekday === null ? null : LongNightWeekdaySchema.parse(row.weekday);
    },

    setWeekday: async (mapId, weekday) => {
      const rows = await db
        .update(maps)
        .set({ longNightWeekday: weekday })
        .where(and(eq(maps.id, mapId), sql`${maps.longNightWeekday} is distinct from ${weekday}`))
        .returning({ id: maps.id });
      return rows.length > 0;
    },

    usernames: (mapId) =>
      db
        .select({ username: users.username })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .where(activeMember(mapId))
        .orderBy(asc(mapMembers.userId)),

    latest: async (mapId) => {
      const [row] = await db
        .select(rowColumns)
        .from(longNights)
        .where(eq(longNights.mapId, mapId))
        .orderBy(desc(longNights.night))
        .limit(1);
      // jsonb is checked on the way out, so a hand-edited row fails loudly.
      return row ? { ...row, outcomes: OutcomesSchema.parse(row.outcomes) } : null;
    },

    lockLatest: async (mapId) => {
      const [row] = await db
        .select(rowColumns)
        .from(longNights)
        .where(eq(longNights.mapId, mapId))
        .orderBy(desc(longNights.night))
        .limit(1)
        .for('update');
      return row ? { ...row, outcomes: OutcomesSchema.parse(row.outcomes) } : null;
    },

    setGapWindow: async (id, opensAt, closesAt) => {
      await db
        .update(longNights)
        .set({ gapOpensAt: opensAt, gapClosesAt: closesAt })
        .where(eq(longNights.id, id));
    },

    setOutcomes: async (id, outcomes) => {
      await db
        .update(longNights)
        .set({ outcomes: OutcomesSchema.parse(outcomes) })
        .where(eq(longNights.id, id));
    },

    insert: async (row) => {
      await db.insert(longNights).values(row);
    },

    lastActive: async (mapId, userIds) => {
      const seen = new Map<string, Date>();
      // One backwards walk of `(map_id, seq)` per Keeper, once a week (plan:
      // no `last_active_at` column in Long Night A).
      for (const userId of userIds) {
        const [row] = await db
          .select({ at: gameEvents.createdAt })
          .from(gameEvents)
          .where(and(eq(gameEvents.mapId, mapId), eq(gameEvents.actorUserId, userId)))
          .orderBy(desc(gameEvents.seq))
          .limit(1);
        if (row) seen.set(userId, row.at);
      }
      return seen;
    },
  };
}
