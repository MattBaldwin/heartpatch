import { LORE_PAGES, loreFinds, type LoreEntry } from '@heartpatch/shared/server';
import type { Transaction } from '../../db/client.js';
import type { GameEvent } from '../../db/game-events.js';
import type { EventConsumer } from '../../jobs/consumers.js';
import type { Clock } from '../../lib/time.js';
import { createLoreRepo } from './repo.js';

/** Plain code-unit order (not locale order), the same in every process. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface LoreConsumerOptions {
  clock?: Clock;
  /** Tests pass their own pages. */
  pages?: readonly LoreEntry[];
}

/**
 * The Lorebook's event consumer (design doc §16, tech spec §7 "Event
 * consumers"). For each event on any map, in seq order: record the lore
 * pages its conditions find (`LORE_PAGES`, server-only data), once per
 * player. It writes no game event, so it never holds `maps`, and locks
 * nothing but its own inserts (each ignores a page already found, but waits
 * on another transaction inserting the same one), which it makes in
 * `lore_found`'s key order; the client reads found pages from `GET /lore`.
 */
export function createLoreConsumer(options: LoreConsumerOptions = {}): EventConsumer {
  const pages = options.pages ?? LORE_PAGES;
  const now = options.clock ?? (() => new Date());
  const eventTypes = new Set<string>(pages.map((p) => p.trigger.eventType));

  return {
    name: 'lore',
    mapKinds: ['multiplayer', 'tutorial'],
    handle: async (tx: Transaction, event: GameEvent) => {
      if (!eventTypes.has(event.type)) return;
      const repo = createLoreRepo(tx);
      const map = await repo.mapFinder(event.mapId);
      if (!map) return;
      // In `lore_found`'s key order (player, then page), so two consumers
      // finding the same pages wait on each other rather than deadlock.
      const finds = loreFinds(pages, event, map.kind, map.tutorialPlayer).sort(
        (a, b) => compare(a.userId, b.userId) || compare(a.pageId, b.pageId),
      );
      for (const find of finds) {
        await repo.found({ ...find, mapId: event.mapId, at: now() });
      }
    },
  };
}
