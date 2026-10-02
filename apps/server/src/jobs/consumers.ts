import type { Database, Transaction } from '../db/client.js';
import type { GameEvent } from '../db/game-events.js';
import { CONSUMER_BATCH_SIZE } from './limits.js';
import { createJobsRepo, type MapKind } from './repo.js';

/**
 * Reads every map's `game_events` in seq order after commit and keeps its own
 * state (tech spec §7: tutorial steps; later milestones, Easter eggs, the raid
 * log). Never runs inside the command's transaction and never depends on live
 * broadcast.
 */
export interface EventConsumer {
  /** Stored in `event_consumers.consumer` and names the queue. Never rename one. */
  name: string;
  /** Map kinds it reads; it isn't woken for others. */
  mapKinds: readonly MapKind[];
  /**
   * Applies one event. Write only through `tx`: `last_seq` advances in the
   * same transaction, so the writes and the position commit together. Throw
   * to roll the batch back; it is retried from the same event later.
   */
  handle: (tx: Transaction, event: GameEvent) => Promise<void>;
}

export interface RunConsumerOptions {
  batchSize?: number;
  /** After each batch commits (e.g. `wsHub.publish`, if handlers write events). */
  afterCommit?: (mapId: string) => void;
}

/**
 * Applies a consumer to one map until it has caught up with `maps.event_seq`
 * (tech spec §7). Each batch is one transaction that holds the consumer's
 * `event_consumers` row `FOR UPDATE`, applies the events after `last_seq` in
 * seq order and advances `last_seq`. So:
 *
 * - two workers on the same (consumer, map) take turns, and each event is
 *   applied exactly once;
 * - a crash or a throwing handler rolls the batch back: it is only delayed;
 * - an event committed while this runs is picked up by the next batch, so a
 *   wake-up that pg-boss de-duplicated is never lost.
 *
 * Returns how many events it applied.
 */
export async function runConsumer(
  db: Database,
  consumer: EventConsumer,
  mapId: string,
  options: RunConsumerOptions = {},
): Promise<number> {
  const batchSize = options.batchSize ?? CONSUMER_BATCH_SIZE;
  const store = createJobsRepo(db);
  let applied = 0;
  for (;;) {
    const count = await store.transaction(async (repo, tx) => {
      const lastSeq = await repo.lockPosition(consumer.name, mapId);
      if (lastSeq === null) return 0;
      const events = await repo.eventsAfter(mapId, lastSeq, batchSize);
      const last = events.at(-1);
      if (last === undefined) return 0;
      for (const event of events) await consumer.handle(tx, event);
      await repo.setPosition(consumer.name, mapId, last.seq);
      return events.length;
    });
    if (count === 0) return applied;
    applied += count;
    options.afterCommit?.(mapId);
  }
}
