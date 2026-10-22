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
  /**
   * A memory puzzle (PR 2b; its collider is `EXPLORE_VIEW.spotRadius.puzzle`):
   * how long each piece lights up while
   * it shows the order and the pause between (ms), how many wrong taps
   * before the next piece glows by itself, and how long a wrong piece wobbles.
   */
  puzzle: {
    showMs: 750,
    gapMs: 250,
    missesForGlow: 2,
    wobbleMs: 450,
  }, // TUNE
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
