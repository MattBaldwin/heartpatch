import { z } from 'zod';
import { ResourceCostSchema } from './common.js';
import { formatDataIssues, type Report } from './issues.js';

/** How many levels a line (`tile_lines.level`) can have; the DB check matches. */
export const MAX_LINE_LEVEL = 2;

/**
 * A Clockwork Isle line's kind (#874): a `wire` carries power, a `rail`
 * hauls (`tile_lines.kind`; one of each kind per tile).
 */
export const LineKindSchema = z.enum(['wire', 'rail']);
export type LineKind = z.infer<typeof LineKindSchema>;

/** A line's level (`tile_lines.level`): a wire is always 1; a rail 1 Rail, 2 Tidy rail. */
export const LineLevelSchema = z.number().int().min(1).max(MAX_LINE_LEVEL);

/**
 * Clockwork Isle rails (#874): a per-tile line like a road (`tile_lines`
 * kind `rail`, one per tile), feeding the supply line home with their own
 * levels. Each level's `cost` is what it costs to lay or raise to; `reach`
 * is how many tiles past the rail its owner can claim; `speedPercent` is a
 * gatherer's pace on it. A Rail Depot's `waitingCycles` (its building
 * levels) is how much a rail-joined gatherer holds for the bag. Cozy and
 * Wild patches never read these (`patchRules(type).rails` is null).
 */
export const RailRulesSchema = z.strictObject({
  levels: z
    .array(
      z.strictObject({
        cost: ResourceCostSchema,
        reach: z.number().int().min(1).max(6),
        speedPercent: z.number().int().min(100).max(300),
      }),
    )
    .min(1)
    .max(MAX_LINE_LEVEL),
});
export type RailRules = z.infer<typeof RailRulesSchema>;

/**
 * Readable problems with the rail rules, or `[]`: they parse, every cost
 * names a real resource, and each level reaches at least as far and is at
 * least as quick as the one below.
 */
export function checkRailRules(input: unknown, resourceIds: ReadonlySet<string>): string[] {
  const parsed = RailRulesSchema.safeParse(input);
  if (!parsed.success) return formatDataIssues(input, parsed.error);
  const problems: string[] = [];
  const report: Report = (path, message) => {
    problems.push(`${path.join('.')}: ${message}`);
  };
  const { levels } = parsed.data;
  levels.forEach((level, i) => {
    for (const id of Object.keys(level.cost)) {
      if (!resourceIds.has(id)) report(['levels', i, 'cost', id], `unknown resource "${id}"`);
    }
    const below = levels[i - 1];
    if (!below) return;
    if (level.reach < below.reach) report(['levels', i, 'reach'], 'shorter than below');
    if (level.speedPercent < below.speedPercent) {
      report(['levels', i, 'speedPercent'], 'slower than below');
    }
  });
  return problems;
}
