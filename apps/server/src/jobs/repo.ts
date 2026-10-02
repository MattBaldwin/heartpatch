import { and, asc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
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
  };
}

/**
 * Lets pg-boss run its statements on a Drizzle transaction (its `db`
 * option), so a `send` commits or rolls back with the command (tech spec §7).
 * pg-boss writes `$1`-style placeholders; they become bound parameters.
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
