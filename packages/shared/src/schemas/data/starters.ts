import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { formatDataIssues } from './issues.js';

/*
 * The starter pick (owner decision 2026-10-03, design doc §4 "First
 * squishy"): on joining a patch, a new player picks 1 of 3 starters, one per
 * element family. The tutorial's Partner (#24) is the same choice.
 */

/** Exactly three public, base-form species with three different elements (`starters.test.ts`). */
export const StarterDataSchema = z
  .strictObject({
    speciesIds: z.array(ContentIdSchema).length(3),
    /**
     * Sprout's gift with the account's very first starter pick (owner
     * decision 2026-10-04): items into that patch's bag, once per account,
     * so a new player can befriend a squishy on day one.
     */
    firstPickGift: z.record(ContentIdSchema, z.number().int().positive()),
  })
  .refine((data) => new Set(data.speciesIds).size === data.speciesIds.length, {
    message: 'Starter species must be different.',
    path: ['speciesIds'],
  });
export type StarterData = z.infer<typeof StarterDataSchema>;

/** Validates the starter list's shape and returns readable problems, or `[]`. */
export function checkStarters(input: unknown): string[] {
  const result = StarterDataSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
