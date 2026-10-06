import { z } from 'zod';
import { formatDataIssues } from './issues.js';

// Care, contentment and growth rules (design doc §7–8, DECISIONS G). Data, so
// tuning them is a data edit (CLAUDE.md rule 5). Every multiplier is a whole
// percent, so the maths is integers only and the same on every engine
// (DECISIONS "Battle engine (#11)", bit-identical maths).

const percent = z.number().int().min(0).max(100);

/** A contentment band: the soft word players see instead of a number. */
export const MoodIdSchema = z.enum(['glowing', 'happy', 'calm', 'cuddly']);
export type MoodId = z.infer<typeof MoodIdSchema>;

export const CareRulesSchema = z
  .strictObject({
    /** Contentment is 0 to this (design doc §7: 0–100). */
    maxContentment: z.literal(100),
    /** Where contentment settles when nobody cares for a while. */
    baselineContentment: percent,
    /**
     * Contentment a brand-new squishy starts with; it slides down from here
     * like care does, from the moment it joins the player.
     */
    startContentment: percent,
    /** Hours from full contentment down to the baseline (design doc §7: ~24 h). */
    hoursFullToBaseline: z
      .number()
      .int()
      .min(1)
      .max(24 * 14),
    /**
     * Care actions per squishy per day that give their full contentment
     * (design doc §7, decision G). The day is the player's account day.
     */
    fullActionsPerDay: z.number().int().min(1),
    /**
     * Percent of an action's contentment for the 1st, 2nd, … action past the
     * full ones that day; the last entry repeats from there on.
     */
    falloffPercents: z.array(percent).min(1),
    /** Patch Coins a full-value care action earns (#45 pays them out). */
    coinsPerFullAction: z.number().int().min(0),
    /** Patch Coins from care per account per day, across every patch (decision F, G). */
    dailyCoinCap: z.number().int().min(0),
    /**
     * Moods from happiest down: a squishy shows the first mood whose
     * `atLeast` its contentment reaches. The last must start at 0.
     */
    moods: z
      .array(z.strictObject({ id: MoodIdSchema, atLeast: percent, line: z.string().min(1) }))
      .min(1),
  })
  .superRefine((rules, ctx) => {
    if (rules.baselineContentment >= rules.maxContentment) {
      ctx.addIssue({
        code: 'custom',
        path: ['baselineContentment'],
        message: 'the baseline must be below full',
      });
    }
    if (
      rules.startContentment < rules.baselineContentment ||
      rules.startContentment > rules.maxContentment
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['startContentment'],
        message: 'a new squishy starts between the baseline and full',
      });
    }
    rules.falloffPercents.forEach((p, i) => {
      const before = rules.falloffPercents[i - 1];
      if (before !== undefined && p > before) {
        ctx.addIssue({
          code: 'custom',
          path: ['falloffPercents', i],
          message: 'later care actions can give less, never more',
        });
      }
    });
    rules.moods.forEach((mood, i) => {
      const before = rules.moods[i - 1];
      if (before !== undefined && mood.atLeast >= before.atLeast) {
        ctx.addIssue({
          code: 'custom',
          path: ['moods', i, 'atLeast'],
          message: 'moods go from happiest (highest) down',
        });
      }
    });
    if (rules.moods.at(-1)?.atLeast !== 0) {
      ctx.addIssue({ code: 'custom', path: ['moods'], message: 'the last mood must start at 0' });
    }
    if (new Set(rules.moods.map((m) => m.id)).size !== rules.moods.length) {
      ctx.addIssue({ code: 'custom', path: ['moods'], message: 'each mood once' });
    }
  });
export type CareRules = z.infer<typeof CareRulesSchema>;

export const GrowthRulesSchema = z
  .strictObject({
    /** Squishies stop levelling here (evolution levels go up to 100). */
    maxLevel: z.number().int().min(2).max(100),
    /**
     * Total XP to reach level L is `perLevel × (L − 1) + curve × (L − 1)²`,
     * plus `steep × (L − level)²` for each knee below L: early levels come
     * quickly, later ones take longer, and each knee makes the climb past it
     * steeper still. No knees (the default) is the plain curve.
     */
    xpCurve: z.strictObject({
      perLevel: z.number().int().min(1),
      curve: z.number().int().min(0),
      knees: z
        .array(
          z.strictObject({
            level: z.number().int().min(2).max(100),
            steep: z.number().int().min(0),
          }),
        )
        .optional(),
    }),
    /** Care multiplier: `minPercent` at no contentment up to `maxPercent` when full. */
    care: z.strictObject({
      minPercent: z.literal(100),
      maxPercent: z.number().int().min(100).max(1000),
    }),
    /**
     * Habitat multiplier: a squishy whose habitat's tags match its element or
     * its feeling gets `onePercent`, both `bothPercent`; no habitat or no
     * match is 100% (design doc §7).
     */
    habitat: z.strictObject({
      onePercent: z.number().int().min(100).max(1000),
      bothPercent: z.number().int().min(100).max(1000),
    }),
    /** Care × habitat never goes below 100% (neglect costs nothing) or above this. */
    capPercent: z.number().int().min(100).max(1000),
    /**
     * A befriended squishy joins at most this many levels below its
     * species' first evolution, so it still grows up by training. Species
     * that never evolve keep their battle level. Optional: left out, every
     * befriended squishy keeps its battle level.
     */
    befriendBelowEvolution: z.number().int().min(1).max(99).optional(),
    /**
     * Battle XP falls off per squishy per map-local day: full XP while it has
     * won fewer than `fullWinsPerDay` battles today, then `afterPercent` of
     * it. Optional: left out, every battle pays in full.
     */
    battleXpFalloff: z
      .strictObject({
        fullWinsPerDay: z.number().int().min(1),
        afterPercent: z.number().int().min(0).max(100),
      })
      .optional(),
  })
  .superRefine((rules, ctx) => {
    if (rules.habitat.bothPercent < rules.habitat.onePercent) {
      ctx.addIssue({
        code: 'custom',
        path: ['habitat', 'bothPercent'],
        message: 'matching both tags is worth at least as much as one',
      });
    }
  });
export type GrowthRules = z.infer<typeof GrowthRulesSchema>;

/** Readable problems with care rules, or `[]` if they're all good. */
export function checkCareRules(input: unknown): string[] {
  const result = CareRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}

/** Readable problems with growth rules, or `[]` if they're all good. */
export function checkGrowthRules(input: unknown): string[] {
  const result = GrowthRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
