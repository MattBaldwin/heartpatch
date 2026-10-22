import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { NAMING_RULES } from '../data/naming.js';
import { ContentIdSchema } from './data/common.js';
import { BuildableKindSchema } from './data/home-base.js';
import { ElementIdSchema, FeelingIdSchema } from './data/elements.js';
import { SpeciesSchema } from './data/species.js';
import { HomeHouseSchema } from './house.js';
import { ItemCountsSchema } from './inventory.js';
import { SquishyJobIdSchema } from './jobs.js';
import { LocalDateSchema } from './time.js';

// Home base and buildings API (design doc §11, §13–14; tech spec §5). The
// client sends intents ("build a Hearthfire on this spot", "add a night of
// fuel"); the server checks and pays for them (CLAUDE.md rules 1 and 7).

/** A building spot on a home tile: 0 is the middle, 1–6 around it (`spotOffset`). */
export const BuildingSpotSchema = z.number().int().min(0).max(6);

/**
 * Kinds of `buildings` row. Fences (#203) are segments on edges, in their own
 * rows. `resource` and `warehouse` (#601) parse ahead of any row of them: none
 * can be built until their kind joins `HOME_BASE_RULES.buildableKinds`.
 */
export const BuildingKindSchema = z.enum([
  'hearthfire',
  'habitat',
  'training-grounds',
  'factory',
  'resource',
  'warehouse',
]);
export type BuildingRowKind = z.infer<typeof BuildingKindSchema>;

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
  /**
   * Resource buildings and the Warehouse (#601): napping because its
   * morning upkeep wasn't paid. Members see a sleeping building, never why
   * in coins. Left out for other kinds, by older servers and in older
   * stored events.
   */
  paused: z.boolean().nullable().optional(),
});
export type PublicBuilding = z.infer<typeof PublicBuildingSchema>;

/** A building on the map, with its tile (what building events carry). */
export const PlacedBuildingSchema = z.object({
  ...PublicBuildingSchema.shape,
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
});
export type PlacedBuilding = z.infer<typeof PlacedBuildingSchema>;

/**
 * A resource building's output as its owner sees it (#601): the resource
 * and how much a cycle makes, how long a cycle takes, what's waiting for
 * the next settle and how much fits, and its morning upkeep.
 */
export const BuildingProductionSchema = z.object({
  resource: ContentIdSchema,
  perCycle: z.number().int().min(0),
  cycleSeconds: z.number().int().min(1),
  /** Finished and waiting: the next settle banks it. */
  ready: ItemCountsSchema,
  cycles: z.number().int().min(0),
  /** Its storage in cycles, or null while the Warehouse delivers (never full). */
  maxCycles: z.number().int().min(1).nullable(),
  /** Storage full: it waits for the next settle. */
  full: z.boolean(),
  /** When the next cycle finishes, or null while full, paused or napping. */
  nextReadyAt: z.iso.datetime().nullable(),
  /** Heart Coins each morning at this level. */
  upkeep: z.number().int().min(0),
  /** The last map-local morning settled (paid, paused or skipped), or null. */
  paidThrough: LocalDateSchema.nullable(),
  /** Paused for unpaid upkeep since this morning, or null while running. */
  pausedAt: z.iso.datetime().nullable(),
  /** The kid's place for it in the upkeep order (lower first), or null for the default. */
  upkeepRank: z.number().int().min(0).nullable(),
  /** The Warehouse delivers its output straight to the bag (#601 PR 8). */
  delivering: z.boolean(),
});
export type BuildingProduction = z.infer<typeof BuildingProductionSchema>;

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
  /**
   * Resource buildings (#601): what it makes and where it's up to. Left out
   * for other kinds and by an older server.
   */
  production: BuildingProductionSchema.nullable().optional(),
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
  /**
   * The wardrobe accessory it wears (#43, #340), or null: read back through
   * ownership, so it's always a piece its owner has. An older server sends
   * none: nothing worn.
   */
  accessory: ContentIdSchema.nullable().default(null),
  /**
   * The room of the Keeper's house it lives in (#381), or null: not a
   * resident, or the house is switched off. An older server sends none.
   */
  houseRoomId: ContentIdSchema.nullable().default(null),
});
export type HomeSquishy = z.infer<typeof HomeSquishySchema>;

/**
 * A home's name (#306 PR 0): trimmed, runs of spaces made one, up to
 * `NAMING_RULES.maxLength` letters, numbers, spaces and a little friendly
 * punctuation (no emoji), like a squishy's nickname. The server also runs
 * the text filter (CLAUDE.md rule 9).
 */
export const HomeNameSchema = z
  .string()
  .transform((name) => name.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(1, 'Type a name first!')
      .max(NAMING_RULES.maxLength, `Names can be up to ${String(NAMING_RULES.maxLength)} letters.`)
      .regex(
        /^[\p{L}\p{N} '’!&.,-]+$/u,
        'Names can use letters, numbers, spaces and a little punctuation.',
      ),
  );

/**
 * Naming my home (#306 PR 0), as `namingGate` works it out: my home's name,
 * whether naming is unlocked, each buildable kind and whether I've built
 * one, squishies caught toward `need`, and whether I may (re)name it now.
 */
export const HomeNamingSchema = z.object({
  name: z.string().nullable(),
  unlocked: z.boolean(),
  kinds: z.array(z.object({ kind: BuildableKindSchema, built: z.boolean() })),
  caught: z.number().int().min(0),
  need: z.number().int().min(1),
  renameOpen: z.boolean(),
});
export type HomeNaming = z.infer<typeof HomeNamingSchema>;

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
  /**
   * The Keeper's house (#381): left out while the house is switched off for
   * this player (`HP_HOUSE`) and by older servers, so the client draws none.
   */
  house: HomeHouseSchema.optional(),
  /** Naming my home (#306 PR 0); older servers send none. */
  naming: HomeNamingSchema.optional(),
});
export type HomeResponse = z.infer<typeof HomeResponseSchema>;

/**
 * `POST /maps/:mapId/buildings`: build on a spot of one of my home tiles, or
 * (a building with `placement: 'land'` or `'owned'`, #202) of a tile I own.
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

/**
 * `POST /maps/:mapId/buildings/upkeep-order` (#601, owner decision Q5): the
 * order my upkeep buildings pay their mornings in when Heart Coins run
 * short, first first. Every one listed must be mine and pay upkeep; any of
 * mine left out goes back to the default order (highest level, then
 * oldest, the Warehouse last), after the listed ones.
 */
export const UpkeepOrderRequestSchema = z.strictObject({
  buildingIds: z
    .array(z.uuid())
    .max(64)
    .refine((ids) => new Set(ids).size === ids.length, 'Each building goes in the order once.'),
});
export type UpkeepOrderRequest = z.infer<typeof UpkeepOrderRequestSchema>;

/** `POST /maps/:mapId/dev/upkeep/due` (dev/test only): my upkeep buildings owe this many more mornings. */
export const DevUpkeepDueRequestSchema = z.strictObject({
  mornings: z.number().int().min(1).max(30),
});
export type DevUpkeepDueRequest = z.infer<typeof DevUpkeepDueRequestSchema>;
