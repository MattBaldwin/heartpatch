import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { ExploreTerrainSchema } from './explore.js';

// Hollowed Communities (#306, plan v3): grey villages the Hollow Man drained,
// seeded into wild land. Data, so tuning them is a data edit (CLAUDE.md
// rule 5). What a kid can see lives here; find odds and rare-spawn
// multipliers stay in the server-only tables (rule 6).

/** The five village kinds (owner decision 4): each has one fixed perk. */
export const CommunityKindIdSchema = z.enum([
  'lantern-tower',
  'workshop',
  'old-well',
  'bakery',
  'watchtower',
]);
export type CommunityKindId = z.infer<typeof CommunityKindIdSchema>;

/**
 * Where villages go (owner decision 6, plan v3 Q6). Read by
 * `placeCommunities`, on new maps by `generateMap` and on older maps by the
 * server's boot pass, by the same rule, like the trading posts.
 */
export const CommunityPlacementRulesSchema = z
  .strictObject({
    /** One village per this many seats (rounded up)... */
    seatsPerCommunity: z.number().int().min(1),
    /** ...but never fewer than this on a map. */
    minPerMap: z.number().int().min(1),
    /** Seat counts that get their own number instead (seats → villages). */
    countBySeats: z.record(z.string().regex(/^[0-9]+$/), z.number().int().min(1)),
    /** A village is its seed tile plus this many of its neighbours (seed included: 4–7 tiles). */
    size: z
      .strictObject({ min: z.number().int().min(2), max: z.number().int().max(7) })
      .refine((s) => s.min <= s.max, 'size.min must not exceed size.max'),
    /** Village seed to the nearest Heart Seed, in steps. 3 keeps the two rings one tile apart. */
    minFromSeed: z.number().int().min(3),
    maxFromSeed: z.number().int().min(3),
    /** The boot pass (and the rare lake-heavy new map) relaxes `maxFromSeed` to this before giving up. */
    relaxedMaxFromSeed: z.number().int().min(3),
    /** Steps between two village rings (ring tile to ring tile). */
    ringsApart: z.number().int().min(1),
    /** Steps from a village ring to the nearest trading post. */
    ringFromPost: z.number().int().min(1),
    /** Terrains a village ring never covers (lakes; the Gap and posts are always out). */
    excludedTerrains: z.array(ContentIdSchema),
    /** Every map has at least one village of this kind (owner decision 4). */
    requiredKind: CommunityKindIdSchema,
    /** Name stems, each paired with `nameSuffix` ("Bramble" + " Hollow"). */
    nameStems: z.array(z.string().min(1).max(9)).min(1),
    nameSuffix: z.string().min(1),
  })
  .refine((r) => r.minFromSeed <= r.maxFromSeed, 'minFromSeed must not exceed maxFromSeed')
  .refine((r) => r.maxFromSeed <= r.relaxedMaxFromSeed, 'relaxedMaxFromSeed must be the widest')
  .refine(
    (r) => r.nameStems.every((s) => s.length + 1 + r.nameSuffix.length <= 16),
    'a generated name fits the 16-character header (stem + space + suffix)',
  );
export type CommunityPlacementRules = z.infer<typeof CommunityPlacementRulesSchema>;

/**
 * What a won village does for its winner (#306 PR 3b), one fixed perk a
 * kind (plan Q4). Each type hooks into a system that already exists.
 */
export const VillagePerkSchema = z.discriminatedUnion('type', [
  /** Lit every night without fuel: its square and this many tiles around it (the night's safe tiles). */
  z.strictObject({ type: z.literal('light'), radius: z.number().int().min(1).max(3) }),
  /** More Crafting Factory batches at once for the winner. */
  z.strictObject({ type: z.literal('factory-batches'), extra: z.number().int().min(1).max(2) }),
  /** A gift the winner collects on the square once every morning. */
  z.strictObject({
    type: z.literal('morning-gift'),
    items: z.record(ContentIdSchema, z.number().int().min(1).max(20)),
  }),
  /** The winner's guards fight this many levels above the guard level floor (#529) on their land. */
  z.strictObject({ type: z.literal('guard-levels'), levels: z.number().int().min(1).max(10) }),
]);
export type VillagePerk = z.infer<typeof VillagePerkSchema>;

/** One village kind as kids see it on the map and the panel. */
export const CommunityKindSchema = z.strictObject({
  id: CommunityKindIdSchema,
  /** The village square's building ("Lantern Tower"). */
  name: z.string().min(1).max(24),
  emoji: z.string().min(1),
  /** What restoring it earns, finishing "restore it for …" (no full stop). */
  perk: z.string().min(1).max(80),
  /** Its won square's line when "<emoji> <Kind>: <perk>" doesn't read right (PR 3b). */
  does: z.string().min(1).max(80).optional(),
  /** What that perk does once the village is won. */
  effect: VillagePerkSchema,
});
export type CommunityKind = z.infer<typeof CommunityKindSchema>;

/** A restored piece's ordinary building cost on one terrain (owner decision 1). */
export const PieceCostSchema = z.record(ContentIdSchema, z.number().int().min(1));
export type PieceCost = z.infer<typeof PieceCostSchema>;

/** Restoring and exploring rules for Hollowed tiles (owner decision 1). */
export const CommunityRulesSchema = z.strictObject({
  kinds: z.array(CommunityKindSchema).length(CommunityKindIdSchema.options.length),
  /** Pieces each village tile needs, by village size (tiles): pieces grow with the village. */
  piecesBySize: z.record(z.string().regex(/^[0-9]+$/), z.number().int().min(1)),
  /** Each piece's building resources by terrain; `default` covers terrains not listed. */
  pieceCost: z.record(z.string().min(1), PieceCostSchema),
  /** Heartdust each piece also costs: "the joy" (owner: exactly 1). */
  heartdustPerPiece: z.number().int().min(1),
  /** The resource that is the joy. */
  joyResource: ContentIdSchema,
  /** How much more often a Hollowed search finds Heartdust than an ordinary one. */
  heartdustFindMultiplier: z.number().int().min(1),
  /** Hollow echoes drifting on each unrestored village tile while exploring (2a): client feel only. */
  echoesPerTile: z.number().int().min(0).max(3),
  /** Restored-name endings for PR 3's suggestions ("Bramble Glen"). */
  restoredSuffixes: z.array(z.string().min(1).max(6)).min(1),
  /**
   * The hidden cellar under a won village's square (PR 2c): its spots, an
   * explore kit like a terrain's (`terrain` is the look it borrows, the hills
   * cave). Hands only, so a kid never needs a tool to search it. What its
   * spots hold is server-only (the cellar find tables, rule 6).
   */
  cellar: ExploreTerrainSchema,
  /**
   * Where the cellar's chests stand (#306, owner decision of 2026-10-22):
   * the kit's spots become small chests in a row along the back wall, with
   * the big chest in the middle. Tile-local, like a spot (+z away from the
   * camera, the corner 1 from the middle).
   */
  cellarChests: z.strictObject({
    /** How far back the row stands (the chests nearest the middle). */
    row: z.number().min(0).max(0.9),
    /** The gap between the big chest and the first small chest on each side. */
    first: z.number().min(0.1).max(0.6),
    /** The gap between two small chests. */
    gap: z.number().min(0.1).max(0.5),
    /** How far each chest out from the middle comes forward, so the row curves round the big one. */
    curve: z.number().min(0).max(0.3),
    /** How far back the big chest stands. */
    big: z.number().min(0).max(0.95),
  }),
});
export type CommunityRules = z.infer<typeof CommunityRulesSchema>;
