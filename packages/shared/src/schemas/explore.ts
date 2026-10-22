import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';
import { ToolIdSchema } from './data/explore.js';
import { RelightDepthSchema } from './data/memory-puzzles.js';
import { ExploreNotableSchema } from './events.js';
import { ItemCountsSchema } from './inventory.js';
import { queryInt } from './query.js';

// Exploring your land (#199): zoom into a tile you own and search its spots
// with your Keeper and crafted tools. The server sends where the spots are
// and which are done, never what they hold (CLAUDE.md rule 6), and rolls
// every find (rule 1).

/**
 * Dev only (`HP_DEV_SQUISHY_GRANTS`): `POST /maps/:mapId/dev/homestead`, a
 * fully explored tile of mine next to home (#295). An e2e can ask for its
 * land and resource spot, or for one that hasn't joined home (#242).
 */
export const DevHomesteadRequestSchema = z.strictObject({
  /** Its land (a terrain id); otherwise what's there, or cleared land. */
  terrain: ContentIdSchema.optional(),
  /** A resource spot in its middle (a resource id); otherwise none. */
  nodeResource: ContentIdSchema.optional(),
  /**
   * False: explored, but three steps from home, so it hasn't joined.
   * 'napping': the same, but a homestead once, cut off from home since.
   */
  joined: z.union([z.boolean(), z.literal('napping')]).optional(),
});
export type DevHomesteadRequest = z.infer<typeof DevHomesteadRequestSchema>;

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

/**
 * A grey village tile's puzzle (#306 PR 2b, "Relight the path"): its broken
 * thing, how deep in the Hollow the tile is (that sets the board's size),
 * where it stands and whether I've fixed it. The board itself comes with
 * each try (`POST …/explore/puzzle/start`); what fixing it gives stays
 * server-side.
 */
export const HollowedPuzzleSchema = z.object({
  /** Its look (`MEMORY_PUZZLES.skins[].id`). */
  skin: ContentIdSchema,
  depth: RelightDepthSchema,
  /** Where it stands, tile-local (`hexToWorld` at size 1, like the spots). */
  x: z.number(),
  z: z.number(),
  /** I've fixed it already (once a tile each, `tile_explore.puzzle_solved_at`). */
  solved: z.boolean(),
});
export type HollowedPuzzle = z.infer<typeof HollowedPuzzleSchema>;

/**
 * One cell of a Relight board: the heart, a lantern, a path piece, an echo
 * shadow or an empty slot. `open` is its openings as they are now (a 4-bit
 * mask: north 1, east 2, south 4, west 8), never how it sits when solved.
 * A `loose` (wooden) piece slides and never turns.
 */
export const RelightCellSchema = z.object({
  kind: z.enum(['heart', 'lantern', 'pipe', 'shadow', 'empty']),
  open: z.number().int().min(0).max(15),
  loose: z.boolean(),
});
export type RelightCell = z.infer<typeof RelightCellSchema>;

/** A Relight board, row by row from the top, and how many moves it allows. */
export const RelightBoardSchema = z.object({
  size: z.number().int().min(3).max(8),
  /** The heart's cell (bottom row): where the light comes from. */
  heart: z.number().int().min(0),
  limit: z.number().int().min(1),
  cells: z.array(RelightCellSchema).max(64),
});
export type RelightBoard = z.infer<typeof RelightBoardSchema>;

/** One move: a quarter turn of a piece, or a wooden piece's slide into the empty slot beside it. */
export const RelightMoveSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('turn'), at: z.number().int().min(0).max(63) }),
  z.strictObject({
    type: z.literal('slide'),
    at: z.number().int().min(0).max(63),
    to: z.number().int().min(0).max(63),
  }),
]);
export type RelightMove = z.infer<typeof RelightMoveSchema>;

/**
 * A grey village tile's explore extras (#306 2a), on `ExploreTileResponse`
 * when the tile is an unrestored Hollowed village tile. Its spots refill
 * each morning (map time), so `joy` is today's colour.
 */
export const HollowedExploreSchema = z.object({
  /** The village (`MapView.communities[].id`) and its name for the header. */
  id: z.uuid(),
  name: z.string(),
  /** How much colour today's searches brought back, 0–100 (`exploreJoy`). */
  joy: z.number().int().min(0).max(100),
  /** Where each Hollow echo drifts, tile-local (`hexToWorld` at size 1, like the spots). */
  echoes: z.array(z.object({ x: z.number(), z: z.number() })),
  /** Its Relight puzzle (PR 2b). */
  puzzle: HollowedPuzzleSchema.optional(),
});
export type HollowedExplore = z.infer<typeof HollowedExploreSchema>;

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
  /** A grey village tile (#306 2a); absent on my own land. */
  community: HollowedExploreSchema.optional(),
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
  /** On a grey village tile (#306 2a): its joy after this search, 0–100. */
  joy: z.number().int().min(0).max(100).optional(),
});
export type SearchSpotResponse = z.infer<typeof SearchSpotResponseSchema>;

/** `POST /maps/:mapId/explore/puzzle/start`: a new try at a grey village tile's puzzle (#306 PR 2b). */
export const StartPuzzleRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
});
export type StartPuzzleRequest = z.infer<typeof StartPuzzleRequestSchema>;

/** This try's board: every try is a fresh puzzle of the same size (owner decision: a reshuffle). */
export const StartPuzzleResponseSchema = z.object({
  /** The try's number, sent back with its moves. */
  attempt: z.number().int().min(1),
  board: RelightBoardSchema,
});
export type StartPuzzleResponse = z.infer<typeof StartPuzzleResponseSchema>;

/** `POST /maps/:mapId/explore/puzzle`: relight a grey village tile's path (#306 PR 2b). */
export const SolvePuzzleRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  /** The try these moves were made on (the latest start's). */
  attempt: z.number().int().min(1),
  /** Every move, in order; the server replays them (CLAUDE.md rule 1). */
  moves: z.array(RelightMoveSchema).max(200),
});
export type SolvePuzzleRequest = z.infer<typeof SolvePuzzleRequestSchema>;
/**
 * Dev only (`HP_DEV_SQUISHY_GRANTS`, never in production):
 * `POST /maps/:mapId/dev/relight-answer { q, r }`, my latest try's answer,
 * so an e2e or a capture can play a win through the real board.
 */
export const DevRelightAnswerResponseSchema = z.object({
  attempt: z.number().int().min(1),
  moves: z.array(RelightMoveSchema),
});
export type DevRelightAnswerResponse = z.infer<typeof DevRelightAnswerResponseSchema>;

/** What fixing it gave: the server rolls it (CLAUDE.md rule 1). */
export const SolvePuzzleResponseSchema = z.object({
  /** The puzzle, fixed now. */
  puzzle: HollowedPuzzleSchema,
  /** A lore page, by id and title; its words come from `GET /lore`. */
  lore: z.object({ id: ContentIdSchema, title: z.string() }).nullable(),
  /** A Rekindled recipe (its recipe id), once #306 PR 5's recipes can be found here; null until then. */
  recipe: z.object({ id: ContentIdSchema, title: z.string() }).nullable(),
  /** Items, when there's no page left to find (may be empty). */
  found: ItemCountsSchema,
  /** The bag after it. */
  items: ItemCountsSchema,
});
export type SolvePuzzleResponse = z.infer<typeof SolvePuzzleResponseSchema>;
