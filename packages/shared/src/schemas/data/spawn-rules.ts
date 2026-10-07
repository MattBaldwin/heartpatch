import { z } from 'zod';
import { isSpawnWindowHours } from '../../spawns/window.js';
import { RaritySchema } from './common.js';
import { formatDataIssues } from './issues.js';
import { SpawnTableSchema } from './spawn-tables.js';

/** `day`, `dusk` or `night`: what a spawn table can be limited to. */
export const TimeOfDaySchema = SpawnTableSchema.shape.timeOfDay.unwrap();
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

const hour = z.number().int().min(0).max(23);

/**
 * How wild spawns work (tech spec §8, design doc §4). Server-only with the
 * spawn tables (CLAUDE.md rule 6): the spawn chance and times shape what a
 * player can find.
 */
export const SpawnRulesSchema = z.strictObject({
  /** Spawn window length in hours; divides 24 (tech spec §8 [DEFAULT: 4]). */
  windowHours: z
    .number()
    .int()
    .refine(isSpawnWindowHours, 'must divide 24 (1, 2, 3, 4, 6, 8, 12 or 24)'),
  /** Chance (%) that a tile has a wild squishy in a window. */
  chance: z.number().int().min(0).max(100),
  /**
   * Wild squishy levels, both inclusive, for a player without a Partner (or
   * with no `partnerOffset`). `min` is also the floor for Partner-scaled levels.
   */
  levels: z
    .strictObject({ min: z.number().int().min(1).max(100), max: z.number().int().min(1).max(100) })
    .refine((l) => l.min <= l.max, { message: 'min must not be more than max', path: ['max'] }),
  /**
   * Wild levels follow the player's Partner: its level plus a roll in this
   * range (both inclusive), kept within `levels.min` and the top level (`GROWTH_RULES.maxLevel`). Optional: left
   * out, or for a player without a Partner, levels roll in `levels`.
   */
  partnerOffset: z
    .strictObject({
      min: z.number().int().min(-99).max(99),
      max: z.number().int().min(-99).max(99),
    })
    .refine((o) => o.min <= o.max, { message: 'min must not be more than max', path: ['max'] })
    .optional(),
  /**
   * Levels taken off a Partner-matched wild squishy by its rarity, after the
   * `partnerOffset` roll and before the `levels.min` floor (owner decision
   * 2026-10-06, #208): rarer base forms have bigger base stats, so at the
   * Partner's level they'd win far more often. A rarity left out takes off 0.
   * Plain levels (no Partner) ignore it.
   */
  rarityLevelDiscount: z.partialRecord(RaritySchema, z.number().int().min(0).max(99)).optional(),
  /**
   * Map-local hours where each time of day starts, earliest first, from 0.
   * A window's time of day is judged at its middle.
   */
  timesOfDay: z
    .array(z.strictObject({ from: hour, timeOfDay: TimeOfDaySchema }))
    .min(1)
    .superRefine((ranges, ctx) => {
      if (ranges[0]?.from !== 0) {
        ctx.addIssue({ code: 'custom', path: [0, 'from'], message: 'the first range starts at 0' });
      }
      ranges.forEach((range, i) => {
        const prev = ranges[i - 1];
        if (prev && prev.from >= range.from) {
          ctx.addIssue({
            code: 'custom',
            path: [i, 'from'],
            message: 'ranges must go earliest first',
          });
        }
      });
    }),
});
export type SpawnRules = z.infer<typeof SpawnRulesSchema>;

/** Validates spawn rules and returns readable problems, or `[]`. */
export function checkSpawnRules(input: unknown): string[] {
  const result = SpawnRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
