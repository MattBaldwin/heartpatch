import { z } from 'zod';
import { PublicUserSchema } from './auth.js';
import { ContentIdSchema } from './data/common.js';

// Patch stats (#573, owner decision 2026-10-19): who's winning what on a
// patch. One crown per category, shared on a tie, and no overall ranking.
// Worked out on read (rule 4) from the map view and the members' counts.

/**
 * The categories with a crown: most land, most befriended, best builder,
 * brightest (lit tiles) and collector (different species befriended).
 */
export const PatchCrownSchema = z.enum(['land', 'befriended', 'builder', 'brightest', 'collector']);
export type PatchCrown = z.infer<typeof PatchCrownSchema>;

/** How many of one building a Keeper has (`buildingId` from the shared table). */
export const BuildingCountSchema = z.object({
  buildingId: ContentIdSchema,
  count: z.number().int().min(1),
});
export type BuildingCount = z.infer<typeof BuildingCountSchema>;

/** One Keeper's stats on the patch. */
export const KeeperStatsSchema = z.object({
  user: PublicUserSchema,
  /** Their home's slot (`MapMember.homeSlot`), for their colour and icon. */
  homeSlot: z.number().int().nullable(),
  /** Tiles they own, home base included. */
  tiles: z.number().int().min(0),
  /** Their homesteads (#199), joined to home or napping. */
  homesteads: z.number().int().min(0),
  /** Their buildings by kind, most first. */
  buildings: z.array(BuildingCountSchema),
  /** Tiles their lit Hearthfires light up. */
  lit: z.number().int().min(0),
  /** Squishies they befriended in battle on this patch (`map_members.caught_count`). */
  befriended: z.number().int().min(0),
  /** How many different species they've befriended here. A count only, never which (rule 6). */
  species: z.number().int().min(0),
  /** Hollowed villages they restored; null until restoring arrives (#306 PR 3). */
  villages: z.number().int().min(0).nullable(),
  /** The categories they lead (or share the lead in), in `PatchCrownSchema` order. */
  crowns: z.array(PatchCrownSchema),
});
export type KeeperStats = z.infer<typeof KeeperStatsSchema>;

/** `GET /api/v1/maps/:mapId/stats` */
export const PatchStatsSchema = z.object({
  totals: z.object({
    /** Tiles somebody owns. */
    claimed: z.number().int().min(0),
    /** Wild land still to claim: nobody's, not a home base, trading post or village. */
    wild: z.number().int().min(0),
    /** Tiles any lit Hearthfire lights up. */
    lit: z.number().int().min(0),
    /** Hollowed villages restored; null until restoring arrives (#306 PR 3). */
    villages: z.number().int().min(0).nullable(),
  }),
  /** Every member, owner first, then by join time (as `MapView.members`). */
  keepers: z.array(KeeperStatsSchema),
});
export type PatchStats = z.infer<typeof PatchStatsSchema>;
