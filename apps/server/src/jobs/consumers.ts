import type { Database, Transaction } from '../db/client.js';
import type { GameEvent } from '../db/game-events.js';
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
   * Applies one event, in a transaction of its own. Write only through `tx`:
   * `last_seq` advances in the same transaction, so the writes and the
   * position commit together. Throw to roll it back; it is retried from the
   * same event later. Lock entity rows first and append any new event last
   * (tech spec §7 "Lock order"): the append takes `maps`.
   */
  handle: (tx: Transaction, event: GameEvent) => Promise<void>;
}

export interface RunConsumerOptions {
  /** After each event's transaction commits (e.g. `wsHub.publish`, if handlers write events). */
  afterCommit?: (mapId: string) => void;
}

/**
 * Applies a consumer to one map until it has caught up with `maps.event_seq`
 * (tech spec §7). Each event is one transaction that holds the consumer's
 * `event_consumers` row `FOR UPDATE`, applies the next event after
 * `last_seq` and advances `last_seq` to it. So:
 *
 * - two workers on the same (consumer, map) take turns, and each event is
 *   applied exactly once, in seq order;
 * - a crash or a throwing handler rolls that one event back: it is only
 *   delayed, and the events before it stay applied;
 * - an event committed while this runs is picked up by the next round, so a
 *   wake-up that pg-boss de-duplicated is never lost;
 * - a transaction takes the `maps` row lock (a handler's append) at most once
 *   and only at its end. A batch of events in one transaction would hold
 *   `maps` from the first append while the next handler locks squishies or
 *   tiles, the reverse of every command's order (and nightfall's), which can
 *   deadlock (tech spec §7 "Lock order").
 *
 * Returns how many events it applied.
 */
export async function runConsumer(
  db: Database,
  consumer: EventConsumer,
  mapId: string,
  options: RunConsumerOptions = {},
): Promise<number> {
  const store = createJobsRepo(db);
  let applied = 0;
  for (;;) {
    const done = await store.transaction(async (repo, tx) => {
      const lastSeq = await repo.lockPosition(consumer.name, mapId);
      if (lastSeq === null) return false;
      const [event] = await repo.eventsAfter(mapId, lastSeq, 1);
      if (event === undefined) return false;
      await consumer.handle(tx, event);
      await repo.setPosition(consumer.name, mapId, event.seq);
      return true;
    });
    if (!done) return applied;
    applied += 1;
    options.afterCommit?.(mapId);
  }
}
