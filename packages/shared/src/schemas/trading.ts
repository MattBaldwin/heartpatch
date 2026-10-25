import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';
import { ItemCountsSchema } from './inventory.js';

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

/**
 * `GET /maps/:mapId/glimmer-swap` (#523): how much Glimmer I've swapped on my
 * own day, when that day ends, and how many of each accepted resource (and
 * Glimmer) are in my bag on this patch. The rate and cap are shared data
 * (`GLIMMER_SWAP`).
 */
export const GlimmerSwapViewSchema = z.object({
  swappedToday: z.number().int().min(0),
  resetsAt: z.iso.datetime(),
  have: ItemCountsSchema,
});
export type GlimmerSwapView = z.infer<typeof GlimmerSwapViewSchema>;

export const GlimmerSwapResponseSchema = z.object({ swap: GlimmerSwapViewSchema });
export type GlimmerSwapResponse = z.infer<typeof GlimmerSwapResponseSchema>;

/** `POST /maps/:mapId/glimmer-swap`: one swap of `itemId` at the post at (q, r). */
export const GlimmerSwapRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  itemId: ContentIdSchema,
});
export type GlimmerSwapRequest = z.infer<typeof GlimmerSwapRequestSchema>;

/**
 * `GET /maps/:mapId/posts/sell` (#601 PR 3): what I could sell at a post on
 * this patch. My Heart Coins there and how many I've earned selling today
 * (the patch's day, `cap` from `HEART_COIN_RULES.dailyCaps.sell`); the items
 * in my bag the post buys, each with how many it leaves behind for a recipe;
 * and my clothing with more than one free copy. Prices are shared data
 * (`SELL_RULES`).
 */
export const SellViewSchema = z.object({
  balance: z.number().int().min(0),
  soldToday: z.number().int().min(0),
  cap: z.number().int().min(1),
  resetsAt: z.iso.datetime(),
  /** In `SELL_RULES.items` order. `keep` is what a sale leaves (`recipeKeep`). */
  items: z.array(
    z.object({
      itemId: ContentIdSchema,
      have: z.number().int().min(1),
      keep: z.number().int().min(0),
    }),
  ),
  /** Sellable pieces I have spares of, by item id. `copies` counts free ones (not in an offer). */
  clothing: z.array(z.object({ itemId: ContentIdSchema, copies: z.number().int().min(2) })),
});
export type SellView = z.infer<typeof SellViewSchema>;

export const SellViewResponseSchema = z.object({ sell: SellViewSchema });
export type SellViewResponse = z.infer<typeof SellViewResponseSchema>;

/**
 * `POST /maps/:mapId/posts/sell` at the post at (q, r): `lots` lots of an
 * item from my bag, or one spare piece of a clothing item (never the last
 * copy). The client confirms first; there's no undo. Send an `Idempotency-Key`.
 */
export const SellRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('item'),
    q: HexSchema.shape.q,
    r: HexSchema.shape.r,
    itemId: ContentIdSchema,
    lots: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal('clothing'),
    q: HexSchema.shape.q,
    r: HexSchema.shape.r,
    itemId: ContentIdSchema,
  }),
]);
export type SellRequest = z.infer<typeof SellRequestSchema>;

/** What a sale took and paid, and the Sell tab after it. */
export const SellResponseSchema = z.object({
  sold: z.object({
    kind: z.enum(['item', 'clothing']),
    itemId: ContentIdSchema,
    quantity: z.number().int().min(1),
    coins: z.number().int().min(1),
  }),
  sell: SellViewSchema,
});
export type SellResponse = z.infer<typeof SellResponseSchema>;

/**
 * One line of a sell basket (#655): `lots` lots of an item from my bag, or
 * `count` spare pieces of a clothing item (never the last free copy).
 */
export const SellLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('item'),
    itemId: ContentIdSchema,
    lots: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal('clothing'),
    itemId: ContentIdSchema,
    count: z.number().int().min(1).max(50), // TUNE: most spares of one piece per sale
  }),
]);
export type SellLine = z.infer<typeof SellLineSchema>;

/**
 * `POST /maps/:mapId/posts/sell` with a basket (#655): every line sells in
 * one transaction against one sale id and one `Idempotency-Key`, or nothing
 * does. One line per (kind, itemId), in the Sell tab's row order.
 */
export const SellBasketRequestSchema = z
  .strictObject({
    kind: z.literal('basket'),
    q: HexSchema.shape.q,
    r: HexSchema.shape.r,
    lines: z.array(SellLineSchema).min(1).max(40), // TUNE: most lines in one basket
  })
  .refine(
    (basket) =>
      new Set(basket.lines.map((l) => `${l.kind}:${l.itemId}`)).size === basket.lines.length,
    { message: 'one line per item', path: ['lines'] },
  );
export type SellBasketRequest = z.infer<typeof SellBasketRequestSchema>;

/** One line of a basket sale: how many went and what they paid. */
export const SoldLineSchema = z.object({
  kind: z.enum(['item', 'clothing']),
  itemId: ContentIdSchema,
  quantity: z.number().int().min(1),
  coins: z.number().int().min(1),
});
export type SoldLine = z.infer<typeof SoldLineSchema>;

/** What a basket took and paid, line by line and in all, and the Sell tab after it. */
export const SellBasketResponseSchema = z.object({
  sold: z.object({
    lines: z.array(SoldLineSchema).min(1),
    quantity: z.number().int().min(1),
    coins: z.number().int().min(1),
  }),
  sell: SellViewSchema,
});
export type SellBasketResponse = z.infer<typeof SellBasketResponseSchema>;

/**
 * The sell route's body while the one-line request is still accepted (#655,
 * one release): a basket or a legacy one-line sale. A legacy request gets the
 * legacy `SellResponse`, a basket gets `SellBasketResponse`.
 */
export const AnySellRequestSchema = z.union([SellRequestSchema, SellBasketRequestSchema]);
export type AnySellRequest = z.infer<typeof AnySellRequestSchema>;

export const AnySellResponseSchema = z.union([SellResponseSchema, SellBasketResponseSchema]);
export type AnySellResponse = z.infer<typeof AnySellResponseSchema>;
