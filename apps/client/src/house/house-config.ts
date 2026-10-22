import type { SkyPhase } from '@heartpatch/shared';
import type { QualityTier } from '../engine/config.js';

/*
 * The Keeper's house interior (#381 plan §1c): every tunable number in one
 * place. All first guesses, judged on the house-shots captures and the
 * owner's `?fps=1` walk on the older iPad (the device gate).
 */

/** The house grid and the shell, metres (world units). */
export const HOUSE_GRID = {
  /** One grid cell (`HouseRoomLayout` gx/gy/w/d), as PR A's data says. */
  cell: 1.6, // TUNE: about 1.6 m, so a 3 × 3 room is 4.8 m across
  /** One storey, floor to floor. */
  storey: 3.0, // TUNE
  /** Wall thickness. */
  wall: 0.24, // TUNE
  /** How tall a wall that faces the dollhouse camera is cut down to. */
  cut: 1.0, // TUNE: low enough to see over from 50°+
  /** One floor board's width (the porch's boards line up with the room's). */
  plank: 0.4, // TUNE
  /** How far the floor reaches past the open front (a little lip). */
  frontLip: 0.35, // TUNE
  /** How deep a gap between floor boards reads before the board under them, metres (B5a: no dark slit). */
  seamDepth: 0.008, // TUNE: render check: at 0.03 the boards' lit sides in a gap read as a pale line down its length
} as const;

/** Colours of the shell (sRGB). */
export const HOUSE_PALETTE = {
  wall: '#f6e4d2', // TUNE: warm cream plaster
  wallTop: '#fbeee2', // TUNE: the lighter band under the cut edge
  outside: '#b98393', // TUNE: the dusky clapboard outside
  cap: '#6b4630', // TUNE: dark wood along a cut edge (the dollhouse look)
  trim: '#8d5a3b', // TUNE: skirting
  frame: '#fff6ec', // TUNE: window frames
  planks: ['#c98b5a', '#d2956a', '#bf7f52'], // TUNE: floor boards, three tones
  /** The gaps between boards: unlit dark wood, the boards' shadow (B5a render check: a lit board read pale mauve at a grazing angle). */
  groove: '#6b4630', // TUNE: the cut-edge dark wood; lit with the boards, a gap reads about (125, 60, 30) beside them
  footing: '#8f8279', // TUNE: the stone footing under the house
  lawn: '#a9c58f', // TUNE: a pastel dusk lawn
  lawnLift: '#3a3424', // TUNE: emissive lift so the lawn stays pastel at dusk
  haze: '#f0b49a', // TUNE: dusk haze, the backdrop's horizon colour
  sky: '#5a4f9c', // TUNE: clear colour behind everything
  /** A room's beamed ceiling at kid height once the floor above is cut away (B4). */
  ceiling: {
    boards: '#efc9a2', // TUNE: pale warm boards (a flat brown read as a lid, render check)
    joists: '#c99068', // TUNE: a shade under the boards
    beam: '#8a5a39', // TUNE: the dark beams, like the roof's
    joistEvery: 0.8, // TUNE: metres
    /** High and medium: the ceiling's own soft warm lift (the fire and the lamp leave it out, H2). */
    lift: '#6a4630', // TUNE
  },
} as const;

/** Small props' detail, every tier (B5a: faceted on low). */
export const HOUSE_PROPS = {
  /** Sides on the Snug's plant pot (its rim is close to the camera at kid height). */
  potSides: 18, // TUNE: was 10
} as const;

/** Windows on exterior walls: one per wall run at least `minRun` cells long. */
export const HOUSE_WINDOWS = {
  minRun: 2, // TUNE: cells
  width: 1.3, // TUNE: metres
  height: 1.1, // TUNE
  sill: 1.2, // TUNE: bottom edge above the floor
} as const;

/** Doorways between rooms (each room's `door` side). */
export const HOUSE_DOORS = { width: 1.0, height: 2.1 } as const; // TUNE

/** Light and shadow per quality tier (plan §1c's table). */
export interface HouseTierLook {
  /** Lights lit at once, the squishy fill included. */
  readonly lights: number;
  /** Shadow map size, or 0 for none (contact shadows instead). */
  readonly shadowMap: number;
  readonly specular: boolean;
  /** The clear coat on house props (squishies keep theirs). */
  readonly clearCoat: boolean;
  /** Trees round the clearing. */
  readonly trees: number;
  /** The squishy-only fill's strength: higher without bloom and the window light. */
  readonly fill: number;
  /** Segments on the trees' round crowns (far off, in the haze). */
  readonly treeSegments: number;
  /**
   * Segments on the small round props (pillows, the yard's bushes and
   * pumpkins, the hearth's flames): never on squishies, which keep their
   * own detail on every tier.
   */
  readonly rounds: number;
}

export const HOUSE_TIERS: Readonly<Record<QualityTier, HouseTierLook>> = {
  // TUNE: all of it. B4 budget headroom: crowns 9 → 7 (high) and 6, the small rounds 10 → 7 off high.
  high: {
    lights: 4,
    shadowMap: 2048,
    specular: true,
    clearCoat: true,
    trees: 30,
    fill: 2.45, // TUNE: B4: Puddlepuff's belly reads about #e8f6ff (2.6 clips it to white, 2.35 greys it)
    treeSegments: 7,
    rounds: 10,
  },
  medium: {
    lights: 3,
    shadowMap: 1024,
    specular: true,
    clearCoat: true,
    trees: 20,
    fill: 2.45, // TUNE: B4: as high (2.8 clipped Puddlepuff's belly to white)
    treeSegments: 6,
    rounds: 7,
  },
  low: {
    lights: 2,
    shadowMap: 0,
    specular: false,
    clearCoat: false,
    trees: 12,
    fill: 3.2,
    treeSegments: 6,
    rounds: 7,
  },
};

/**
 * The low-tier budget the older iPad holds at 30 fps (coordinator,
 * 2026-10-11): `house-models.test.ts` keeps every level's shell and
 * fixtures under it, and house-shots records the real numbers.
 */
export const HOUSE_BUDGET: Readonly<
  Record<QualityTier, { drawCalls: number; triangles: number; lights: number }>
> = {
  high: { drawCalls: 110, triangles: 220_000, lights: 4 }, // TUNE: plan §1c
  // TUNE: was the plan's 160k, which assumed `low` squishies outside the
  // focus room; B4 keeps every squishy at full detail on medium (the
  // owner's bar), and the top level's ground floor alone is ~150k of
  // squishies and the Keeper. 190k keeps a tenth spare over the worst
  // frame (the entry glide, ~171k). Needs the coordinator's OK (B4 PR body).
  medium: { drawCalls: 90, triangles: 190_000, lights: 3 },
  low: { drawCalls: 60, triangles: 90_000, lights: 2 }, // TUNE: binding (iPad 9th gen)
};

/** The shadow map (high and medium). */
export const HOUSE_SHADOW = {
  /** Pieces smaller than this (metres, their biggest size) cast no shadow: the shadow pass skips them. */
  minCaster: 0.35, // TUNE
} as const;

/** Light strengths (Babylon units). */
export const HOUSE_LIGHT = {
  /** Dusk sun low through the back windows (high and medium only). */
  sun: { intensity: 1.8, color: '#ffc29a', direction: [-0.3, -0.55, -0.78] }, // TUNE
  /** The hearth's warm point light, per room that has one. */
  fire: { intensity: 12, color: '#ff9a4a' }, // TUNE
  /** A lamp's point light (high: a second warm light). */
  lamp: { intensity: 8, color: '#ffcf8a' }, // TUNE
  /** Low tier: the one warm house light over the rooms. */
  house: { intensity: 1.6, color: '#ffd6a8', direction: [0.15, -0.8, 0.55] }, // TUNE: B4 directional (was a point light, 22)
  /** Point light range: long, since PBR's range is a hard cut (a seam on the floor). */
  range: 40, // TUNE
  /** Image-based light under the lamps. */
  environment: { lit: 0.4, low: 0.48 }, // TUNE: the lamps carry the room
  /** Low tier: a warm ambient bounce stands in for the window light. */
  ambient: '#5e3c2c', // TUNE: B4: a little more, the low house light now being directional (a roof seen from inside faces away from it)
  /**
   * The squishy-only fill (ART_BIBLE: nothing changes a squishy's colours):
   * a neutral light on squishies and the Keeper alone, while every warm
   * light leaves them out, so Puddlepuff's pale belly stays pale.
   */
  fill: {
    color: '#ffffff',
    specular: 0.2, // TUNE: 0.35 left a hot spot on the Keeper's face (B4): neutral, so Puddlepuff's belly reads #e8f6ff (owner check #4)
    /**
     * Added to the camera's look direction for the fill's direction: up a
     * little and from the right. The dollhouse looks down steeply, so there
     * it comes in flatter (B5a: Puddlepuff's belly rim read grey, #b6b3bb, lit
     * from straight above); kid height keeps B4's.
     */
    tilt: { doll: [0.15, -0.1, 0], kid: [0.15, -0.45, 0] }, // TUNE: B5a render check: 0.25 up put a white streak down Puddlepuff's crown
  }, // TUNE
} as const;

/** Blanket colours, bed by bed (sRGB). */
export const HOUSE_BLANKETS = ['#9fd0ff', '#c9a0ff', '#ffd166', '#9fe0c8', '#ffb3c8', '#bfe3ff']; // TUNE

/** Tree crown colours round the clearing (sRGB): the pastel world palette. */
export const HOUSE_TREE_CROWNS = ['#9fcf9a', '#b5d89a', '#a7c9b8', '#c8b6dc', '#f0b9c8']; // TUNE

/** The cottage on its home tile (`buildCottage`), sRGB. */
export const HOUSE_COTTAGE = {
  wall: '#f6e4d2', // TUNE
  roof: '#c86a6a', // TUNE
  wingRoof: '#d98a6a', // TUNE
  heartRoof: '#d4577e', // TUNE: the top level's rosy roof
  trim: '#8d5a3b', // TUNE
  window: '#ffd27a', // TUNE: lit at dusk
  trunk: '#9b7a62', // TUNE
  canopy: ['#ff9ec4', '#ffc4da'], // TUNE: the heart-tree's pink crown
} as const;

/** Residents and the Keeper in the room. */
export const HOUSE_CAST = {
  /** A resident's size (a squishy at 1 is about a metre tall). */
  squishyScale: 0.95, // TUNE
  /** The Keeper, standing by the hearth until PR C lets it walk. */
  keeperScale: 0.8, // TUNE
  /** Leans back so its face looks up at the dollhouse camera (render check: hair hid it at 56°). */
  keeperLean: 0.24, // TUNE
  /**
   * Low tier: this many residents nearest the kid-height camera in its room
   * are drawn at the smooth detail, so the big ones on screen never look
   * faceted (owner check #4). The rest keep the low detail.
   */
  lowHeroes: 2, // TUNE: the Snug's two beds; about 10k triangles each
  /** About how far a resident reaches from its middle at scale 1, metres (spikes and ears included): the phone frame's edge misses it. */
  reach: 0.62, // TUNE
  /** At most this far off facing the camera, radians. */
  faceTurn: 0.3, // TUNE
} as const;

/** The dollhouse camera (`fitHouse`). */
export const HOUSE_CAMERA = {
  /** A viewport narrower than this (width / height) is a portrait phone. */
  phoneAspect: 0.62, // TUNE
  /** Tilt down, degrees: portrait phones look down steeper so a tall frame fills. */
  pitch: { phone: 58, wide: 48 }, // TUNE: plan 52–58° phones (steepest: a tall frame fills with house, owner check #1), 40–52° iPad/landscape
  /** Vertical field of view, degrees. */
  fov: { phone: 50, wide: 44 }, // TUNE
  /** Space kept round the house inside the safe area, CSS px. */
  margin: 10, // TUNE
  /**
   * The folded sheet's band at the bottom, CSS px (the iPhone's peek bar
   * and its gap), when the screen doesn't measure it.
   */
  sheet: 79, // TUNE
  /**
   * A portrait phone fits the focus room across plus this much of each
   * neighbour, metres (the rest is a sideways drag away).
   */
  peek: 0.4, // TUNE: B5a: the usual, nearest first; framedFocus widens it until no resident is cut or wholly off screen (render check), about 1.8 at level 2 (B4's 1.1 widened to 2.5)
  /** At most this much lawn past the house's near end keeps the focus room toward the frame's middle on a phone, metres (B5a). */
  lawn: 0.5, // TUNE
  /** The "more this way" chevron pill (CSS px): its size, how far in from the edge, and the gap it keeps from a resident. */
  chevron: { width: 28, height: 44, inset: 4, gap: 8 }, // TUNE: house.css .house-more matches
  /** Room kept between a frame edge and a resident it would slice, normalised device units. */
  edgeClear: 0.04, // TUNE
  /** How deep the front yard is (path, lanterns, bushes, fence), metres: kept in frame when there's room. */
  yard: 3.7, // TUNE: frontYard's fence and last stepping stone
  /** Pinch out past the dollhouse by this much (zoom units) and you're back home. */
  exitOvershoot: 0.18, // TUNE
  /** A mouse wheel's travel (px; a notch is about 100) that moves zoom by 1. */
  wheelPerZoom: 400, // TUNE
  /** How much pinch (log of the finger spread ratio) moves zoom by 1. */
  pinchPerZoom: 0.9, // TUNE
} as const;

/**
 * The dollhouse fits the floor it shows (the floor cut's rooms) rather than
 * the whole house: on the ground floor of a two-floor house the camera
 * comes in closer. A plain boolean, so turning it off needs no other change.
 */
export const HOUSE_FIT_FLOOR: boolean = true; // TUNE: B4 captures showed both

/** Kid height (`kidPose`, `blend`, `wallFade`): walking into a room. */
export const HOUSE_KID = {
  /** Eye height above the room's floor: a small squishy's eye level. */
  eyeHeight: 0.83, // TUNE: the approved captures
  /** Tilted up this much, degrees, so faces sit just under the middle (owner check #2: 3–4°). */
  tiltUp: 3.5, // TUNE
  /** Horizontal view angle, degrees: the room's walls and its residents across the frame. */
  horizontalFov: 44, // TUNE
  /** A tall phone's vertical view angle is capped here, degrees (less floor in view). */
  maxVerticalFov: 72, // TUNE: subjects big on a tall phone (render check: rafters and floor took half the frame)
  /** Kid height stands this far in front of the room's front, metres. */
  minStandBack: 2.9, // TUNE: residents big in the frame, the back wall still in view
  /** Room either side of the back wall in the frame, metres. */
  sideRoom: 0.3, // TUNE
  /** How far ahead the camera looks, metres (the pose's target). */
  lookAhead: 5, // TUNE
  /** The pitch holds the dollhouse look until this much of the zoom. */
  pitchFrom: 0.6, // TUNE: plan "the last 40%"
  /** A wall between the camera and the room, faded. */
  fadedAlpha: 0.15, // TUNE: the render check's ~0.15
  /** A wall this close to the line of sight still fades, metres. */
  fadeMargin: 0.4, // TUNE
  /** The front walls appear (faded) past this much zoom; the dollhouse has none. */
  frontFrom: 0.55, // TUNE
  /** A wall in the way is gone (alpha 0, not drawn) from this much zoom: none at rest at kid height. */
  clearFrom: 0.85, // TUNE
  /** How tall the soft foot is: a faded wall fades to nothing at the floor over this, metres. */
  softFoot: 1.2, // TUNE
  /** Past this much zoom you count as walked in: the button says Step out. */
  walkedIn: 0.5, // TUNE
  /** Walk in / Step out takes this long, seconds. */
  walkSeconds: 1.2, // TUNE
  /** The header over a back wall cut low (the Snug's, with the Heart Hall behind), metres deep: it holds the sign. */
  header: 0.9, // TUNE: B4 round 4: deep enough that the Heart Tree's crown never peeks under it
  /** The porch you stand on at kid height, outside the open front, metres deep. */
  porch: 5.4, // TUNE
} as const;

/**
 * The Keeper walking about inside the house (#381 W1, the approved walk
 * mockup): its pace and footprint, and the follow camera (house-walk.ts).
 */
export const HOUSE_WALK = {
  /** Metres a second at full push. */
  speed: 1.5, // TUNE
  /** The Keeper's footprint, metres: it keeps this far from walls and furniture. */
  radius: 0.28, // TUNE
  /** Furniture lower than this is walked over (rugs, mats). */
  stepOver: 0.15, // TUNE
  /** A merged piece bigger than this across the floor (beams, bunting, the gallery) never blocks, m². */
  wideIgnore: 6, // TUNE
  /** How far a floor may be from the Keeper's height and still be stepped onto, metres. */
  floorReach: 0.45, // TUNE
  /** How far the stairs' height may be from the Keeper's and still be stepped onto, metres. */
  rampReach: 0.6, // TUNE
  /** The camera's eye above the Keeper's floor: kid height, a little over its head. */
  eyeHeight: 1.7, // TUNE
  /** How far behind the Keeper the camera stands, metres. */
  back: 3.4, // TUNE
  /** The camera never turns more than this from looking into the house, degrees. */
  maxYaw: 28, // TUNE
  /** It turns this share of the way to the Keeper's heading (up to `maxYaw`). */
  turnShare: 0.5, // TUNE
  /** Heading further round than this (toward the camera), it looks straight in, radians. */
  turnAway: 1.9, // TUNE
  /** It looks at about the Keeper's chest... */
  lookHeight: 0.55, // TUNE
  /** ...this far ahead of it, metres. */
  lookAhead: 1.2, // TUNE
  /** The camera's eye and what it looks at stay at least this far apart across the floor, metres. */
  minSpan: 0.5, // TUNE
  /** Squeezed right up to the Keeper, the camera climbs this much more, metres, and looks down. */
  squeezeRise: 2.0, // TUNE
  /** An inner room's camera stops this far inside its front wall, metres. */
  frontMargin: 0.3, // TUNE
  /** ...and this far from its side walls. */
  sideMargin: 0.3, // TUNE
  /** ...and this far under its ceiling. */
  ceilingMargin: 0.3, // TUNE
  /** A front room's camera may stand this far out on the porch, metres. */
  porchBack: HOUSE_KID.minStandBack,
  /** The camera keeps this far from furniture across the floor (the low tier's Kitchen table), metres. */
  nearClear: 0.45, // TUNE
  /** ...if it stands at least this tall, metres (a toy on the floor stays out of its view). */
  nearTall: 0.5, // TUNE
  /** How finely the camera is drawn in toward the Keeper to clear furniture, metres. */
  nearStep: 0.1, // TUNE
  /** Horizontal view angle, degrees; a tall phone's vertical one is capped at `maxFov`. */
  hfov: 74, // TUNE
  maxFov: 80, // TUNE
  /** Seconds for the camera to catch up (an exponential ease). */
  lag: 0.28, // TUNE
  /** Where a Keeper put into a room stands, as shares of its walkable width and depth. */
  start: [0.5, 0.5], // TUNE
  /** A tap-walk is there within this, metres (#381 W2). */
  arrive: 0.05, // TUNE
  /** ...and gives up after getting no nearer for this long (a bed in the way), seconds. */
  giveUp: 0.4, // TUNE
  /** A tap this near the Keeper's middle in the dollhouse walks in with it, CSS px (a 44 pt target or more). */
  tapRadius: 40, // TUNE
  /** The follow camera counts as caught up within this (its eye and look summed), metres: nothing more to draw. */
  settled: 0.004, // TUNE
  /** A resident's body, as a share of its framing reach (which counts ears, spikes and room round it). */
  blockerShare: 0.85, // TUNE
  /**
   * A resident this close to the camera (metres from its body's edge) is
   * gone, and whole again by the second (the owner's render check: about 1 m).
   */
  fadeNear: [1.2, 1.8], // TUNE
  /** One across the line to the Keeper fades from its body's edge in to this share of its radius. */
  fadeEdge: 0.6, // TUNE
  /**
   * The clear lane furniture leaves in front of every inside doorway, on
   * both sides (#381 W3): this deep from the wall (the Keeper's width and a
   * little more to turn), and this much wider than the doorway each side.
   */
  doorLane: { depth: 0.86, side: 0.1 }, // TUNE: 2 × radius + 0.3
  /** A piece slid out of a doorway's lane keeps this gap from it, metres. */
  laneGap: 0.05, // TUNE
  /** The floor cut follows the Keeper up a floor once its feet are this share of a storey up it (on the stairs). */
  floorSwitch: 0.5, // TUNE
  /** ...and back down only this share of a storey below that (and up only this far above it). */
  floorBand: 0.05, // TUNE
  /** A storey up, the turned-round camera turns back only this far inside `turnAway`, radians. */
  reverseBand: 0.35, // TUNE
} as const;

/** The roof-off entry glide (a cinematic `Timeline` shot). */
export const HOUSE_GLIDE = {
  seconds: 1.8, // TUNE
  /** Starting pose: further out and lower, looking at the closed cottage. */
  startDistance: 1.7, // TUNE: times the fitted distance
  startPitch: 30, // TUNE: degrees
  /** The roof lifts over this share of the glide, then fades. */
  roofLift: 3.5, // TUNE: metres it rises
  roofFrom: 0.15, // TUNE
  roofTo: 0.7, // TUNE
} as const;

/** The outside: a lawn, trees and a little yard (the house sits in a clearing). */
export const HOUSE_OUTSIDE = {
  lawnRadius: 36, // TUNE
  treeRing: [12, 21], // TUNE: metres from the house's middle
  /** The dollhouse haze starts this far past the house and is thick here. */
  hazeFrom: 4, // TUNE
  hazeTo: 24, // TUNE
} as const;

/** The bottom sheet (Grow the house, #381 B3b). */
export const HOUSE_SHEET = {
  /**
   * A touch's click follows its release within this long: after the handle
   * opens the sheet, that click would land on whatever opened under the
   * finger, so it's swallowed.
   */
  ghostClickMs: 350, // TUNE
} as const;

/**
 * The grown rooms (#381 B3): the Playroom, the Kitchen loft and the Heart
 * Hall. Their pieces are boxes and low-segment rounds so the whole top-level
 * house stays inside the low tier's triangles; every piece merges into its
 * room's one solid mesh (and one glow mesh), so furniture adds no draw calls.
 */
export const HOUSE_GROWN = {
  /** Segments on the rounds (balls, jars, the tree's crown): low, so L4 fits the low tier. */
  segments: 4, // TUNE
  /** Sides on the round tubes (the table, stools, plates, the tree's trunk). */
  sides: 7, // TUNE
  /** Sides on the six-sided pieces (the tent, jars, paper lanterns): faceted on purpose. */
  facets: 6, // TUNE
  playroom: {
    /** The play mat's squares, front-left to back-right (sRGB). */
    mat: ['#ffb3c8', '#bfe3ff', '#ffe29a', '#b9ecc8'], // TUNE
    /** One square of the play mat, metres. */
    matCell: 0.62, // TUNE
    chest: '#c9764f', // TUNE: the toy chest's painted wood
    chestLid: '#e97a9b', // TUNE: pink, so the open lid reads against the wall
    tent: '#9ad8ff', // TUNE: the play tent's canvas
    tentStripe: '#fff6ec', // TUNE
    nightLight: '#ffe6a0', // TUNE: the star night-light's glow
  },
  kitchen: {
    stove: '#4a4250', // TUNE: the little iron stove
    stoveFire: '#ff8a3c', // TUNE: its glowing window
    pot: '#fff2e3', // TUNE: white enamel (pink read as a gem on high)
    counter: '#f2d7b8', // TUNE
    counterTop: '#9a6a46', // TUNE
    table: '#b9825a', // TUNE
    cloth: '#ffd1dc', // TUNE: the checked table cloth
    pie: '#e8a25a', // TUNE
    shelf: '#8d5a3b', // TUNE
    /** Jars and plates on the shelves (sRGB). */
    jars: ['#ffd166', '#9fe0c8', '#ff9ab8', '#c9a0ff', '#9ad8ff'], // TUNE
  },
  hall: {
    /** How far the gallery (at the second storey) reaches out from the back wall, metres. */
    galleryDepth: 1.3, // TUNE
    deck: '#c98b5a', // TUNE: planks, like the floor
    rail: '#8d5a3b', // TUNE
    gold: '#f2c14e', // TUNE: the top level's gold accents
    trunk: '#9b7a62', // TUNE
    /** The Heart Tree's crown, a heart of two pink rounds (sRGB). */
    crown: ['#ffc2dc', '#ffb0d2'], // TUNE: left and right lobes
    /** The crown's glow, its foot to its top (it's unlit, so the same pink on every tier). */
    crownGlow: ['#c48fa4', '#eebfd0'], // TUNE: the low tier's lit pink (#c7899e) at its middle
    lantern: '#ffd27a', // TUNE: hanging lanterns along the gallery
    /** The warm pool of light on the floor under each hanging lantern, metres across its middle (B5a). */
    lanternPool: 1.6, // TUNE
    sparkle: '#fff2b0', // TUNE: the tree's sparkles
    rug: '#e97a9b', // TUNE
    rugEdge: '#f2c14e', // TUNE
    /** Where the first residents stand, as shares of the hall's width and depth. */
    residentBand: [
      [0.66, 0.32],
      [0.8, 0.3],
      [0.8, 0.5],
      [0.8, 0.7],
    ], // TUNE: B5a: the front two back a little, so the Hall's cut-low front wall never slices a resident's bottom from the iPad;  all right of the Kitchen loft, which hides the left from the iPad's 48° pitch; B4 round 3: the first moved right, clear of the loft's side wall on a phone
    /** Steps up to the gallery. */
    steps: 10, // TUNE
    stairWidth: 1.0, // TUNE: metres
    /** The walkway from the gallery down the west wall to an upstairs doorway, and its landing (#381 W3), metres wide. */
    walkway: 1.2, // TUNE
  },
} as const;

/*
 * The living house (#381 H2): the daily gift box, welcome home, and the
 * light that follows the real clock, with the fire's flicker.
 */

/** The daily gift box by the giver's bed (or the hearth): vinyl, wrapped, a ribbon and a bow. */
export const HOUSE_GIFT = {
  /** The box's edge, metres (a squishy is about a metre tall). */
  size: 0.38, // TUNE
  wrap: '#ff8fb8', // TUNE: pink paper
  lid: '#ffa9c8', // TUNE: a shade lighter, so the lid reads
  ribbon: '#fff2b0', // TUNE: a pale gold ribbon
  bow: '#f2c14e', // TUNE: the bow, a little deeper
  /** The bow's two ribbon loops, metres: across a loop, the ribbon's thickness and width, and how far each leans out (radians). */
  bowLoop: { diameter: 0.14, thickness: 0.036, width: 0.08, lean: 0.75 }, // TUNE: B5a render check: 0.022 thick read as a wire handle
  /**
   * The Snug's spare spot, metres from its x0 and z0: by the east wall behind
   * the side table, clear of the cast from kid height (B5a render check: by
   * the hearth it sat on the hearthstone, and no spot off the stone there
   * keeps out of the way of the two on the rug and the Keeper).
   */
  snugSpare: { x: 4.2, z: 1.7 }, // TUNE
  /** The gap between the bed's side and the box, metres. */
  besideBed: 0.3, // TUNE
  /** Kept this far inside the room's walls, metres. */
  wallGap: 0.34, // TUNE
  /** About how far the Keeper reaches from its middle, metres (the box keeps clear of it). */
  keeperReach: 0.35, // TUNE
  /** A tap this close to the box on screen opens it (CSS px). */
  tapRadius: 52, // TUNE: a 44pt target and a little more
} as const;

/** Welcome home: the first open of the house on a patch day. */
export const HOUSE_WELCOME = {
  /** The line stays up this long, ms, unless the sheet moves first. */
  lineMs: 4500, // TUNE
  /** localStorage, per map: the patch day last welcomed (cosmetic; a failure counts as welcomed). */
  storageKey: 'heartpatch.houseWelcome',
} as const;

/** The fire and lamp flicker: a slow timer, never per-frame rendering. */
export const HOUSE_FLICKER = {
  /** Ticks a second while the house is on screen and the page shows (0: a still fire). */
  hz: { high: 9, medium: 8, low: 0 } satisfies Readonly<Record<QualityTier, number>>, // TUNE: low stays still, so an idle house draws nothing on the iPad 9th gen
  /** How far the light dips and lifts, a share of its strength. */
  depth: { fire: 0.16, lamp: 0.05 }, // TUNE
} as const;

/** The time-of-day look is checked this often while the house is open, ms (never per frame). */
export const HOUSE_LOOK_EVERY_MS = 60_000; // TUNE

/** One time of day's light in the house (sRGB): the windows, the sky outside, the lamps. */
export interface HouseTimeLook {
  /** The sky dome's colours from the horizon up, at the dome's six stops. */
  readonly sky: readonly [string, string, string, string, string, string];
  readonly haze: string;
  readonly clear: string;
  /** The lawn outside (night: moonlit blue-green, like explore's ground). */
  readonly lawn: string;
  readonly lawnLift: string;
  /** The windows: the painted picture behind the glass. */
  readonly pane: 'day' | 'dusk' | 'night';
  /** The lamps and the fire are lit (dusk and night). */
  readonly lit: boolean;
  /** High and medium: the light through the back windows (it casts the shadows). */
  readonly sun: { readonly color: string; readonly intensity: number };
  /** Low: the one warm house light. */
  readonly house: { readonly color: string; readonly intensity: number };
  /** Low: the warm ambient bounce. */
  readonly ambient: string;
  /** The fire's light and the floor's light pools, times their strength. */
  readonly lamps: number;
  /** The table lamp's light (high and medium), times its strength: gentler at night, so its hotspot never washes the table out. */
  readonly lamp: number;
  /**
   * High and medium: the image-based light, times `HOUSE_LIGHT.environment.lit`.
   * By day it stands in for the window light the dimmer lamps leave (the sun
   * comes through the back windows, so the shell shades most of the room).
   */
  readonly environment: number;
  /** High and medium: the sun's (or moon's) highlight, a share of its colour: soft, so no beam edge glints. */
  readonly sunSpecular: number;
  /** Lamp shades, flames and lanterns (their unlit glow), times their colour. */
  readonly glow: number;
  /**
   * High and medium: a warm ambient lift on the house's own materials, times
   * their colour (so dark wood stays dark), for the rooms the fire doesn't
   * reach (B5a: they read dim and mauve against low's peach). Never on the
   * squishies or the Keeper. No light: the light caps stay as they are.
   */
  readonly lift: string;
  /** High and medium: the beamed ceiling's own warm lift at kid height, times its colour (B5a: muddy at dusk and night). */
  readonly ceiling: string;
  /** The yard's lantern pools on the lawn, times their strength (B5a: none by day). */
  readonly yard: number;
}

/**
 * The house's light at each time of day, following explore's sky (#335,
 * `SKY_LOOKS`). Dusk is the look B1–B4 were judged on, unchanged.
 * Squishies and the Keeper never take any of it (their own neutral fill).
 */
export const HOUSE_TIMES: Readonly<Record<SkyPhase, HouseTimeLook>> = {
  dawn: {
    sky: ['#f6cdb4', '#f6cdb4', '#ffd6b0', '#e8bcc4', '#b8afd8', '#8fa2e3'], // TUNE: SKY_LOOKS.dawn
    haze: '#f6cdb4', // TUNE
    clear: '#8fa2e3',
    lawn: '#a9c58f', // TUNE
    lawnLift: '#3e3828', // TUNE
    pane: 'dusk',
    lit: false,
    sun: { color: '#ffd9c2', intensity: 1.7 }, // TUNE
    house: { color: '#ffe0c2', intensity: 1.6 }, // TUNE
    ambient: '#5e4232', // TUNE
    lamps: 0.7, // TUNE
    lamp: 0.7, // TUNE
    environment: 1.7, // TUNE
    sunSpecular: 0.3, // TUNE
    glow: 1,
    lift: '#957965', // TUNE: B5a: as dusk, so dawn never reads gloomier than dusk
    ceiling: '#2a1c12', // TUNE: B5a
    yard: 0.35, // TUNE: B5a: the lanterns fading out with the night
  },
  day: {
    sky: ['#e3efe0', '#e3efe0', '#e6f7ff', '#bfe6fa', '#96d3f5', '#6fbff0'], // TUNE: SKY_LOOKS.day
    haze: '#e3efe0', // TUNE: pale, so the far trees fade into daylight
    clear: '#6fbff0',
    lawn: '#afcb92', // TUNE: a touch brighter in daylight
    lawnLift: '#46503a', // TUNE
    pane: 'day',
    lit: false,
    sun: { color: '#fff1dc', intensity: 2.1 }, // TUNE: warm daylight
    house: { color: '#fff0dc', intensity: 1.75 }, // TUNE
    ambient: '#6a5444', // TUNE
    lamps: 0.6, // TUNE: the hearth still glows; the lamps all but off
    lamp: 0.45, // TUNE
    environment: 2.0, // TUNE: daylight fills the room (H2 render check: day on high read dimmer than dusk)
    sunSpecular: 0.12, // TUNE: no white glint along the rafters (H2 render check)
    glow: 0.9, // TUNE
    lift: '#6c594b', // TUNE: B5a: high's walls read pinker than low's by day too; keeps day at or over dusk
    ceiling: '#000000', // TUNE: B5a: daylight lights it already
    yard: 0, // TUNE: B5a: no lantern pools at noon
  },
  dusk: {
    sky: ['#f0b49a', '#f0b49a', '#f3ae98', '#d99bb0', '#8d78b8', '#4e4a96'], // B4's dusk dome
    haze: HOUSE_PALETTE.haze,
    clear: HOUSE_PALETTE.sky,
    lawn: HOUSE_PALETTE.lawn,
    lawnLift: HOUSE_PALETTE.lawnLift,
    pane: 'dusk',
    lit: true,
    sun: { color: HOUSE_LIGHT.sun.color, intensity: HOUSE_LIGHT.sun.intensity },
    house: { color: HOUSE_LIGHT.house.color, intensity: HOUSE_LIGHT.house.intensity },
    ambient: HOUSE_LIGHT.ambient,
    lamps: 1,
    lamp: 1,
    environment: 1,
    sunSpecular: 0.6,
    glow: 1,
    lift: '#957965', // TUNE: B5a: most of the way to low's peach away from the fire (#987a71 → about #c49a85)
    ceiling: '#9e6e4b', // TUNE: B5a: warm, not muddy (house4 kid iPad read (154,89,60))
    yard: 1,
  },
  night: {
    sky: ['#5a5f96', '#5a5f96', '#4d5596', '#3c4682', '#2c376f', '#1e2a5e'], // TUNE: SKY_LOOKS.night: a friendly blue, never black
    haze: '#555a90', // TUNE
    clear: '#1e2a5e',
    lawn: '#7f9e98', // TUNE: moonlit blue-green (explore's night groundTint)
    lawnLift: '#1f2434', // TUNE: moonlit
    pane: 'night',
    lit: true,
    sun: { color: '#b9c4ff', intensity: 0.9 }, // TUNE: moonlight through the back windows
    house: { color: '#ffcf94', intensity: 1.5 }, // TUNE: the lamps carry the room
    ambient: '#46302a', // TUNE
    lamps: 1, // TUNE: as dusk (1.15 turned the Heart Hall's ceiling orange at kid height)
    lamp: 0.6, // TUNE: the table lamp's hotspot washed the side table out at 1.15
    environment: 1.05, // TUNE
    sunSpecular: 0.12, // TUNE: no lavender glint along the rafters
    glow: 1,
    lift: '#6c594b', // TUNE: B5a: the Heart Hall and the right-hand rooms out of the gloom; render check: #957965 left kid-height night at 92% of day
    ceiling: '#5e3e2a', // TUNE: B5a: evening, under dusk's
    yard: 1,
  },
};

/**
 * How much each light brightens the room's walls, for `interiorLight` (a
 * proxy the time-of-day test compares: day must never read dimmer than
 * dusk). Per unit of strength, judged against the H2 captures' wall samples.
 */
export const HOUSE_INTERIOR = {
  /** High and medium: the image-based light, per unit of intensity. */
  environment: 1, // TUNE
  /** High and medium: the fire and the table lamp at full strength. */
  fire: 0.35, // TUNE
  lamp: 0.15, // TUNE
  /** High and medium: the warm ambient lift, per unit of its lightness. */
  lift: 1, // TUNE
  /** Low: the ambient bounce (its lightness) and the house light (its lightness times strength). */
  ambient: 1, // TUNE
  house: 0.35, // TUNE
} as const;

/** The painted windows (sRGB): the sky behind the glass, top to bottom, and the hills. */
export const HOUSE_PANES = {
  day: {
    sky: ['#6fbff0', '#a9dcf7', '#d8f1ff', '#f2fbff'],
    hills: '#8fbf86',
    stars: false,
  },
  dusk: {
    sky: ['#4f4596', '#a46aa6', '#f29a86', '#ffc27a'],
    hills: '#5c4a6e',
    stars: true,
  },
  night: {
    sky: ['#141d4a', '#1e2a5e', '#2c376f', '#3c4682'],
    hills: '#1a2140',
    stars: true,
  },
} as const; // TUNE
