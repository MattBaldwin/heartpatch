import { z } from 'zod';
import { BuildableKindSchema } from './home-base.js';

/**
 * Naming your home (#306 PR 0, owner decisions 2026-10-18/19). A kid names
 * their home once they've built one of each kind in `kindsToName` and befriended
 * enough squishies in battle on that patch, and may rename after each Heart
 * Seed upgrade. Data, so tuning it is a data edit (CLAUDE.md rule 5).
 */
export const NamingRulesSchema = z.strictObject({
  /** The longest name, in characters (it fits the map flag on a phone). */
  maxLength: z.number().int().min(4).max(32),
  /** Squishies befriended in battle on the patch before naming unlocks. */
  caughtToName: z.number().int().min(1).max(100),
  /**
   * The kinds to build one of before naming, in the order the card lists
   * them. Its own list, not `buildableKinds`: resource buildings and the
   * Warehouse stand on homesteads, never at home, so they don't count
   * (#601 PR 7, coordinator decision).
   */
  kindsToName: z.array(BuildableKindSchema).min(1),
});
export type NamingRules = z.infer<typeof NamingRulesSchema>;
