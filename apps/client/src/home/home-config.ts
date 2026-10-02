/**
 * Home-base view and map-marker tunables (#18, design doc §13, §20). All
 * first guesses to judge on the playtest devices.
 */
export const HOME_VIEW = {
  /** Hex size of a home tile in the home-base view (the map's is 0.65). */
  hexSize: 2.6, // TUNE: the 7 home tiles fill a portrait iPhone at the start zoom
  /** Building scale in the home-base view (models are ~1 unit across). */
  buildingScale: 1.15, // TUNE
  /** Squishy scale in the home-base view. */
  squishyScale: 0.55, // TUNE
  /** The player's Keeper, beside the Heart Seed. */
  keeper: { scale: 0.7, offset: { x: 1.1, z: -0.7 }, lean: 0.12 }, // TUNE
  /** How far squishies wander from their habitat's spot, world units. */
  wanderRadius: 0.95, // TUNE
} as const;

/** Spots inside a tile: sub-hex size as a fraction of the tile's hex size. */
export const SPOT_SIZE = 0.3; // TUNE: ring spots sit about half-way to the tile edge

/** Building scale on the world map, as a fraction of the map's hex size. */
export const MAP_BUILDING_SCALE = 0.42; // TUNE

/** The soft glow over Hearthfire-safe tiles on the map (linear RGB, alpha). */
export const SAFE_GLOW = { rgb: [1, 0.82, 0.42], fill: 0.2, edge: 0.55 } as const; // TUNE

/**
 * Wandering (render on demand): every `everyMs` (± `jitterMs`) one squishy
 * hops to a new spot near its habitat, over `hopMs`. Between hops nothing
 * moves and nothing is drawn.
 */
export const WANDER = { everyMs: 3500, jitterMs: 1500, hopMs: 650, hopHeight: 0.35 } as const; // TUNE
