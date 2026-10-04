import { and, asc, eq, gt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { GameEvent } from '../db/game-events.js';
import { gameEvents, mapMembers, maps } from '../db/schema.js';
import { activeMember } from '../modules/maps/repo.js';

/** What the WebSocket hub reads. Reads only: the hub never writes game state. */
export interface WsRepo {
  /** True if the player is an active (not removed) member of the map. */
  isActiveMember: (mapId: string, userId: string) => Promise<boolean>;
  /** User ids of the map's active members. */
  activeMemberIds: (mapId: string) => Promise<Set<string>>;
  /** The map's last allocated seq (`maps.event_seq`), or null if the map is gone. */
  headSeq: (mapId: string) => Promise<number | null>;
  /** Committed events with `seq > afterSeq`, oldest first. */
  eventsAfter: (mapId: string, afterSeq: number, limit: number) => Promise<GameEvent[]>;
}

/**
 * Reads use their own pooled connection, never a caller's transaction, so
 * they only ever see **committed** events (tech spec §7: broadcast after commit).
 */
export function createWsRepo(db: Database): WsRepo {
  return {
    isActiveMember: async (mapId, userId) => {
      const [row] = await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(activeMember(mapId, userId))
        .limit(1);
      return row !== undefined;
    },

    activeMemberIds: async (mapId) => {
      const rows = await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(activeMember(mapId));
      return new Set(rows.map((r) => r.userId));
    },

    headSeq: async (mapId) => {
      const [row] = await db
        .select({ seq: maps.eventSeq })
        .from(maps)
        .where(eq(maps.id, mapId))
        .limit(1);
      return row?.seq ?? null;
    },

    eventsAfter: (mapId, afterSeq, limit) =>
      db
        .select()
        .from(gameEvents)
        .where(and(eq(gameEvents.mapId, mapId), gt(gameEvents.seq, afterSeq)))
        .orderBy(asc(gameEvents.seq))
        .limit(limit),
  };
}
