import { z } from 'zod';
import { ContentIdSchema } from './common.js';

// Hollow puzzles on grey village tiles (#306 PR 2b, owner decisions
// 2026-10-22): each tile's broken thing (a music box, a mural, a fountain)
// holds a "Relight the path" lantern line. Its look comes from the tile's
// terrain; how hard it is comes from how deep in the Hollow the tile is.
// What a kid sees lives here (CLAUDE.md rule 5); what solving one gives
// stays in the server-only data (rule 6).

/** One look of the broken thing and its words (style guide §6). */
export const PuzzleSkinSchema = z.strictObject({
  id: ContentIdSchema,
  /** Its name on the action button and the card ("music box"). */
  name: z.string().min(1).max(24),
  emoji: z.string().min(1).max(8),
  /** The terrains it stands on; the rest get `defaultSkin`. */
  terrains: z.array(ContentIdSchema),
  /** The card's title once it's whole again. */
  fixed: z.string().min(1).max(48),
});
export type PuzzleSkin = z.infer<typeof PuzzleSkinSchema>;

/** How deep in its Hollow a tile is: the square (heart), a ring tile with Hollow on both sides (inner), or any other (rim). */
export const RelightDepthSchema = z.enum(['rim', 'inner', 'heart']);
export type RelightDepth = z.infer<typeof RelightDepthSchema>;

/** One Relight difficulty: a square grid and what's on it. */
export const RelightTierSchema = z
  .strictObject({
    /** The grid is `size` × `size`. */
    size: z.number().int().min(3).max(8),
    lanterns: z.number().int().min(1),
    /** Echo shadows: light that touches one is snuffed out. */
    shadows: z.number().int().min(0),
    /** Wooden pieces: they slide into an empty slot and never turn. */
    loose: z.number().int().min(0),
    /** Empty slots for them to slide into. */
    empty: z.number().int().min(0),
    /** Moves allowed over the puzzle's work: limit = work + slack. */
    slack: z.number().int().min(0),
    /** A board whose work is under this is made again: no puzzle is trivial. */
    minWork: z.number().int().min(1),
  })
  .superRefine((tier, ctx) => {
    // Shadows never sit on the heart or the (up to) 3 cells beside it.
    if (
      tier.lanterns + tier.shadows + tier.empty + 1 >= tier.size * tier.size ||
      tier.shadows > tier.size * tier.size - 4
    ) {
      ctx.addIssue({ code: 'custom', message: 'too much on too small a grid' });
    }
    if ((tier.loose === 0) !== (tier.empty === 0)) {
      ctx.addIssue({ code: 'custom', path: ['empty'], message: 'wooden pieces need empty slots' });
    }
  });
export type RelightTier = z.infer<typeof RelightTierSchema>;

export const MemoryPuzzleRulesSchema = z
  .strictObject({
    skins: z.array(PuzzleSkinSchema).min(1),
    /** The skin for a terrain no skin lists. */
    defaultSkin: ContentIdSchema,
    /** Relight's difficulty by depth. */
    relight: z.record(RelightDepthSchema, RelightTierSchema),
  })
  .superRefine((rules, ctx) => {
    const ids = new Set<string>();
    const terrains = new Set<string>();
    rules.skins.forEach((skin, i) => {
      if (ids.has(skin.id)) {
        ctx.addIssue({ code: 'custom', path: ['skins', i, 'id'], message: 'listed twice' });
      }
      ids.add(skin.id);
      for (const terrain of skin.terrains) {
        if (terrains.has(terrain)) {
          ctx.addIssue({
            code: 'custom',
            path: ['skins', i, 'terrains'],
            message: `"${terrain}" already has a skin`,
          });
        }
        terrains.add(terrain);
      }
    });
    if (!ids.has(rules.defaultSkin)) {
      ctx.addIssue({ code: 'custom', path: ['defaultSkin'], message: 'no such skin' });
    }
  });
export type MemoryPuzzleRules = z.infer<typeof MemoryPuzzleRulesSchema>;
