import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { LocalDateSchema } from './time.js';

/*
 * Christmas Eve (#37 C0b): the shared contracts for the co-op patch bar.
 * Addendum: issue #37 comment 7211383869; owner answers 7224108930. Logic
 * lands in X1 (the visit), X2 (the bar), X4 (on screen) and X5 (the fall).
 * Kept apart from `boss.ts` so `battle.ts` can use it without a cycle.
 */

/**
 * What kind of visit a `boss_windows` row is: the weekly bag draw, or the
 * Christmas Eve visit that replaces it in the week holding December 24.
 * The `boss_windows_kind_known` CHECK holds the same list.
 */
export const BossWindowKindSchema = z.enum(['weekly', 'christmas-eve']);
export type BossWindowKind = z.infer<typeof BossWindowKindSchema>;

/**
 * Where a patch bar stands (`boss_bars.state`):
 * - `open`: the visit is out and every finished fight chips it;
 * - `fell`: it filled, so the BIG squishy is tuckered out for everyone
 *   (fights after still count);
 * - `dozed`: it closed short, so it dozed off and wandered home (owner
 *   answer 4): a thanks bundle, no asks, nothing taken.
 */
export const BossBarStateSchema = z.enum(['open', 'fell', 'dozed']);
export type BossBarState = z.infer<typeof BossBarStateSchema>;

/**
 * The patch bar as a Keeper sees it: the goal, the points chipped so far
 * (head start included) and its state. Never who chipped, the head-start
 * rule, the goal formula or any odds (CLAUDE.md rule 6). `chipped` may pass
 * `goal`: fights after the fall still count.
 */
export const BossPatchBarSchema = z
  .object({
    goal: z.number().int().min(1),
    chipped: z.number().int().min(0),
    state: BossBarStateSchema,
  })
  .refine((bar) => bar.state !== 'fell' || bar.chipped >= bar.goal, {
    path: ['state'],
    message: 'a bar falls only once it is full',
  })
  .refine((bar) => bar.state !== 'dozed' || bar.chipped < bar.goal, {
    path: ['state'],
    message: 'a full bar falls; it does not doze off',
  });
export type BossPatchBar = z.infer<typeof BossPatchBarSchema>;

/**
 * `BossVisitSchema.event` (#37 C0b): a visit that isn't the weekly one.
 * Left out on a weekly visit and by older servers. `gatesLowered` says the
 * visit's lower level gates apply (owner answer 3), so the card can say
 * "Everyone can help!"; the levels themselves stay server-side.
 */
export const BossVisitEventSchema = z.object({
  kind: z.literal('christmas-eve'),
  gatesLowered: z.literal(true),
  /** When the bar closes (10:00 patch-local Dec 25 by default). */
  closesAt: z.iso.datetime(),
});
export type BossVisitEvent = z.infer<typeof BossVisitEventSchema>;

/** What a contributor's thanks was (`boss.thanked`): the fall's bundle, or the dozed-off one. */
export const BossThanksKindSchema = z.enum(['fell', 'dozed']);
export type BossThanksKind = z.infer<typeof BossThanksKindSchema>;

/** Items a thanks put in the bag: item id → how many (at least one item). Never odds. */
export const BossThanksItemsSchema = z
  .record(ContentIdSchema, z.number().int().min(1))
  .refine((items) => Object.keys(items).length > 0, { message: 'a thanks holds something' });
export type BossThanksItems = z.infer<typeof BossThanksItemsSchema>;

/**
 * A `boss_bars` row (server-only): one per patch per Christmas Eve visit.
 * `headStart` is the share of `chipped` the lit lights and star gave at open
 * (`headStartLights` tiles, `headStartStar`). `fellAt` is set once, on the
 * chip that filled it.
 */
export const BossBarRowSchema = z
  .strictObject({
    mapId: z.uuid(),
    windowId: LocalDateSchema,
    goal: z.number().int().min(1),
    chipped: z.number().int().min(0),
    state: BossBarStateSchema,
    headStart: z.number().int().min(0),
    headStartLights: z.number().int().min(0),
    headStartStar: z.boolean(),
    opensAt: z.iso.datetime(),
    closesAt: z.iso.datetime(),
    fellAt: z.iso.datetime().nullable(),
  })
  .refine((row) => row.closesAt > row.opensAt, {
    path: ['closesAt'],
    message: 'a bar closes after it opens',
  })
  .refine((row) => row.chipped >= row.headStart, {
    path: ['chipped'],
    message: 'the head start is part of what was chipped',
  })
  .refine((row) => (row.state === 'fell') === (row.fellAt !== null), {
    path: ['fellAt'],
    message: 'a bar has a fall time exactly when it fell',
  })
  .refine((row) => row.state !== 'fell' || row.chipped >= row.goal, {
    path: ['state'],
    message: 'a bar falls only once it is full',
  })
  .refine((row) => row.state !== 'dozed' || row.chipped < row.goal, {
    path: ['state'],
    message: 'a full bar falls; it does not doze off',
  });
export type BossBarRow = z.infer<typeof BossBarRowSchema>;

/**
 * A `boss_bar_chips` row (server-only): one per finished fight against the
 * Christmas Eve visit, unique per battle, so a retried finish can't chip
 * twice. `points` may be 0: a fight that missed every hit still makes its
 * Keeper a contributor (owner answer 2).
 */
export const BossBarChipRowSchema = z.strictObject({
  id: z.uuid(),
  mapId: z.uuid(),
  windowId: LocalDateSchema,
  userId: z.uuid(),
  battleId: z.uuid(),
  points: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});
export type BossBarChipRow = z.infer<typeof BossBarChipRowSchema>;
