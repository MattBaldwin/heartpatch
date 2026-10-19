import { z } from 'zod';
import { ContentIdSchema } from './common.js';

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
    /** The cellar key's tile: this many steps from the nearest village tile (owner decision 5). */
    keyFromVillage: z
      .strictObject({ min: z.number().int().min(2), max: z.number().int().min(2) })
      .refine((k) => k.min <= k.max, 'keyFromVillage.min must not exceed max'),
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
  /** More guards on each of the winner's tiles (not built yet: battles field 3 a side). */
  z.strictObject({ type: z.literal('guards'), extra: z.number().int().min(1).max(3) }),
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
});
export type CommunityRules = z.infer<typeof CommunityRulesSchema>;
