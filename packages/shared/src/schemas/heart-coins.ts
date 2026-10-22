import { z } from 'zod';

// Heart Coins API (#601): one balance per player per patch, earned by
// playing there and spent only there. The server pays and caps everything
// (CLAUDE.md rule 1); the client only shows it.

const amount = z.number().int().min(0);

/** Today's earnings (or caps) by capped source. */
export const HeartCoinsBySourceSchema = z.object({
  battle: amount,
  capture: amount,
  care: amount,
  sell: amount,
});
export type HeartCoinsBySource = z.infer<typeof HeartCoinsBySourceSchema>;

/** `GET /api/v1/maps/:mapId/heart-coins`: my Heart Coins on this patch. */
export const HeartCoinsSchema = z.object({
  balance: amount,
  /** What I've earned from each source this patch day. */
  today: HeartCoinsBySourceSchema,
  /** The most each source pays a patch day (`HEART_COIN_RULES.dailyCaps`). */
  caps: HeartCoinsBySourceSchema,
  /** When today's earnings start again: the patch's next local midnight. */
  resetsAt: z.iso.datetime(),
});
export type HeartCoins = z.infer<typeof HeartCoinsSchema>;

export const HeartCoinsResponseSchema = z.object({ heartCoins: HeartCoinsSchema });
export type HeartCoinsResponse = z.infer<typeof HeartCoinsResponseSchema>;

/** `POST /api/v1/maps/:mapId/dev/heart-coins` (dev/test only): hands me Heart Coins on this patch. */
export const DevGrantHeartCoinsRequestSchema = z.strictObject({
  amount: z.number().int().min(1).max(10_000),
});
export type DevGrantHeartCoinsRequest = z.infer<typeof DevGrantHeartCoinsRequestSchema>;
