import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';

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
 * `GET /maps/:mapId/inventory`: everything the bag and the tile panel need.
 * `seasons` are the season ids on today on this map (map-local date).
 */
export const InventoryResponseSchema = z.object({
  items: ItemCountsSchema,
  gathers: z.array(GatherSchema),
  crafts: z.array(CraftSchema),
  seasons: z.array(ContentIdSchema),
  now: z.iso.datetime(),
});
export type InventoryResponse = z.infer<typeof InventoryResponseSchema>;

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
