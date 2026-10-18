import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { LocalDateSchema } from './time.js';

/*
 * Trick-or-treat's API (#515). The rules are shared data (`TRICK_OR_TREAT`);
 * what a treat can be and the odds stay on the server.
 */

/** What a treat was: Heartdust, a Keeper costume or a squishy costume. */
export const TrickOrTreatPrizeKindSchema = z.enum([
  'heartdust',
  'keeper-costume',
  'squishy-costume',
]);
export type TrickOrTreatPrizeKind = z.infer<typeof TrickOrTreatPrizeKindSchema>;

/** One patch-mate's home, as my map sees it. */
export const TrickOrTreatHostSchema = z.object({
  userId: z.uuid(),
  /** They have a lit Jack-o'-Lantern Hearthfire tonight: better treats, and their Heart Seed glows. */
  lit: z.boolean(),
  /** I've had my treat here today (the patch's day). */
  visited: z.boolean(),
});
export type TrickOrTreatHost = z.infer<typeof TrickOrTreatHostSchema>;

/**
 * `GET /maps/:mapId/trick-or-treat`: whether it's on today (the Halloween
 * season, the map's local date), the patch day and when it ends, and every
 * other member with a home on the patch.
 */
export const TrickOrTreatViewSchema = z.object({
  open: z.boolean(),
  day: LocalDateSchema,
  resetsAt: z.iso.datetime(),
  hosts: z.array(TrickOrTreatHostSchema),
});
export type TrickOrTreatView = z.infer<typeof TrickOrTreatViewSchema>;

export const TrickOrTreatResponseSchema = z.object({ trickOrTreat: TrickOrTreatViewSchema });
export type TrickOrTreatResponse = z.infer<typeof TrickOrTreatResponseSchema>;

/** `POST /maps/:mapId/trick-or-treat`: knock on a patch-mate's door. */
export const TrickOrTreatRequestSchema = z.strictObject({ hostUserId: z.uuid() });
export type TrickOrTreatRequest = z.infer<typeof TrickOrTreatRequestSchema>;

export const TrickOrTreatPrizeSchema = z.object({
  kind: TrickOrTreatPrizeKindSchema,
  /** `heartdust`, or the costume's clothing id. */
  itemId: ContentIdSchema,
  count: z.number().int().min(1),
});
export type TrickOrTreatPrize = z.infer<typeof TrickOrTreatPrizeSchema>;

/** One visit: whose door, whether a silly trick played first, and the treat. */
export const TrickOrTreatVisitSchema = z.object({
  visitId: z.uuid(),
  hostUserId: z.uuid(),
  /** Their lantern was lit, so the treat was rolled from the better table. */
  lantern: z.boolean(),
  trick: z.boolean(),
  prize: TrickOrTreatPrizeSchema,
});
export type TrickOrTreatVisit = z.infer<typeof TrickOrTreatVisitSchema>;

export const TrickOrTreatVisitResponseSchema = z.object({
  visit: TrickOrTreatVisitSchema,
  trickOrTreat: TrickOrTreatViewSchema,
});
export type TrickOrTreatVisitResponse = z.infer<typeof TrickOrTreatVisitResponseSchema>;
