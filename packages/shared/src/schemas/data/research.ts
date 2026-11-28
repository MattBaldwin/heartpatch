import { z } from 'zod';
import {
  ContentIdSchema,
  DescriptionSchema,
  DisplayNameSchema,
  ResourceCostSchema,
} from './common.js';
import { formatDataIssues, type Report } from './issues.js';

/**
 * One research node (#874): a Research Bench works on it for `seconds` (at
 * 100 % bench pace), paid `cost` up front; finishing makes it known to that
 * player on that patch and puts `grants` (Blueprints) in the bag. A node
 * needs every node in `requires` known first, each on a lower tier.
 */
export const ResearchNodeSchema = z.strictObject({
  id: ContentIdSchema,
  tier: z.number().int().min(1).max(3),
  name: DisplayNameSchema,
  description: DescriptionSchema,
  cost: ResourceCostSchema,
  seconds: z
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 3600),
  requires: z.array(ContentIdSchema).default([]),
  grants: ResourceCostSchema,
});
export type ResearchNode = z.infer<typeof ResearchNodeSchema>;

/**
 * The research tree (#874). One node goes at a time per player per patch
 * (`oneAtATime`; the DB's partial unique index on `research_jobs` holds it).
 * Cozy and Wild patches never read it (`patchRules(type).research` is null).
 */
export const ResearchRulesSchema = z.strictObject({
  nodes: z.array(ResearchNodeSchema).min(1),
  oneAtATime: z.literal(true),
});
export type ResearchRules = z.infer<typeof ResearchRulesSchema>;
export type ResearchRulesInput = z.input<typeof ResearchRulesSchema>;

/**
 * Readable problems with the research tree, or `[]`: it parses; node ids
 * are unique; every `requires` names another node on a lower tier, once;
 * costs and grants name real resources; and every building's
 * `requiresResearch` names a node.
 */
export function checkResearchTree(
  input: unknown,
  resourceIds: ReadonlySet<string>,
  buildings: readonly { readonly id: string; readonly requiresResearch?: string | undefined }[],
): string[] {
  const parsed = ResearchRulesSchema.safeParse(input);
  if (!parsed.success) return formatDataIssues(input, parsed.error);
  const problems: string[] = [];
  const report: Report = (path, message) => {
    problems.push(`${path.join('.')}: ${message}`);
  };
  const { nodes } = parsed.data;
  const byId = new Map<string, ResearchNode>();
  nodes.forEach((node, i) => {
    if (byId.has(node.id)) report(['nodes', i, 'id'], `duplicate id "${node.id}"`);
    byId.set(node.id, node);
  });
  nodes.forEach((node, i) => {
    for (const [field, cost] of [
      ['cost', node.cost],
      ['grants', node.grants],
    ] as const) {
      for (const id of Object.keys(cost)) {
        if (!resourceIds.has(id)) report(['nodes', i, field, id], `unknown resource "${id}"`);
      }
    }
    node.requires.forEach((id, j) => {
      const needed = byId.get(id);
      if (!needed) report(['nodes', i, 'requires', j], `unknown research "${id}"`);
      else if (needed.tier >= node.tier) {
        report(['nodes', i, 'requires', j], `"${id}" is not on a lower tier`);
      }
      if (node.requires.indexOf(id) !== j) report(['nodes', i, 'requires', j], 'listed twice');
    });
  });
  for (const b of buildings) {
    if (b.requiresResearch !== undefined && !byId.has(b.requiresResearch)) {
      report(['buildings', b.id, 'requiresResearch'], `unknown research "${b.requiresResearch}"`);
    }
  }
  return problems;
}
