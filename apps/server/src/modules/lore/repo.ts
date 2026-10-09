import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { loreFound, maps } from '../../db/schema.js';
import { createMapsRepo } from '../maps/repo.js';

/** A page a player found (`lore_found`). */
export interface FoundRow {
  pageId: string;
  foundAt: Date;
  /** When it was read in the Lorebook (#307), or null while it's new. */
  readAt: Date | null;
}

/** Lore storage (`lore_found`). Plain queries; the consumer and service decide the rules. */
export interface LoreRepo {
  /** The map's kind, and its player if it's a tutorial map (its owner). Null if it's gone. */
  mapFinder: (
    mapId: string,
  ) => Promise<{ kind: 'multiplayer' | 'tutorial'; tutorialPlayer: string | null } | null>;
  /** Records a find; a page already found stays as first found. */
  found: (find: {
    userId: string;
    pageId: string;
    /** Where it was found; null for a dev find (`lore_found.map_id` is nullable). */
    mapId: string | null;
    at: Date;
  }) => Promise<void>;
  /** The player's found pages, oldest first. */
  listFound: (userId: string) => Promise<FoundRow[]>;
  /** Marks found pages read (#307); one already read keeps its first time, one not found is skipped. */
  markRead: (userId: string, pageIds: readonly string[], at: Date) => Promise<void>;
}

export function createLoreRepo(db: Executor): LoreRepo {
  return {
    mapFinder: async (mapId) => {
      const [map] = await db.select({ kind: maps.kind }).from(maps).where(eq(maps.id, mapId));
      if (!map) return null;
      if (map.kind !== 'tutorial') return { kind: map.kind, tutorialPlayer: null };
      return { kind: map.kind, tutorialPlayer: await createMapsRepo(db).tutorialPlayerOf(mapId) };
    },

    found: async ({ userId, pageId, mapId, at }) => {
      await db
        .insert(loreFound)
        .values({ userId, pageId, mapId, foundAt: at })
        .onConflictDoNothing();
    },

    listFound: (userId) =>
      db
        .select({ pageId: loreFound.pageId, foundAt: loreFound.foundAt, readAt: loreFound.readAt })
        .from(loreFound)
        .where(eq(loreFound.userId, userId))
        .orderBy(asc(loreFound.foundAt), asc(loreFound.pageId)),

    markRead: async (userId, pageIds, at) => {
      await db
        .update(loreFound)
        .set({ readAt: at })
        .where(
          and(
            eq(loreFound.userId, userId),
            inArray(loreFound.pageId, [...pageIds]),
            isNull(loreFound.readAt),
          ),
        );
    },
  };
}
