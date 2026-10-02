import { z } from 'zod';
import { formatDataIssues } from './issues.js';
import { SpawnTableSchema } from './spawn-tables.js';

const minuteOfDay = z.number().int().min(0).max(1439);
const level = z.number().int().min(1).max(100);

/**
 * The Hollow Man's public rules (design doc §14, decision C). Nightfall itself
 * is `HOME_BASE_RULES.nightfallMinute` (the Hearthfires burn on it). Public:
 * the client shows the night and the rescue reward from them; the server
 * enforces them.
 */
export const HollowRulesSchema = z.strictObject({
  /** Map-local minute the night ends (the map's lights come back up). */
  morningMinute: minuteOfDay,
  /** How many past nights the morning report looks back over. */
  reportNights: z.number().int().min(1).max(14),
  rescue: z.strictObject({
    /** Heartdust for a rescue that wins a reward. */
    heartdust: z.number().int().min(1),
    /**
     * Rescues per player per map-local day that earn Heartdust (decision C:
     * taking squishies on purpose isn't a farm). Later rescues still bring
     * the squishy home, without the reward.
     */
    rewardsPerDay: z.number().int().min(0),
  }),
});
export type HollowRules = z.infer<typeof HollowRulesSchema>;

/** Validates the Hollow Man's rules and returns readable problems, or `[]`. */
export function checkHollowRules(input: unknown): string[] {
  const result = HollowRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}

/**
 * The shadow guardians of a rescue expedition (design doc §14). Secret
 * (CLAUDE.md rule 6): the table lives in `data/server/`. Their level follows
 * the player's strongest active squishy, so a rescue is always a fair fight.
 */
export const RescueGuardianRulesSchema = z
  .strictObject({
    /** Shadow guardians in the battle (a battle side holds at most the team size). */
    count: z.number().int().min(1).max(6),
    /** Their level is the player's strongest active squishy's plus this, kept in `levels`. */
    levelOffset: z.number().int().min(-20).max(20),
    levels: z.strictObject({ min: level, max: level }),
    /** Who the shadows look like. */
    entries: SpawnTableSchema.shape.entries,
  })
  .refine((r) => r.levels.min <= r.levels.max, {
    message: 'min must not be more than max',
    path: ['levels', 'max'],
  });
export type RescueGuardianRules = z.infer<typeof RescueGuardianRulesSchema>;

/** Validates rescue guardian rules and returns readable problems, or `[]`. */
export function checkRescueGuardianRules(input: unknown): string[] {
  const result = RescueGuardianRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
