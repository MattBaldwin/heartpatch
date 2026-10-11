import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { BattleEndReasonSchema, PlayerBattleSchema } from './battle.js';
import { ContentIdSchema } from './data/common.js';
import { DefenseStanceSchema } from './data/raids.js';
import { ItemCountsSchema } from './inventory.js';

// Offline defense and the raid log (design doc §3, §6, §11; issue #16). A
// rival tile's defenders are always played by the server's AI following the
// owner's defense stance, so the defender never has to be online. Every
// finished challenge on their land lands in their raid log, which they see
// the next time they open the map ("morning report", style guide §6).

/**
 * How a challenge ended, from the defender's side.
 *
 * - `held`: their side won, or the challenger scooted home (left).
 * - `tie`: nobody won.
 * - `lost`: the challenger won the showdown, but the land didn't change hands
 *   (it had already moved on while the battle ran).
 * - `taken`: the challenger won and the land is theirs now.
 * - `no-contest`: the server called it off (content re-tuned mid-battle).
 */
export const RaidOutcomeSchema = z.enum(['held', 'tie', 'lost', 'taken', 'no-contest']);
export type RaidOutcome = z.infer<typeof RaidOutcomeSchema>;

/** One challenge on my land, as the raid log shows it. */
export const RaidSchema = z.object({
  id: z.uuid(),
  /** The battle, for the replay. */
  battleId: z.uuid(),
  attackerUserId: z.uuid(),
  /** The challenger's username (every member of the map sees it already). */
  attackerName: z.string(),
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  outcome: RaidOutcomeSchema,
  /** Why the battle ended (`forfeit`: the challenger scooted home). */
  reason: z.union([BattleEndReasonSchema, z.literal('no-contest')]),
  /**
   * The style my squishies on watch played with; null when the land's
   * guardians stood in, or when I defended live.
   */
  stance: DefenseStanceSchema.nullable(),
  /**
   * I said "Defend now?" yes and played it myself (#29-C). Optional only so
   * older fixtures parse.
   */
  live: z.boolean().optional(),
  resolvedAt: z.iso.datetime(),
  /** When I saw it in the report; null while it's new. */
  seenAt: z.iso.datetime().nullable(),
  /** False when there's nothing to watch (called off, or from before a re-tune). */
  replayable: z.boolean(),
  /** My fire on that land came down when it was taken (#202): what came back. Null: no fire. */
  lostFire: ItemCountsSchema.nullable(),
  /**
   * A fence battle (#203): which of my fences, whether it was broken, and
   * how much energy it has left in whole percent (0 when broken). Null: the
   * guard battle. Optional only so older fixtures parse.
   */
  fence: z
    .object({
      buildingId: ContentIdSchema,
      broken: z.boolean(),
      percent: z.number().int().min(0).max(100),
    })
    .nullable()
    .optional(),
  /**
   * My fence segments there were destroyed when it was taken (#203, owner
   * decision 2026-10-07: nothing comes back): how many. Null: none.
   */
  lostFences: z.number().int().min(1).nullable().optional(),
});
export type Raid = z.infer<typeof RaidSchema>;

/** `GET /maps/:mapId/raids`: my defense style and the latest challenges on my land. */
export const RaidReportSchema = z.object({
  stance: DefenseStanceSchema,
  /** How many of `raids` I haven't seen yet. */
  unseen: z.number().int().min(0),
  /** Newest first, at most `RAID_RULES.reportLimit`. */
  raids: z.array(RaidSchema),
});
export type RaidReport = z.infer<typeof RaidReportSchema>;

export const RaidReportResponseSchema = z.object({ report: RaidReportSchema });
export type RaidReportResponse = z.infer<typeof RaidReportResponseSchema>;

/** `POST /maps/:mapId/defense-style`: how my squishies on watch play from now on. */
export const SetDefenseStyleRequestSchema = z.strictObject({ stance: DefenseStanceSchema });
export type SetDefenseStyleRequest = z.infer<typeof SetDefenseStyleRequestSchema>;

/** `POST /maps/:mapId/raids/seen`: I've read these in the report. */
export const MarkRaidsSeenRequestSchema = z.strictObject({
  raidIds: z.array(z.uuid()).min(1).max(50),
});
export type MarkRaidsSeenRequest = z.infer<typeof MarkRaidsSeenRequestSchema>;

export const RaidParamsSchema = z.object({ mapId: z.uuid(), raidId: z.uuid() });

/**
 * `GET /maps/:mapId/raids/:raidId/replay`: the showdown from my side (`b`),
 * as the battle screen plays it: `start` is the first turn, `end` the
 * finished battle whose log the screen plays back.
 */
export const RaidReplaySchema = z.object({ start: PlayerBattleSchema, end: PlayerBattleSchema });
export type RaidReplay = z.infer<typeof RaidReplaySchema>;

export const RaidReplayResponseSchema = z.object({ replay: RaidReplaySchema });
export type RaidReplayResponse = z.infer<typeof RaidReplayResponseSchema>;
