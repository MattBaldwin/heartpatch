import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { WearingSchema } from './data/clothing.js';

// Wardrobe API schemas (design doc §23; issue #43). Clothing is account-level
// (tech spec §4): one wardrobe per player, worn on every map. The server
// checks every id against the catalog and the player's own items.

/** How many outfit presets a player can save (design doc §23 [DEFAULT: 3]). */
export const OUTFIT_PRESETS = 3;

/** One item the player owns. Starter items count as one each. */
export const OwnedClothingSchema = z.object({
  itemId: ContentIdSchema,
  count: z.number().int().min(1),
});
export type OwnedClothing = z.infer<typeof OwnedClothingSchema>;

/** Outfit names players type pass the server's text filter (style guide §8). */
export const OutfitNameSchema = z.string().trim().min(1).max(24);

export const OutfitPresetNumberSchema = z.number().int().min(1).max(OUTFIT_PRESETS);

/** A saved outfit. */
export const OutfitPresetSchema = z.object({
  preset: OutfitPresetNumberSchema,
  name: z.string().nullable(),
  wearing: WearingSchema,
});
export type OutfitPreset = z.infer<typeof OutfitPresetSchema>;

/** `GET /api/v1/wardrobe` and every wardrobe command's reply. */
export const WardrobeSchema = z.object({
  /** Everything the player owns, Keeper clothing and squishy accessories, in catalog order. */
  owned: z.array(OwnedClothingSchema),
  /** What their Keeper wears now, in slot order. */
  wearing: WearingSchema,
  /** Saved outfits, by preset number; empty ones are left out. */
  presets: z.array(OutfitPresetSchema).max(OUTFIT_PRESETS),
});
export type Wardrobe = z.infer<typeof WardrobeSchema>;

export const WardrobeResponseSchema = z.object({ wardrobe: WardrobeSchema });
export type WardrobeResponse = z.infer<typeof WardrobeResponseSchema>;

/** `POST /api/v1/wardrobe/wear`: the whole set to wear (equip and unequip in one). */
export const WearRequestSchema = z.strictObject({ wearing: WearingSchema });
export type WearRequest = z.infer<typeof WearRequestSchema>;

export const OutfitPresetParamsSchema = z.object({
  preset: z.coerce.number().pipe(OutfitPresetNumberSchema),
});

/** `POST /api/v1/wardrobe/presets/:preset`: saves an outfit into a preset (replacing it). */
export const SavePresetRequestSchema = z.strictObject({
  name: OutfitNameSchema.nullable(),
  wearing: WearingSchema,
});
export type SavePresetRequest = z.infer<typeof SavePresetRequestSchema>;

/** `POST /api/v1/maps/:mapId/squishies/:squishyId/accessory`: null takes it off. */
export const SetAccessoryRequestSchema = z.strictObject({ itemId: ContentIdSchema.nullable() });
export type SetAccessoryRequest = z.infer<typeof SetAccessoryRequestSchema>;

export const SetAccessoryResponseSchema = z.object({
  squishyId: z.uuid(),
  accessory: ContentIdSchema.nullable(),
});
export type SetAccessoryResponse = z.infer<typeof SetAccessoryResponseSchema>;

/** `POST /api/v1/dev/wardrobe/items` (dev/test only): hands the player clothing. */
export const DevGrantClothingRequestSchema = z.strictObject({
  items: z.array(ContentIdSchema).min(1).max(50),
});
export type DevGrantClothingRequest = z.infer<typeof DevGrantClothingRequestSchema>;
