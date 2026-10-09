import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';
import { RecipeBookPageKeySchema } from './data/recipe-book.js';

// Inventory, gathering and crafting API (design doc §12, §15; tech spec §5).
// Inventory is per player per map. Timers are timestamps: the server sends
// `readyAt` and its own `now`, so the client counts down against the game
// clock (which a dev override can move), not the phone's.

/**
 * Why an inventory changed, stored with every `resource_ledger` row (tech
 * spec §4). Later issues add their own (trades, care). Home base (#18):
 * `build` (a building's cost), `fuel` (Emberwood into a Hearthfire) and
 * `build-refund` (what comes back when a building is taken down). The Hollow
 * Man (#21): `rescue` (Heartdust for bringing a squishy home). The tutorial
 * (#24): `tutorial` (Sprout's little bag at the start of a run). The starter
 * pick: `starter` (Sprout's Heart Charms with the account's first pick).
 * Squishy jobs: `work` (what squishy gatherers bring in).
 */
export const ItemChangeReasonSchema = z.enum([
  'gather',
  'craft',
  'capture',
  'dev-grant',
  'build',
  'fuel',
  'build-refund',
  'care',
  'rescue',
  'tutorial',
  'starter',
  /** Squishy gatherers' work (owner decisions 2026-10-04). */
  'work',
  /** Raising a building a level (owner decision 2026-10-06). */
  'upgrade',
  /** A potion drunk in battle (#214), ledgered against the battle. */
  'battle-item',
  /** Mending a fence segment (#203), ledgered against the segment. */
  'repair',
  /** Exploring your land (#199): finds, and the wear on the tool a search used. */
  'explore',
  /** Trades and gifts (#271): held for an offer, landed by it, or given back. */
  'trade-escrow',
  'trade',
  'trade-return',
  /**
   * Crafting Factory batches (#294): paid when one starts, things made as
   * they land, and what comes back when one stops. Ledgered against the batch.
   */
  'factory',
]);
export type ItemChangeReason = z.infer<typeof ItemChangeReasonSchema>;

/** Item id → how many the player has. A missing id means none. */
export const ItemCountsSchema = z.record(ContentIdSchema, z.number().int().min(0));

/** One gather on a node the player owns. */
export const GatherSchema = z.object({
  id: z.uuid(),
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  /** The node's resource. */
  resource: ContentIdSchema,
  /** What collecting gives (the resource, plus any in-season extras). */
  items: ItemCountsSchema,
  startedAt: z.iso.datetime(),
  readyAt: z.iso.datetime(),
});
export type Gather = z.infer<typeof GatherSchema>;

/** One recipe on the go. Its inputs were used up when it started. */
export const CraftSchema = z.object({
  id: z.uuid(),
  recipeId: ContentIdSchema,
  items: ItemCountsSchema,
  startedAt: z.iso.datetime(),
  readyAt: z.iso.datetime(),
});
export type Craft = z.infer<typeof CraftSchema>;

/**
 * One Crafting Factory batch still going (#294). `done` is how many were made
 * by the reply's `now` (all of them are in the bag already); `nextAt` is when
 * the next one finishes, `doneAt` the last.
 */
export const FactoryBatchSchema = z.object({
  id: z.uuid(),
  recipeId: ContentIdSchema,
  total: z.number().int().min(1),
  done: z.number().int().min(0),
  /** Seconds each one takes (fixed when the batch started, speed-ups included). */
  itemSeconds: z.number().int().min(1),
  startedAt: z.iso.datetime(),
  nextAt: z.iso.datetime().nullable(),
  doneAt: z.iso.datetime(),
});
export type FactoryBatch = z.infer<typeof FactoryBatchSchema>;

/** My Crafting Factory on this map: its building row, level, batch spots and batches going. */
export const FactoryViewSchema = z.object({
  buildingId: z.uuid(),
  level: z.number().int().min(1),
  slots: z.number().int().min(1),
  batches: z.array(FactoryBatchSchema),
});
export type FactoryView = z.infer<typeof FactoryViewSchema>;

/**
 * `GET /maps/:mapId/inventory`: everything the bag and the tile panel need.
 * `seasons` are the season ids on today on this map (map-local date).
 * `factory`: my Crafting Factory (#294), or null before I build one.
 */
export const InventoryResponseSchema = z.object({
  items: ItemCountsSchema,
  gathers: z.array(GatherSchema),
  crafts: z.array(CraftSchema),
  factory: FactoryViewSchema.nullable(),
  seasons: z.array(ContentIdSchema),
  now: z.iso.datetime(),
});
export type InventoryResponse = z.infer<typeof InventoryResponseSchema>;

/**
 * What a settle put in the bag: one finished craft, keeper gather, a
 * gatherer's cycles, or a Factory batch's newly made things (#294, with its
 * `recipeId`).
 */
export const LandedSchema = z.object({
  kind: z.enum(['craft', 'gather', 'work', 'factory']),
  items: ItemCountsSchema,
  recipeId: ContentIdSchema.optional(),
});
export type Landed = z.infer<typeof LandedSchema>;

/**
 * `POST /maps/:mapId/settle` (owner decision 2026-10-06): everything that
 * finished goes straight into the bag, no Collect tap. The bag after, what
 * landed (crafts, then gathers, then gatherers' work, then Factory batches), and when the next thing finishes (null: nothing's
 * going), so the client asks again then and not before.
 */
export const SettleResponseSchema = InventoryResponseSchema.extend({
  landed: z.array(LandedSchema),
  /**
   * Training Grounds XP that landed (owner decision 2026-10-06), per
   * squishy, with its name (only mine, as `JobsView.names`) for the pop-up.
   */
  trained: z.array(
    z.object({ squishyId: z.uuid(), name: z.string(), xp: z.number().int().min(1) }),
  ),
  nextAt: z.iso.datetime().nullable(),
});
export type SettleResponse = z.infer<typeof SettleResponseSchema>;

/** `POST /maps/:mapId/gathers`: start gathering the node on this tile. */
export const StartGatherRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
});
export type StartGatherRequest = z.infer<typeof StartGatherRequestSchema>;

export const GatherResponseSchema = z.object({ gather: GatherSchema, now: z.iso.datetime() });
export type GatherResponse = z.infer<typeof GatherResponseSchema>;

export const GatherParamsSchema = z.object({ mapId: z.uuid(), gatherId: z.uuid() });
export const CraftParamsSchema = z.object({ mapId: z.uuid(), craftId: z.uuid() });

/** Collecting a gather or a craft: what was added, and the bag after. */
export const CollectResponseSchema = z.object({
  granted: ItemCountsSchema,
  items: ItemCountsSchema,
  now: z.iso.datetime(),
});
export type CollectResponse = z.infer<typeof CollectResponseSchema>;

/** `POST /maps/:mapId/crafts` */
export const StartCraftRequestSchema = z.strictObject({ recipeId: ContentIdSchema });
export type StartCraftRequest = z.infer<typeof StartCraftRequestSchema>;

/** The craft that started, and the bag after its inputs were used. */
export const CraftResponseSchema = z.object({
  craft: CraftSchema,
  items: ItemCountsSchema,
  now: z.iso.datetime(),
});
export type CraftResponse = z.infer<typeof CraftResponseSchema>;

/**
 * `GET /recipe-book` (account-level, owner decision 2026-10-05): the keys of
 * the recipe book pages this account has opened (`recipe:<id>`,
 * `building:<id>`), in book order. The pages themselves are public data
 * (`recipeBookPages`); a sealed page can't be crafted or built.
 */
export const RecipeBookResponseSchema = z.object({
  unlocked: z.array(RecipeBookPageKeySchema),
});
export type RecipeBookResponse = z.infer<typeof RecipeBookResponseSchema>;

// ── Dev and test only ──────────────────────────────────────────────────────
// `HP_DEV_SQUISHY_GRANTS`, refused in production (server config).

/** `POST /maps/:mapId/dev/items`: hands the caller items (e.g. Heart Charms). */
export const DevGrantItemsRequestSchema = z.strictObject({
  items: z
    .record(ContentIdSchema, z.number().int().min(1).max(999))
    .refine((items) => Object.keys(items).length > 0, 'Pick at least one item.'),
});
export type DevGrantItemsRequest = z.infer<typeof DevGrantItemsRequestSchema>;

export const ItemsResponseSchema = z.object({ items: ItemCountsSchema });
export type ItemsResponse = z.infer<typeof ItemsResponseSchema>;
