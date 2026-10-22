/**
 * Exploring a grey village tile (#306 2a): the feel's tunables. Positions
 * are tile-local like the spots (a corner is 1 from the middle); a world
 * length is a tile-local one times `EXPLORE_VIEW.hexSize`. First guesses to
 * judge on the playtest devices.
 */
export const HOLLOWED_EXPLORE = {
  /** A searched spot's joy disc: how far it colours the land back, tile-local, and how long it takes to open, ms. */
  joy: { radius: 0.24, growMs: 900 }, // TUNE
  /** Every spot searched today: the whole tile eases back to colour over this long, ms. */
  drainFadeMs: 1200, // TUNE
  /**
   * The spark burst from a searched spot: how many, how long, how high they
   * rise and how far they spread (world units), and their size. Bigger and
   * brighter than the plan's mockup, which read as a few gold flecks.
   */
  sparks: { count: 16, burstMs: 1300, rise: 1.8, spread: 1.7, size: 0.36 }, // TUNE
  /**
   * A Hollow echo: its loop round the server's point (tile-local radius and
   * seconds a lap, on ambient time), how close spooks the Keeper and how far
   * back it pushes (tile-local), how high it hovers (world units), how big
   * it's drawn (world units tall), the wait between spooks and after
   * arriving (ms), and how much a lantern in hand shrinks its reach.
   */
  echo: {
    orbit: 0.14,
    lapSeconds: 11,
    reach: 0.11,
    push: 0.07,
    hover: 0.12,
    height: 0.7,
    cooldownMs: 1500,
    graceMs: 2000,
    lantern: 0.5,
  }, // TUNE
  /** How long the spook's line stays up, ms. */
  spookedMs: 2600, // TUNE
  /** After a win, how long the camera stays framed on the mended thing, ms (#306 PR 2b). */
  mendedShowMs: 3500, // TUNE
} as const;

/**
 * The key map card (#306 PR 2c): it waits its turn behind the joy and naming
 * cards. Once they close, a beat passes before it shows (so the moment the
 * naming card closed stays its own), and its buttons ignore taps for a
 * moment after it shows, so a tap meant for the card before can't land on it.
 */
export const KEY_HUNT = {
  /** After the card before it closes (or a busy check fails), ms before looking again. */
  afterCardMs: 1200, // TUNE
  /** Its buttons ignore taps for this long once it shows, ms. */
  tapGuardMs: 450, // TUNE
} as const;

/**
 * The hidden cellar's chests (#306, owner decision of 2026-10-22): how a lid
 * pops open and the sparkle it lets out, and the big chest's bigger moment
 * (a wobble, a slower swing, a fountain of sparkles and a beam of warm
 * light). Angles are radians, times ms, lengths world units.
 */
/**
 * The cellar's camera (#306): a little further back and higher than
 * exploring a tile, so the row of chests reads as one set, the big one in
 * the middle. Times the explore shot's distance, plus radians of pitch.
 */
export const CELLAR_CAMERA = {
  distance: 1.4, // TUNE
  pitch: (5 * Math.PI) / 180, // TUNE
} as const;

export const CELLAR_CHESTS = {
  small: {
    open: 1.95, // TUNE: how far the lid swings back
    openMs: 420, // TUNE
    sparks: 16, // TUNE
    sparkMs: 1100, // TUNE
    rise: 1.6, // TUNE
    spread: 1.2, // TUNE
    size: 0.32, // TUNE
  },
  big: {
    open: 1.85, // TUNE
    /** It wobbles first, as if something inside can't wait. */
    wobbleMs: 650, // TUNE
    wobble: 0.12, // TUNE: the lid's rattle
    openMs: 750, // TUNE
    sparks: 40, // TUNE
    sparkMs: 2200, // TUNE
    rise: 3.4, // TUNE
    spread: 2.2, // TUNE
    size: 0.5, // TUNE
    /** The beam of light out of the open chest: how tall and wide, and how long it shows. */
    beam: { height: 6, width: 1.6, ms: 2600 }, // TUNE
  },
} as const;
