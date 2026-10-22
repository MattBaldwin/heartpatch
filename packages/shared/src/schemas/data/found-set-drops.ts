import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import type { FoundSet } from './found-sets.js';
import { checkRef, formatDataIssues, type Report } from './issues.js';

/*
 * Where a found set drops (#306 PR 5): one weighted table per place that
 * gives it. Secret (CLAUDE.md rule 6): the tables live in
 * `data/server/hollowed-finds.ts`, and this schema and its check are
 * exported only from `@heartpatch/shared/server`.
 */

/**
 * The places that roll a found set: a search on a grey village tile (#306
 * 2a), a solved memory puzzle (2b), a search in a hidden cellar (2c) and
 * the far Hollow (PR 6). Each caller names its place, so its odds are data.
 */
export const FoundSetPlaceSchema = z.enum(['village', 'puzzle', 'cellar', 'far-hollow']);
export type FoundSetPlace = z.infer<typeof FoundSetPlaceSchema>;

/** One outcome: a piece of the set, or some of its finds. */
export const FoundSetDropEntrySchema = z
  .strictObject({
    weight: z.number().int().positive(),
    /** A piece of the set. One the player already has finds nothing (a piece is found once). */
    clothing: ContentIdSchema.optional(),
    /** Some of the set's own finds (`FoundSet.finds`). */
    items: z.record(ContentIdSchema, z.number().int().min(1).max(10)).optional(),
  })
  .refine((e) => (e.clothing === undefined) !== (e.items === undefined), {
    message: 'an entry is a piece or some finds, not both or neither',
  });
export type FoundSetDropEntry = z.infer<typeof FoundSetDropEntrySchema>;

export const FoundSetDropTableSchema = z.strictObject({
  /** The set (`FOUND_SETS` id). */
  set: ContentIdSchema,
  place: FoundSetPlaceSchema,
  /** Percent chance that one roll finds anything of the set at all. */
  chance: z.number().int().min(0).max(100),
  entries: z.array(FoundSetDropEntrySchema).min(1),
});
export type FoundSetDropTable = z.infer<typeof FoundSetDropTableSchema>;

/**
 * Validates the drop tables against the sets: one table per set and place,
 * entries from that set only, no piece twice in a table, every piece and
 * every find in some table.
 */
export function checkFoundSetDrops(input: unknown, sets: readonly FoundSet[]): string[] {
  const byId = new Map(sets.map((s) => [s.id, s]));
  const schema = z.array(FoundSetDropTableSchema).superRefine((tables, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const seen = new Set<string>();
    const dropped = new Set<string>();
    tables.forEach((table, i) => {
      checkRef(new Set(byId.keys()), 'set', table.set, ['drops', i, 'set'], report);
      const key = `${table.set}@${table.place}`;
      if (seen.has(key))
        report(['drops', i, 'place'], `${table.set} has two ${table.place} tables`);
      seen.add(key);
      const set = byId.get(table.set);
      if (!set) return;
      const pieces = new Set(set.pieces);
      const finds = new Set(set.finds);
      const listed = new Set<string>();
      table.entries.forEach((entry, j) => {
        const at = ['drops', i, 'entries', j];
        if (entry.clothing !== undefined) {
          if (!pieces.has(entry.clothing)) {
            report([...at, 'clothing'], `"${entry.clothing}" isn't a ${set.name} piece`);
          }
          if (listed.has(entry.clothing)) {
            report([...at, 'clothing'], `"${entry.clothing}" is listed twice`);
          }
          listed.add(entry.clothing);
          dropped.add(entry.clothing);
        }
        for (const id of Object.keys(entry.items ?? {})) {
          if (!finds.has(id)) report([...at, 'items'], `"${id}" isn't a ${set.name} find`);
          dropped.add(id);
        }
      });
    });
    for (const set of sets) {
      for (const id of [...set.pieces, ...set.finds]) {
        if (!dropped.has(id)) report(['drops'], `${set.id}'s "${id}" is in no drop table`);
      }
    }
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues({ drops: input }, result.error);
}
