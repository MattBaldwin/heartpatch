/**
 * Battle scene and HUD tunables (design doc §6, §19, §20). First guesses, to
 * be judged on the playtest devices.
 */

/** How the two squishies stand: the player's at the front left, the wild one across. */
export const ARENA = {
  /** Extra scale on the squishies (a close-up, like the gallery's). */
  scale: 3.2, // TUNE
  /** Half the distance between the two squishies, world units. */
  halfGap: 2, // TUNE
  /** How far the player's squishy sits towards the camera (+z is towards it). */
  depth: 1, // TUNE
  /** Each squishy turns to face the other, radians off straight ahead. */
  faceOff: 0.55, // TUNE
  /** Floor disc diameter. */
  floorDiameter: 14, // TUNE
  /**
   * Where the camera looks (+z is away from it). Looking a little in front of
   * the squishies lifts them up the screen, clear of the controls.
   */
  lookAtZ: -2.4, // TUNE
} as const;

/** Timings for playing the server's resolved log back, ms. */
export const PLAYBACK = {
  /** A move name shows this long before its result lands. */
  moveMs: 650, // TUNE
  /** A hit: squash, energy bar drop, callout. */
  hitMs: 800, // TUNE
  missMs: 700, // TUNE
  /** Heals, stat changes and statuses: a bounce or wobble plus a line. */
  effectMs: 700, // TUNE
  /** Flopping over when tuckered out. */
  tuckeredMs: 1100, // TUNE
  swapMs: 700, // TUNE
  /** Breather before the result screen. */
  endMs: 900, // TUNE
} as const;

/**
 * Render-on-demand pacing (tech spec §6): while only breathing animates,
 * draw at this rate; while a move plays, every frame.
 */
export const BREATHING_FRAME_MS = 1000 / 30; // TUNE: 30 fps is plenty for a slow breath

/** How a tuckered-out squishy lies: sunk a little and turned on its side. */
export const TUCKERED_POSE = {
  sink: 0.22, // TUNE: fraction of body height below the ground
  turn: 0.9, // TUNE: radians
} as const;
