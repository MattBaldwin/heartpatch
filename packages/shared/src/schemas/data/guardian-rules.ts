import { z } from 'zod';
import { isSpawnWindowHours } from '../../spawns/window.js';
import { formatDataIssues } from './issues.js';
import { SpawnTableSchema } from './spawn-tables.js';

const positiveInt = z.number().int().positive();
const level = z.number().int().min(1).max(100);

/**
 * The wild guardians a tile's `guardian_strength` stands for: how many, and
 * how strong. Strength comes from map generation (`MAP_GEN.guardianStrength`).
 */
export const GuardianStrengthTierSchema = z.strictObject({
  strength: positiveInt,
  /** Guardians on the tile (a battle side holds at most the battle team size). */
  count: z.number().int().min(1).max(6),
  levels: z
    .strictObject({ min: level, max: level })
    .refine((l) => l.min <= l.max, { message: 'min must not be more than max', path: ['max'] }),
});
export type GuardianStrengthTier = z.infer<typeof GuardianStrengthTierSchema>;

/**
 * How tile guardians are made (design doc §11, tech spec §8 "No rerolls").
 * Secret (CLAUDE.md rule 6): the tables live in `data/server/` and never
 * reach the client. A tile's guardians are fixed for each window of
 * `windowHours`, seeded from `deriveSeed(mapSeed, 'guardian', q, r, windowId)`.
 */
export const GuardianRulesSchema = z
  .strictObject({
    /** Guardian window length in hours; divides 24. */
    windowHours: z
      .number()
      .int()
      .refine(isSpawnWindowHours, 'must divide 24 (1, 2, 3, 4, 6, 8, 12 or 24)'),
    /** One tier per strength, weakest first. A stronger tile uses the last tier. */
    strengths: z.array(GuardianStrengthTierSchema).min(1),
    /**
     * Who guards which terrain (the spawn table shape; `timeOfDay` is
     * ignored). Every terrain needs at least one table.
     */
    tables: z.array(SpawnTableSchema).min(1),
    /**
     * The tile panel's difficulty word for a neutral tile's team (owner
     * decision 10, 2026-10-03), by the team's total level: `easy` up to
     * `easyUpTo`, `tough` up to `toughUpTo`, else `very-tough`. Fixed bands,
     * so every member sees the same hint.
     */
    hint: z
      .strictObject({ easyUpTo: positiveInt, toughUpTo: positiveInt })
      .refine((h) => h.easyUpTo < h.toughUpTo, {
        message: 'easyUpTo must be less than toughUpTo',
        path: ['toughUpTo'],
      }),
  })
  .superRefine((rules, ctx) => {
    rules.strengths.forEach((tier, i) => {
      const prev = rules.strengths[i - 1];
      if (prev && prev.strength >= tier.strength) {
        ctx.addIssue({
          code: 'custom',
          path: ['strengths', i, 'strength'],
          message: 'strengths must go weakest first',
        });
      }
    });
  });
export type GuardianRules = z.infer<typeof GuardianRulesSchema>;

/** Validates guardian rules and returns readable problems, or `[]`. */
export function checkGuardianRules(input: unknown): string[] {
  const result = GuardianRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
