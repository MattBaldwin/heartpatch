import { z } from 'zod';
import { HollowStageSchema } from '../hollow-stage.js';
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
const HollowRulesShape = z.strictObject({
  /** Map-local minute the night ends (the map's lights come back up). */
  morningMinute: minuteOfDay,
  /** How many past nights the morning report looks back over. */
  reportNights: z.number().int().min(1).max(14),
  /**
   * First-night grace (owner decision 2026-10-03): the Hollow Man skips a
   * player for their first this-many nightfalls after joining a patch.
   */
  graceNights: z.number().int().min(0).max(14),
  /**
   * How bold the Hollow Man is on a Keeper's dark land, night by night
   * (#277, owner decisions 2026-10-08). A Keeper's night is counted from the
   * patch nightfall after they joined (night 1); the last row whose `from`
   * has come applies. `chances[i]` is the percent chance of an (i + 1)th
   * strike, rolled in order and stopping at the first miss. Each strike
   * wins back one dark tile and takes one exposed squishy, as far as there
   * are any.
   */
  strength: z
    .strictObject({
      nights: z
        .array(
          z.strictObject({
            from: z.number().int().min(1),
            /** What kids see (moon stages on the "getting bolder" sheet). */
            stage: HollowStageSchema,
            chances: z.array(z.number().int().min(1).max(100)).max(6),
          }),
        )
        .min(1),
      /** Most strikes in one night, on any patch (a kid-safety limit; the admin percent never raises it). */
      cap: z.number().int().min(0).max(6),
      /** Most strikes in one night on a `gentle` patch, for good. */
      gentleCap: z.number().int().min(0).max(6),
      /**
       * Most tiles a Keeper loses in one night, Hollow Man and untended land
       * (#194) together (owner decision 2026-10-08, Q6).
       */
      landLostPerNight: z.number().int().min(0).max(10),
      /**
       * A tile with a resource node in its middle can't hold a fire, so dark
       * land no fire site could ever reach is skipped (owner decision
       * 2026-10-08, Q5). #242 (clear and convert land) turns this off once a
       * node can be cleared away.
       */
      nodesBlockFires: z.boolean(),
    })
    .refine((s) => s.nights[0]?.from === 1, {
      message: 'the first row must start on night 1',
      path: ['nights', 0, 'from'],
    })
    .refine((s) => s.nights.every((n, i) => i === 0 || n.from > (s.nights[i - 1]?.from ?? 0)), {
      message: 'rows must start on later and later nights',
      path: ['nights'],
    }),
  /** The show the client plays from the night's outcome (#277): the walk lasts this long after nightfall. */
  show: z.strictObject({ prowlMinutes: z.number().int().min(1).max(120) }),
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
export const HollowRulesSchema = HollowRulesShape.refine(
  (r) => r.strength.nights.every((n) => n.from > r.graceNights || n.chances.length === 0),
  { message: 'the grace nights must not strike', path: ['strength', 'nights'] },
);
export type HollowRules = z.infer<typeof HollowRulesSchema>;
export type HollowStrengthRules = HollowRules['strength'];
export type HollowStage = HollowStrengthRules['nights'][number]['stage'];

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
