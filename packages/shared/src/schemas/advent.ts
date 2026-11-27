import { z } from 'zod';
import { AdventDaySchema, AdventResultSchema } from './christmas.js';
import { ContentIdSchema } from './data/common.js';
import { LocalDateSchema } from './time.js';

/*
 * The advent calendar's API (#37 1c): `GET /maps/:mapId/advent`,
 * `POST /maps/:mapId/advent/claim { day }` and `POST /maps/:mapId/presents/open`.
 * Additive request and response shapes on top of the C0 contracts
 * (`schemas/christmas.ts`). Never odds, weights or seeds (CLAUDE.md rule 6).
 */

/**
 * A day on the calendar as its Keeper sees it: `opened` (with what it held),
 * `today` (today's, waiting), `catch-up` (a missed day that can be opened
 * now), `missed` (a missed day, but today's catch-up is used or the
 * calendar is over) or `locked` (its day hasn't come).
 */
export const AdventDayStateSchema = z.enum(['opened', 'today', 'catch-up', 'missed', 'locked']);
export type AdventDayState = z.infer<typeof AdventDayStateSchema>;

export const AdventDayViewSchema = z.strictObject({
  day: AdventDaySchema,
  state: AdventDayStateSchema,
  /** What it held, once opened. */
  items: AdventResultSchema.optional(),
  /** What it *can* hold (item ids, no odds), for the calendar sheet. */
  contents: z.array(ContentIdSchema).min(1),
});
export type AdventDayView = z.infer<typeof AdventDayViewSchema>;

export const AdventViewSchema = z.strictObject({
  /** The patch's local day: the calendar is drawn from it. */
  today: LocalDateSchema,
  /** The 25 days of this year's calendar, December 1 to 25. */
  days: z.array(AdventDayViewSchema).length(25),
  /** Today's one catch-up is still free (and the calendar isn't over). */
  catchUpLeft: z.boolean(),
  /**
   * What a wrapped present from the bag *can* hold (item ids, no odds), so
   * it shows its possible contents before it's opened (GAME_DESIGN §15).
   */
  presentContents: z.array(ContentIdSchema).min(1),
});
export type AdventView = z.infer<typeof AdventViewSchema>;

/** `POST /maps/:mapId/advent/claim`: the day tapped (today's, or a missed one). */
export const ClaimAdventRequestSchema = z.strictObject({ day: AdventDaySchema });
export type ClaimAdventRequest = z.infer<typeof ClaimAdventRequestSchema>;

export const ClaimAdventResponseSchema = z.strictObject({
  opened: z.strictObject({
    day: AdventDaySchema,
    catchUp: z.boolean(),
    items: AdventResultSchema,
  }),
  advent: AdventViewSchema,
});
export type ClaimAdventResponse = z.infer<typeof ClaimAdventResponseSchema>;

/** `POST /maps/:mapId/presents/open`: one wrapped present from my bag, opened. */
export const OpenPresentResponseSchema = z.strictObject({
  items: AdventResultSchema,
  /** Wrapped presents still in my bag. */
  presentsLeft: z.number().int().min(0),
});
export type OpenPresentResponse = z.infer<typeof OpenPresentResponseSchema>;
