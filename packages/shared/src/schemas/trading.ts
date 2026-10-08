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

export const TradeStatusSchema = z.enum([
  'open',
  'accepted',
  'declined',
  'cancelled',
  'expired',
  'taken_back',
]);
export type TradeStatus = z.infer<typeof TradeStatusSchema>;

/**
 * One line as the two players see it: the line, plus what to draw. A squishy
 * shows its species and level; a secret species the viewer hasn't met is
 * `speciesId: null` ("Mystery squishy", CLAUDE.md rule 6). A clothing piece
 * shows its catalog item.
 */
export const TradeLineViewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('squishy'),
    squishyId: z.uuid(),
    speciesId: ContentIdSchema.nullable(),
    level: z.number().int().min(1),
    nickname: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('item'),
    itemId: ContentIdSchema,
    quantity: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('clothing'), clothingId: z.uuid(), itemId: ContentIdSchema }),
]);
export type TradeLineView = z.infer<typeof TradeLineViewSchema>;

/** An open offer to or from me (#271). */
export const TradeOfferViewSchema = z.object({
  id: z.uuid(),
  kind: TradeKindSchema,
  fromUserId: z.uuid(),
  toUserId: z.uuid(),
  status: TradeStatusSchema,
  noteId: ContentIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  give: z.array(TradeLineViewSchema),
  want: z.array(TradeLineViewSchema),
});
export type TradeOfferView = z.infer<typeof TradeOfferViewSchema>;

/**
 * Something in my mailbox (#271): a finished trade's side or a gift waiting
 * for me (pick it up at any post I can visit), or a note that something
 * came back to me (`return`: already in my bag or wardrobe).
 */
export const MailboxEntrySchema = z.object({
  id: z.uuid(),
  offerId: z.uuid(),
  kind: z.enum(['trade', 'gift', 'return']),
  /** Who it's from: the patch-mate, or me for a return. */
  fromUserId: z.uuid(),
  lines: z.array(TradeLineViewSchema),
  readyAt: z.iso.datetime(),
  pickedUpAt: z.iso.datetime().nullable(),
});
export type MailboxEntry = z.infer<typeof MailboxEntrySchema>;

/** `GET /maps/:mapId/trades`: my open offers, my mailbox, recent returns, and the rules. */
export const TradesViewSchema = z.object({
  tradingEnabled: z.boolean(),
  offers: z.array(TradeOfferViewSchema),
  mailbox: z.array(MailboxEntrySchema),
  /** Things that came back lately (newest first, a few). */
  returns: z.array(MailboxEntrySchema),
  now: z.iso.datetime(),
});
export type TradesView = z.infer<typeof TradesViewSchema>;

export const TradesResponseSchema = z.object({ trades: TradesViewSchema });
export type TradesResponse = z.infer<typeof TradesResponseSchema>;

/** `POST /maps/:mapId/trades/:offerId/accept`: say yes at the post at (q, r). */
export const PostAtRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
});
export type PostAtRequest = z.infer<typeof PostAtRequestSchema>;

/** `POST /maps/:mapId/mailbox/pickup`: pick up at the post at (q, r); every waiting entry, or `ids`. */
export const PickupRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  ids: z.array(z.uuid()).min(1).max(50).optional(),
});
export type PickupRequest = z.infer<typeof PickupRequestSchema>;

export const OfferParamsSchema = z.object({ mapId: z.uuid(), offerId: z.uuid() });

export const ShelfParamsSchema = z.object({ mapId: z.uuid(), userId: z.uuid() });

/**
 * `GET /maps/:mapId/trades/shelf/:userId`: what a patch-mate (or I) could
 * trade right now, to build an offer from (#271). Only trade-ready things:
 * resting squishies (not the patch starter, nothing busy, Hollowed or in a
 * trade; a secret species the viewer hasn't met is `speciesId: null`),
 * tradable items in the bag, and tradable clothing pieces not held by an
 * offer. The server checks it all again on send.
 */
export const TradeShelfSchema = z.object({
  userId: z.uuid(),
  squishies: z.array(TradeLineViewSchema.options[0]),
  items: z.array(TradeLineViewSchema.options[1]),
  clothing: z.array(TradeLineViewSchema.options[2]),
});
export type TradeShelf = z.infer<typeof TradeShelfSchema>;

export const TradeShelfResponseSchema = z.object({ shelf: TradeShelfSchema });
export type TradeShelfResponse = z.infer<typeof TradeShelfResponseSchema>;
