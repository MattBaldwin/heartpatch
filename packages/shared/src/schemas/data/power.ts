import { z } from 'zod';
import { ResourceCostSchema } from './common.js';
import { formatDataIssues, type Report } from './issues.js';

/** A land tile's wind on a Clockwork Isle (#874): 1 still, 2 breezy, 3 blowy. Set from the seed, never changed. */
export const WindSchema = z.number().int().min(1).max(3);
export type Wind = z.infer<typeof WindSchema>;

/**
 * Clockwork Isle power (#874, owner answer Q3: wires like roads). Power is a
 * reach rule, not a flow: a `needsPower` building works only while joined to
 * one of its owner's generators. `model`:
 * - `wires`: by a chain of its owner's wire lines (`tile_lines` kind `wire`,
 *   at most `wire.maxRun` tiles) or by standing next to one;
 * - `radius`: within `radius` tiles of one (no wires);
 * - `none`: its owner has a generator anywhere on the patch.
 * `windPace` is a wind building's pace (percent) on a tile of that wind.
 * Cozy and Wild patches never read these (`patchRules(type).power` is null).
 */
export const PowerRulesSchema = z.strictObject({
  model: z.enum(['wires', 'radius', 'none']),
  wire: z.strictObject({
    /** What one tile of wire costs to lay. */
    cost: ResourceCostSchema,
    /** Wire tiles in one chain from a generator, at most. */
    maxRun: z.number().int().min(1).max(12),
  }),
  /** Tiles from a generator that count as powered; read only when `model` is `radius`. */
  radius: z.number().int().min(1).max(3),
  windPace: z.record(z.enum(['1', '2', '3']), z.number().int().positive().max(1000)),
});
export type PowerRules = z.infer<typeof PowerRulesSchema>;

/**
 * Readable problems with the power rules, or `[]`: they parse, the wire's
 * cost names real resources, and a windier tile is never slower.
 */
export function checkPowerRules(input: unknown, resourceIds: ReadonlySet<string>): string[] {
  const parsed = PowerRulesSchema.safeParse(input);
  if (!parsed.success) return formatDataIssues(input, parsed.error);
  const problems: string[] = [];
  const report: Report = (path, message) => {
    problems.push(`${path.join('.')}: ${message}`);
  };
  const rules = parsed.data;
  for (const id of Object.keys(rules.wire.cost)) {
    if (!resourceIds.has(id)) report(['wire', 'cost', id], `unknown resource "${id}"`);
  }
  if (rules.windPace['2'] < rules.windPace['1']) report(['windPace', '2'], 'slower than wind 1');
  if (rules.windPace['3'] < rules.windPace['2']) report(['windPace', '3'], 'slower than wind 2');
  return problems;
}
