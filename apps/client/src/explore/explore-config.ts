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
  /** The Keeper. */
  keeperScale: 0.75, // TUNE
  /** Building scale (a fire on the land, #202). */
  buildingScale: 1.6, // TUNE
  /** Search-spot props, as a share of the tile's size (map props are drawn for a 0.65 tile). */
  propScale: 0.34, // TUNE
  /** Where the Keeper starts: just below the tile's middle (tile-local units). */
  start: { x: 0, z: -0.42 },
  /**
   * It starts turned to its left and a little towards the camera (yaw π/2
   * faces −x), so its face shows in profile under the camera behind it
   * (board a), not just the back of its hair.
   */
  startYaw: Math.PI * 0.4, // TUNE
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
  /** Picking what's in front: each tile-local unit of gap counts as this many radians off-heading. */
  frontWeight: 4, // TUNE: nearly ahead beats a little closer
  /** A walk to a spot stops this share of `reach` outside its collider (well in reach). */
  standOff: 0.4, // TUNE
  /** A tap this close to a spot's middle means that spot, tile-local units. */
  tapPick: 0.1, // TUNE
  /** The Keeper stays this far inside the tile's edge, tile-local units. */
  edgeMargin: 0.06, // TUNE
  /**
   * The tile's corners are rounded (`CORNER`): nothing reaches further from
   * the middle than this, less the margin, tile-local units (the rounded
   * rim's corner is about 0.92 out on a 0.95 tile).
   */
  cornerReach: 0.92, // TUNE
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
    // A grey village's broken thing (#306 PR 2b): the Relight puzzle.
    puzzle: 0.05,
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
  /** The glint sits off to one side of its prop, this share of the spot's collider. */
  glintSide: 0.6, // TUNE
  /** The soft halo under the spot in front: its radius (times the spot's collider) and opacity. */
  halo: { size: 1.5, alpha: 0.6 }, // TUNE
} as const;

/**
 * The follow camera (#291, board a): behind and above the Keeper, tilted
 * about 3/4, so its face or profile reads and it stands about a sixth to a
 * fifth of the screen's height (the stage camera's field of view is 0.75
 * rad, vertical). Far and high enough to look down over its hair, so a spot
 * right beside it stays in view. A tall, narrow phone looks flatter and
 * closer than a tablet; screens in between blend the two.
 */
export const EXPLORE_CAMERA = {
  /** A phone held upright (width ÷ height at or under `aspect`): looking down from the horizontal, radians, and camera to target, world units. */
  phone: { aspect: 0.5, pitch: (28 * Math.PI) / 180, distance: 7.5 }, // TUNE: #335 lower, so the sky shows over the far trees; a step back so the foreground breathes
  /** A tablet or wider (at or over `aspect`). */
  tablet: { aspect: 0.75, pitch: (31 * Math.PI) / 180, distance: 7.6 }, // TUNE
  /** The target sits this far ahead of the Keeper (tile-local +z), so it walks low on the screen and the ground ahead shows. */
  lookAhead: 0.18, // TUNE
  /** With the lantern lit the Keeper and its light sit higher, clear of the overlay (board g). */
  lightLookAhead: -0.14, // TUNE
  /** The target stays this far inside the tile's edge, tile-local units. */
  edgeMargin: 0.12, // TUNE: more pushes the Keeper off a phone held upright near the edge
  /** Using a tool nudges the camera in to this share of `distance`. */
  nudge: 0.86, // TUNE
  /** Follow lag: the time constant of the ease, seconds. */
  follow: 0.14, // TUNE
  /** Closer than this (tile-local, and share of distance) counts as there: drawing stops. */
  settle: 0.0015, // TUNE
  /** The glint is baked tipped back by this much to face the camera, radians. */
  glintTilt: (36 * Math.PI) / 180, // TUNE: about the phone and tablet pitches
} as const;

/**
 * Compiling what shows later (the tools, faded spots, the night's motes) while
 * the scene loads (#501 D1): the longest the stage waits on it before it
 * settles anyway, ms. A phone compiles a program in 50–300 ms.
 */
export const EXPLORE_PREWARM = {
  maxMs: 5000, // TUNE
} as const;

/**
 * Props between the camera and the Keeper fade (#291), so a tree never
 * hides it: a spot taller than the Keeper's middle, in front of it (towards
 * the camera) and within this much of its line, tile-local units.
 */
export const EXPLORE_FADE = {
  /** Beside the Keeper's line: this plus the spot's own collider, doubled for its canopy. */
  side: 0.04, // TUNE
  /** A faded prop's opacity. */
  alpha: 0.45, // TUNE: see-through, but still reads as the prop, not a pale ghost
  /**
   * On screen (#335), a spot fades only if its outline covers at least this
   * share of the Keeper's, so a stone beside the Keeper stays solid.
   */
  cover: 0.12, // TUNE
  /** The Keeper's half-width on screen, as a share of its height there. */
  keeperHalfWidth: 0.36, // TUNE
  /**
   * A glint keeps clear of the whole Keeper (#335): its spiky hair, hands and
   * feet, half its height either side; the glint's halo is this many times
   * its star.
   */
  glintClearHalfWidth: 0.55, // TUNE
  glintHalo: 1.6, // TUNE
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
  /**
   * Decor stays this far inside the tile's hex, tile-local: the tile's top
   * (TILE_FILL 0.95) ends about 0.82 out on a flat side, and the bevel
   * before it.
   */
  edgeMargin: 0.07, // TUNE
  /** How far across the tile decor scatters before the edge check, tile-local (x is narrower). */
  spread: { x: 0.9, z: 1 }, // TUNE
} as const;

/** The tool in hand and its motion (#291). */
export const EXPLORE_TOOL = {
  /** The held tool's size, as a multiple of the Keeper's scale. */
  scale: 1, // TUNE
  /** One swing of the tool, ms (each scoop, shake or step plays one). */
  swingMs: 420, // TUNE
  /** How far it swings, radians. */
  swingAngle: 0.9, // TUNE
  /** How hard the Keeper jiggles with each swing (0–1). */
  jiggle: 0.6, // TUNE
} as const;

/**
 * The Keeper hops as it walks (#317, owner mockup 2026-10-09):
 * one hop per stride, so the hop rate follows the ground covered. Distances
 * are tile-local, like `walkSpeed`; heights are a share of the hopper's own
 * height. "Effort" blends small hops (a gentle push) into big ones (full
 * stick). The hop is drawn only: colliders and the ground point don't move.
 */
export const EXPLORE_HOP = {
  /** Ground covered by one hop at no effort and at full effort (full stick is about 3 hops a second). */
  stride: { min: 0.045, max: 0.095 }, // TUNE
  /** Hop height, share of the hopper's height, at no effort and at full effort. */
  height: { min: 0.07, max: 0.16 }, // TUNE
  /** Every walk starts at this share of the stick's effort, growing to all of it over `warmUp`. */
  warmFloor: 0.45, // TUNE: a tap-walk (always full speed) still starts small
  warmUp: 0.12, // TUNE
  /** Effort eases toward the stick with this time constant, seconds. */
  effortEase: 0.15, // TUNE
  /** Share of each hop spent on the ground, squashed. */
  contact: 0.14, // TUNE
  /** Height squash on landing and stretch on take-off (width keeps the volume). */
  squash: 0.12, // TUNE
  stretch: 0.08, // TUNE
  /** Let go in mid-air: the longest it takes to come down, ms. */
  landMs: 120, // TUNE
  /** The settle squish when the walk stops: how long, ms, how deep, and its rebound. */
  settleMs: 260, // TUNE
  settleSquash: 0.1, // TUNE
  settleRebound: 0.03, // TUNE
  /** The shadow at the top of the highest hop, as a share of its width on the ground. */
  shadowMin: 0.7, // TUNE
  /** …and fades by this share of its opacity (#323), so the hop reads clearly. */
  shadowFade: 0.45, // TUNE
  /** Reduce Motion: a bob this share of the height, one per stride, nothing squashes. */
  bob: 0.025, // TUNE
  /** A move longer than this many full-speed frames is a jump to a new place, not a step. */
  teleportFrames: 1.5, // TUNE
} as const;

/** Finds (#291): the toast and the flight into the bag. */
export const EXPLORE_FIND = {
  /** The toast stays this long, ms. */
  toastMs: 2600, // TUNE
  /** An item's flight from the spot into the bag, ms. */
  flyMs: 900, // TUNE
  /** At most this many items fly (the rest just count). */
  flyMax: 3, // TUNE
  /** The items fan out this far apart and pop up this high before they fly, CSS pixels. */
  flySpread: 26, // TUNE
  flyLift: 70, // TUNE
  /** Each item leaves this long after the one before, ms. */
  flyStagger: 120, // TUNE
  /** The bag's bounce as they land: how long, ms, and how big. */
  bagBounceMs: 420, // TUNE
  bagBounce: 1.18, // TUNE
} as const;

/** The mini-interactions (owner design 2026-10-07): how much of each makes a search. */
export const INTERACTION = {
  /** Shovel: downward swipes (or taps on the easy button) to dig. */
  digScoops: 3, // TUNE
  /** A swipe counts once it travels this far, CSS pixels. */
  swipePx: 40, // TUNE
  /** Walking Stick: alternating left and right taps to reach the ledge. */
  climbSteps: 6, // TUNE
  /** The Walking Stick's easy way and lifting a rock: hold this long, ms. */
  holdMs: 900, // TUNE
  /** Snorkel at a bubble spring: bubbles to catch, a tap each (#335). */
  diveBubbles: 4, // TUNE
  /** Snorkel at a reed bed: swipes to part the reeds (#335). */
  partSwipes: 2, // TUNE
  /** Walking Stick at a snow drift: pokes till it slumps (#335). */
  pokes: 3, // TUNE
  /** Hands on glow mushrooms: caps to boop (#335). */
  boops: 3, // TUNE
  /** Hands on a tree or flower bed: changes of direction to shake it. */
  shakes: 4, // TUNE
  /** Snorkel: the glow comes and goes on this cycle, ms; the first `glowMs` of it glows. */
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

/**
 * Under a lake (#335, owner's second pass): a Keeper who floats and swims,
 * with the Snorkel's mask on its face. The water's own life (kelp, fish,
 * bubbles, caustics) is in lake-config.ts.
 */
export const EXPLORE_UNDERWATER = {
  /** The mask on the face: up the Keeper's height, forward and size by its width. */
  mask: { up: 0.74, forward: 0.42, size: 0.8 }, // TUNE
} as const;

/**
 * Swimming under a lake (#399, owner's pick "Glide and kick"): the Keeper
 * stretches out head first; each kick bunches it up and shoots it ahead of
 * its pace, then it glides back. Like the hop, the stroke follows the water
 * covered, never the clock.
 */
export const EXPLORE_SWIM = {
  /** The Keeper pitches about this share of its height up (its head), not its feet: the head stays on (about) its point and the legs trail. */
  pivot: 0.7, // TUNE
  /** Water covered by one stroke at no effort and at full effort, tile-local (full stick is about 1.6 strokes a second). */
  stroke: { min: 0.13, max: 0.19 }, // TUNE
  /** Effort eases toward the stick with this time constant, seconds. */
  effortEase: 0.2, // TUNE
  /** Stretching out into the swim, and back up to tread water, time constants in seconds. */
  stretchIn: 0.18, // TUNE
  stretchOut: 0.35, // TUNE
  /** Afloat this share of the swimmer's height above the sand: a clear gap of water under the steep camera. */
  float: 0.45, // TUNE: the pivot lifts a swimming Keeper higher still
  /** The camera leads a swimmer by this many times its follow lag, so the long body sits mid-screen. */
  cameraLead: 1.6, // TUNE
  /** Forward pitch while swimming, radians (about 66°, toward flat). */
  pitch: 1.15, // TUNE
  /**
   * Each stroke: the share spent kicking, how far the kick surges ahead
   * (share of the height), how much it bunches up then stretches out, how
   * quickly the glide gives the surge back (per stroke), and a small nose
   * dip and bob.
   */
  kick: { share: 0.22, surge: 0.38, squash: 0.14, stretch: 0.12, decay: 3.2, dip: 0.1, bob: 0.03 }, // TUNE
  /** Treading water: bob height (share of the height) and bobs a second. */
  tread: { bob: 0.04, rate: 0.45 }, // TUNE
  /** The soft shadow under a swimmer's middle: width (times its contact shadow) and opacity. */
  shadow: { scale: 1.1, alpha: 0.75 }, // TUNE
  /**
   * Bubbles puffed from the mask on each kick (never on letting go): how
   * many, the pool, how long each lives (ms), how far it rises and its size
   * (world units), how far apart they start and the stagger between them (ms).
   */
  bubbles: {
    perKick: 3,
    pool: 9,
    lifeMs: 900,
    rise: 0.9,
    size: 0.13,
    spread: 0.2,
    staggerMs: 140,
    /** Each kick's bubbles in turn, as a share of the full size. */
    sizes: [1, 0.7, 0.85],
  }, // TUNE
  /** Kick bubbles are one extra draw: only on the high tier, so the iPad 9th gen's low and medium tiers pay nothing (owner, 30 fps with no headroom). */
  bubbleTiers: { high: true, medium: false, low: false }, // TUNE
} as const;
