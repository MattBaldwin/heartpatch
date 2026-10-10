import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema } from './common.js';
import { FeelingIdSchema } from './elements.js';
import { formatDataIssues } from './issues.js';

/*
 * Branching evolution (design doc §8, #32). Secret (CLAUDE.md rule 6): the
 * odds, the conditions and the whispers that hint at them live in
 * `data/server/` and never reach the client. A step's forms are the
 * evolutions a species has at one level (`Species.evolutions` first, then
 * `secretEvolutions`); the first listed is its default form, and each other
 * one is a branch with odds.
 */

/** Something that must hold at the moment a squishy evolves for a rare branch to be possible. */
export const EvolutionConditionSchema = z.discriminatedUnion('kind', [
  /** The owner's patch time of day (the spawn tables' day / dusk / night). */
  z.strictObject({
    kind: z.literal('time'),
    times: z.array(z.enum(['day', 'dusk', 'night'])).min(1),
  }),
  /** A fire of this building is burning at the owner's home. */
  z.strictObject({ kind: z.literal('fire-lit'), building: ContentIdSchema }),
  /** A fire at the owner's home is full of fuel. */
  z.strictObject({ kind: z.literal('fire-full') }),
  z.strictObject({ kind: z.literal('season'), season: ContentIdSchema }),
]);
export type EvolutionCondition = z.infer<typeof EvolutionConditionSchema>;

/** A whisper in the care sheet (#32): `{name}` is the squishy's name. Never names a form or a chance. */
export const WhisperSchema = z.strictObject({
  icon: z.string().min(1).max(8),
  text: DescriptionSchema,
  sub: DescriptionSchema.optional(),
});
export type Whisper = z.infer<typeof WhisperSchema>;

/**
 * How a branch is reached. `feeling`: the squishy's dominant feeling (its
 * lean) is this one. `rare`: every condition holds as it evolves, and the
 * dominant feeling matches too when one is given. A rare branch can't be
 * rolled at all otherwise; a feeling branch keeps a small surprise chance.
 */
export const BranchTriggerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('feeling'), feeling: FeelingIdSchema }),
  z.strictObject({
    kind: z.literal('rare'),
    conditions: z.array(EvolutionConditionSchema).min(1),
    feeling: FeelingIdSchema.optional(),
    /** The whisper for this branch (a rare branch has no feeling whisper to lean on). */
    whisper: WhisperSchema,
  }),
]);
export type BranchTrigger = z.infer<typeof BranchTriggerSchema>;

/** A public branch's odds: `from` evolves into `into` (one of its `Species.evolutions`). */
export const EvolutionOddsSchema = z.strictObject({
  from: ContentIdSchema,
  into: ContentIdSchema,
  trigger: BranchTriggerSchema,
});
export type EvolutionOdds = z.infer<typeof EvolutionOddsSchema>;

const weight = z.number().min(0).max(10_000);
const points = z.number().min(0).max(100);

/** The numbers every roll and lean uses (all `// TUNE:` in the data). */
export const EvolutionRulesSchema = z
  .strictObject({
    weights: z.strictObject({
      /** The default form; positive, so a roll always has something to pick. */
      default: weight.positive(),
      /** A feeling branch whose feeling isn't the dominant one: a small surprise. */
      unaimed: weight,
      /** A branch the squishy is aimed at (its feeling won, or its rare conditions hold). */
      aimed: weight,
      /** Branch weights × (1 + (careBoost − 1) × care score); care score is 0–1. */
      careBoost: z.number().min(1).max(10),
    }),
    /** Aimed misses (per player and branch) before the branch's weight doubles, and before it's certain. */
    pity: z.strictObject({
      boostAfter: z.number().int().min(1),
      boost: z.number().min(1).max(100),
      guaranteeAfter: z.number().int().min(1),
    }),
    lean: z.strictObject({
      /** Lean points halve over this many hours (worked out lazily, CLAUDE.md rule 4). */
      halfLifeHours: z.number().positive(),
      /** A new squishy's own feeling starts with this many points. */
      headStart: points,
      /** Points a full-value care action gives, by care action id. */
      care: z.record(ContentIdSchema, z.strictObject({ feeling: FeelingIdSchema, points })),
      /** A battle win. */
      win: z.strictObject({ feeling: FeelingIdSchema, points }),
      /** On watch when the Hollow Man visits. */
      nightWatch: z.strictObject({ feeling: FeelingIdSchema, points }),
      /** Points per habitat feeling tag, for every `habitatHours` housed there. */
      habitat: z.strictObject({ points, hours: z.number().positive() }),
    }),
    whisper: z.strictObject({
      /** Whispers show from this evolving-meter percent. */
      fromPercent: z.number().int().min(0).max(100),
      /** The feeling whisper, by dominant feeling. */
      feelings: z.record(FeelingIdSchema, WhisperSchema),
    }),
  })
  .superRefine((rules, ctx) => {
    if (rules.pity.guaranteeAfter < rules.pity.boostAfter) {
      ctx.addIssue({
        code: 'custom',
        path: ['pity', 'guaranteeAfter'],
        message: 'guaranteeAfter must not be less than boostAfter',
      });
    }
  });
export type EvolutionRules = z.infer<typeof EvolutionRulesSchema>;

/** Readable problems with the evolution rules, or `[]`. */
export function checkEvolutionRules(input: unknown): string[] {
  const result = EvolutionRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
