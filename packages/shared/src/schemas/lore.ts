import { z } from 'zod';
import { ContentIdSchema, DisplayNameSchema } from './data/common.js';

// The Lorebook API (design doc §16; #24 seeds the first pages, #307 makes it
// a book). A page's words only leave the server once the player has found
// it, so reading the client can't give one away (CLAUDE.md rule 6).

/** A lore page the player has found. */
export const LorePageSchema = z.object({
  id: ContentIdSchema,
  title: DisplayNameSchema,
  text: z.string(),
  foundAt: z.iso.datetime(),
});
export type LorePage = z.infer<typeof LorePageSchema>;

/** A chapter of the book (#307), in book order. */
export const LoreBookChapterSchema = z.object({
  id: ContentIdSchema,
  title: DisplayNameSchema,
  order: z.number().int().min(1),
});
export type LoreBookChapter = z.infer<typeof LoreBookChapterSchema>;

/**
 * Every page has a place in its chapter, found or not. `id` is the page's id
 * once found; before that it only names the place (`<chapter>-<order>`), so
 * it never gives the page away.
 */
const SlotPlaceSchema = z.object({
  id: ContentIdSchema,
  chapter: ContentIdSchema,
  order: z.number().int().min(1),
  /** A gentle nudge toward it, never how to find it. */
  hint: z.string(),
});

/**
 * A page's place in the book (#307): a found page in full, with when it was
 * read in the book (null while it's new); a page still to find is only its
 * place and its hint.
 */
export const LoreSlotSchema = z.discriminatedUnion('found', [
  SlotPlaceSchema.extend({
    found: z.literal(true),
    title: DisplayNameSchema,
    text: z.string(),
    foundAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
  }),
  SlotPlaceSchema.extend({ found: z.literal(false) }),
]);
export type LoreSlot = z.infer<typeof LoreSlotSchema>;
export type FoundLoreSlot = Extract<LoreSlot, { found: true }>;

/**
 * `GET /api/v1/lore`: the pages I've found, oldest first (`pages`, as since
 * #24), and the whole book (#307): its chapters, every page's slot in book
 * order, and how many pages there are. The book's fields default to empty, so
 * an older server's reply still parses.
 */
export const LorebookResponseSchema = z.object({
  pages: z.array(LorePageSchema),
  chapters: z.array(LoreBookChapterSchema).default([]),
  slots: z.array(LoreSlotSchema).default([]),
  total: z.number().int().min(0).default(0),
});
export type LorebookResponse = z.infer<typeof LorebookResponseSchema>;

/** `POST /api/v1/lore/read`: these pages have been read in the book (#307). */
export const LoreReadRequestSchema = z.strictObject({
  ids: z.array(ContentIdSchema).min(1).max(50),
});
export type LoreReadRequest = z.infer<typeof LoreReadRequestSchema>;

/** `POST /api/v1/lore/dev/find` (dev builds only): find a page now, for tests and playtests. */
export const DevFindLoreRequestSchema = z.strictObject({ pageId: ContentIdSchema });
export type DevFindLoreRequest = z.infer<typeof DevFindLoreRequestSchema>;
