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
 * Render-on-demand pacing (tech spec §6): while only breathing animates, a
 * frame is asked for at most this often; while a move plays, every frame.
 * Asks land on display ticks, so this is a 30 fps interval less half a
 * 120 Hz tick: every 2nd tick at 60 Hz and every 4th at 120 Hz, both 30 fps,
 * with margin for timer jitter. A full 33.3 ms would round to every 3rd
 * tick (20 fps) at 60 Hz; exactly 25 ms sits on the 120 Hz boundary.
 */
export const BREATHING_FRAME_MS = 29; // TUNE: 30 fps is plenty for a slow breath

/** A submit that never reached the server is sent once more, with the same key, after this long. */
export const RETRY_AFTER_MS = 1200; // TUNE: a phone's radio often comes back within a second

/** How a tuckered-out squishy lies: sunk a little and turned on its side. */
export const TUCKERED_POSE = {
  sink: 0.22, // TUNE: fraction of body height below the ground
  turn: 0.9, // TUNE: radians
} as const;
