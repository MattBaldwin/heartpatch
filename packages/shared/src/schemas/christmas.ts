import { z } from 'zod';
import { ItemCountsSchema } from './inventory.js';
import { LocalDateSchema } from './time.js';

/*
 * Christmas (#37 C0): the shared contracts for advent presents, warmth and
 * the Patch Tree. Logic lands in the plan's later PRs (1c advent, 2c tree);
 * the Christmas Eve fight's contracts come in their own C0b.
 */

/**
 * An advent day: `YYYY-12-01` to `YYYY-12-25` (owner answer 3). The
 * `advent_claims_day_in_advent` CHECK holds the same rule.
 */
export const AdventDaySchema = LocalDateSchema.refine(
  (day) => {
    const [, month, date] = day.split('-').map(Number);
    return month === 12 && date !== undefined && date >= 1 && date <= 25;
  },
  { message: 'an advent day is December 1 to 25' },
);
export type AdventDay = z.infer<typeof AdventDaySchema>;

/** What a present held: item id → how many (at least one item). Never odds. */
export const AdventResultSchema = ItemCountsSchema.refine(
  (items) => Object.values(items).some((n) => n > 0),
  { message: 'a present holds something' },
);
export type AdventResult = z.infer<typeof AdventResultSchema>;

/**
 * An `advent_claims` row (server-only: `seed` replays the roll, rule 6).
 * One per Keeper per advent day at account level; `catchUp` is a missed day
 * opened later (`claimedOn > day`), at most one per `claimedOn`.
 */
export const AdventClaimRowSchema = z
  .strictObject({
    id: z.uuid(),
    userId: z.uuid(),
    day: AdventDaySchema,
    /** The patch whose bag it went to; null once that patch is gone. */
    mapId: z.uuid().nullable(),
    seed: z.string().min(1),
    result: AdventResultSchema,
    catchUp: z.boolean(),
    claimedOn: LocalDateSchema,
    claimedAt: z.iso.datetime(),
  })
  .refine((row) => row.claimedOn >= row.day, {
    path: ['claimedOn'],
    message: 'claimed before its day',
  })
  .refine((row) => row.catchUp === row.claimedOn > row.day, {
    path: ['catchUp'],
    message: 'a catch-up is a day opened after its own',
  });
export type AdventClaimRow = z.infer<typeof AdventClaimRowSchema>;

/** A `keeper_warmth` row: one per pair of patch-mates, stored ordered (`userAId < userBId`). */
export const KeeperWarmthRowSchema = z
  .strictObject({
    mapId: z.uuid(),
    userAId: z.uuid(),
    userBId: z.uuid(),
    warmth: z.number().int().min(0),
    updatedAt: z.iso.datetime(),
  })
  .refine((row) => row.userAId < row.userBId, {
    path: ['userBId'],
    message: 'the pair is stored ordered',
  });
export type KeeperWarmthRow = z.infer<typeof KeeperWarmthRowSchema>;

/** A `patch_trees` row: one per patch, at a trading post's tile. */
export const PatchTreeRowSchema = z.strictObject({
  mapId: z.uuid(),
  postTileId: z.uuid(),
  ornaments: z.number().int().min(0),
  starLitAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type PatchTreeRow = z.infer<typeof PatchTreeRowSchema>;

/**
 * `MapView.christmas` (#37): the Patch Tree as the patch sees it, and whether
 * today's advent present waits for the viewer. Left out outside the season
 * and by older servers.
 */
export const MapViewChristmasSchema = z.object({
  tree: z.object({
    ornaments: z.number().int().min(0),
    starLit: z.boolean(),
  }),
  presentWaiting: z.boolean(),
});
export type MapViewChristmas = z.infer<typeof MapViewChristmasSchema>;

/** Why an ornament went up: a December gift between patch-mates (a present, two). */
export const OrnamentSourceSchema = z.enum(['gift', 'present-gift']);
export type OrnamentSource = z.infer<typeof OrnamentSourceSchema>;
