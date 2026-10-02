import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';
import { SpeciesSchema } from './data/species.js';

// Wild squishies and the catalog (#14; design doc §4, §6, §21). Spawn tables
// are secret, so nothing here says what could spawn: only that someone is on
// a tile right now, and what the player has already met.

/**
 * `POST /maps/:mapId/battles`: look for a wild squishy. With `tile`, on that
 * tile; without, the nearest one the player can reach.
 */
export const StartWildBattleRequestSchema = z.strictObject({ tile: HexSchema.optional() });
export type StartWildBattleRequest = z.infer<typeof StartWildBattleRequestSchema>;

/**
 * `GET /maps/:mapId/wild`: tiles in the player's reach with a wild squishy
 * they haven't befriended, for the current spawn window only. No species, no
 * future windows (CLAUDE.md rule 6).
 */
export const WildHintsSchema = z.object({ tiles: z.array(HexSchema) });
export type WildHints = z.infer<typeof WildHintsSchema>;
export const WildHintsResponseSchema = z.object({ wild: WildHintsSchema });
export type WildHintsResponse = z.infer<typeof WildHintsResponseSchema>;

/** One species the player has met on this map (`species_seen`). */
export const CatalogEntrySchema = z.object({
  speciesId: ContentIdSchema,
  firstSeenAt: z.iso.datetime(),
  /** Null until they befriend one. */
  firstCaughtAt: z.iso.datetime().nullable(),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

/**
 * `GET /maps/:mapId/catalog`: what the player has seen and befriended.
 * Public species fill the page (unseen ones as "???"); `speciesDefs` carries
 * the secret species they've met, and only those, so a secret never shows
 * before it's seen.
 */
export const CatalogSchema = z.object({
  entries: z.array(CatalogEntrySchema),
  speciesDefs: z.array(SpeciesSchema),
});
export type Catalog = z.infer<typeof CatalogSchema>;
export const CatalogResponseSchema = z.object({ catalog: CatalogSchema });
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>;
