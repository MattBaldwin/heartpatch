import { z } from 'zod';
import { ContentIdSchema } from './common.js';

/**
 * The Crooked House's secrets (#306 6b). Server-only (CLAUDE.md rule 6):
 * what its rooms and chests give and the rare-friend odds (owner decision
 * 6). Exported only from `@heartpatch/shared/server`; the house itself is
 * `CROOKED_HOUSE`, and the season's shuffle is `crookedHouseSecrets(seed)`.
 */

const ItemPileSchema = z.record(ContentIdSchema, z.number().int().min(1).max(50));

export const CrookedHouseSecretsSchema = z.strictObject({
  /**
   * What a room's bloom rolls in `FAR_HOLLOW_FINDS` (`rollExploreFind`):
   * an explore spot kind and terrain. Every main room with things has one.
   */
  blooms: z.record(
    ContentIdSchema,
    z.strictObject({ kind: ContentIdSchema, terrain: ContentIdSchema }),
  ),
  /**
   * Each bonus room's chest (owner decision 6): small loot, one pile picked
   * by the season's seed, and a chance (percent) of a rare squishy friend to
   * befriend, picked by weight at a level in `level`.
   */
  chests: z.record(
    ContentIdSchema,
    z.strictObject({
      loot: z
        .array(z.strictObject({ weight: z.number().int().min(1), items: ItemPileSchema }))
        .min(1),
      friend: z.strictObject({
        chance: z.number().int().min(0).max(100),
        level: z
          .strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) })
          .refine((l) => l.min <= l.max, 'level.min must not exceed max'),
        species: z
          .array(z.strictObject({ species: ContentIdSchema, weight: z.number().int().min(1) }))
          .min(1),
      }),
    }),
  ),
  /**
   * The attic's big chest (owner decision 4): its pile, and the house's
   * one-of-a-kind keepsake (a found, untradable Legendary in `CLOTHING`).
   * The season's lore page and the completion gift are `FAR_HOLLOW_SECRETS`.
   */
  attic: z.strictObject({ items: ItemPileSchema, keepsake: ContentIdSchema }),
});
export type CrookedHouseSecrets = z.infer<typeof CrookedHouseSecretsSchema>;
