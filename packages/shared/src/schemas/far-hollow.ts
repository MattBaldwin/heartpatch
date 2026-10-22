import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { ExploreTileResponseSchema, SearchSpotResponseSchema } from './explore.js';
import { LocalDateSchema } from './data/seasons.js';

// The far Hollow (#306 PR 6, plan Q7, owner decision 7): each kid's own grey
// village, fresh every season, reached by the far road from any trading
// post. Explore only. Its own file: it borrows the explore view.

/** A season as the far Hollow names it. */
const FarHollowSeasonSchema = z.object({ id: ContentIdSchema, name: z.string() });

/** One of the far Hollow's tiles on its sheet: where, what, and how far along I am. */
export const FarHollowTileSummarySchema = z.object({
  index: z.number().int().min(0),
  /** Its place in the far Hollow's own little layout (the middle is 0, 0). */
  q: z.number().int(),
  r: z.number().int(),
  terrain: ContentIdSchema,
  searched: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type FarHollowTileSummary = z.infer<typeof FarHollowTileSummarySchema>;

/**
 * `GET /maps/:mapId/far-hollow`: my far Hollow this season. `arrived` once
 * I've won the far road this season; `completedAt` once every spot on every
 * tile is searched. A new season brings a new one (`nextSeason`).
 */
export const FarHollowViewSchema = z.object({
  name: z.string(),
  season: FarHollowSeasonSchema,
  arrived: z.boolean(),
  tiles: z.array(FarHollowTileSummarySchema),
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

/** `GET /maps/:mapId/far-hollow/tiles/:index`. */
export const FarHollowTileParamsSchema = z.strictObject({
  mapId: z.uuid(),
  index: z.coerce.number().int().min(0).max(31),
});

/**
 * One far-Hollow tile up close, as the explore view of a grey village tile
 * (`community`: its joy and echoes; it has no puzzle). `q`, `r` are its place
 * in the far Hollow's layout, not on the patch.
 */
export const FarHollowTileViewSchema = ExploreTileResponseSchema.extend({
  farHollow: z.object({ index: z.number().int().min(0), name: z.string() }),
});
export type FarHollowTileView = z.infer<typeof FarHollowTileViewSchema>;

/** `POST /maps/:mapId/far-hollow/search`: search one spot on one far-Hollow tile. */
export const FarHollowSearchRequestSchema = z.strictObject({
  tile: z.number().int().min(0),
  spot: z.number().int().min(0),
});
export type FarHollowSearchRequest = z.infer<typeof FarHollowSearchRequestSchema>;

/**
 * An explore search's answer. `completed` when it was the far Hollow's last
 * spot: the joy is all back, and its guaranteed lore page and gift are in
 * `lore` and `found`.
 */
export const FarHollowSearchResponseSchema = SearchSpotResponseSchema.extend({
  completed: z.boolean(),
});
export type FarHollowSearchResponse = z.infer<typeof FarHollowSearchResponseSchema>;
