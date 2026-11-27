import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { LocalDateSchema } from './time.js';
import { BossBarStateSchema } from './boss-bar.js';

/*
 * Christmas (#37 C0): the shared contracts for advent presents, warmth and
 * the Patch Tree. Logic lands in the plan's later PRs (1c advent, 2c tree);
 * the Christmas Eve fight's contracts are C0b (`boss-bar.ts`, `eve` below).
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
export const AdventResultSchema = z
  .record(ContentIdSchema, z.number().int().min(1))
  .refine((items) => Object.keys(items).length > 0, { message: 'a present holds something' });
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
 * `MapView.christmas.eve` (#37 C0b): the Christmas Eve visit as the map
 * shows it, for the notice chip (from three days before) and the event card.
 * `opensAt` alone until the visit opens; then the bar comes whole (`state`,
 * `chipped`, `goal`). Never the species, the head-start rule or who chipped.
 */
export const MapViewChristmasEveSchema = z
  .object({
    opensAt: z.iso.datetime(),
    state: BossBarStateSchema.optional(),
    chipped: z.number().int().min(0).optional(),
    goal: z.number().int().min(1).optional(),
  })
  .refine(
    (eve) =>
      (eve.state === undefined) === (eve.chipped === undefined) &&
      (eve.state === undefined) === (eve.goal === undefined),
    { path: ['state'], message: 'the bar comes whole or not at all' },
  )
  .refine((eve) => eve.state !== 'fell' || (eve.chipped ?? 0) >= (eve.goal ?? 0), {
    path: ['state'],
    message: 'a bar falls only once it is full',
  })
  .refine((eve) => eve.state !== 'dozed' || (eve.chipped ?? 0) < (eve.goal ?? 0), {
    path: ['state'],
    message: 'a full bar falls; it does not doze off',
  });
export type MapViewChristmasEve = z.infer<typeof MapViewChristmasEveSchema>;

/**
 * `MapView.christmas` (#37): the Patch Tree as the patch sees it, and whether
 * today's advent present waits for the viewer. Left out outside the season
 * and by older servers.
 */
export const MapViewChristmasSchema = z.object({
  tree: z
    .object({
      /**
       * The trading post it stands at (`PostView.index`), as the server chose
       * it (`patch_trees.post_tile_id`); the client never works it out (rule 1).
       */
      postIndex: z.number().int().min(0),
      ornaments: z.number().int().min(0),
      starLit: z.boolean(),
    })
    // Left out while the patch has no tree yet (2c backfills it on first read).
    .optional(),
  presentWaiting: z.boolean(),
  /**
   * My warmth with each patch-mate I have any with (`keeper_warmth`), for the
   * hearts on their card. Optional so the tree lane (2c) can fill it later.
   */
  warmth: z.array(z.object({ userId: z.uuid(), warmth: z.number().int().min(1) })).optional(),
  /**
   * The Christmas Eve visit (#37 C0b), from its notice until it closes.
   * Left out otherwise and by older servers.
   */
  eve: MapViewChristmasEveSchema.optional(),
});
export type MapViewChristmas = z.infer<typeof MapViewChristmasSchema>;

/** Why an ornament went up: a December gift between patch-mates (a present, two). */
export const OrnamentSourceSchema = z.enum(['gift', 'present-gift']);
export type OrnamentSource = z.infer<typeof OrnamentSourceSchema>;
