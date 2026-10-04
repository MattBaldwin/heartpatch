import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './data/common.js';
import { MilestoneTitleSchema } from './data/milestones.js';

// The Milestones API (design doc §24; issue #44). Account-level, like the
// wardrobe. A secret track's name, goal and title only leave the server once
// the player has earned it (CLAUDE.md rule 6): until then it's "???".

/** What a tier gives. */
export const MilestoneRewardSchema = z.object({
  title: MilestoneTitleSchema,
  coins: z.number().int().min(0),
  /** A clothing id (`CLOTHING`), or null. */
  clothing: ContentIdSchema.nullable(),
});
export type MilestoneReward = z.infer<typeof MilestoneRewardSchema>;

export const MilestoneTierViewSchema = z.object({
  /** 1 for the first tier. */
  tier: z.number().int().min(1),
  threshold: z.number().int().min(1),
  goal: DescriptionSchema,
  reward: MilestoneRewardSchema,
  /** When it was earned, or null. */
  earnedAt: z.iso.datetime().nullable(),
});
export type MilestoneTierView = z.infer<typeof MilestoneTierViewSchema>;

/** A track on the Milestones screen, or a secret one not earned yet ("???"). */
export const MilestoneTrackViewSchema = z.discriminatedUnion('hidden', [
  z.object({
    hidden: z.literal(false),
    id: ContentIdSchema,
    name: DisplayNameSchema,
    secret: z.boolean(),
    /** Only counts in this season (a season id), or null. */
    season: ContentIdSchema.nullable(),
    /** Whole steps so far, never past the last tier's threshold. */
    progress: z.number().int().min(0),
    tiers: z.array(MilestoneTierViewSchema).min(1),
  }),
  z.object({ hidden: z.literal(true) }),
]);
export type MilestoneTrackView = z.infer<typeof MilestoneTrackViewSchema>;

/** A tier earned that the player hasn't celebrated yet. */
export const MilestoneNewsSchema = z.object({
  /** The `milestone_rewards` row; send it to `POST /milestones/seen`. */
  id: z.uuid(),
  trackName: DisplayNameSchema,
  goal: DescriptionSchema,
  reward: MilestoneRewardSchema,
  earnedAt: z.iso.datetime(),
});
export type MilestoneNews = z.infer<typeof MilestoneNewsSchema>;

/** `GET /api/v1/milestones` (and the reply to the other milestone calls). */
export const MilestonesResponseSchema = z.object({
  tracks: z.array(MilestoneTrackViewSchema),
  /** Every title earned, in the order earned. */
  titles: z.array(MilestoneTitleSchema),
  /** The title on the profile card, or null. */
  equippedTitleId: ContentIdSchema.nullable(),
  /** Earned and not celebrated yet, oldest first. */
  news: z.array(MilestoneNewsSchema),
});
export type MilestonesResponse = z.infer<typeof MilestonesResponseSchema>;

/** `POST /api/v1/milestones/seen`: these were celebrated. */
export const MilestonesSeenRequestSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(50),
});
export type MilestonesSeenRequest = z.infer<typeof MilestonesSeenRequestSchema>;

/** `POST /api/v1/milestones/title`: wear an earned title, or none (null). */
export const EquipTitleRequestSchema = z.strictObject({
  titleId: ContentIdSchema.nullable(),
});
export type EquipTitleRequest = z.infer<typeof EquipTitleRequestSchema>;
