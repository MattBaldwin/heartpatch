import { z } from 'zod';
import { formatDataIssues } from './issues.js';

const positiveInt = z.number().int().positive();
const percent = z.number().int().min(0).max(100);

/**
 * Raid rules for taking land (design doc §11, decision B). Public: the client
 * shows "attempts left" and cooldowns from them, and the server enforces them.
 */
export const TerritoryRulesSchema = z.strictObject({
  /** A tile can't be battled for again this long after a battle on it starts. */
  cooldownHours: positiveInt,
  /** A new player's land can't be challenged this long after they join a map. */
  newPlayerShieldHours: z.number().int().min(0),
  /** Tile battles (claims and challenges) per player per map-local day. */
  attemptsPerDay: positiveInt,
  /** A tile battle with no action for this long has been left: it counts as a loss. */
  abandonMinutes: positiveInt,
  /** Most squishies standing watch on one tile. */
  maxDefenders: z.number().int().min(1).max(6),
  /**
   * Most tiles one player can lose to challenges per map-local day, by PvP
   * mode (Off allows no challenges at all).
   */
  dailyLossCap: z.strictObject({ on: positiveInt, gentle: positiveInt }),
  /**
   * Gentle mode: challenging a player whose land (home rings not counted) is
   * under `smallerBelowPercent`% of yours earns `rewardPercent`% rewards.
   */
  gentle: z.strictObject({ smallerBelowPercent: percent, rewardPercent: percent }),
  /**
   * Land that misses you (owner decision 2026-10-06, design review Q2): an
   * outer tile its owner hasn't tended in a while (claimed it, or tapped
   * Visit, which tends all their land) fades, then goes wild again at a
   * nightfall and its guardians come back. Home tiles never do.
   */
  tending: z
    .strictObject({
      /** Untended this many days, a tile starts to fade and the owner is told it misses them. */
      missesYouAfterDays: positiveInt,
      /** Untended this many days, it can go wild again at a nightfall. */
      wildAfterDays: positiveInt,
      /** Most of one player's tiles that go wild at one nightfall, by PvP mode. */
      wildPerNight: z.strictObject({ off: positiveInt, on: positiveInt, gentle: positiveInt }),
      /** Tiles this close to a Heart Seed never fade (1 is the home ring alone). */
      keepRadius: positiveInt,
    })
    .refine((t) => t.wildAfterDays > t.missesYouAfterDays, {
      message: 'wildAfterDays must come after missesYouAfterDays, so there is a warning first',
      path: ['wildAfterDays'],
    }),
});
export type TerritoryRules = z.infer<typeof TerritoryRulesSchema>;

/** Validates territory rules and returns readable problems, or `[]`. */
export function checkTerritoryRules(input: unknown): string[] {
  const result = TerritoryRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
