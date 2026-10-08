import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import type { ExploreRules } from './explore.js';
import type { GameData } from './game-data.js';
import { formatDataIssues } from './issues.js';

/**
 * What exploring finds (#199): one weighted table per search-spot kind, and
 * optionally a terrain's own table for a kind. Secret (CLAUDE.md rule 6): the
 * tables live in `data/server/explore-finds.ts`, and this schema and its
 * check are exported only from `@heartpatch/shared/server`. Finds stay small
 * next to a gather, so gathering stays the main source (#199).
 */
export const ExploreFindSchema = z
  .strictObject({
    weight: z.number().int().positive(),
    /** Items found. Neither items nor a page: a happy nothing ("Just a wiggly worm!"). */
    items: z.record(ContentIdSchema, z.number().int().min(1).max(10)).optional(),
    /** A lore page (server-only `LORE_PAGES` id). Skipped once the player has it. */
    lore: ContentIdSchema.optional(),
  })
  .refine((f) => !(f.items && f.lore), { message: 'a find is items or a lore page, not both' });
export type ExploreFind = z.infer<typeof ExploreFindSchema>;

export const ExploreFindTableSchema = z.strictObject({
  /** The search-spot kind (`EXPLORE_RULES.spotKinds`). */
  kind: ContentIdSchema,
  /** Only on these terrains; the kind's general table is the one without. */
  terrains: z.array(ContentIdSchema).min(1).optional(),
  finds: z.array(ExploreFindSchema).min(1),
});
export type ExploreFindTable = z.infer<typeof ExploreFindTableSchema>;

/**
 * Validates the find tables against the public data and the lore pages:
 * one general table for every spot kind, known terrains, gathered or made
 * items only (no seasonal ones, no tools), and real lore pages.
 */
export function checkExploreFinds(
  input: unknown,
  data: Pick<GameData, 'resources' | 'terrains'>,
  rules: Pick<ExploreRules, 'spotKinds'>,
  lorePages: readonly string[],
): string[] {
  const result = z.array(ExploreFindTableSchema).safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const problems: string[] = [];
  const resources = new Map(data.resources.map((r) => [r.id, r]));
  const terrains = new Set(data.terrains.map((t) => t.id));
  const kinds = new Set(rules.spotKinds.map((k) => k.id));
  const pages = new Set(lorePages);
  const general = new Set<string>();
  const seen = new Set<string>();
  result.data.forEach((table, i) => {
    const at = `finds[${String(i)}]`;
    if (!kinds.has(table.kind)) problems.push(`${at}: unknown spot kind "${table.kind}"`);
    for (const t of table.terrains ?? ['*']) {
      const key = `${table.kind}@${t}`;
      if (seen.has(key)) problems.push(`${at}: ${table.kind} has two tables for ${t}`);
      seen.add(key);
      if (t !== '*' && !terrains.has(t)) problems.push(`${at}: unknown terrain "${t}"`);
    }
    if (!table.terrains) general.add(table.kind);
    table.finds.forEach((find, j) => {
      for (const id of Object.keys(find.items ?? {})) {
        const item = resources.get(id);
        if (!item) problems.push(`${at}.finds[${String(j)}]: unknown item "${id}"`);
        else if (item.kind === 'seasonal' || item.tool) {
          problems.push(`${at}.finds[${String(j)}]: "${id}" can't be found exploring`);
        }
      }
      if (find.lore !== undefined && !pages.has(find.lore)) {
        problems.push(`${at}.finds[${String(j)}]: unknown lore page "${find.lore}"`);
      }
    });
  });
  for (const kind of kinds) {
    if (!general.has(kind)) problems.push(`spot kind "${kind}" has no find table`);
  }
  return problems;
}
