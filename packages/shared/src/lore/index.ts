import type { LoreEntry } from '../schemas/data/lore-pages.js';
import { predicateHolds, type TutorialEvent } from '../tutorial/index.js';

// Which lore pages a game event finds (design doc §16). Pure, so the
// server's lore consumer and tests share it. Server-only: it reads the
// secret pages (`@heartpatch/shared/server`).

/** A page someone found. */
export interface LoreFind {
  pageId: string;
  userId: string;
}

/** The payload's `userId`, if it has one (`payload-user` finds). */
function payloadUser(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('userId' in payload)) return null;
  return typeof payload.userId === 'string' ? payload.userId : null;
}

/**
 * The pages `event` finds on a map of `mapKind`. `tutorialPlayer` is the
 * Glade's player on a tutorial map (null elsewhere), for system events there.
 */
export function loreFinds(
  pages: readonly LoreEntry[],
  event: TutorialEvent,
  mapKind: 'multiplayer' | 'tutorial',
  tutorialPlayer: string | null,
): LoreFind[] {
  return pages.flatMap((page): LoreFind[] => {
    const { trigger } = page;
    if (!trigger.mapKinds.includes(mapKind) || trigger.eventType !== event.type) return [];
    if (!trigger.where.every((p) => predicateHolds(p, event.payload))) return [];
    const userId =
      trigger.finder === 'actor'
        ? event.actorUserId
        : trigger.finder === 'payload-user'
          ? payloadUser(event.payload)
          : tutorialPlayer;
    return userId ? [{ pageId: page.id, userId }] : [];
  });
}
