import { z } from 'zod';
import { ElementIdSchema, FeelingIdSchema } from './elements.js';

/** Allowed multiplier range for each combat table (design doc §5). */
export interface MultiplierRange {
  readonly min: number;
  readonly max: number;
}

export const ELEMENT_MULTIPLIER_RANGE: MultiplierRange = { min: 0.5, max: 2 };
// TUNE: design doc §5 [DEFAULT: 0.75× to 1.5×]
export const FEELING_MULTIPLIER_RANGE: MultiplierRange = { min: 0.75, max: 1.5 };
// TUNE: design doc §5 [DEFAULT: 0.85× to 1.2×]
export const SYNERGY_MULTIPLIER_RANGE: MultiplierRange = { min: 0.85, max: 1.2 };

function multiplier(label: string, range: MultiplierRange) {
  const outOfRange = `${label} multiplier must be between ${range.min} and ${range.max}`;
  return z
    .number({
      error: (issue) =>
        issue.input === undefined
          ? `missing ${label} multiplier (every pair needs one)`
          : undefined,
    })
    .min(range.min, outOfRange)
    .max(range.max, outOfRange);
}

/**
 * `matrix[attacker][defender]`. Records keyed by an enum are exhaustive, so a
 * missing pair fails, and unknown keys fail too.
 */
export const ElementMatrixSchema = z.record(
  ElementIdSchema,
  z.record(ElementIdSchema, multiplier('element', ELEMENT_MULTIPLIER_RANGE)),
);
export type ElementMatrix = z.infer<typeof ElementMatrixSchema>;

/** `matrix[attacker][defender]`, where the counters live. */
export const FeelingMatrixSchema = z.record(
  FeelingIdSchema,
  z.record(FeelingIdSchema, multiplier('feeling', FEELING_MULTIPLIER_RANGE)),
);
export type FeelingMatrix = z.infer<typeof FeelingMatrixSchema>;

/** `table[element][feeling]`: a squishy's own combo, applied to its stats. */
export const SynergyTableSchema = z.record(
  ElementIdSchema,
  z.record(FeelingIdSchema, multiplier('synergy', SYNERGY_MULTIPLIER_RANGE)),
);
export type SynergyTable = z.infer<typeof SynergyTableSchema>;
