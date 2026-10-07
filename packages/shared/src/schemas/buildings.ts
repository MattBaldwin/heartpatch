import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { ContentIdSchema } from './data/common.js';
import { ElementIdSchema, FeelingIdSchema } from './data/elements.js';
import { SpeciesSchema } from './data/species.js';
import { ItemCountsSchema } from './inventory.js';
import { SquishyJobIdSchema } from './jobs.js';
import { LocalDateSchema } from './time.js';

// Home base and buildings API (design doc §11, §13–14; tech spec §5). The
// client sends intents ("build a Hearthfire on this spot", "add a night of
// fuel"); the server checks and pays for them (CLAUDE.md rules 1 and 7).

/** A building spot on a home tile: 0 is the middle, 1–6 around it (`spotOffset`). */
export const BuildingSpotSchema = z.number().int().min(0).max(6);

export const BuildingKindSchema = z.enum(['hearthfire', 'habitat', 'training-grounds']);

/**
 * A building as every member sees it on the map: which one, its level, where
 * on its tile, and for Hearthfires whether it's lit for the next nightfall
 * and how far its light reaches. Who owns it is the tile's owner.
 */
export const PublicBuildingSchema = z.object({
  id: z.uuid(),
  /** Building id from the shared building table (`hearthfire`, `cozy-meadow`). */
  buildingId: ContentIdSchema,
  kind: BuildingKindSchema,
  level: z.number().int().min(1),
  spot: BuildingSpotSchema,
  /** Hearthfires: has fuel for the next nightfall. Null for other kinds. */
  lit: z.boolean().nullable(),
  /** Hearthfires: safe radius in tiles at this level. Null for other kinds. */
  safeRadius: z.number().int().min(0).nullable(),
});
export type PublicBuilding = z.infer<typeof PublicBuildingSchema>;

/** A building on the map, with its tile (what building events carry). */
export const PlacedBuildingSchema = z.object({
  ...PublicBuildingSchema.shape,
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
});
export type PlacedBuilding = z.infer<typeof PlacedBuildingSchema>;

/** One of my buildings, with what only I see (fuel, residents). */
export const MyBuildingSchema = z.object({
  ...PlacedBuildingSchema.shape,
  /** Hearthfires: nights of fuel left, tonight included. Null for other kinds. */
  nightsLeft: z.number().int().min(0).nullable(),
  /** Hearthfires: how many more nights fit right now. Null for other kinds. */
  fuelSpace: z.number().int().min(0).nullable(),
  /** Habitats and Training Grounds: how many squishies fit. Null for fires. */
  capacity: z.number().int().min(0).nullable(),
  /**
   * Habitats: squishies living there, a squishy in the Hollow included (it
   * keeps its bed). Training Grounds: squishies practicing there. Null for fires.
   */
  residents: z.number().int().min(0).nullable(),
});
export type MyBuilding = z.infer<typeof MyBuildingSchema>;

/** One of my home tiles, and what stands in its middle already. */
export const HomeTileSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  heartSeed: z.boolean(),
  nodeResource: z.string().nullable(),
});
export type HomeTile = z.infer<typeof HomeTileSchema>;

/**
 * One of my active squishies, the habitat it lives in (null: none yet) and
 * the Training Grounds it practices at (null: none).
 */
export const HomeSquishySchema = z.object({
  id: z.uuid(),
  speciesId: ContentIdSchema,
  element: ElementIdSchema,
  feeling: FeelingIdSchema,
  nickname: z.string().nullable(),
  level: z.number().int().min(1),
  habitatId: z.uuid().nullable(),
  trainingId: z.uuid().nullable(),
  /** Its one job (squishy jobs), so the Training Grounds card can say what Train stops. */
  job: SquishyJobIdSchema,
});
export type HomeSquishy = z.infer<typeof HomeSquishySchema>;

/**
 * `GET /maps/:mapId/home`, and the reply to every home command: my home
 * tiles, buildings and squishies, my bag (to show costs), the seasons on
 * today, tonight's map-local date and the server's clock.
 */
export const HomeResponseSchema = z.object({
  tiles: z.array(HomeTileSchema),
  buildings: z.array(MyBuildingSchema),
  squishies: z.array(HomeSquishySchema),
  /**
   * Species of my squishies that aren't in the public table (a secret one
   * I befriended), so the client can draw them; as `PlayerBattle.speciesDefs`.
   */
  speciesDefs: z.array(SpeciesSchema),
  items: ItemCountsSchema,
  seasons: z.array(ContentIdSchema),
  /** The night the next nightfall belongs to (map-local date). */
  tonight: LocalDateSchema,
  now: z.iso.datetime(),
});
export type HomeResponse = z.infer<typeof HomeResponseSchema>;

/**
 * `POST /maps/:mapId/buildings`: build on a spot of one of my home tiles, or
 * (a building with `placement: 'owned'`, #202) of any tile I own.
 */
export const PlaceBuildingRequestSchema = z.strictObject({
  buildingId: ContentIdSchema,
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  spot: BuildingSpotSchema,
});
export type PlaceBuildingRequest = z.infer<typeof PlaceBuildingRequestSchema>;

/** `POST /maps/:mapId/buildings/:buildingId/move` */
export const MoveBuildingRequestSchema = z.strictObject({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  spot: BuildingSpotSchema,
});
export type MoveBuildingRequest = z.infer<typeof MoveBuildingRequestSchema>;

/** `POST /maps/:mapId/buildings/:buildingId/fuel` */
export const FuelBuildingRequestSchema = z.strictObject({
  nights: z.number().int().min(1).max(30),
});
export type FuelBuildingRequest = z.infer<typeof FuelBuildingRequestSchema>;

/** `POST /maps/:mapId/squishies/:squishyId/habitat`: move in, or out (null). */
export const HouseSquishyRequestSchema = z.strictObject({
  habitatId: z.uuid().nullable(),
});
export type HouseSquishyRequest = z.infer<typeof HouseSquishyRequestSchema>;

export const BuildingParamsSchema = z.object({ mapId: z.uuid(), buildingId: z.uuid() });

/** Taking a building down: what came back, and the home after. */
export const RemoveBuildingResponseSchema = z.object({
  refund: ItemCountsSchema,
  home: HomeResponseSchema,
});
export type RemoveBuildingResponse = z.infer<typeof RemoveBuildingResponseSchema>;

/**
 * `POST /maps/:mapId/buildings/fuel-all` (#202): tops up every one of my
 * fires, the ones with the fewest nights first, one night at a time, until
 * they're full or my bag runs out (`planFuelAll`).
 */
export const FuelAllResponseSchema = z.object({
  /** Fires that got fuel. */
  fires: z.number().int().min(0),
  /** Nights of fuel added across them. */
  nights: z.number().int().min(0),
  /** Some fire still has room: the bag ran out first. */
  short: z.boolean(),
  home: HomeResponseSchema,
});
export type FuelAllResponse = z.infer<typeof FuelAllResponseSchema>;
