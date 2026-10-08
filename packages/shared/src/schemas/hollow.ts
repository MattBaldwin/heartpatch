import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';
import { HollowStageSchema, WalkKindSchema } from './hollow-stage.js';
import { SpeciesSchema } from './data/species.js';
import { ItemCountsSchema } from './inventory.js';
import { OwnedSquishySchema } from './squishies.js';
import { LocalDateSchema } from './time.js';

// The Hollow Man API (design doc §14; issue #21; tech spec §5). Nightfall is a
// server job; players see what it did (the morning report) and rescue their
// squishies from the Hollow. The night's seed, who was exposed on other
// players' land and the shadow guardians never appear here (CLAUDE.md rule 6).

/** One stop on the Hollow Man's walk (#277), which the client plays as a show. */
export const WalkPointSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  kind: WalkKindSchema,
});
export type WalkPointView = z.infer<typeof WalkPointSchema>;

/** A squishy the Hollow Man took. */
export const TakenSquishySchema = z.object({
  squishyId: z.uuid(),
  speciesId: ContentIdSchema,
  nickname: z.string().nullable(),
  /** Still waiting in the Hollow (false once rescued). */
  inHollow: z.boolean(),
});
export type TakenSquishy = z.infer<typeof TakenSquishySchema>;

/** What one night did to me (the morning report, design doc §14). */
export const MorningReportSchema = z.object({
  /** The night, as the map-local date its nightfall fell on. */
  night: LocalDateSchema,
  /** The squishies the Hollow Man took to the Hollow (#277: up to 3); empty if everyone stayed safe. */
  taken: z.array(TakenSquishySchema),
  /** My squishies kept safe that night: by a lit fire, or standing watch. */
  sheltered: z.number().int().min(0),
  /**
   * My squishies left in the dark that night, the taken ones included. More
   * than none with nobody taken means he let them be (first-night grace):
   * the report says so and nudges for a fire, so the quiet nights still teach.
   */
  exposed: z.number().int().min(0),
  /** My dark land he won back that night: it went wild (#277). */
  reclaimed: z.array(HexSchema),
  /** How bold he was with me that night. */
  stage: HollowStageSchema,
  /** His walk along my border, for the replay (empty for nights before #277). */
  walk: z.array(WalkPointSchema),
  /** What stood on the land he won back; it came down and gave back its take-down share. */
  lostBuildings: z.object({
    fires: z.number().int().min(0),
    fences: z.number().int().min(0),
    trainingGrounds: z.number().int().min(0),
  }),
});
export type MorningReport = z.infer<typeof MorningReportSchema>;

/** `GET /maps/:mapId/hollow`: the night, my morning reports and my squishies in the Hollow. */
export const HollowStatusSchema = z.object({
  night: z.object({
    /** Between nightfall and morning, map time: the map is drawn at night. */
    isNight: z.boolean(),
    /** Ask again after this many minutes: night falls or morning comes. */
    changesInMinutes: z.number().int().min(1),
  }),
  /**
   * The coming (or current) night for me (#277): how bold he'll be, and
   * when the show's strike lands (nightfall plus `HOLLOW_RULES.show`). The
   * client holds back what he took until then, or until the kid skips.
   */
  tonight: z.object({
    night: LocalDateSchema,
    stage: HollowStageSchema,
    nightfallAt: z.iso.datetime(),
    strikeAt: z.iso.datetime(),
  }),
  /** Nights the Hollow Man has come by lately, newest first. */
  reports: z.array(MorningReportSchema),
  /** My squishies in the Hollow, waiting to be rescued. */
  hollowed: z.array(OwnedSquishySchema),
  /** Rows the public species table doesn't have, for my own squishies (a secret one I befriended). */
  speciesDefs: z.array(SpeciesSchema),
  rescue: z.object({
    /** Heartdust a rewarded rescue earns. */
    heartdust: z.number().int().min(1),
    /** Rescues left today that earn it (decision C); rescues past it still bring them home. */
    rewardsLeftToday: z.number().int().min(0),
  }),
  /**
   * A cozy nudge to light a fire: the Hollow Man's first visit to me (after
   * my first-night grace) is tonight or still to come, and one of my
   * squishies would spend tonight in the dark (a gatherer or a guard out on
   * land no lit fire reaches; home is always safe, owner decisions 2026-10-07).
   */
  fireHint: z.boolean(),
  /**
   * My home fire packed up when the Heart Seed began keeping home safe
   * (#202, owner decision 2026-10-07): what came back, and when. The
   * morning report says so once per device; null when I never had one.
   */
  homeFirePacked: z.object({ refund: ItemCountsSchema, at: z.iso.datetime() }).nullable(),
  /** The server's clock. */
  now: z.iso.datetime(),
});
export type HollowStatus = z.infer<typeof HollowStatusSchema>;

export const HollowResponseSchema = z.object({ hollow: HollowStatusSchema });
export type HollowResponse = z.infer<typeof HollowResponseSchema>;

/**
 * `POST /maps/:mapId/rescues`: set off to rescue one of my squishies from the
 * Hollow, from anywhere on the map (decision C). Answers with the rescue
 * battle (or the battle already going).
 */
export const StartRescueRequestSchema = z.strictObject({ squishyId: z.uuid() });
export type StartRescueRequest = z.infer<typeof StartRescueRequestSchema>;

/**
 * `POST /maps/:mapId/dev/nightfall` (dev/test only): night falls on the map
 * now, as the next night that hasn't come yet.
 */
export const DevNightfallResponseSchema = z.object({
  night: LocalDateSchema,
  /** How many squishies were taken. */
  taken: z.number().int().min(0),
});
export type DevNightfallResponse = z.infer<typeof DevNightfallResponseSchema>;
