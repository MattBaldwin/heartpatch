import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { ElementIdSchema, FeelingIdSchema } from './elements.js';
import type { GameData } from './game-data.js';
import { formatDataIssues } from './issues.js';

const percent = z.number().int().min(100).max(1000);

/**
 * What a squishy gatherer brings in from land with no node (owner decision
 * 2026-10-04 "territory farming"): one entry per terrain that yields
 * something. `seconds` is the Keeper-equivalent gather time; a squishy's own
 * cycle is worked out from it (`workCycleSeconds`).
 */
export const TerrainYieldSchema = z.strictObject({
  terrain: ContentIdSchema,
  resource: ContentIdSchema,
  quantity: z.number().int().positive(),
  seconds: z.number().int().positive(),
});
export type TerrainYield = z.infer<typeof TerrainYieldSchema>;

/**
 * Who is good at gathering a resource (like a habitat's tags, DECISIONS
 * "XP maths is whole percents"): a squishy whose element (or seasonal
 * species) matches is quicker, one whose feeling matches too is quickest.
 */
export const GatherAffinitySchema = z.strictObject({
  resource: ContentIdSchema,
  /** A little picture for the job hints ("Great at gathering Timber 🌲"). */
  icon: z.string().min(1).max(8),
  elements: z.array(ElementIdSchema),
  feelings: z.array(FeelingIdSchema),
  /** Species of these seasons count as an element match (Halloween squishies → Pumpkins). */
  seasons: z.array(ContentIdSchema),
});
export type GatherAffinity = z.infer<typeof GatherAffinitySchema>;

/**
 * Squishy jobs (owner decisions 2026-10-04): team picking, squishy gatherers
 * and their hints. Public: the job board explains the same numbers the
 * server uses. The team size itself is `BATTLE_RULES.teamSize`.
 */
export const JobRulesSchema = z
  .strictObject({
    work: z.strictObject({
      /**
       * A squishy's gather cycle as a percent of the Keeper's gather time
       * before any match (200 = twice as long; the squishy repeats on its own).
       */
      cyclePercent: percent,
      /** Finished cycles a gatherer holds before it waits to be collected. */
      maxStoredCycles: z.number().int().min(1).max(48),
      /** Gathering speed when the element or the feeling matches, and when both do. */
      match: z.strictObject({ onePercent: percent, bothPercent: percent }),
    }),
    terrainYields: z.array(TerrainYieldSchema),
    affinities: z.array(GatherAffinitySchema),
    /** How many "good at gathering" hints a squishy shows at most. */
    maxGatherHints: z.number().int().min(0).max(6),
  })
  .refine((r) => r.work.match.onePercent <= r.work.match.bothPercent, {
    message: 'a double match must be at least as quick as a single one',
    path: ['work', 'match', 'bothPercent'],
  });
export type JobRules = z.infer<typeof JobRulesSchema>;

/**
 * Validates the job rules against the content they name (resources with a
 * gather, real terrains, one yield per terrain) and returns readable
 * problems, or `[]`.
 */
export function checkJobRules(
  input: unknown,
  data: Pick<GameData, 'resources' | 'terrains' | 'seasons'>,
): string[] {
  const result = JobRulesSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const rules = result.data;
  const problems: string[] = [];
  const resources = new Map(data.resources.map((r) => [r.id, r]));
  const terrains = new Set(data.terrains.map((t) => t.id));
  const seasons = new Set(data.seasons.map((s) => s.id));
  const seenTerrains = new Set<string>();
  rules.terrainYields.forEach((y, i) => {
    if (!terrains.has(y.terrain)) problems.push(`terrainYields[${String(i)}]: unknown terrain`);
    if (seenTerrains.has(y.terrain)) {
      problems.push(`terrainYields[${String(i)}]: ${y.terrain} has two yields`);
    }
    seenTerrains.add(y.terrain);
    if (!resources.get(y.resource)?.gather) {
      problems.push(`terrainYields[${String(i)}]: ${y.resource} isn't a gathered resource`);
    }
  });
  const seenResources = new Set<string>();
  rules.affinities.forEach((a, i) => {
    if (!resources.get(a.resource)?.gather) {
      problems.push(`affinities[${String(i)}]: ${a.resource} isn't a gathered resource`);
    }
    if (seenResources.has(a.resource)) {
      problems.push(`affinities[${String(i)}]: ${a.resource} is listed twice`);
    }
    seenResources.add(a.resource);
    for (const season of a.seasons) {
      if (!seasons.has(season)) problems.push(`affinities[${String(i)}]: unknown season ${season}`);
    }
  });
  return problems;
}
