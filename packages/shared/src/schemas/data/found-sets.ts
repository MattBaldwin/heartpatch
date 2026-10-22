import { z } from 'zod';
import type { ClothingItem } from './clothing.js';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './common.js';
import { checkRef, checkUniqueIds, formatDataIssues, type Report } from './issues.js';
import { MilestoneTitleSchema } from './milestones.js';
import type { Resource } from './resources.js';

/*
 * Found sets (#306 PR 5): a group of found-only clothing pieces that some
 * places give, and the title for finding every piece. The Rekindled set is
 * the first; a later season adds a row (and its server-only drop tables),
 * not engine code (CLAUDE.md rule 5). Public: the pieces, the title and what
 * the set is called; where and how often they drop is server-only
 * (`schemas/data/found-set-drops.ts`, CLAUDE.md rule 6).
 */

export const FoundSetSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  /** Where it's found, in a kid's words, for the Milestones goal ("in the Hollows"). */
  where: DescriptionSchema,
  /** The clothing pieces, in catalog order. `found`, never traded, in no other drop table. */
  pieces: z.array(ContentIdSchema).min(2).max(12),
  /**
   * The set's own finds: resources only its places give (a recipe page's
   * sealed ingredient). Never gathered, never traded, so the page they open
   * is only ever opened by finding one.
   */
  finds: z.array(ContentIdSchema),
  /** Worn on the profile card once every piece has been found (a milestone track). */
  title: MilestoneTitleSchema,
  /** Patch Coins with the title (#45). */
  coins: z.number().int().min(0),
});
export type FoundSet = z.infer<typeof FoundSetSchema>;

/**
 * Validates the found sets against the catalog and the resources, and
 * returns readable problems, or `[]`: unique ids, real `found` pieces that
 * stay with the account and belong to one set, and finds that are only ever
 * found.
 */
export function checkFoundSets(
  input: unknown,
  data: {
    clothing: readonly Pick<ClothingItem, 'id' | 'sources' | 'tradable' | 'season'>[];
    resources: readonly Pick<Resource, 'id' | 'kind' | 'gather' | 'tradable'>[];
  },
): string[] {
  const clothing = new Map(data.clothing.map((c) => [c.id, c]));
  const resources = new Map(data.resources.map((r) => [r.id, r]));
  const schema = z.array(FoundSetSchema).superRefine((sets, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    checkUniqueIds('sets', sets, report);
    const inSet = new Set<string>();
    const finds = new Set<string>();
    sets.forEach((set, i) => {
      set.pieces.forEach((id, j) => {
        const at = ['sets', i, 'pieces', j];
        checkRef(new Set(clothing.keys()), 'clothing', id, at, report);
        const item = clothing.get(id);
        if (item && (!item.sources.includes('found') || item.sources.length > 1)) {
          report(at, `"${id}" must be found only`);
        }
        if (item?.tradable) report(at, `"${id}" stays with whoever found it: not tradable`);
        if (item?.season !== undefined) report(at, `"${id}" is found all year: no season`);
        if (inSet.has(id)) report(at, `"${id}" is in two sets`);
        inSet.add(id);
      });
      set.finds.forEach((id, j) => {
        const at = ['sets', i, 'finds', j];
        checkRef(new Set(resources.keys()), 'resource', id, at, report);
        const r = resources.get(id);
        if (r && (r.kind !== 'gathered' || r.gather !== undefined || r.tradable !== false)) {
          report(at, `"${id}" is only ever found: gathered kind, no gather, not tradable`);
        }
        if (finds.has(id)) report(at, `"${id}" is in two sets`);
        finds.add(id);
      });
    });
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues({ sets: input }, result.error);
}
