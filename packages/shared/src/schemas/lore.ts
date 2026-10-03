import { z } from 'zod';
import { ContentIdSchema, DisplayNameSchema } from './data/common.js';

// The Lorebook API (design doc §16; #24 seeds the first pages). A page's
// words only leave the server once the player has found it, so reading the
// client can't give one away (CLAUDE.md rule 6).

/** A lore page the player has found. */
export const LorePageSchema = z.object({
  id: ContentIdSchema,
  title: DisplayNameSchema,
  text: z.string(),
  foundAt: z.iso.datetime(),
});
export type LorePage = z.infer<typeof LorePageSchema>;

/** `GET /api/v1/lore`: the pages I've found, oldest first. */
export const LorebookResponseSchema = z.object({ pages: z.array(LorePageSchema) });
export type LorebookResponse = z.infer<typeof LorebookResponseSchema>;
