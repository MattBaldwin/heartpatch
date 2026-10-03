import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import { ClothingDropSourceSchema, type ClothingItem } from './clothing.js';
import { checkRef, formatDataIssues, type Report } from './issues.js';

/**
 * Found clothing (design doc §23 "Getting clothing"): a small chance of an
 * item when a player gathers, captures a tile or rescues a squishy from the
 * Hollow. The schema is public; the tables are secret and live in
 * `data/server/clothing-drops.ts` (CLAUDE.md rule 6), so players can't read
 * the odds or which terrain hides what.
 */
export const ClothingDropEntrySchema = z.strictObject({
  item: ContentIdSchema,
  weight: z.number().int().positive(),
  /** Only drops on these terrains (ids from the terrain table); anywhere if left out. */
  terrains: z.array(ContentIdSchema).min(1).optional(),
});
export type ClothingDropEntry = z.infer<typeof ClothingDropEntrySchema>;

/**
 * One table per source. A seasonal item (its catalog `season`) only drops
 * while that season is on (design doc §15).
 */
export const ClothingDropTableSchema = z.strictObject({
  source: ClothingDropSourceSchema,
  /** Percent chance that one of these events finds anything at all. */
  chance: z.number().int().min(0).max(100),
  entries: z.array(ClothingDropEntrySchema).min(1),
});
export type ClothingDropTable = z.infer<typeof ClothingDropTableSchema>;

/**
 * Validates the drop tables against the catalog and terrains: one table per
 * source, known `found` items only, no item twice in a table, and every
 * `found` item in some table (or it could never be got).
 */
export function checkClothingDrops(
  input: unknown,
  catalog: readonly ClothingItem[],
  terrains: readonly string[],
): string[] {
  const items = new Map(catalog.map((item) => [item.id, item]));
  const knownTerrains = new Set(terrains);
  const schema = z.array(ClothingDropTableSchema).superRefine((tables, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const sources = new Set<string>();
    const dropped = new Set<string>();
    tables.forEach((table, i) => {
      if (sources.has(table.source)) report(['drops', i, 'source'], 'one table per source');
      sources.add(table.source);
      const seen = new Set<string>();
      table.entries.forEach((entry, j) => {
        const path = ['drops', i, 'entries', j];
        const item = items.get(entry.item);
        if (!item) report([...path, 'item'], `unknown clothing "${entry.item}"`);
        else if (!item.sources.includes('found')) {
          report([...path, 'item'], `"${entry.item}" isn't a found item`);
        }
        if (seen.has(entry.item)) report([...path, 'item'], `"${entry.item}" is listed twice`);
        seen.add(entry.item);
        dropped.add(entry.item);
        entry.terrains?.forEach((terrain, k) => {
          checkRef(knownTerrains, 'terrain', terrain, [...path, 'terrains', k], report);
        });
      });
    });
    for (const item of catalog) {
      if (item.sources.includes('found') && !dropped.has(item.id)) {
        report(['drops'], `found item "${item.id}" is in no drop table`);
      }
    }
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues({ drops: input }, result.error);
}
