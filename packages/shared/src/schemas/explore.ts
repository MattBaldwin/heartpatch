import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';
import { ToolIdSchema } from './data/explore.js';
import { ExploreNotableSchema } from './events.js';
import { ItemCountsSchema } from './inventory.js';
import { queryInt } from './query.js';

// Exploring your land (#199): zoom into a tile you own and search its spots
// with your Keeper and crafted tools. The server sends where the spots are
// and which are done, never what they hold (CLAUDE.md rule 6), and rolls
// every find (rule 1).

/** `GET /maps/:mapId/explore?q=&r=`: one of my tiles. */
export const ExploreQuerySchema = z.object({
  q: queryInt({ min: -32768, max: 32767 }),
  r: queryInt({ min: -32768, max: 32767 }),
});

/** One search spot as the explore view draws it. */
export const PublicSearchSpotSchema = z.object({
  index: z.number().int().min(0),
  kind: ContentIdSchema,
  tool: ToolIdSchema.nullable(),
  /** Tile-local position (`hexToWorld` at size 1: the tile's corner is 1 away). */
  x: z.number(),
  z: z.number(),
  done: z.boolean(),
});
export type PublicSearchSpot = z.infer<typeof PublicSearchSpotSchema>;

/** A tile's homestead state for its owner: part of home, cut off, or neither. */
export const HomesteadStateSchema = z.enum(['joined', 'paused']).nullable();

/** How far along a tile is: "7 of 12 found 🔍". */
export const ExploreProgressSchema = z.object({
  searched: z.number().int().min(0),
  total: z.number().int().min(0),
});

/** The explore view of one of my tiles. */
export const ExploreTileResponseSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  terrain: z.string(),
  spots: z.array(PublicSearchSpotSchema),
  /** Every tool the tile's spots call for, in tool order (hands need none). */
  needs: z.array(ToolIdSchema),
  progress: ExploreProgressSchema,
  homestead: HomesteadStateSchema,
  /** Uses left of each tool in my bag (a tool is counted in uses). */
  tools: z.record(ToolIdSchema, z.number().int().min(0)),
});
export type ExploreTileResponse = z.infer<typeof ExploreTileResponseSchema>;

/** `POST /maps/:mapId/explore/search`: search one spot on one of my tiles. */
export const SearchSpotRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  spot: z.number().int().min(0),
});
export type SearchSpotRequest = z.infer<typeof SearchSpotRequestSchema>;

/** What a search found and what it changed, for the find card. */
export const SearchSpotResponseSchema = z.object({
  spot: z.number().int().min(0),
  /** Resources and other items found (may be empty: "Just a wiggly worm!"). */
  found: ItemCountsSchema,
  /** A lore page found, by id and title; its words come from `GET /lore`. */
  lore: z.object({ id: ContentIdSchema, title: z.string() }).nullable(),
  /** A piece of clothing found (wardrobe item id). */
  clothing: ContentIdSchema.nullable(),
  notable: ExploreNotableSchema.nullable(),
  /** XP each team squishy got. */
  xp: z.array(z.object({ squishyId: z.uuid(), xp: z.number().int().min(0) })),
  /** The tool it used and its uses left, or null for hands. */
  tool: z.object({ id: ToolIdSchema, usesLeft: z.number().int().min(0) }).nullable(),
  progress: ExploreProgressSchema,
  /** This search finished the tile. */
  explored: z.boolean(),
  homestead: HomesteadStateSchema,
  /** The bag after the search. */
  items: ItemCountsSchema,
});
export type SearchSpotResponse = z.infer<typeof SearchSpotResponseSchema>;
