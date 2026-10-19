import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { HomeNameSchema } from './buildings.js';
import { CommunityKindIdSchema } from './data/communities.js';
import { ItemCountsSchema } from './inventory.js';

/**
 * One Hollowed Community as the viewer sees it on the map (#306). Public:
 * its tiles, kind and progress are the same for everyone; only `reach` and
 * `distance` are the viewer's own. The cellar key's tile, the find odds and
 * the community's seed never leave the server (CLAUDE.md rule 6).
 */
export const CommunityViewSchema = z.object({
  id: z.uuid(),
  /** The restored name once it has one, else the generated one ("Bramble Hollow"). */
  name: z.string(),
  kind: CommunityKindIdSchema,
  /** The village square: the seed tile, where the kind's building stands. */
  square: HexSchema,
  /** Every village tile, square first, then in (q, r) order. */
  tiles: z.array(HexSchema).min(1),
  /** Village tiles fully restored so far, of `tiles.length`. */
  restored: z.number().int().min(0),
  /** Which tiles those are (PR 3): they draw in colour again. Optional for older servers. */
  restoredTiles: z.array(HexSchema).optional(),
  /** Who restored every tile and won it; null while it's still Hollowed. */
  ownerUserId: z.uuid().nullable(),
  /**
   * Its winner has typed its name (PR 3). A won village wears its first
   * restored-name idea until then, and its square's panel offers "Name it".
   * Optional for older servers.
   */
  named: z.boolean().optional(),
  /**
   * How the viewer reaches it, the trading posts' `postReach` shape:
   * `touching` (their land joined to home touches a village tile, so they
   * may explore it by day) or `away` at `distance` steps from their nearest
   * land. Null when they own no land here.
   */
  reach: z.enum(['touching', 'away']).nullable(),
  distance: z.number().int().min(1).nullable(),
});
export type CommunityView = z.infer<typeof CommunityViewSchema>;

/** A village tile, by its place on the map (the explore routes' `q`, `r`). */
export const CommunityTileQuerySchema = z.object({
  q: z.coerce.number().int(),
  r: z.coerce.number().int(),
});
export type CommunityTileQuery = z.infer<typeof CommunityTileQuerySchema>;

export const CommunityParamsSchema = z.object({ mapId: z.uuid(), communityId: z.uuid() });

/**
 * Put one piece back on a village tile (#306 PR 3). `piecesDone` is how many
 * the sheet showed: a retry of a tap that already went in (the count moved
 * on) changes nothing and pays nothing, so a double tap never pays twice.
 */
export const RestorePieceRequestSchema = CommunityTileQuerySchema.extend({
  piecesDone: z.number().int().min(0),
});
export type RestorePieceRequest = z.infer<typeof RestorePieceRequestSchema>;

/**
 * The restore sheet for one village tile (#306 PR 3): the village, this
 * tile's pieces and who put them back, what the next piece costs against my
 * bag, and why I can't add one now (the shared `restoreProblem`; null when I
 * can). Costs come from `COMMUNITY_RULES` on the server, never the client.
 */
export const RestoreTileResponseSchema = z.object({
  community: CommunityViewSchema,
  tile: HexSchema.extend({
    piecesDone: z.number().int().min(0),
    piecesNeeded: z.number().int().min(1),
    /** Who added its last piece and claimed it; null while it's still grey. */
    restoredBy: z.uuid().nullable(),
  }),
  /** The next piece, item id → how many (Heartdust included). */
  cost: ItemCountsSchema,
  /** How many of each `cost` item I have. */
  have: ItemCountsSchema,
  /** Who has put pieces on this tile, most first. */
  helpers: z.array(z.object({ userId: z.uuid(), pieces: z.number().int().min(1) })),
  problem: z.enum(['won', 'restored', 'night', 'away']).nullable(),
  /**
   * After a restore only: what the piece did. `piece` it went in (and
   * `gift` is the thank-you a helper got); `tile` it was the last and I
   * claimed the tile; `village` it finished the village and its ring is mine.
   */
  outcome: z.enum(['piece', 'tile', 'village']).optional(),
  gift: ItemCountsSchema.optional(),
});
export type RestoreTileResponse = z.infer<typeof RestoreTileResponseSchema>;

/** Dev only: which village to bring to its last pieces (else the first my land touches). */
export const DevVillageAlmostRequestSchema = z.object({ communityId: z.uuid().optional() });

/** Name a won village (#306 PR 3): the same name rules as a home. */
export const CommunityNameRequestSchema = z.object({ name: HomeNameSchema });
export type CommunityNameRequest = z.infer<typeof CommunityNameRequestSchema>;
