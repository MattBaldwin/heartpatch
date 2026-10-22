import { z } from 'zod';
import { ContentIdSchema } from './common.js';

// Memory puzzles on grey village tiles (#306 PR 2b, plan Q5): a broken
// thing (a music box, a mural, a fountain) is put back together by
// remembering the order of its pieces. One puzzle a tile; its skin comes
// from the tile's terrain. What a kid sees lives here (CLAUDE.md rule 5);
// what solving one gives stays server-side (`PUZZLE_REWARDS`, rule 6).

/** One piece of a broken thing: what the kid taps. */
export const PuzzlePieceSchema = z.strictObject({
  id: ContentIdSchema,
  /** What it shows on the puzzle card. */
  emoji: z.string().min(1).max(8),
  /** Its name, for screen readers ("the bell"). */
  name: z.string().min(1).max(24),
});
export type PuzzlePiece = z.infer<typeof PuzzlePieceSchema>;

/** One look of the puzzle: the broken thing, its pieces and its words (style guide §6). */
export const PuzzleSkinSchema = z.strictObject({
  id: ContentIdSchema,
  /** Its name on the action button and the card ("music box"). */
  name: z.string().min(1).max(24),
  emoji: z.string().min(1).max(8),
  /** The terrains it stands on; the rest get `defaultSkin`. */
  terrains: z.array(ContentIdSchema),
  /** Exactly `pieceCount` pieces, all different. */
  pieces: z.array(PuzzlePieceSchema),
  /** The card's first line, while it shows the order. */
  watch: z.string().min(1).max(80),
  /** The card's line while the kid puts it back. */
  play: z.string().min(1).max(80),
  /** The easy way's button (every puzzle has one, like #199's). */
  easy: z.string().min(1).max(24),
  /** The card's title once it's whole again. */
  fixed: z.string().min(1).max(48),
});
export type PuzzleSkin = z.infer<typeof PuzzleSkinSchema>;

export const MemoryPuzzleRulesSchema = z
  .strictObject({
    /** Pieces in every puzzle (the plan's "4-piece ordered puzzle"). */
    pieceCount: z.number().int().min(2).max(6),
    skins: z.array(PuzzleSkinSchema).min(1),
    /** The skin for a terrain no skin lists. */
    defaultSkin: ContentIdSchema,
  })
  .superRefine((rules, ctx) => {
    const ids = new Set<string>();
    const terrains = new Set<string>();
    rules.skins.forEach((skin, i) => {
      if (ids.has(skin.id)) {
        ctx.addIssue({ code: 'custom', path: ['skins', i, 'id'], message: 'listed twice' });
      }
      ids.add(skin.id);
      if (skin.pieces.length !== rules.pieceCount) {
        ctx.addIssue({
          code: 'custom',
          path: ['skins', i, 'pieces'],
          message: `needs exactly ${String(rules.pieceCount)} pieces`,
        });
      }
      if (new Set(skin.pieces.map((p) => p.id)).size !== skin.pieces.length) {
        ctx.addIssue({ code: 'custom', path: ['skins', i, 'pieces'], message: 'pieces repeat' });
      }
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
