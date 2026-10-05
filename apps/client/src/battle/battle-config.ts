/**
 * Battle scene and HUD tunables (design doc §6, §19, §20). First guesses, to
 * be judged on the playtest devices.
 */

/** How the two squishies stand: the player's at the front left, the wild one across. */
export const ARENA = {
  /** Extra scale on the squishies (a close-up, like the gallery's). */
  scale: 2.8, // TUNE
  /** Half the distance between the two squishies, world units. */
  halfGap: 2.4, // TUNE
  /** How far the player's squishy sits towards the camera, and the other one away (−z is towards it). */
  depth: 3, // TUNE
  /** The player's Keeper stands nearly upright under the low battle camera (× its map lean). */
  keeperLean: 0.3, // TUNE
  /** Each squishy turns to face the other, radians off straight ahead. */
  faceOff: 0.55, // TUNE
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

/** How a tuckered-out squishy lies: sunk a little and turned on its side. */
export const TUCKERED_POSE = {
  sink: 0.22, // TUNE: fraction of body height below the ground
  turn: 0.9, // TUNE: radians
} as const;

/**
 * Action-cartoon choreography (owner decision 2026-10-04): fractions are of
 * the step's length (`PLAYBACK`), distances in world units, angles in
 * radians. First guesses to judge on the playtest devices.
 */
export const CHOREO = {
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
  hitStop: 90, // TUNE: a few frames
  knockback: { distance: 0.9 }, // TUNE
  dodge: { side: 0.9 }, // TUNE
  /** How far a tuckered-out squishy flops over and sinks. */
  faint: { roll: 1.35, sink: 0.12 }, // TUNE
  swap: { out: 0.45 }, // TUNE: fraction of the swap step spent hopping out
  swapIn: { height: 3 }, // TUNE: drops from this high
  /** The Heart Charm: when it lands, when the wobble ends, when the result shows (fractions). */
  charm: { throwAt: 0.3, wobbleAt: 0.42, resultAt: 0.78, shrink: 0.12, lift: 0.45 }, // TUNE
  /** Hit strength per effectiveness tier (`BATTLE_RULES.effectiveness`). */
  strength: { super: 1.45, good: 1.2, normal: 1, weak: 0.65 } as Readonly<Record<string, number>>, // TUNE
  /** Standing ready to fight: lean in, a little low, light on its toes. */
  ready: { lean: 0.1, squash: 0.96, bobHz: 1.5, bob: 0.05, sway: 0.05, otherPhase: 0.37 }, // TUNE: otherPhase keeps the two out of step
  /** A fighter left at arm's length (a dash that didn't land) hops home this fast, ms. */
  returnMs: 320, // TUNE
  camera: {
    /** Push-in on a dash and a capture, on a hit (× strength), and on a flop. */
    followPush: 0.06, // TUNE
    hitPush: 0.13, // TUNE
    koPush: 0.12, // TUNE
    /** Screen shake on a normal hit, world units (× strength). */
    shake: 0.14, // TUNE: light
  },
  /** Reduced motion: moves this size (dashes become a short lunge), no twirls or shake. */
  reduced: { size: 0.45, reach: 0.35 }, // TUNE
} as const;

/** The battle camera (owner decision 2026-10-04): it frames the fight and follows it. */
export const BATTLE_CAMERA = {
  fov: 0.78, // TUNE
  /** Near clip plane: close enough for a push-in, far enough for depth precision. */
  minZ: 0.3, // TUNE
  /** Tilt down from the horizon: low enough to see the sky behind the fight. */
  pitch: 0.35, // TUNE: about 20°
  /** What must fit on screen, world units: the fight's width and height. */
  frameWidth: 10, // TUNE
  frameHeight: 14, // TUNE: a landscape iPad
  /** Where it looks: the middle of the fight. */
  aim: { x: 0.3, y: 1, z: 0 }, // TUNE
  /**
   * Lens shift, in screen halves: the picture moves up this far, so the fight
   * sits in the top half (the caption and moves cover the bottom on a phone)
   * while the camera still looks straight at it, sky and all. Only the
   * projection changes: no extra pass.
   */
  lensShift: 0.4, // TUNE
  /** Leans the framing this far towards the fighter a step is about. */
  focusShift: 0.9, // TUNE
  /** Camera follow smoothing, per second (higher is snappier). */
  follow: 4.5, // TUNE
  /** Shake: wobbles per second and how fast it dies away. */
  shakeHz: 21, // TUNE
  shakeDecay: 9, // TUNE
} as const;
