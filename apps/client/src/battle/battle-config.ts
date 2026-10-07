/**
 * Battle scene and HUD tunables (design doc §6, §19, §20; owner decision
 * 2026-10-05: Lantern Hour's stage, Saturday Morning Smackdown's hits, the
 * Storybook Diorama's HUD). First guesses, to be judged on the playtest
 * devices.
 */

/** Where the two fighters stand on the stage (world units; −z is towards the camera). */
export const HOMES = {
  /** The player's squishy: near left. */
  mine: { x: -2.15, z: -1.2 }, // TUNE
  /** The other side: further away, right. */
  theirs: { x: 2.15, z: 1.9 }, // TUNE
} as const;

export const FIGHTER = {
  /** Extra scale on the squishies (a close-up, like the gallery's). */
  scale: 2.7, // TUNE
  /**
   * Three-quarter facing: each face turns between "at the other fighter" (1)
   * and "at the camera" (0), so both faces always show.
   */
  facing: { mine: 0.5, theirs: 0.62 }, // TUNE
  /** The player's Keeper stands at their squishy's back, nearly upright under the low camera. */
  keeper: { offset: { x: 1.25, z: 3.4 }, yaw: -0.25, leanShare: 0.3 }, // TUNE
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
  /** Offering a Heart Charm: a hopeful pause, then a bounce or a wiggle. */
  captureMs: 1300, // TUNE
  /** A potion (#214): a cosy sip, a happy wiggle, and the sparkle shield. */
  itemMs: 1000, // TUNE
  /** A raid replay (#16) rests on its first turn this long before it plays. */
  replayLeadMs: 900, // TUNE
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

/**
 * Saturday Morning Smackdown's hits (owner decision 2026-10-05): fractions are
 * of the step's length (`PLAYBACK`), distances in world units, angles in
 * radians.
 */
export const CHOREO = {
  /** Squash and stretch exaggeration (1 is the map's gentle squish). */
  exaggeration: 1.5, // TUNE: B's 1.6 trimmed a little for readability
  dash: {
    /** Anticipation (pull back and squat) before the dash, fraction of the move step. */
    windup: 0.36, // TUNE
    /** The dash itself, fraction of the move step; the rest is the brace at arm's length. */
    travel: 0.26, // TUNE
  },
  /**
   * Hit-stop, ms (longer for a super hit): when a hit lands, both fighters
   * hold their contact pose this long before the knockback.
   */
  hitStop: 120, // TUNE
  knockback: { distance: 1.2 }, // TUNE
  dodge: { side: 0.9 }, // TUNE
  /** How far a tuckered-out squishy flops over and sinks. */
  faint: { roll: 1.35, sink: 0.1 }, // TUNE
  swap: { out: 0.45 }, // TUNE: fraction of the swap step spent hopping out
  swapIn: { height: 3 }, // TUNE: drops from this high
  /** The Heart Charm: when it lands, when the wobble ends, when the result shows (fractions). */
  charm: { throwAt: 0.3, wobbleAt: 0.42, resultAt: 0.78, shrink: 0.2, lift: 0.9 }, // TUNE
  /** Hit strength per effectiveness tier (`BATTLE_RULES.effectiveness`). */
  strength: { super: 1.45, good: 1.2, normal: 1, weak: 0.65 } as Readonly<Record<string, number>>, // TUNE
  /** Standing ready: lean in a touch, a light bob on the toes. */
  ready: { lean: 0.06, bob: 0.045, bobHz: 1.3, otherPhase: 0.37 }, // TUNE: otherPhase keeps the two out of step
  /** A fighter left at arm's length (a dash that didn't land) hops home this fast, ms. */
  returnMs: 320, // TUNE
  /** Reduced motion: moves this size (dashes become a short lunge), no twirls, shake, flash or hit-stop. */
  reduced: { size: 0.45, reach: 0.35 }, // TUNE
} as const;

/**
 * Lantern Hour's camera (owner decision 2026-10-05): low, swung a little to
 * the player's side, framing the fight into the safe region between the
 * HUD's pills and its bottom sheet. Angles in radians, distances in world units.
 */
export const BATTLE_CAMERA = {
  /** Tilt down from the horizon. */
  pitch: (11 * Math.PI) / 180, // TUNE
  /** Swing around the fight (0 looks along +z). */
  yaw: (-14 * Math.PI) / 180, // TUNE
  fov: 0.74, // TUNE
  minZ: 0.3, // TUNE
  maxZ: 300,
  /** Where it looks: a point at the fighters' feet, between them. */
  aim: { x: 0.35, y: 0.1, z: 0.5 }, // TUNE
  /** Where the aim lands on screen, as a fraction of the height from the top. */
  feetY: 0.56, // TUNE: low enough to use the room above the sheet
  /** The fight's box that must always fit in the safe region: half width and height. */
  fitHalfWidth: 3.9, // TUNE
  fitHeight: 3.6, // TUNE
  /** Camera beats (B): push-in on a hit (fraction of distance), shake (world units), dutch roll (radians). */
  hitPush: 0.1, // TUNE
  followPush: 0.04, // TUNE
  koPush: 0.08, // TUNE
  shake: 0.12, // TUNE: light
  roll: (1.5 * Math.PI) / 180, // TUNE: only on super hits
  /** Leans the framing this far towards the fighter a step is about. */
  focusShift: 0.35, // TUNE
  /** Camera follow smoothing, per second (higher is snappier). */
  follow: 4.5, // TUNE
  /** Shake: wobbles per second and how fast it dies away. */
  shakeHz: 21, // TUNE
  shakeDecay: 9, // TUNE
  /** How fast a push-in and a beat decay back, per second. */
  beatDecay: 2.4, // TUNE
} as const;

/**
 * A potion's sparkle shield (#214): a soft lavender bubble over the squishy
 * until the next hit lands. `fit` is its size against the squishy's.
 */
export const SHIELD_BUBBLE = {
  color: [0.82, 0.72, 1] as const, // TUNE
  glow: [0.42, 0.34, 0.62] as const, // TUNE
  alpha: 0.24, // TUNE
  fit: 1.25, // TUNE
};
