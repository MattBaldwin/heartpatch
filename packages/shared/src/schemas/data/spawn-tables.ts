import { z } from 'zod';
import { ContentIdSchema } from './common.js';

/**
 * Where and what wild squishies spawn (design doc §4, §16). The schema is
 * public; the tables themselves are secret and live in `data/server/`.
 * Terrain ids are free-form until the map issue defines the terrain set.
 */
export const SpawnTableSchema = z.strictObject({
  id: ContentIdSchema,
  terrains: z.array(ContentIdSchema).min(1),
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
