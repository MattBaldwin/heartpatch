import { and, asc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Db as PgBossDb } from 'pg-boss';
import { withTransaction, type Executor, type Transaction } from '../db/client.js';
import type { GameEvent } from '../db/game-events.js';
import { eventConsumers, gameEvents, maps } from '../db/schema.js';

export type MapKind = (typeof maps.$inferSelect)['kind'];

/**
 * Storage for event consumers (tech spec §7). Plain queries; the runner
 * (`consumers.ts`) holds the transaction.
 */
export interface JobsRepo {
  /** Runs `fn` in one transaction, with this repo on it. */
  transaction: <T>(fn: (repo: JobsRepo, tx: Transaction) => Promise<T>) => Promise<T>;
  /**
   * Creates the consumer's row for the map if needed, then locks it `FOR
   * UPDATE` until commit and returns `last_seq`. Null if the map is gone.
   */
  lockPosition: (consumer: string, mapId: string) => Promise<number | null>;
  /** The map's events after `afterSeq`, in seq order, at most `limit`. */
  eventsAfter: (mapId: string, afterSeq: number, limit: number) => Promise<GameEvent[]>;
  setPosition: (consumer: string, mapId: string, lastSeq: number) => Promise<void>;
  /** Maps of these kinds whose `event_seq` is past the consumer's `last_seq`. */
  laggingMaps: (consumer: string, kinds: readonly MapKind[]) => Promise<string[]>;
  /** Maps (all, or just these) with their head seq and every consumer's position on them. */
  retentionMaps: (mapIds?: readonly string[]) => Promise<RetentionMap[]>;
  /**
   * Deletes up to `limit` of the map's events below `belowSeq` that are past
   * their keep (older than `before`, or a short-lived type older than
   * `shortLivedBefore`), oldest seq first. Returns how many it deleted.
   */
  deleteOldEvents: (mapId: string, cut: EventCut) => Promise<number>;
}

/** A map as the retention job sees it. */
export interface RetentionMap {
  id: string;
  kind: MapKind;
  eventSeq: number;
  /** `event_consumers.last_seq` by consumer name. */
  positions: Map<string, number>;
}

/** Which of a map's events one retention batch may delete. */
export interface EventCut {
  belowSeq: number;
  before: Date;
  shortLivedTypes: readonly string[];
  shortLivedBefore: Date;
  limit: number;
}

export function createJobsRepo(db: Executor): JobsRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createJobsRepo(tx), tx)),

    lockPosition: async (consumer, mapId) => {
      // Only for a map that exists, so a vanished map ends the job quietly.
      await db.execute(sql`
        insert into ${eventConsumers} (consumer, map_id)
        select ${consumer}, ${maps.id} from ${maps} where ${maps.id} = ${mapId}
        on conflict do nothing`);
      const [row] = await db
        .select({ lastSeq: eventConsumers.lastSeq })
        .from(eventConsumers)
        .where(and(eq(eventConsumers.consumer, consumer), eq(eventConsumers.mapId, mapId)))
        .for('update');
      return row?.lastSeq ?? null;
    },

    eventsAfter: (mapId, afterSeq, limit) =>
      db
        .select()
        .from(gameEvents)
        .where(and(eq(gameEvents.mapId, mapId), gt(gameEvents.seq, afterSeq)))
        .orderBy(asc(gameEvents.seq))
        .limit(limit),

    setPosition: async (consumer, mapId, lastSeq) => {
      await db
        .update(eventConsumers)
        .set({ lastSeq })
        .where(and(eq(eventConsumers.consumer, consumer), eq(eventConsumers.mapId, mapId)));
    },

    laggingMaps: async (consumer, kinds) => {
      if (kinds.length === 0) return [];
      const rows = await db
        .select({ id: maps.id })
        .from(maps)
        .leftJoin(
          eventConsumers,
          and(eq(eventConsumers.mapId, maps.id), eq(eventConsumers.consumer, consumer)),
        )
        .where(
          and(
            inArray(maps.kind, [...kinds]),
            gt(maps.eventSeq, sql`coalesce(${eventConsumers.lastSeq}, 0)`),
          ),
        );
      return rows.map((r) => r.id);
    },

    retentionMaps: async (mapIds) => {
      if (mapIds?.length === 0) return [];
      const only = mapIds ? [...mapIds] : null;
      const rows = await db
        .select({ id: maps.id, kind: maps.kind, eventSeq: maps.eventSeq })
        .from(maps)
        .where(only ? inArray(maps.id, only) : undefined)
        .orderBy(asc(maps.id));
      const positions = await db
        .select()
        .from(eventConsumers)
        .where(only ? inArray(eventConsumers.mapId, only) : undefined);
      return rows.map((map) => ({
        ...map,
        positions: new Map(
          positions.filter((p) => p.mapId === map.id).map((p) => [p.consumer, p.lastSeq]),
        ),
      }));
    },

    deleteOldEvents: async (mapId, cut) => {
      // Walks the `(map_id, seq)` index from the map's oldest event; no other index needed.
      const doomed = db
        .select({ id: gameEvents.id })
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.mapId, mapId),
            lt(gameEvents.seq, cut.belowSeq),
            or(
              lt(gameEvents.createdAt, cut.before),
              cut.shortLivedTypes.length > 0
                ? and(
                    inArray(gameEvents.type, [...cut.shortLivedTypes]),
                    lt(gameEvents.createdAt, cut.shortLivedBefore),
                  )
                : undefined,
            ),
          ),
        )
        .orderBy(asc(gameEvents.seq))
        .limit(cut.limit);
      const gone = await db
        .delete(gameEvents)
        .where(inArray(gameEvents.id, doomed))
        .returning({ id: gameEvents.id });
      return gone.length;
    },
  };
}

/**
 * Lets pg-boss run its statements on a Drizzle transaction (its `db`
 * option), so a `send` commits or rolls back with the command (tech spec §7).
 * pg-boss writes `$1`-style placeholders; they become bound parameters.
 *
 * Only for `send` with `{ mapId }` data: its SQL has one placeholder and the
 * data travels as a parameter. Statements that inline data into the SQL text
 * (e.g. flows) could contain `$<digit>` and must not go through this.
 */
export function pgBossOnTransaction(tx: Transaction): PgBossDb {
  return {
    executeSql: async (text, values = []) => {
      const chunks: SQL[] = text.split(/\$(\d+)/).map((part, i) => {
        if (i % 2 === 0) return sql.raw(part);
        const index = Number(part) - 1;
        if (index < 0 || index >= values.length) {
          throw new Error(`pgBossOnTransaction: no value for $${part}`);
        }
        return sql`${values[index]}`;
      });
      const rows = await tx.execute(sql.join(chunks));
      return { rows: [...rows] };
    },
  };
}
