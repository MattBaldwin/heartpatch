import { z } from 'zod';
import { BattleAiPolicySchema } from './battle.js';
import { formatDataIssues } from './issues.js';

/**
 * How the owner's squishies on watch play when someone challenges their land
 * (design doc §6). The UI calls it "Defense style": Bold, Careful, Balanced
 * (style guide §9). Per map, like everything else about a player's land.
 */
export const DefenseStanceSchema = z.enum(['aggressive', 'defensive', 'balanced']);
export type DefenseStance = z.infer<typeof DefenseStanceSchema>;

/** Offline defense and raid log rules (design doc §6, issue #16). */
export const RaidRulesSchema = z
  .strictObject({
    /** The engine AI policy each stance plays with (`content.rules.ai`). */
    stancePolicies: z.strictObject({
      aggressive: BattleAiPolicySchema,
      defensive: BattleAiPolicySchema,
      balanced: BattleAiPolicySchema,
    }),
    /** A new member's stance until they pick one. */
    defaultStance: DefenseStanceSchema,
    /** How many of the latest challenges the report shows. */
    reportLimit: z.number().int().min(1).max(100),
  })
  // Each stance its own policy, never a wild or guardian one, so a stored
  // policy reads back as exactly one stance (`stanceOfPolicy`).
  .refine(
    (rules) => {
      const policies = Object.values(rules.stancePolicies);
      return (
        new Set(policies).size === policies.length &&
        !policies.some((p) => p === 'wild' || p === 'guardian')
      );
    },
    {
      message: 'Each defense stance needs its own policy (not wild or guardian).',
      path: ['stancePolicies'],
    },
  );
export type RaidRules = z.infer<typeof RaidRulesSchema>;

/** Validates raid rules and returns readable problems, or `[]`. */
export function checkRaidRules(input: unknown): string[] {
  const result = RaidRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
