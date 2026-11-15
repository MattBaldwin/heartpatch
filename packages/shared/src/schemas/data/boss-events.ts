import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { formatDataIssues } from './issues.js';

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
  bundle: z.record(ContentIdSchema, z.number().int().min(1).max(99)),
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
  return problems;
}
