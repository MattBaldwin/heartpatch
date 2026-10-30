import { z } from 'zod';
import { formatDataIssues } from './issues.js';

/**
 * A day of the week, as `Date.getUTCDay` counts it: 0 is Sunday, 6 is
 * Saturday. The Long Night's day on a patch (#727, owner decision Q1: the
 * weekday only; the Night is that day's normal nightfall in map time).
 */
export const LongNightWeekdaySchema = z.number().int().min(0).max(6);
export type LongNightWeekday = z.infer<typeof LongNightWeekdaySchema>;

/**
 * The Long Night's public rules (#727): the weekly night the Hollow Man
 * comes at full strength, and Juniper's Gap after a patch holds. Public: the
 * client shows the countdown, the Gap's window and the rescue reward from
 * them; the server enforces them. How much stronger he is stays server-only
 * (`LongNightSecretsSchema`, CLAUDE.md rule 6).
 */
export const LongNightRulesSchema = z.strictObject({
  /**
   * The weekday every patch starts on (owner decision Q5: Saturday, for old
   * and new patches alike). `maps.long_night_weekday`'s column default is
   * this number; an owner can pick another day or Off.
   */
  defaultWeekday: LongNightWeekdaySchema,
  /** Juniper's Gap stays open this many hours from the strike after a patch holds. */
  gapOpenHours: z.number().int().min(1).max(72),
  /** Rescue rewards per player per day are multiplied by this while the Gap is open. */
  rescueRewardsMultiplier: z.number().int().min(1).max(5),
  /**
   * A Keeper with nothing in `game_events` for this many days isn't counted
   * for the patch's hold, so a patch never fails for someone who's away.
   */
  awayAfterDays: z.number().int().min(1).max(60),
  /** "Long Night in 3 days": the chips show the countdown from this many days out. */
  noticeDays: z.number().int().min(0).max(6),
});
export type LongNightRules = z.infer<typeof LongNightRulesSchema>;

/** Validates the Long Night's public rules and returns readable problems, or `[]`. */
export function checkLongNightRules(input: unknown): string[] {
  const result = LongNightRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
