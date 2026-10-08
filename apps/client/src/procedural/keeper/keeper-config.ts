/**
 * Procedural Keeper tunables (design doc §19, §23). Bases and palettes are
 * data in `@heartpatch/shared` (`KEEPER_DATA`); this file holds the build
 * numbers every Keeper shares. Sizes are fractions of the Keeper's height
 * unless they say otherwise. All first guesses to judge in the Keeper
 * gallery (`/keepers.html`) and on the playtest devices.
 */
export const KEEPER = {
  /** World height of a standard (`body.height` 1) Keeper at scale 1; a hex tile is about 2 across. */
  height: 1.6, // TUNE
  /** Body depth as a fraction of its width. */
  torsoDepth: 0.8, // TUNE
  /** How far the head sinks into the body, as a fraction of its height. */
  neckSink: 0.12, // TUNE
  /** Shoes, as multiples of limb thickness: width, height, length. */
  shoe: [1.5, 0.95, 2.1], // TUNE
  /** Hands, as a multiple of limb thickness. */
  hand: 1.25, // TUNE
  /** Arms hang this far out from straight down, degrees. */
  armSplayDeg: 14, // TUNE
  /** Sleeves cover this much of the arm from the shoulder. */
  sleeve: 0.45, // TUNE
  /** Face features, as fractions of the head's own size. */
  face: {
    eyeSpread: 0.19, // TUNE: eye centre from the middle, of head width
    eyeHeight: -0.02, // TUNE: of head height, from its middle
    browHeight: 0.07, // TUNE: just above the eyes, clear of the fringe
    noseHeight: -0.12, // TUNE
    mouthHeight: -0.22, // TUNE
    /** How far features stand out of the head surface, of their own depth. */
    standOut: 0.35, // TUNE
  },
  /** Fixed toy colours (sRGB hex). */
  colors: {
    ink: '#3b2a3f', // TUNE: the squishies' plum ink
    /** The face's lines (#289): a step darker than ink so they read on the deepest skin. */
    faceLine: '#24151d', // TUNE
    white: '#ffffff',
  },
  /** Seeded wobble so two Keepers with one config are identical, but hair isn't ruler-straight. */
  jitter: { hairDeg: 6, hairSize: 0.06 }, // TUNE
} as const;

/** Detail levels, like squishies' (`procedural/config.ts`): `low` on the map, `high` in close-ups. */
export const KEEPER_LOD = {
  low: { bodyRings: 10, partRings: 6, partSegments: 10 }, // TUNE
  high: { bodyRings: 20, partRings: 12, partSegments: 20 }, // TUNE
} as const;

/** Where Keepers stand, and how big, in each place they show up. */
export const KEEPER_PLACES = {
  /** The map: next to the owner's Heart Seed, small (design doc §23). */
  map: {
    scale: 0.55, // TUNE
    /** Offset from the Heart Seed (world units). */
    offset: { x: 0.55, z: -0.25 }, // TUNE
    /** Leans back (radians) so the face shows under the steep map camera. */
    lean: 0.3, // TUNE
  },
  /**
   * Battles: at the player's back (design doc §23), like a coach: nearer the
   * camera than their squishy and off to the side, clear of the nameplates.
   */
  battle: {
    scale: 1.5, // TUNE
    /** Offset from the player's squishy (world units; +z is away from the camera). */
    offset: { x: -0.95, z: -1.9 }, // TUNE
    yaw: -0.6, // TUNE: turned towards the action
    lean: 0.35, // TUNE
  },
  /** The Keeper picker's preview (a close-up). */
  preview: {
    scale: 2.9, // TUNE
    lean: 0.5, // TUNE
    /** Where the camera looks (+z is away from it): the Keeper sits above the picker card. */
    lookAtZ: -2.3, // TUNE
  },
} as const;
