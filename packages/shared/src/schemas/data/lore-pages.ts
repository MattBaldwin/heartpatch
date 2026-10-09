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
   * Who finds it: the event's actor, the player the event is about (its
   * payload's `userId`, for system events on patches like a squishy taken to
   * the Hollow, #307), or the Glade's player (for system events there, like
   * nightfall). An event with no finder finds nothing.
   */
  finder: z.enum(['actor', 'payload-user', 'tutorial-player']),
});
export type LoreTrigger = z.infer<typeof LoreTriggerSchema>;

/** A chapter of the Lorebook (#307). Its title is shown even before any of its pages are found. */
export const LoreChapterSchema = z.strictObject({
  id: ContentIdSchema,
  title: DisplayNameSchema,
  /** Where it comes in the book, from 1. */
  order: z.number().int().min(1),
});
export type LoreChapter = z.infer<typeof LoreChapterSchema>;

export const LoreEntrySchema = z.strictObject({
  /** Stored in `lore_found`, so never rename one. */
  id: ContentIdSchema,
  /** Its chapter (`LORE_CHAPTERS`) and place in it, from 1 (#307). */
  chapter: ContentIdSchema,
  order: z.number().int().min(1),
  title: DisplayNameSchema,
  text: z.string().trim().min(1).max(400),
  /**
   * What a blank page says before it's found (#307): a gentle nudge that
   * never gives the trigger away. The only words of an unfound page that
   * leave the server.
   */
  hint: z.string().trim().min(1).max(80),
  trigger: LoreTriggerSchema,
});
export type LoreEntry = z.infer<typeof LoreEntrySchema>;

/** Validates the lore pages and their chapters, and returns readable problems, or `[]`. */
export function checkLoreData(input: unknown, chapters: unknown): string[] {
  const chapterProblems = checkLoreChapters(chapters);
  if (chapterProblems.length > 0) return chapterProblems;
  const chapterIds = new Set(
    z
      .array(LoreChapterSchema)
      .parse(chapters)
      .map((c) => c.id),
  );
  const schema = z.array(LoreEntrySchema).superRefine((entries, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const seen = new Set<string>();
    const places = new Set<string>();
    entries.forEach((entry, i) => {
      if (seen.has(entry.id)) report([i, 'id'], `"${entry.id}" is listed twice`);
      seen.add(entry.id);
      if (!chapterIds.has(entry.chapter)) {
        report([i, 'chapter'], `no chapter "${entry.chapter}"`);
      }
      const place = `${entry.chapter}#${String(entry.order)}`;
      if (places.has(place)) {
        report([i, 'order'], `"${entry.chapter}" already has a page ${String(entry.order)}`);
      }
      places.add(place);
      const { eventType, where, finder, mapKinds } = entry.trigger;
      const shape = GAME_EVENTS[eventType].internal;
      where.forEach((predicate, j) => {
        const top = predicate.field.split('.')[0] ?? '';
        if (!(shape instanceof z.ZodObject) || !(top in shape.shape)) {
          report([i, 'trigger', 'where', j, 'field'], `"${eventType}" has no "${top}"`);
        }
      });
      if (finder === 'payload-user' && !(shape instanceof z.ZodObject && 'userId' in shape.shape)) {
        report([i, 'trigger', 'finder'], `"${eventType}" has no "userId" to find it`);
      }
      if (finder === 'tutorial-player' && mapKinds.some((k) => k !== 'tutorial')) {
        report([i, 'trigger', 'finder'], 'only a tutorial map has one player to find it');
      }
    });
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}

/** Validates the chapters: unique ids and places. */
function checkLoreChapters(input: unknown): string[] {
  const schema = z.array(LoreChapterSchema).superRefine((chapters, ctx) => {
    const ids = new Set<string>();
    const orders = new Set<number>();
    chapters.forEach((chapter, i) => {
      if (ids.has(chapter.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'id'],
          message: `"${chapter.id}" is listed twice`,
        });
      }
      if (orders.has(chapter.order)) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'order'],
          message: `two chapters are number ${String(chapter.order)}`,
        });
      }
      ids.add(chapter.id);
      orders.add(chapter.order);
    });
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}
