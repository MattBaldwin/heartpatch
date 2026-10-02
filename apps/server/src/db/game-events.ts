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
 *   deadlocks and keeps the busy `maps` row locked only briefly.
 *
 * Broadcast the returned event to WebSocket clients only after commit, using
 * `publicGameEventPayload` (never the raw payload).
 */
export async function appendGameEvent<T extends GameEventType>(
  tx: Transaction,
  event: NewGameEvent<T>,
): Promise<GameEvent> {
  const payload = parseGameEventPayload(event.type, event.payload);
  const [allocated] = await tx
    .update(maps)
    .set({ eventSeq: sql`${maps.eventSeq} + 1` })
    .where(eq(maps.id, event.mapId))
    .returning({ seq: maps.eventSeq });
  if (!allocated) throw new Error(`appendGameEvent: map ${event.mapId} does not exist`);

  const [row] = await tx
    .insert(gameEvents)
    .values({ ...event, payload, seq: allocated.seq })
    .returning();
  if (!row) throw new Error('appendGameEvent: insert returned no row');
  return row;
}
