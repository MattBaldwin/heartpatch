import { z } from 'zod';
import { ResourceCostSchema } from './common.js';
import { formatDataIssues, type Report } from './issues.js';

/**
 * Wild Isle travel (#621): roads, bridges, ferry docks and the supply line
 * home. Cozy Patches have none of it (`patchRules`): reach and tending stay
 * exactly as they are there.
 */
export const TravelRulesSchema = z.strictObject({
  /**
   * Road levels, a tile attribute (`tile_roads`), not a building: level 1 is
   * a Path, 2 a Road, 3 a Paved road. Each level's `cost` is what that level
   * costs to lay or raise to; `reach` is how many tiles past the road its
   * owner can claim; `speedPercent` is a gatherer's pace on it.
   */
  roads: z.strictObject({
    levels: z
      .array(
        z.strictObject({
          cost: ResourceCostSchema,
          reach: z.number().int().min(1).max(6),
          speedPercent: z.number().int().min(100).max(300),
        }),
      )
      .min(1)
      .max(3),
  }),
  stranded: z.strictObject({
    /** Hours land can go without a supply line home before it starts to go wild. */
    afterHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 14),
    /** Extra hours when the supply line was a bridge or dock that came down. */
    graceHoursAfterBridgeLoss: z
      .number()
      .int()
      .min(0)
      .max(24 * 7),
  }),
  /** Every patch-mate may cross any Keeper's bridge (owner answer Q3, 2026-10-24). */
  bridgesShared: z.boolean(),
  ferry: z.strictObject({
    /** How many water steps across its lake a Ferry dock reaches (revision 1). */
    range: z.number().int().min(1).max(20),
    /** One dock per lake per Keeper. */
    oneDockPerLake: z.boolean(),
  }),
});
export type TravelRules = z.infer<typeof TravelRulesSchema>;

/**
 * Readable problems with the travel rules, or `[]`: they parse, every cost
 * names a real resource, and each road level reaches at least as far and is
 * at least as quick as the one below.
 */
export function checkTravelRules(input: unknown, resourceIds: ReadonlySet<string>): string[] {
  const parsed = TravelRulesSchema.safeParse(input);
  if (!parsed.success) return formatDataIssues(input, parsed.error);
  const problems: string[] = [];
  const report: Report = (path, message) => {
    problems.push(`${path.join('.')}: ${message}`);
  };
  const { levels } = parsed.data.roads;
  levels.forEach((level, i) => {
    for (const id of Object.keys(level.cost)) {
      if (!resourceIds.has(id))
        report(['roads', 'levels', i, 'cost', id], `unknown resource "${id}"`);
    }
    const below = levels[i - 1];
    if (!below) return;
    if (level.reach < below.reach) report(['roads', 'levels', i, 'reach'], 'shorter than below');
    if (level.speedPercent < below.speedPercent) {
      report(['roads', 'levels', i, 'speedPercent'], 'slower than below');
    }
  });
  return problems;
}
