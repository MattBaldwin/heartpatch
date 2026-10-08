/**
 * Explore view tunables (#199, owner design 2026-10-07; cozy-sim feel #291,
 * owner mockup 2026-10-08). All first guesses to judge on the playtest
 * devices. Positions on the tile are tile-local: the tile is 2 across corner
 * to corner, so a world length is a tile-local one times `hexSize`.
 */
export const EXPLORE_VIEW = {
  /**
   * The tile's size up close (corner to middle, world units). Big next to
   * the Keeper (about 1.2 tall), so walking it feels like a little world.
   */
  hexSize: 7, // TUNE
  /** The Keeper and the squishies that follow it. */
  keeperScale: 0.75, // TUNE
  squishyScale: 0.5, // TUNE
  /** Building scale (a fire on the land, #202). */
  buildingScale: 1.6, // TUNE
  /** Search-spot props, as a share of the tile's size (map props are drawn for a 0.65 tile). */
  propScale: 0.34, // TUNE
  /** Where the Keeper starts: just below the tile's middle (tile-local units). */
  start: { x: 0, z: -0.42 },
  /** It starts facing into the tile, three-quarters from behind (board a), so its face still shows. */
  startYaw: Math.PI * 0.75, // TUNE
  /** Walking speed, tile-local units a second. */
  walkSpeed: 0.3, // TUNE
  /** A tap-walk that gets no closer for this long stops (it's stuck behind something), seconds. */
  walkGiveUp: 0.6, // TUNE
  /**
   * The longest step one frame may take, seconds: a slow frame still walks,
   * yet a step (speed × this) stays far shorter than any collider, so the
   * Keeper can't skip through a rock.
   */
  maxFrameStep: 0.1, // TUNE
  /**
   * Close enough to a spot to use it: the gap between the Keeper's edge and
   * the spot's, tile-local units.
   */
  reach: 0.06, // TUNE
  /** "In front": a spot within this angle either side of where the Keeper faces, radians. */
  facingCone: (75 * Math.PI) / 180, // TUNE
  /** A tap this close to a spot's middle means that spot, tile-local units. */
  tapPick: 0.1, // TUNE
  /** The Keeper stays this far inside the tile's edge, tile-local units. */
  edgeMargin: 0.06, // TUNE
  /** Followers trail the Keeper by this much, one behind another. */
  followGap: 0.06, // TUNE
  /** The joystick: how far the knob travels, CSS pixels, and its dead zone. */
  joystick: { radius: 46, deadZone: 0.18 }, // TUNE
  /** A press that moves less than this is a tap (walk there), CSS pixels. */
  tapSlop: 10, // TUNE
  /**
   * The Keeper's collider (tile-local radius) and each spot's, by kind. The
   * Keeper slides round them and never walks through (#291). Land spots sit
   * at least `placement.minGap` (0.16) apart, so two land radii plus the
   * Keeper's stay under it and there is always a way between them; the pond
   * is wider, and a flood fill over generated tiles checks every spot can
   * still be walked up to (explore-world.test.ts).
   */
  keeperRadius: 0.028, // TUNE
  spotRadius: {
    rock: 0.045,
    tree: 0.04,
    'hollow-log': 0.046,
    'flower-bed': 0.045,
    'pumpkin-row': 0.046,
    mound: 0.045,
    pond: 0.07,
    reeds: 0.04,
    ledge: 0.046,
    cave: 0.046,
  } as Readonly<Record<string, number>>, // TUNE
  /** Any other kind of spot. */
  spotRadiusDefault: 0.045, // TUNE
  /** A building's collider, tile-local radius (a fire's footprint). */
  buildingRadius: 0.06, // TUNE
  /** How high each spot's glint floats, in map-prop units (times the prop scale). */
  glintLift: {
    rock: 0.22,
    tree: 0.62,
    'hollow-log': 0.2,
    'flower-bed': 0.16,
    'pumpkin-row': 0.22,
    mound: 0.18,
    pond: 0.08,
    reeds: 0.3,
    ledge: 0.36,
    cave: 0.32,
  } as Readonly<Record<string, number>>, // TUNE
  /** The glint's size, world units. */
  glintSize: 0.42, // TUNE
} as const;

/**
 * The follow camera (#291): close behind the Keeper, tilted about 3/4. The
 * Keeper (about 1.2 tall) fills about a fifth of the screen's height at
 * `distance` with the stage camera's 0.75 rad field of view.
 */
export const EXPLORE_CAMERA = {
  /** Looking down from the horizontal, radians. */
  pitch: (40 * Math.PI) / 180, // TUNE
  /** Camera to target, world units. */
  distance: 6.6, // TUNE
  /** The target sits this far ahead of the Keeper (tile-local +z), so it walks low on the screen. */
  lookAhead: 0.13, // TUNE
  /** The target stays this far inside the tile's edge, tile-local units. */
  edgeMargin: 0.12, // TUNE: more pushes the Keeper off a phone held upright near the edge
  /** Using a tool nudges the camera in to this share of `distance`. */
  nudge: 0.86, // TUNE
  /** Follow lag: the time constant of the ease, seconds. */
  follow: 0.14, // TUNE
  /** Closer than this (tile-local, and share of distance) counts as there: drawing stops. */
  settle: 0.0015, // TUNE
} as const;

/** Decorative props (#291): thin instances, one draw call per kind, placed from the tile. */
export const EXPLORE_DECOR = {
  /** How many of each on a tile. */
  tufts: 60, // TUNE
  pebbles: 22, // TUNE
  flowers: 18, // TUNE
  /** Kept this far from spots' and buildings' edges, and from the Keeper's start, tile-local. */
  clearance: 0.04, // TUNE
  /** Size range, as a multiple of the base mesh. */
  scale: { min: 0.7, max: 1.3 }, // TUNE
} as const;

/** The tool in hand and its motion (#291). */
export const EXPLORE_TOOL = {
  /** The held tool's size, as a multiple of the Keeper's scale. */
  scale: 1, // TUNE
  /** One swing of the tool, ms (each scoop, shake or step plays one). */
  swingMs: 420, // TUNE
  /** How far it swings, radians. */
  swingAngle: 0.9, // TUNE
} as const;

/** Finds (#291): the toast and the flight into the bag. */
export const EXPLORE_FIND = {
  /** The toast stays this long, ms. */
  toastMs: 2600, // TUNE
  /** An item's flight from the spot into the bag, ms. */
  flyMs: 900, // TUNE
  /** At most this many items fly (the rest just count). */
  flyMax: 3, // TUNE
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
  /**
   * Lantern (#291): the reducer's stage is a square this wide round the
   * cave, tile-local units, so the light's radius on the ground is
   * `lightRadius × caveArea` (about the Keeper's own glow).
   */
  caveArea: 0.5, // TUNE
} as const;
