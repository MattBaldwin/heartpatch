import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { LocalDateSchema } from './data/seasons.js';

// The far Hollow (#306 PR 6, plan Q7, owner decision 7): each kid's own
// place, fresh every season, reached by the far road from any trading post.
// Halloween 2026's is the Crooked House (#306 6b adds its view and commands).

/** A season as the far Hollow names it. */
const FarHollowSeasonSchema = z.object({ id: ContentIdSchema, name: z.string() });

/**
 * `GET /maps/:mapId/far-hollow`: my far Hollow this season. `arrived` once
 * I've won the far road this season; `completedAt` once I've brought it all
 * back this season. A new season brings a new one (`nextSeason`).
 */
export const FarHollowViewSchema = z.object({
  name: z.string(),
  season: FarHollowSeasonSchema,
  arrived: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  /** When a fresh far Hollow comes: the next season's first day, map-local. */
  nextSeason: FarHollowSeasonSchema.extend({ startsOn: LocalDateSchema }).nullable(),
  /** The far road's trail, as a journey preview shows it. */
  road: z.object({
    distance: z.number().int().min(1),
    level: z.number().int().min(1),
    teamSize: z.number().int().min(1),
  }),
});
export type FarHollowView = z.infer<typeof FarHollowViewSchema>;
