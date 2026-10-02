import { z } from 'zod';
import { ContentIdSchema, DisplayNameSchema, RaritySchema } from './common.js';
import { formatDataIssues } from './issues.js';

/**
 * Who picks a computer-controlled side's moves (design doc §6): wild
 * squishies, tile guardians, and the three offline defense stances. The UI
 * calls the stances Bold, Careful and Balanced (style guide §9).
 */
export const BattleAiPolicySchema = z.enum([
  'wild',
  'guardian',
  'aggressive',
  'defensive',
  'balanced',
]);
export type BattleAiPolicy = z.infer<typeof BattleAiPolicySchema>;

const percent = z.number().int().min(0).max(100);
const positive = z.number().positive();

/**
 * How an AI policy scores its options. Each option's score is its expected
 * value times the policy's weight for that kind of option; the AI then picks
 * with probability proportional to `score ^ focus`, so a higher `focus` makes
 * it greedier and a `focus` of 1 keeps it playful.
 */
export const BattleAiPolicyRulesSchema = z.strictObject({
  focus: z.number().int().min(1).max(8),
  /** × the share of the other squishy's remaining energy the move takes (0–1). */
  damage: z.number().min(0),
  /** × the share of full energy the move gives back; only below `healBelow`% energy. */
  heal: z.number().min(0),
  healBelow: percent,
  /** × stat stages gained (own stats up, or the other squishy's down) × chance. */
  boost: z.number().min(0),
  /** × chance of making the other squishy dizzy or sleepy, if it isn't already. */
  status: z.number().min(0),
  /**
   * × how much better a bench squishy's best damage share is; only below
   * `swapBelow`% energy.
   */
  swap: z.number().min(0),
  swapBelow: percent,
});
export type BattleAiPolicyRules = z.infer<typeof BattleAiPolicyRulesSchema>;

/** How a status from a move behaves (the move schema's `status` effect). */
export const BattleStatusRulesSchema = z
  .strictObject({
    minTurns: z.number().int().min(1).max(10),
    maxTurns: z.number().int().min(1).max(10),
    /** Chance each turn that the squishy can't act. 100 = always. */
    skipChance: percent,
    clearsOnSwap: z.boolean(),
  })
  .refine((s) => s.minTurns <= s.maxTurns, {
    message: 'minTurns must not be more than maxTurns',
    path: ['maxTurns'],
  });
export type BattleStatusRules = z.infer<typeof BattleStatusRulesSchema>;

/**
 * An effectiveness callout tier (style guide §2: "Super cozy!", not
 * "1.5× multiplier"). The engine tags each hit with the first tier whose
 * `atLeast` the element × feeling multiplier reaches; the UI shows `line`.
 */
export const BattleEffectivenessTierSchema = z.strictObject({
  id: ContentIdSchema,
  atLeast: z.number().min(0),
  line: DisplayNameSchema.optional(),
});
export type BattleEffectivenessTier = z.infer<typeof BattleEffectivenessTierSchema>;

/** Every tunable number the battle engine uses (design doc §6–7). */
export const BattleRulesSchema = z.strictObject({
  /** Most squishies a side can bring. */
  teamSize: z.number().int().min(1).max(6),
  /** A battle still going after this many turns ends on remaining energy. */
  maxTurns: z.number().int().min(1).max(1000),
  /**
   * Battle stats from base stats and level:
   * `floor(base × level / levelDivisor) + flat`, and for energy (hp)
   * `floor(base × level / levelDivisor) + level × hpPerLevel + hpFlat`.
   */
  stats: z.strictObject({
    levelDivisor: positive,
    flat: z.number().int().min(0),
    hpPerLevel: z.number().int().min(0),
    hpFlat: z.number().int().min(1),
  }),
  /**
   * `base = ((level / levelDivisor + levelOffset) × power × attack /
   * defense) / powerDivisor + flat`, then × element × feeling × synergy ×
   * variance, rounded down, at least `minimum` (design doc §6).
   */
  damage: z
    .strictObject({
      levelDivisor: positive,
      levelOffset: z.number().min(0),
      powerDivisor: positive,
      flat: z.number().min(0),
      minimum: z.number().int().min(1),
      varianceMin: positive,
      varianceMax: positive,
    })
    .refine((d) => d.varianceMin <= d.varianceMax, {
      message: 'varianceMin must not be more than varianceMax',
      path: ['varianceMax'],
    }),
  /**
   * Stat stages from move effects, capped at ±`maxStages`. Each stage up
   * multiplies the stat by `1 + perStage × n`; down divides by the same.
   */
  statStages: z.strictObject({
    maxStages: z.number().int().min(1).max(6),
    perStage: positive,
  }),
  status: z.strictObject({
    dizzy: BattleStatusRulesSchema,
    sleepy: BattleStatusRulesSchema,
  }),
  /** Highest tier first; the last tier must start at 0 so every hit has one. */
  effectiveness: z
    .array(BattleEffectivenessTierSchema)
    .min(1)
    .superRefine((tiers, ctx) => {
      tiers.forEach((tier, i) => {
        const prev = tiers[i - 1];
        if (prev && prev.atLeast <= tier.atLeast) {
          ctx.addIssue({
            code: 'custom',
            path: [i, 'atLeast'],
            message: 'tiers must go from highest atLeast to lowest',
          });
        }
        if (tiers.findIndex((t) => t.id === tier.id) !== i) {
          ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `duplicate id "${tier.id}"` });
        }
      });
      if (tiers.at(-1)?.atLeast !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: [tiers.length - 1, 'atLeast'],
          message: 'the last tier must start at 0',
        });
      }
    }),
  /**
   * Base battle XP (design doc §7; care and habitat multipliers come later).
   * Each squishy that took part earns `perOpponentLevel` × the levels of the
   * opposing squishies its side tuckered out, × `winMultiplier` on a win,
   * rounded down, and never less than `minimum`.
   */
  xp: z.strictObject({
    perOpponentLevel: z.number().min(0),
    winMultiplier: z.number().min(1),
    minimum: z.number().int().min(0),
  }),
  /**
   * Befriending a wild squishy with a Heart Charm (design doc §6): the chance
   * rises as its energy drops. At full energy it is `atFull`%; with 1 energy
   * left it is `nearlyOut`%, in a straight line between (rounded down). Then
   * × `rarity[rarity]`/100 (rarer squishies are shyer), never below 1%.
   */
  capture: z
    .strictObject({
      atFull: percent,
      nearlyOut: percent,
      rarity: z.record(RaritySchema, percent),
    })
    .refine((c) => c.atFull <= c.nearlyOut, {
      message: 'atFull must not be more than nearlyOut',
      path: ['nearlyOut'],
    }),
  ai: z.record(BattleAiPolicySchema, BattleAiPolicyRulesSchema),
});
export type BattleRules = z.infer<typeof BattleRulesSchema>;

/** Validates battle rules and returns readable problems, or `[]`. */
export function checkBattleRules(input: unknown): string[] {
  const result = BattleRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
