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
 * The cellar key's treasure map (#306, owner decision 2026-10-22): an old
 * parchment drawing of the patch before the Hollow Man (treasure-map.ts).
 * Sepia inks (sRGB), sizes in CSS pixels.
 */
export const TREASURE_MAP = {
  /** Parchment round the land, px. */
  margin: 18, // TUNE
  /** Steps of land shown round the Hollow and the key (a closer map reads better on a phone). */
  around: 3, // TUNE
  /** How much the rim's tiles fade into the paper, 0–1. */
  rimFade: 0.55, // TUNE
  /** The tallest the drawing gets, as a share of the screen's height. */
  maxScreenShare: 0.46, // TUNE
  /** Drawn at the device's pixel ratio up to this (never pixelated, never huge). */
  maxDpr: 3,
  ink: {
    paper: '#fbf0d6',
    paperMid: '#f3e0b5',
    paperEdge: '#e0c08a',
    edge: 'rgb(122 84 40 / 45%)',
    sea: 'rgb(96 120 120 / 55%)',
    grid: 'rgb(110 78 40 / 16%)',
    coast: '#6e4a22',
    doodle: '#6e4a22',
    tree: '#b9a36a',
    peak: '#efe0bd',
    pumpkin: '#e2a95c',
    trail: '#8a3b2a',
    cross: '#a3361f',
    glow: 'rgb(255 205 90 / 85%)',
    land: {
      meadow: '#eedcab',
      forest: '#d9c48c',
      'old-forest': '#c9b07a',
      hills: '#e6cf98',
      mountains: '#d8c39a',
      lake: '#c9d3bd',
      pumpkins: '#ecd096',
      gap: '#e8d6c0',
    },
  },
} as const; // TUNE

/**
 * The key's tile on the world map while I hunt for it (#306, owner decision
 * 2026-10-22): a soft gold glow over the tile, breathing gently. One mesh,
 * one draw call, only while a hunt is on; it breathes only on frames the map
 * draws anyway (still with reduced motion). Linear RGB, alpha.
 */
export const KEY_GLOW = {
  look: { rgb: [1, 0.88, 0.42], fill: 0.72, edge: 1 },
  /** Its softest and brightest, as a share of the look. */
  low: 0.55,
  high: 1,
  /** One breath, seconds. */
  periodS: 2.4,
  /** Over the tile's top, world units: above a homestead's glow, so the two never z-fight. */
  lift: 0.03,
} as const; // TUNE
