import type { LorebookResponse, LoreSlot, PublicUser } from '@heartpatch/shared';
import {
  LORE_CHAPTERS,
  LORE_PAGES,
  type LoreChapter,
  type LoreEntry,
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createLoreRepo } from './repo.js';

/**
 * The Lorebook (design doc §16, #307): every page's place in the book, words
 * only for the pages the player has found. A page still to find sends its
 * place and its hint, never its title, words or trigger (CLAUDE.md rule 6).
 */
export interface LoreService {
  lorebook: (user: PublicUser) => Promise<LorebookResponse>;
  /** `POST /lore/read`: these found pages have been read in the book; replies with the book. */
  markRead: (user: PublicUser, pageIds: readonly string[]) => Promise<LorebookResponse>;
  /** Dev builds only (`HP_DEV_SQUISHY_GRANTS`): finds a page now; replies with the book. */
  devFind: (user: PublicUser, pageId: string) => Promise<LorebookResponse>;
}

export interface LoreServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Tests pass their own pages and chapters. */
  pages?: readonly LoreEntry[];
  chapters?: readonly LoreChapter[];
}

/** An unfound page's slot id: its chapter and place ("wild-lands-3"), never the page's own id. */
export function blankSlotId(page: Pick<LoreEntry, 'chapter' | 'order'>): string {
  return `${page.chapter}-${String(page.order)}`;
}

export function createLoreService(options: LoreServiceOptions): LoreService {
  const store = createLoreRepo(options.db);
  const now = options.clock ?? (() => new Date());
  const pages = new Map((options.pages ?? LORE_PAGES).map((p) => [p.id, p]));
  const chapters = [...(options.chapters ?? LORE_CHAPTERS)].sort((a, b) => a.order - b.order);
  const chapterOrder = new Map(chapters.map((c) => [c.id, c.order]));
  // Book order: chapter, then the page's place in it.
  const bookOrder = [...pages.values()].sort(
    (a, b) =>
      (chapterOrder.get(a.chapter) ?? 0) - (chapterOrder.get(b.chapter) ?? 0) || a.order - b.order,
  );

  const lorebook = async (user: PublicUser): Promise<LorebookResponse> => {
    // A page dropped from the data stays found but has nothing to show.
    const found = await store.listFound(user.id);
    const byId = new Map(found.map((f) => [f.pageId, f]));
    const slots = bookOrder.map((page): LoreSlot => {
      const place = { chapter: page.chapter, order: page.order, hint: page.hint };
      const row = byId.get(page.id);
      // A page's id is its title as a slug: until it's found, its slot goes by
      // its place instead, so not even the id gives it away (rule 6).
      if (!row) return { id: blankSlotId(page), ...place, found: false };
      return {
        id: page.id,
        ...place,
        found: true,
        title: page.title,
        text: page.text,
        foundAt: row.foundAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      };
    });
    return {
      pages: found.flatMap(({ pageId, foundAt }) => {
        const page = pages.get(pageId);
        return page
          ? [{ id: page.id, title: page.title, text: page.text, foundAt: foundAt.toISOString() }]
          : [];
      }),
      chapters: chapters.map(({ id, title, order }) => ({ id, title, order })),
      slots,
      total: slots.length,
    };
  };

  return {
    lorebook,
    markRead: async (user, pageIds) => {
      await store.markRead(user.id, pageIds, now());
      return lorebook(user);
    },
    devFind: async (user, pageId) => {
      if (!pages.has(pageId)) throw new AppError('NOT_FOUND', 'There is no page like that.');
      await store.found({ userId: user.id, pageId, mapId: null, at: now() });
      return lorebook(user);
    },
  };
}
