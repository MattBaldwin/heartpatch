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
  land: { color: '#bcd9a4', roughness: 0.9 }, // TUNE
  landDrop: 0.06, // TUNE
  /**
   * The light a fire throws on the land around the home base: warmer and
   * stronger than the map's `SAFE_GLOW`, since the land here is big and pale.
   */
  firelight: { rgb: [1, 0.48, 0.12], fill: 0.24, edge: 0.1 }, // TUNE: added to the land's colour
  /** The firelight fades with distance from the fire: alpha share 1, 2 and 3+ tiles out. */
  firelightFade: [1, 0.62, 0.38], // TUNE
  /** The glowing spots while placing or moving (#131): sRGB, and how see-through. */
  spot: { ring: '#f0437f', fill: '#ffd1e3', fillAlpha: 0.55 }, // TUNE
} as const;

/**
 * The home sheet's handle (#412): how far a finger moves before it's a swipe,
 * not a tap (CSS px), how long after a release its click is swallowed, and
 * how near the release that click lands (CSS px) to be the tap's own (#306).
 */
export const HOME_SHEET = { swipePx: 24, clickAfterMs: 600, strayClickPx: 12 } as const; // TUNE

/** Spots inside a tile: sub-hex size as a fraction of the tile's hex size. */
export const SPOT_SIZE = 0.3; // TUNE: ring spots sit about half-way to the tile edge

/**
 * Building scale on the world map, as a fraction of the map's hex size. A
 * home building has its tile to itself beside the ring node (#295, one
 * building a tile), so it's drawn about tile-sized.
 */
export const MAP_BUILDING_SCALE = 0.72; // TUNE: was 0.42 when tiles held several

/**
 * Out on the land a building fills its tile, in its middle, with the tile's
 * props cleared away (owner decision 2026-10-11, #295): today's models scaled
 * up until bespoke tile-sized ones come in Phase 2. A fire (#202) is tall and
 * narrow; the Training Grounds and Crafting Factory are flat and wide.
 */
export const MAP_OUTER_FIRE_SCALE = 0.95; // TUNE: was 0.75
export const MAP_OUTER_BUILDING_SCALE = 1.15; // TUNE

/** The soft glow over Hearthfire-safe tiles on the map (linear RGB, alpha). */
export const SAFE_GLOW = { rgb: [1, 0.82, 0.42], fill: 0.2, edge: 0.55 } as const; // TUNE

/**
 * Wandering (render on demand): every `everyMs` (± `jitterMs`) one squishy
 * hops to a new spot near its habitat, over `hopMs`. Between hops nothing
 * moves and nothing is drawn.
 */
export const WANDER = { everyMs: 3500, jitterMs: 1500, hopMs: 650, hopHeight: 0.35 } as const; // TUNE

/**
 * The Keeper's house cottage on the Heart Seed tile (#381): behind the Heart
 * Seed, in the gap between the tile's two back spots (the last ones filled),
 * in hex sizes from the Heart Seed. Taps this near it open the house.
 */
export const HOME_HOUSE = {
  offset: { x: 0, z: 0.74 }, // TUNE
  scale: 1.25, // TUNE: the biggest cottage is about two metres across here
  tapReach: 0.36, // TUNE
} as const;

/**
 * How squishies show how they feel about their job at home (#393). A small
 * bubble floats over each one on every tier: 💕 at a job it loves, 🌧️ at one
 * it isn't keen on (the map's 🧺 badges use the same pair). A happy one also
 * does a little bounce now and then: one at a time, on the wander timer's
 * beat, every `cheerEvery`-th beat, so the frames it costs land with a hop's;
 * not with Reduce Motion or on the low quality tier. One that isn't keen
 * droops: it sits squashed (`droop`, height scale about its feet; the width
 * grows to keep its volume), pulls a glum face (procedural GLUM_FACE) and
 * doesn't wander.
 */
export const MOOD_CUES = {
  cheerEvery: 2, // TUNE: a bounce on every 2nd wander beat (about every 7 s)
  bounceStrength: 0.8, // TUNE: of the shared happy bounce (SQUISH.bounce)
  droop: 0.74, // TUNE: 0.86 was hard to spot at the home's start zoom (#393 mockups)
  /**
   * The mood bubbles on screen (CSS px, see mood-layout.ts): their size, the
   * space over the head, how far one may climb or slide to clear other faces
   * before it hides instead, and how much of a squishy counts as its face.
   */
  marks: {
    width: 30,
    height: 26,
    gap: 6,
    maxLift: 48,
    step: 4,
    slide: 10,
    faceWidth: 0.8,
    faceHeight: 0.5,
    faceCover: 0.25,
  }, // TUNE
  /** A squishy this close to its habitat's middle (× building scale) stands inside it, out of sight. */
  tuckedWithin: 0.4, // TUNE: building models are about 1 unit across at scale 1
} as const;
