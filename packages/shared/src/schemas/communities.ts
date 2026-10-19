import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { CommunityKindIdSchema } from './data/communities.js';

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
  /** Who restored every tile and won it; null while it's still Hollowed. */
  ownerUserId: z.uuid().nullable(),
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
