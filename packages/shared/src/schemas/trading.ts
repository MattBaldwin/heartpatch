import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';

/*
 * Trades and gifts at trading posts (#271; owner decisions on #30). Requests
 * name what moves; the server checks it all (CLAUDE.md rule 1), holds the
 * sender's side in escrow, and swaps in one transaction (rule 7).
 */

/** One thing on one side of an offer: a squishy, a stack of an item, or a clothing piece. */
export const TradeLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('squishy'), squishyId: z.uuid() }),
  z.strictObject({
    kind: z.literal('item'),
    itemId: ContentIdSchema,
    quantity: z.number().int().min(1).max(999),
  }),
  z.strictObject({ kind: z.literal('clothing'), clothingId: z.uuid() }),
]);
export type TradeLine = z.infer<typeof TradeLineSchema>;

export const TradeKindSchema = z.enum(['trade', 'gift']);
export type TradeKind = z.infer<typeof TradeKindSchema>;

/**
 * `POST /maps/:mapId/trades`: send a trade offer or a gift at the trading
 * post at (q, r). `give` is the sender's side (held in escrow), `want` the
 * patch-mate's (empty for a gift). `noteId` is a quick-message preset or
 * sticker id, never typed text. Send an `Idempotency-Key`.
 */
export const SendOfferRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  kind: TradeKindSchema,
  toUserId: z.uuid(),
  give: z.array(TradeLineSchema).min(1).max(20),
  want: z.array(TradeLineSchema).max(20),
  noteId: ContentIdSchema.nullable().optional(),
});
export type SendOfferRequest = z.infer<typeof SendOfferRequestSchema>;
