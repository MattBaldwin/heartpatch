import { z } from 'zod';
import { PlayerBattleSchema } from './battle.js';

/*
 * Friendly battles (#29): "Battle me?" between two Keepers who are both on
 * the patch right now. Nothing is at stake, so it works in every PvP mode.
 * The asker brings their picked team; so does whoever says yes.
 */

export const ChallengeKindSchema = z.enum(['friendly', 'defense']);
export type ChallengeKind = z.infer<typeof ChallengeKindSchema>;

export const ChallengeStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
]);
export type ChallengeStatus = z.infer<typeof ChallengeStatusSchema>;

/** An ask, as either of its two players sees it. */
export const ChallengeViewSchema = z.object({
  id: z.uuid(),
  kind: ChallengeKindSchema,
  status: ChallengeStatusSchema,
  fromUserId: z.uuid(),
  toUserId: z.uuid(),
  /** Each side's team, by its top level, for the card's level-gap note (`levelGapNote`). */
  fromTeamLevel: z.number().int().min(0),
  toTeamLevel: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /** The battle it started, once accepted. */
  battleId: z.uuid().nullable(),
});
export type ChallengeView = z.infer<typeof ChallengeViewSchema>;

/** A map-mate whose app is open on this patch right now ("Who's here now"). */
export const OnlineMemberSchema = z.object({
  userId: z.uuid(),
  username: z.string(),
  /** Already in a battle, so "Battle me?" would have to wait. */
  inBattle: z.boolean(),
  /** Their team's top level (the level-gap note). 0 with nobody to battle with. */
  teamLevel: z.number().int().min(0),
});
export type OnlineMember = z.infer<typeof OnlineMemberSchema>;

/**
 * `GET /api/v1/maps/:mapId/challenges`: who's here now (never you), the asks
 * waiting for you, the one you sent, and whether the owner allows them.
 */
export const ChallengesResponseSchema = z.object({
  friendlyChallenges: z.boolean(),
  online: z.array(OnlineMemberSchema),
  incoming: z.array(ChallengeViewSchema),
  outgoing: ChallengeViewSchema.nullable(),
});
export type ChallengesResponse = z.infer<typeof ChallengesResponseSchema>;

/** `POST /api/v1/maps/:mapId/challenges`: "Battle me?" to a map-mate who's here. */
export const SendChallengeRequestSchema = z.strictObject({ toUserId: z.uuid() });
export type SendChallengeRequest = z.infer<typeof SendChallengeRequestSchema>;

export const ChallengeResponseSchema = z.object({ challenge: ChallengeViewSchema });
export type ChallengeResponse = z.infer<typeof ChallengeResponseSchema>;

/** `POST /api/v1/challenges/:challengeId/answer`: "Battle!" (`yes`) or "Not now!". */
export const AnswerChallengeRequestSchema = z.strictObject({
  answer: z.enum(['yes', 'not-now']),
});
export type AnswerChallengeRequest = z.infer<typeof AnswerChallengeRequestSchema>;

/** The answer's reply: the ask, and on a yes the battle that just started. */
export const AnswerChallengeResponseSchema = z.object({
  challenge: ChallengeViewSchema,
  battle: PlayerBattleSchema.nullable(),
});
export type AnswerChallengeResponse = z.infer<typeof AnswerChallengeResponseSchema>;

export const ChallengeIdParamsSchema = z.object({ challengeId: z.uuid() });
