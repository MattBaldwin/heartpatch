/**
 * Home-base view and map-marker tunables (#18, design doc §13, §20). All
 * first guesses to judge on the playtest devices.
 */
export const HOME_VIEW = {
  /** Hex size of a home tile in the home-base view (the map's is 0.65). */
  hexSize: 2.6, // TUNE: the 7 home tiles fill a portrait iPhone at the start zoom
  /**
   * Building scale in the home-base view (models are ~1 unit across at level
   * 1; spots sit about 1.35 apart). #184: buildings read too small.
   */
  buildingScale: 1.5, // TUNE: about 1.5 units across, a third of a tile; neighbours may just touch
  /** Squishy scale in the home-base view. */
  squishyScale: 0.55, // TUNE
  /** The player's Keeper, beside the Heart Seed. */
  keeper: { scale: 0.7, offset: { x: 1.1, z: -0.7 }, lean: 0.12 }, // TUNE
  /** How far squishies wander from their habitat's spot, world units. */
  wanderRadius: 0.95, // TUNE
  /**
   * The home tiles up close (#131). The map's cream (`HOME_LOOK`) reads
   * because the map tints it with the player's colour; here it's alone and
   * big under the sun, so it tone-maps to white and blooms. A warm sand,
   * matte, stays below the bloom threshold and lets the spots glow.
   */
  tile: { color: '#efd2a8', roughness: 0.85 }, // TUNE
  /** The land around the home base: how many rings of tiles, its look, how much lower. */
  landRings: 3, // TUNE: a level-3 fire on the Heart Seed reaches ring 3
  land: { color: '#cfe3b8', roughness: 0.9 }, // TUNE
  landDrop: 0.06, // TUNE
  /**
   * The light a fire throws on the land around the home base: warmer and
   * stronger than the map's `SAFE_GLOW`, since the land here is big and pale.
   */
  firelight: { rgb: [1, 0.66, 0.24], fill: 0.42, edge: 0.75 }, // TUNE
  /** The glowing spots while placing or moving (#131): sRGB, and how see-through. */
  spot: { ring: '#f0437f', fill: '#ffd1e3', fillAlpha: 0.55 }, // TUNE
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
