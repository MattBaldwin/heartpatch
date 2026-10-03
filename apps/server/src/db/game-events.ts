import {
  parseGameEventPayload,
  type GameEventPayload,
  type GameEventType,
} from '@heartpatch/shared';
import { eq, sql } from 'drizzle-orm';
import type { Transaction } from './client.js';
import { gameEvents, maps } from './schema.js';

/** An event to append; the payload is typed by the shared registry (`schemas/events.ts`). */
export interface NewGameEvent<T extends GameEventType = GameEventType> {
  mapId: string;
  type: T;
  /** Null for system events (nightfall, jobs). */
  actorUserId: string | null;
  payload: GameEventPayload<T>;
}

export type GameEvent = typeof gameEvents.$inferSelect;

/** What an event consumer's wake-up needs to know about a new event. */
export interface AppendedEvent {
  mapId: string;
  mapKind: (typeof maps.$inferSelect)['kind'];
  seq: number;
}

/**
 * Enqueues event-consumer wake-ups for a new event **inside its transaction**
 * (tech spec §7), so the wake-up commits or rolls back with the event.
 */
export type EventWakeup = (tx: Transaction, event: AppendedEvent) => Promise<void>;

let eventWakeup: EventWakeup | null = null;

/**
 * Installed by `startJobs` (src/jobs/boss.ts) and cleared when it stops. With
 * no jobs running (tests, ops tools) events are appended without a wake-up;
 * the periodic catch-up job finds them once jobs run.
 */
export function setEventWakeup(wakeup: EventWakeup | null): void {
  eventWakeup = wakeup;
}

/**
 * Appends a `game_events` row inside the caller's transaction (tech spec §7).
 * The payload is checked against the type's internal schema first, so a bad
 * payload throws and rolls the command back.
 *
 * Call it as the **last write** of the transaction, after the state change it
 * describes. Bumping `maps.event_seq` row-locks the map until commit, so:
 * - seqs are gap-free: a rollback undoes the bump along with the event;
 * - commit order matches seq order, because the next appender on this map
 *   waits for the lock;
 * - locks are always taken entity rows first, `maps` last, which avoids
 *   deadlocks and keeps the busy `maps` row locked only briefly. The full
 *   order is tech spec §7 "Lock order" (several rows of a kind in id
 *   order). A consumer transaction applies one event, so it takes `maps`
 *   at most once, at its end (`jobs/consumers.ts`).
 *
 * It also enqueues the event consumers' wake-up (pg-boss `send`) in the same
 * transaction (see `setEventWakeup`), so a rolled-back command wakes nobody.
 *
 * After commit, call `wsHub.publish(mapId)` (apps/server/README.md, "Live
 * sync"); the hub sends each type's public view, never the raw payload.
 */
export async function appendGameEvent<T extends GameEventType>(
  tx: Transaction,
  event: NewGameEvent<T>,
): Promise<GameEvent> {
  return await appendRawGameEvent(tx, {
    ...event,
    payload: parseGameEventPayload(event.type, event.payload),
  });
}

/**
 * The seq-allocating writer under `appendGameEvent`, with no registry check.
 * **Only for tests of the event stream itself** (live sync, replay), which
 * need made-up event types. Modules always use `appendGameEvent`.
 */
export async function appendRawGameEvent(
  tx: Transaction,
  event: {
    mapId: string;
    type: string;
    actorUserId: string | null;
    payload: Record<string, unknown>;
  },
): Promise<GameEvent> {
  const [allocated] = await tx
    .update(maps)
    .set({ eventSeq: sql`${maps.eventSeq} + 1` })
    .where(eq(maps.id, event.mapId))
    .returning({ seq: maps.eventSeq, kind: maps.kind });
  if (!allocated) throw new Error(`appendGameEvent: map ${event.mapId} does not exist`);

  const [row] = await tx
    .insert(gameEvents)
    .values({ ...event, seq: allocated.seq })
    .returning();
  if (!row) throw new Error('appendGameEvent: insert returned no row');
  await eventWakeup?.(tx, { mapId: event.mapId, mapKind: allocated.kind, seq: allocated.seq });
  return row;
}
