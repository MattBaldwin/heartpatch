/**
 * Explore view tunables (#199, owner design 2026-10-07). All first guesses
 * to judge on the playtest devices.
 */
export const EXPLORE_VIEW = {
  /**
   * The tile's size up close (corner to middle, world units). The camera
   * stays put, so the whole tile fits a portrait iPhone at its start zoom.
   */
  hexSize: 3.4, // TUNE
  /** Where the camera looks, past the tile's middle (tile-local z): the HUD covers the top. */
  cameraAim: 0.12, // TUNE
  /** The Keeper and the squishies that follow it. */
  keeperScale: 0.75, // TUNE
  squishyScale: 0.5, // TUNE
  /** Building scale (a fire on the land, #202), as on the home view. */
  buildingScale: 1.3, // TUNE
  /** Search-spot props, as a share of the tile's size. */
  propScale: 0.5, // TUNE
  /** Where the Keeper starts: just below the tile's middle (tile-local units). */
  start: { x: 0, z: -0.42 },
  /** Walking speed, tile-local units a second (the tile is 2 across corner to corner). */
  walkSpeed: 0.55, // TUNE
  /** Close enough to a spot to search it, tile-local units. */
  reach: 0.17, // TUNE: a little more than the spots' `minGap`
  /** The Keeper stays this far inside the tile's edge, tile-local units. */
  edgeMargin: 0.1, // TUNE
  /** Followers trail the Keeper by this much, one behind another. */
  followGap: 0.12, // TUNE
  /** The floating joystick: how far the knob travels, CSS pixels, and its dead zone. */
  joystick: { radius: 46, deadZone: 0.18 }, // TUNE
  /** A press that moves less than this is a tap (walk there), CSS pixels. */
  tapSlop: 10, // TUNE
} as const;

/** The mini-interactions (owner design 2026-10-07): how much of each makes a search. */
export const INTERACTION = {
  /** Shovel: downward swipes (or taps on the easy button) to dig. */
  digScoops: 3, // TUNE
  /** A swipe counts once it travels this far, CSS pixels. */
  swipePx: 40, // TUNE
  /** Rope: alternating left and right taps to reach the ledge. */
  climbSteps: 6, // TUNE
  /** Rope's easy way and lifting a rock: hold this long, ms. */
  holdMs: 900, // TUNE
  /** Hands on a tree or flower bed: changes of direction to shake it. */
  shakes: 4, // TUNE
  /** Net: the glow comes and goes on this cycle, ms; the first `glowMs` of it glows. */
  netCycleMs: 1600, // TUNE
  netGlowMs: 650, // TUNE
  /** Lantern: the light's radius as a share of the cave's width, and the glint's reach. */
  lightRadius: 0.24, // TUNE
} as const;
