import { z } from 'zod';
import { BattleStatsSchema } from './battle.js';
import { MoodIdSchema } from './data/care.js';
import { ContentIdSchema } from './data/common.js';
import { ElementIdSchema, FeelingIdSchema } from './data/elements.js';
import { SpeciesSchema } from './data/species.js';
import { ItemCountsSchema } from './inventory.js';

// Care, contentment, levels and evolution API (design doc §7–8; tech spec §5:
// `POST /maps/:mapId/squishies/:id/care` with `{ action: "pet" }`). The
// client sends the intent; the server works out what it's worth.

/** An evolution the owner hasn't seen celebrated yet. */
export const NewEvolutionSchema = z.object({
  fromSpeciesId: ContentIdSchema,
  intoSpeciesId: ContentIdSchema,
  level: z.number().int().min(1),
  at: z.iso.datetime(),
});
export type NewEvolution = z.infer<typeof NewEvolutionSchema>;

/**
 * One of my squishies, as its care sheet shows it. Only its owner gets this:
 * other members see the mood on `squishy.cared`, never the numbers.
 */
export const CareSquishySchema = z.object({
  id: z.uuid(),
  speciesId: ContentIdSchema,
  element: ElementIdSchema,
  feeling: FeelingIdSchema,
  nickname: z.string().nullable(),
  level: z.number().int().min(1),
  /** Total XP. */
  xp: z.number().int().min(0),
  /** XP into this level and the size of this level (null at the top level), for the bar. */
  xpIntoLevel: z.number().int().min(0),
  xpToNext: z.number().int().min(1).nullable(),
  /** Battle stats at this level (they grow with every level). */
  stats: BattleStatsSchema,
  /** Contentment now, 0–100 (worked out from the last care, design doc §7). */
  contentment: z.number().int().min(0).max(100),
  mood: MoodIdSchema,
  /** The XP multiplier from care × habitat, as a percent (100 = no bonus). For the info card. */
  xpBonusPercent: z.number().int().min(100),
  habitatId: z.uuid().nullable(),
  /** Care actions on it today (the account's day), and how many more give full care. */
  caredToday: z.number().int().min(0),
  fullCareLeft: z.number().int().min(0),
  /** Care actions that can't count again yet, and when they can. */
  nextCareAt: z.record(ContentIdSchema, z.iso.datetime()),
  /** An evolution waiting for its celebration, or null. */
  newEvolution: NewEvolutionSchema.nullable(),
});
export type CareSquishy = z.infer<typeof CareSquishySchema>;

/**
 * `GET /maps/:mapId/care`, and the reply to every care command: my active
 * squishies, the species rows I need that aren't public (a secret squishy I
 * befriended or one that evolved into a secret form), my bag (for Treats),
 * the Patch Coins care earned me today and the server's clock.
 */
export const CareListResponseSchema = z.object({
  squishies: z.array(CareSquishySchema),
  speciesDefs: z.array(SpeciesSchema),
  items: ItemCountsSchema,
  coinsToday: z.number().int().min(0),
  now: z.iso.datetime(),
});
export type CareListResponse = z.infer<typeof CareListResponseSchema>;

/** `POST /maps/:mapId/squishies/:squishyId/care`. */
export const CareRequestSchema = z.strictObject({ action: ContentIdSchema });
export type CareRequest = z.infer<typeof CareRequestSchema>;

/** What one care action did. */
export const CareResultSchema = z.object({
  action: ContentIdSchema,
  squishyId: z.uuid(),
  contentmentGained: z.number().int().min(0),
  /** Still one of the day's full-value actions (design doc §7). */
  full: z.boolean(),
  /** Patch Coins it earned (#45 pays them out). */
  coins: z.number().int().min(0),
});
export type CareResult = z.infer<typeof CareResultSchema>;

export const CareResponseSchema = CareListResponseSchema.extend({ result: CareResultSchema });
export type CareResponse = z.infer<typeof CareResponseSchema>;
