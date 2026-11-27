import { z } from 'zod';
import { PlayerBattleSchema } from './battle.js';
import { BossVisitEventSchema } from './boss-bar.js';
import { ContentIdSchema } from './data/common.js';
import { LocalDateSchema } from './time.js';

/**
 * Where a Keeper stands with this week's mini-boss (#190):
 * - `here`: out there and ready for a fight;
 * - `too-big`: their Partner isn't grown enough yet ("Too big for now!");
 * - `beaten`: they won, so it's done for them until its next visit;
 * - `friend`: they won and it joined them on this visit (190c).
 */
export const BossVisitStateSchema = z.enum(['here', 'too-big', 'beaten', 'friend']);
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
  /**
   * Christmas Eve (#37 C0b): set on a visit that isn't the weekly one, so
   * the card can say so. Left out on a weekly visit and by older servers.
   */
  event: BossVisitEventSchema.optional(),
});
export type BossVisit = z.infer<typeof BossVisitSchema>;

export const BossVisitResponseSchema = z.object({ boss: BossVisitSchema.nullable() });
export type BossVisitResponse = z.infer<typeof BossVisitResponseSchema>;

/**
 * `POST /api/v1/battles/:battleId/befriend` (#190 plan §3): ask a beaten boss
 * to be your friend. `ask` is the ask number (1, then 2), checked against the
 * asks made so far, so a double tap can't spend charms twice.
 */
export const BossBefriendRequestSchema = z.strictObject({
  ask: z.number().int().min(1).max(10),
});
export type BossBefriendRequest = z.infer<typeof BossBefriendRequestSchema>;

/**
 * The ask's answer, and the battle with its `boss` view after it. `squishyId`
 * is the friend who joined (on `joined`). A repeated ask gets the stored answer.
 */
export const BossBefriendResponseSchema = z.object({
  outcome: z.enum(['joined', 'not-yet']),
  squishyId: z.uuid().nullable(),
  battle: PlayerBattleSchema,
});
export type BossBefriendResponse = z.infer<typeof BossBefriendResponseSchema>;
