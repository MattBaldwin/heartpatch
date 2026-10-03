import { z } from 'zod';
import { GAME_EVENTS, GameEventTypeSchema } from '../events.js';
import { ContentIdSchema, DisplayNameSchema } from './common.js';
import { formatDataIssues, type Report } from './issues.js';
import { TutorialPredicateSchema } from './tutorial.js';

/*
 * Lore pages and what finds them (design doc §16: `{ id, conditions, reward }`
 * triggers, evaluated on the server). Secret (CLAUDE.md rule 6): the pages
 * live in `data/server/`, so neither a page's words nor how to find it reach
 * the client before the player does. Conditions reuse the tutorial's
 * declarative payload predicates.
 */

export const LoreTriggerSchema = z.strictObject({
  /** Maps the page can be found on (the Glade's page is `tutorial`). */
  mapKinds: z.array(z.enum(['multiplayer', 'tutorial'])).min(1),
  eventType: GameEventTypeSchema,
  /** Every predicate must hold on the event's internal payload. */
  where: z.array(TutorialPredicateSchema),
  /**
   * Who finds it: the event's actor, or the Glade's player (for system events
   * there, like nightfall). An event with no finder finds nothing.
   */
  finder: z.enum(['actor', 'tutorial-player']),
});
export type LoreTrigger = z.infer<typeof LoreTriggerSchema>;

export const LoreEntrySchema = z.strictObject({
  /** Stored in `lore_found`, so never rename one. */
  id: ContentIdSchema,
  title: DisplayNameSchema,
  text: z.string().trim().min(1).max(400),
  trigger: LoreTriggerSchema,
});
export type LoreEntry = z.infer<typeof LoreEntrySchema>;

/** Validates the lore pages and returns readable problems, or `[]`. */
export function checkLoreData(input: unknown): string[] {
  const schema = z.array(LoreEntrySchema).superRefine((entries, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      if (seen.has(entry.id)) report([i, 'id'], `"${entry.id}" is listed twice`);
      seen.add(entry.id);
      const { eventType, where, finder, mapKinds } = entry.trigger;
      const shape = GAME_EVENTS[eventType].internal;
      where.forEach((predicate, j) => {
        const top = predicate.field.split('.')[0] ?? '';
        if (!(shape instanceof z.ZodObject) || !(top in shape.shape)) {
          report([i, 'trigger', 'where', j, 'field'], `"${eventType}" has no "${top}"`);
        }
      });
      if (finder === 'tutorial-player' && mapKinds.some((k) => k !== 'tutorial')) {
        report([i, 'trigger', 'finder'], 'only a tutorial map has one player to find it');
      }
    });
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
