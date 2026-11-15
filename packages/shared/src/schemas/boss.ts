import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { LocalDateSchema } from './time.js';

/**
 * Where a Keeper stands with this week's mini-boss (#190):
 * - `here`: out there and ready for a fight;
 * - `too-big`: their Partner isn't grown enough yet ("Too big for now!");
 * - `beaten`: they won, so it's done for them until its next visit.
 * (`friend` comes with befriending, 190c.)
 */
export const BossVisitStateSchema = z.enum(['here', 'too-big', 'beaten']);
export type BossVisitState = z.infer<typeof BossVisitStateSchema>;

/**
 * `GET /api/v1/maps/:mapId/boss`: the patch's mini-boss visit now, or null
 * (#190 plan §2). Never the schedule, the bag, the next boss, odds or the
 * unlock levels (CLAUDE.md rule 6). `species` is null until this Keeper has
 * met it: the marker shows a "?!" until then.
 */
export const BossVisitSchema = z.object({
  window: z.object({ id: LocalDateSchema, endsAt: z.iso.datetime() }),
  tile: z.object({ q: z.number().int(), r: z.number().int() }),
  species: ContentIdSchema.nullable(),
  state: BossVisitStateSchema,
  triesLeftToday: z.number().int().min(0),
});
export type BossVisit = z.infer<typeof BossVisitSchema>;

export const BossVisitResponseSchema = z.object({ boss: BossVisitSchema.nullable() });
export type BossVisitResponse = z.infer<typeof BossVisitResponseSchema>;
