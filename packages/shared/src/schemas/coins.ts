import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { LocalDateSchema } from './time.js';
import { WardrobeSchema } from './wardrobe.js';

// Patch Coins and the Boutique API (design doc §23; issue #45). Coins are the
// account's (DECISIONS F), earned in play and never bought (CLAUDE.md rule
// 9). The server prices everything and checks every purchase (rule 1).

/** `GET /api/v1/coins`: the account's Patch Coins. */
export const CoinsSchema = z.object({ balance: z.number().int().min(0) });
export type Coins = z.infer<typeof CoinsSchema>;

export const CoinsResponseSchema = z.object({ coins: CoinsSchema });
export type CoinsResponse = z.infer<typeof CoinsResponseSchema>;

/** One piece on a rack: its price (from data) and whether the player has one already. */
export const BoutiqueItemSchema = z.object({
  itemId: ContentIdSchema,
  price: z.number().int().positive(),
  owned: z.boolean(),
});
export type BoutiqueItem = z.infer<typeof BoutiqueItemSchema>;

/** `GET /api/v1/boutique` and the purchase reply: today's racks and the player's coins. */
export const BoutiqueSchema = z.object({
  /** The account's local date the racks are for. */
  date: LocalDateSchema,
  /** When they change next: the account's next local midnight. */
  restocksAt: z.iso.datetime(),
  daily: z.array(BoutiqueItemSchema),
  /** One rack per season that's on (Halloween only in its window). */
  seasonal: z.array(z.object({ seasonId: ContentIdSchema, items: z.array(BoutiqueItemSchema) })),
  coins: CoinsSchema,
});
export type Boutique = z.infer<typeof BoutiqueSchema>;

export const BoutiqueResponseSchema = z.object({ boutique: BoutiqueSchema });
export type BoutiqueResponse = z.infer<typeof BoutiqueResponseSchema>;

/** `POST /api/v1/boutique/buy`: send an `Idempotency-Key`, so a retry never buys twice. */
export const BuyClothingRequestSchema = z.strictObject({ itemId: ContentIdSchema });
export type BuyClothingRequest = z.infer<typeof BuyClothingRequestSchema>;

/** A purchase's reply: the racks (now "owned") and the wardrobe with the new piece. */
export const BuyClothingResponseSchema = z.object({
  boutique: BoutiqueSchema,
  wardrobe: WardrobeSchema,
});
export type BuyClothingResponse = z.infer<typeof BuyClothingResponseSchema>;

/** `POST /api/v1/dev/coins` (dev/test only): hands the player coins to try the Boutique. */
export const DevGrantCoinsRequestSchema = z.strictObject({
  amount: z.number().int().min(1).max(10_000),
});
export type DevGrantCoinsRequest = z.infer<typeof DevGrantCoinsRequestSchema>;
