import { z } from 'zod';
import { ExploreTileResponseSchema } from './explore.js';

// The hidden cellar under a won village's square (#306 PR 2c). Its own file:
// it borrows the explore view, which the map schemas can't import.

/**
 * `GET /maps/:mapId/communities/:communityId/cellar`: a won village's hidden
 * cellar up close (PR 2c), as the explore view of a little room: its spots
 * in the cave's look (`terrain`), which are done, and my tools. `q`, `r` are
 * the square's.
 */
export const CellarViewSchema = ExploreTileResponseSchema.extend({
  cellar: z.object({ communityId: z.uuid(), name: z.string() }),
});
export type CellarView = z.infer<typeof CellarViewSchema>;

/** `POST /maps/:mapId/communities/:communityId/cellar/search`: search one cellar spot (an explore search's answer). */
export const CellarSearchRequestSchema = z.strictObject({ spot: z.number().int().min(0) });
export type CellarSearchRequest = z.infer<typeof CellarSearchRequestSchema>;
