import { z } from 'zod';
import { DisplayNameSchema, ContentIdSchema } from './common.js';
import type { GameData } from './game-data.js';
import { formatDataIssues } from './issues.js';

/**
 * The tools that clear land (#242, owner decisions 2026-10-11): an Axe for
 * forests, a Pickaxe for mountains, a Spade for meadows and hills. Their own
 * list, apart from the explore tools (`ToolIdSchema`): the explore reply
 * lists every explore tool, so adding these there would break older apps.
 */
export const ClearToolIdSchema = z.enum(['axe', 'pickaxe', 'spade']);
export type ClearToolId = z.infer<typeof ClearToolIdSchema>;

/** The terrain a cleared tile becomes (`tiles.terrain`). */
export const CLEARED_TERRAIN = 'clearing';

/**
 * Clearing land (#242): which terrains can be cleared and with what, how
 * long it takes, and what it drops. A clearing tool is an item counted in
 * uses, like an explore tool (owner decision 2026-10-11, Q4): a recipe makes
 * `uses` of it, and each clear spends one when it starts.
 */
export const ClearingRulesSchema = z.strictObject({
  /** How long a clear takes, from start to cleared (a timestamp, read lazily). */
  seconds: z.number().int().positive(),
  tools: z.array(
    z.strictObject({
      id: ClearToolIdSchema,
      name: DisplayNameSchema,
      /** Clears one tool makes before it wears out. */
      uses: z.number().int().positive(),
    }),
  ),
  /** Every terrain that can be cleared, and the tool it takes. Anything else can't. */
  terrains: z.array(z.strictObject({ terrain: ContentIdSchema, tool: ClearToolIdSchema })),
  /**
   * What a clear drops: one gather of the tile's spot when it has one, else
   * this many cycles of the land's own yield (`JOB_RULES.terrainYields`).
   */
  landDropCycles: z.number().int().min(0),
});
export type ClearingRules = z.infer<typeof ClearingRulesSchema>;

/** The tool that clears a terrain, or null when it can't be cleared. */
export function clearToolFor(terrain: string, rules: ClearingRules): ClearToolId | null {
  return rules.terrains.find((t) => t.terrain === terrain)?.tool ?? null;
}

/**
 * Validates the clearing rules against the content they name (real
 * terrains that a generator places, a tool row for every tool a terrain
 * needs, one row per terrain, a bag item for every tool, and recipes that
 * make one whole tool) and returns readable problems, or `[]`.
 */
export function checkClearingRules(
  input: unknown,
  data: Pick<GameData, 'terrains' | 'resources' | 'recipes'>,
): string[] {
  const result = ClearingRulesSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const rules = result.data;
  const problems: string[] = [];
  const terrains = new Map(data.terrains.map((t) => [t.id, t]));
  if (!terrains.has(CLEARED_TERRAIN))
    problems.push(`no "${CLEARED_TERRAIN}" terrain to clear into`);
  const tools = new Set<string>();
  rules.tools.forEach((t, i) => {
    if (tools.has(t.id)) problems.push(`tools[${String(i)}]: duplicate tool "${t.id}"`);
    tools.add(t.id);
    // The bag holds a tool as an item counted in uses (`Resource.clearTool`).
    if (!data.resources.some((r) => r.clearTool === t.id && r.id === t.id)) {
      problems.push(`tools[${String(i)}]: no item with clearTool "${t.id}"`);
    }
    // A recipe makes one whole tool: exactly its uses.
    for (const recipe of data.recipes) {
      if (recipe.output.resource === t.id && recipe.output.quantity !== t.uses) {
        problems.push(
          `tools[${String(i)}]: recipe "${recipe.id}" makes ${String(recipe.output.quantity)} uses, not ${String(t.uses)}`,
        );
      }
    }
  });
  const seen = new Set<string>();
  rules.terrains.forEach((t, i) => {
    const at = `terrains[${String(i)}]`;
    if (seen.has(t.terrain)) problems.push(`${at}: "${t.terrain}" is listed twice`);
    seen.add(t.terrain);
    const terrain = terrains.get(t.terrain);
    if (!terrain) problems.push(`${at}: unknown terrain "${t.terrain}"`);
    // Only land a map scatters: never the cleared terrain itself, posts or the Gap.
    else if (terrain.weight === 0) problems.push(`${at}: "${t.terrain}" can't be cleared`);
    if (!tools.has(t.tool)) problems.push(`${at}: no tool row for "${t.tool}"`);
  });
  return problems;
}
