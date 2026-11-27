import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { formatDataIssues } from './issues.js';
import { MonthDaySchema } from './seasons.js';

/**
 * One boss in the visiting bag (#190): its boss-form species and the
 * terrains it likes to stomp around on (its tile prefers one of them).
 */
export const BossBagEntrySchema = z.strictObject({
  speciesId: ContentIdSchema,
  terrains: z.array(ContentIdSchema).min(1),
});
export type BossBagEntry = z.infer<typeof BossBagEntrySchema>;

/**
 * Asking a beaten boss to be your friend (#190 plan §3). Secret but for
 * `charmsPerAsk` and `asksPerWin`, which the result screen shows: the odds,
 * the warmth and the sure ask never reach a client (CLAUDE.md rule 6).
 */
export const BossBefriendRulesSchema = z.strictObject({
  /** Heart Charms one ask spends ("Give it 3 Heart Charms?"). */
  charmsPerAsk: z.number().int().min(1).max(10),
  /** Asks after one win; then it stomps off until its next visit. */
  asksPerWin: z.number().int().min(1).max(5),
  /** The asks stay open this long after the win, even once the visit ends (plan §12). */
  askHours: z.number().int().min(1).max(72),
  /** The chance (%) of a yes before anything else… */
  basePercent: z.number().int().min(0).max(100),
  /** …plus this per squishy of yours still standing at the win… */
  perStandingPercent: z.number().int().min(0).max(100),
  /** …plus this per earlier "not yet" from this boss kind (warmth, kept across visits). */
  perMissPercent: z.number().int().min(0).max(100),
  /** After this many "not yet"s, the next ask always works. */
  sureAfterMisses: z.number().int().min(1).max(20),
  /** A yes joins as the line's base form at this share (%) of the Keeper's Partner level… */
  joinLevelPercent: z.number().int().min(1).max(100),
  /** …at least this level (and below its first evolution, `befriendedLevel`). */
  minJoinLevel: z.number().int().min(1).max(100),
});
export type BossBefriendRules = z.infer<typeof BossBefriendRulesSchema>;

const BundleSchema = z.record(ContentIdSchema, z.number().int().min(1).max(99));

/**
 * The Christmas Eve visit's lowered gates (#37 C0b, owner answer 3): every
 * Keeper on the patch can fight it, with the usual level scaling.
 */
export const ChristmasEveGatesSchema = z.strictObject({
  /** A Keeper whose Partner is under this sees it but can't fight yet ("Too big for now!"). */
  minPlayerLevel: z.number().int().min(1).max(100),
  /** The patch gate (some member's Partner this grown); null: no patch gate at all. */
  minPartnerLevel: z.number().int().min(1).max(100).nullable(),
  /** The boss's level: the Keeper's Partner level plus this… */
  levelBonus: z.number().int().min(0).max(20),
  /** …never under this. */
  minLevel: z.number().int().min(1).max(100),
});
export type ChristmasEveGates = z.infer<typeof ChristmasEveGatesSchema>;

/**
 * The Christmas Eve patch bar (#37 C0b, addendum "The patch bar"). Secret:
 * the client sees the goal and the points chipped, never these numbers.
 */
export const ChristmasEveBarRulesSchema = z.strictObject({
  /** One fight's points: this × damage to the boss ÷ its full energy, so a win is this many. */
  pointsPerWin: z.number().int().min(1).max(1000),
  /** The goal: this per active Keeper… */
  goalPerKeeper: z.number().int().min(1).max(10_000),
  /** …never under this… */
  minGoal: z.number().int().min(1).max(100_000),
  /** …or over this. */
  maxGoal: z.number().int().min(1).max(100_000),
  /** Head start at open, as % of the goal: this per lit Twinkle Lights tile… */
  headStartPerLightPercent: z.number().int().min(0).max(100),
  /** …at most this from lights… */
  headStartLightsMaxPercent: z.number().int().min(0).max(100),
  /** …plus this when the Patch Tree's star is lit. */
  headStartStarPercent: z.number().int().min(0).max(100),
});
export type ChristmasEveBarRules = z.infer<typeof ChristmasEveBarRulesSchema>;

/**
 * The Christmas Eve visit (#37 C0b): in the week holding `day`, it replaces
 * that week's bag draw on every patch. Server-only, like the rest.
 */
export const ChristmasEveBossRulesSchema = z.strictObject({
  /**
   * The new Christmas-only BIG squishy (owner answer 1). Null until its
   * species lands (X3): the visit still runs on Christmas Eve, with the
   * week's bag draw standing in (`christmasEveVisitFor`, X1).
   */
  speciesId: ContentIdSchema.nullable(),
  /** The terrains it likes when the Patch Tree's post tile can't be used. */
  terrains: z.array(ContentIdSchema).min(1),
  /** The patch-local day it opens on. */
  day: MonthDaySchema,
  /** The patch-local hour it opens on `day`… */
  opensAtHour: z.number().int().min(0).max(23),
  /** …and the hour it closes on the morning after; the bar falls or dozes off then. */
  closesAtHour: z.number().int().min(0).max(23),
  gates: ChristmasEveGatesSchema,
  /**
   * Who shares the fall (owner answer 2): a Keeper on the patch with at
   * least this many fights finished before the close, win or lose, online
   * or not when the bar filled. The same Keepers get the dozed-off thanks.
   */
  contributorMinFights: z.number().int().min(1).max(10),
  bar: ChristmasEveBarRulesSchema,
  /** A contributor's bundle when the bar fell, ledgered as `christmas-boss`… */
  fallBundle: BundleSchema,
  /** …plus this many befriend asks (`befriend.charmsPerAsk` each). */
  fallAsks: z.number().int().min(0).max(5),
  /** The smaller thanks when it dozed off short (owner answer 4): no asks, nothing taken. */
  dozedBundle: BundleSchema,
});
export type ChristmasEveBossRules = z.infer<typeof ChristmasEveBossRulesSchema>;

/**
 * When, where and who a mini-boss visits (#190 plan §2). Server-only
 * (CLAUDE.md rule 6): the schedule, the bag, the next boss and the unlock
 * levels never reach a client. Exported only from `@heartpatch/shared/server`.
 */
export const BossEventRulesSchema = z.strictObject({
  /** A visit lasts this long from when it opens. */
  windowHours: z.number().int().min(1).max(72),
  /** The patch-local hour a visit opens on its start day. */
  opensAtHour: z.number().int().min(0).max(23),
  /** No visits until some member's Partner reaches this level. */
  minPartnerLevel: z.number().int().min(1).max(100),
  /** A Keeper whose own Partner is under this sees the boss but can't fight it yet. */
  minPlayerLevel: z.number().int().min(1).max(100),
  /** The boss's level: the Keeper's Partner level plus this… */
  levelBonus: z.number().int().min(0).max(20),
  /** …never under this. */
  minLevel: z.number().int().min(1).max(100),
  /** Fights a Keeper can start per patch-local day; a no-contest gives its try back. */
  triesPerDay: z.number().int().min(1).max(10),
  /** No step in a fight for this long and the Keeper has left: a loss, the try used (plan §12). */
  idleMinutes: z.number().int().min(1).max(120),
  /**
   * The visiting bag: a seeded shuffle per patch, so every boss visits
   * before one repeats. Empty: no boss ever visits (production until the
   * boss content lands, #234).
   */
  bag: z.array(BossBagEntrySchema),
  /**
   * The guaranteed bundle a win puts in the Keeper's bag (#190 plan §2):
   * item id → count, ledgered as `boss`. Paid once per win; a scoot or a
   * loss pays none.
   */
  bundle: BundleSchema,
  /** Befriending after a win (190c). */
  befriend: BossBefriendRulesSchema,
  /** The Christmas Eve visit (#37 C0b). Left out: no Christmas visit. */
  christmasEve: ChristmasEveBossRulesSchema.optional(),
});
export type BossEventRules = z.infer<typeof BossEventRulesSchema>;

/** Validates the boss rules and returns readable problems, or `[]`. */
export function checkBossEventRules(
  rules: unknown,
  knownSpecies: ReadonlySet<string>,
  knownTerrains: ReadonlySet<string>,
  knownItems?: ReadonlySet<string>,
): string[] {
  const parsed = BossEventRulesSchema.safeParse(rules);
  if (!parsed.success) return formatDataIssues(rules, parsed.error);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.data.bag) {
    if (!knownSpecies.has(entry.speciesId)) {
      problems.push(`boss bag: unknown species "${entry.speciesId}"`);
    }
    if (seen.has(entry.speciesId)) problems.push(`boss bag: "${entry.speciesId}" is in it twice`);
    seen.add(entry.speciesId);
    for (const terrain of entry.terrains) {
      if (!knownTerrains.has(terrain)) {
        problems.push(`boss bag: "${entry.speciesId}" likes unknown terrain "${terrain}"`);
      }
    }
  }
  if (Object.keys(parsed.data.bundle).length === 0)
    problems.push('boss rules: the bundle is empty');
  for (const item of Object.keys(parsed.data.bundle)) {
    if (knownItems && !knownItems.has(item)) problems.push(`boss bundle: unknown item "${item}"`);
  }
  if (parsed.data.minPlayerLevel > parsed.data.minPartnerLevel) {
    problems.push('boss rules: minPlayerLevel is above minPartnerLevel');
  }
  const eve = parsed.data.christmasEve;
  if (eve)
    problems.push(...checkChristmasEve(eve, parsed.data, knownSpecies, knownTerrains, knownItems));
  return problems;
}

function checkChristmasEve(
  eve: ChristmasEveBossRules,
  weekly: BossEventRules,
  knownSpecies: ReadonlySet<string>,
  knownTerrains: ReadonlySet<string>,
  knownItems?: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  if (eve.speciesId !== null) {
    if (!knownSpecies.has(eve.speciesId)) {
      problems.push(`christmas eve: unknown species "${eve.speciesId}"`);
    }
    if (weekly.bag.some((entry) => entry.speciesId === eve.speciesId)) {
      problems.push(`christmas eve: "${eve.speciesId}" is also in the weekly bag`);
    }
  }
  for (const terrain of eve.terrains) {
    if (!knownTerrains.has(terrain)) problems.push(`christmas eve: unknown terrain "${terrain}"`);
  }
  // Lowered, never raised (owner answer 3).
  if (eve.gates.minPlayerLevel > weekly.minPlayerLevel) {
    problems.push('christmas eve: minPlayerLevel is above the weekly one');
  }
  if (eve.gates.minPartnerLevel !== null && eve.gates.minPartnerLevel > weekly.minPartnerLevel) {
    problems.push('christmas eve: minPartnerLevel is above the weekly one');
  }
  if (eve.gates.minLevel > weekly.minLevel) {
    problems.push('christmas eve: minLevel is above the weekly one');
  }
  if (eve.gates.levelBonus > weekly.levelBonus) {
    problems.push('christmas eve: levelBonus is above the weekly one');
  }
  if (eve.gates.minPartnerLevel !== null && eve.gates.minPlayerLevel > eve.gates.minPartnerLevel) {
    problems.push('christmas eve: minPlayerLevel is above minPartnerLevel');
  }
  // A Keeper must be able to finish enough fights in one patch day to share the fall.
  if (eve.contributorMinFights > weekly.triesPerDay) {
    problems.push('christmas eve: contributorMinFights is above triesPerDay');
  }
  if (eve.bar.minGoal > eve.bar.maxGoal) problems.push('christmas eve: minGoal is above maxGoal');
  if (eve.bar.headStartLightsMaxPercent + eve.bar.headStartStarPercent >= 100) {
    problems.push('christmas eve: the head start fills the bar by itself');
  }
  if (eve.fallAsks > weekly.befriend.asksPerWin) {
    problems.push('christmas eve: more fall asks than a win gets');
  }
  for (const [name, bundle] of [
    ['fall', eve.fallBundle],
    ['dozed', eve.dozedBundle],
  ] as const) {
    if (Object.keys(bundle).length === 0)
      problems.push(`christmas eve: the ${name} bundle is empty`);
    for (const item of Object.keys(bundle)) {
      if (knownItems && !knownItems.has(item)) {
        problems.push(`christmas eve ${name} bundle: unknown item "${item}"`);
      }
    }
  }
  return problems;
}
