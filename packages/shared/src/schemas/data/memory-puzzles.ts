import { z } from 'zod';
import { ContentIdSchema } from './common.js';

// Hollow puzzles on grey village tiles (#306 PR 2b, owner decisions
// 2026-10-22): each tile's broken thing (a music box, a mural, a fountain)
// holds a "Relight the path" lantern line, and the heart tile's holds "The
// forgotten story". Its look comes from the tile's
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

/** How deep in its Hollow a tile is: the square (heart), a ring tile with Hollow on both sides (inner), or another ring tile (rim); see `relightDepth`. */
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

/**
 * One moment of the town's last day in "The forgotten story" (#306, owner
 * decision 2026-10-22). Time-neutral on purpose, so everyday sense ("lanterns
 * are lit at night") never fights a clue. Its three wordings fill the clue
 * sentences (`story.ts`).
 */
export const StoryMomentSchema = z.strictObject({
  id: ContentIdSchema,
  emoji: z.string().min(1).max(8),
  /** The card: "The bell rang". */
  did: z.string().min(1).max(40),
  /** In a clue's sentence: "the bell rang". */
  act: z.string().min(1).max(40),
  /** Inside "between … and …": "the bell ringing". */
  ing: z.string().min(1).max(40),
});
export type StoryMoment = z.infer<typeof StoryMomentSchema>;

/** How many moments a day holds for a Hollow of at least `tiles` tiles (one torn page, so one clue, a tile). */
export const StorySizeSchema = z.strictObject({
  tiles: z.number().int().min(1),
  /** At most 6: the generator checks every order (720) for exactly one answer. */
  moments: z.number().int().min(3).max(6),
});
export type StorySize = z.infer<typeof StorySizeSchema>;

/** The forgotten story's rules: the moments, the day's size and how much a clue may give away. */
export const StoryRulesSchema = z
  .strictObject({
    moments: z.array(StoryMomentSchema).min(6),
    /** By the Hollow's size, smallest first. */
    sizes: z.array(StorySizeSchema).min(1),
    /** Clues a day may have that give a place away outright (first or last). */
    maxPlaceClues: z.number().int().min(0),
  })
  .superRefine((story, ctx) => {
    const ids = new Set<string>();
    story.moments.forEach((m, i) => {
      if (ids.has(m.id)) {
        ctx.addIssue({ code: 'custom', path: ['moments', i, 'id'], message: 'listed twice' });
      }
      ids.add(m.id);
    });
    story.sizes.forEach((size, i) => {
      if (size.moments > story.moments.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['sizes', i],
          message: 'more moments than there are',
        });
      }
      const before = story.sizes[i - 1];
      if (before && before.tiles >= size.tiles) {
        ctx.addIssue({ code: 'custom', path: ['sizes', i], message: 'sizes go smallest first' });
      }
    });
  });
export type StoryRules = z.infer<typeof StoryRulesSchema>;

export const MemoryPuzzleRulesSchema = z
  .strictObject({
    skins: z.array(PuzzleSkinSchema).min(1),
    /** The skin for a terrain no skin lists. */
    defaultSkin: ContentIdSchema,
    /** Relight's difficulty by depth. */
    relight: z.record(RelightDepthSchema, RelightTierSchema),
    /** The forgotten story, on each Hollow's heart tile. */
    story: StoryRulesSchema,
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
