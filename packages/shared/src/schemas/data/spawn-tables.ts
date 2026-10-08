import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { TRADING_POST_TERRAIN } from '../../territory/reach.js';

/**
 * Where and what wild squishies spawn (design doc §4, §16). The schema is
 * public; the tables themselves are secret and live in `data/server/`.
 * `terrains` are ids from the terrain table (`checkServerGameData` checks them).
 */
export const SpawnTableSchema = z.strictObject({
  id: ContentIdSchema,
  // Nothing spawns on, or guards, a trading post (#269): nobody claims one,
  // and no wild squishy waits there. Guardian tables share this schema.
  terrains: z
    .array(
      ContentIdSchema.refine(
        (id) => id !== TRADING_POST_TERRAIN,
        'nothing spawns on or guards a trading post',
      ),
    )
    .min(1),
  season: ContentIdSchema.optional(),
  timeOfDay: z.enum(['day', 'dusk', 'night']).optional(),
  entries: z
    .array(
      z.strictObject({
        species: ContentIdSchema,
        weight: z.number().int().positive(),
      }),
    )
    .min(1),
});
export type SpawnTable = z.infer<typeof SpawnTableSchema>;
