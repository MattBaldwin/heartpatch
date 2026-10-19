import { z } from 'zod';

/**
 * Naming your home (#306 PR 0, owner decisions 2026-10-18/19). A kid names
 * their home once they've built one of each buildable kind and befriended
 * enough squishies in battle on that patch, and may rename after each Heart
 * Seed upgrade. Data, so tuning it is a data edit (CLAUDE.md rule 5).
 */
export const NamingRulesSchema = z.strictObject({
  /** The longest name, in characters (it fits the map flag on a phone). */
  maxLength: z.number().int().min(4).max(32),
  /** Squishies befriended in battle on the patch before naming unlocks. */
  caughtToName: z.number().int().min(1).max(100),
});
export type NamingRules = z.infer<typeof NamingRulesSchema>;
