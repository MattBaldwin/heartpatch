import { type LorePage, type PublicUser } from '@heartpatch/shared';
import { LORE_PAGES, type LoreEntry } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { createLoreRepo } from './repo.js';

/** The Lorebook (design doc §16): only pages the player has found, words and all. */
export interface LoreService {
  lorebook: (user: PublicUser) => Promise<LorePage[]>;
}

export interface LoreServiceOptions {
  db: Executor;
  /** Tests pass their own pages. */
  pages?: readonly LoreEntry[];
}

export function createLoreService(options: LoreServiceOptions): LoreService {
  const store = createLoreRepo(options.db);
  const pages = new Map((options.pages ?? LORE_PAGES).map((p) => [p.id, p]));
  return {
    lorebook: async (user) =>
      // A page dropped from the data stays found but has nothing to show.
      (await store.listFound(user.id)).flatMap(({ pageId, foundAt }) => {
        const page = pages.get(pageId);
        return page
          ? [{ id: page.id, title: page.title, text: page.text, foundAt: foundAt.toISOString() }]
          : [];
      }),
  };
}
