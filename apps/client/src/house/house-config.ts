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
  /** How far the floor reaches past the open front (a little lip). */
  frontLip: 0.35, // TUNE
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
  footing: '#8f8279', // TUNE: the stone footing under the house
  lawn: '#a9c58f', // TUNE: a pastel dusk lawn
  lawnLift: '#3a3424', // TUNE: emissive lift so the lawn stays pastel at dusk
  haze: '#f0b49a', // TUNE: dusk haze, the backdrop's horizon colour
  sky: '#5a4f9c', // TUNE: clear colour behind everything
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
}

export const HOUSE_TIERS: Readonly<Record<QualityTier, HouseTierLook>> = {
  high: { lights: 4, shadowMap: 2048, specular: true, clearCoat: true, trees: 30, fill: 2.6 }, // TUNE
  medium: { lights: 3, shadowMap: 1024, specular: true, clearCoat: true, trees: 20, fill: 2.8 }, // TUNE
  low: { lights: 2, shadowMap: 0, specular: false, clearCoat: false, trees: 12, fill: 3.2 }, // TUNE
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
  medium: { drawCalls: 90, triangles: 160_000, lights: 3 }, // TUNE
  low: { drawCalls: 60, triangles: 90_000, lights: 2 }, // TUNE: binding (iPad 9th gen)
};

/** Light strengths (Babylon units). */
export const HOUSE_LIGHT = {
  /** Dusk sun low through the back windows (high and medium only). */
  sun: { intensity: 1.8, color: '#ffc29a', direction: [-0.3, -0.55, -0.78] }, // TUNE
  /** The hearth's warm point light, per room that has one. */
  fire: { intensity: 12, color: '#ff9a4a' }, // TUNE
  /** A lamp's point light (high: a second warm light). */
  lamp: { intensity: 8, color: '#ffcf8a' }, // TUNE
  /** Low tier: the one warm house light over the rooms. */
  house: { intensity: 22, color: '#ffd6a8' }, // TUNE
  /** Point light range: long, since PBR's range is a hard cut (a seam on the floor). */
  range: 40, // TUNE
  /** Image-based light under the lamps. */
  environment: { lit: 0.4, low: 0.48 }, // TUNE: the lamps carry the room
  /** Low tier: a warm ambient bounce stands in for the window light. */
  ambient: '#4a2e22', // TUNE
  /**
   * The squishy-only fill (ART_BIBLE: nothing changes a squishy's colours):
   * a neutral light on squishies and the Keeper alone, while every warm
   * light leaves them out, so Puddlepuff's pale belly stays pale.
   */
  fill: { color: '#ffffff', specular: 0.35 }, // TUNE: neutral, so Puddlepuff's belly reads #e8f6ff (owner check #4)
} as const;

/** Blanket colours, bed by bed (sRGB). */
export const HOUSE_BLANKETS = ['#9fd0ff', '#c9a0ff', '#ffd166', '#9fe0c8', '#ffb3c8', '#bfe3ff']; // TUNE

/** Tree crown colours round the clearing (sRGB): the pastel world palette. */
export const HOUSE_TREE_CROWNS = ['#9fcf9a', '#b5d89a', '#a7c9b8', '#c8b6dc', '#f0b9c8']; // TUNE

/** The cottage on the Heart Seed tile (`buildCottage`), sRGB. */
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
  /** Pinch out past the dollhouse by this much (zoom units) and you're back home. */
  exitOvershoot: 0.18, // TUNE
  /** A mouse wheel's travel (px; a notch is about 100) that moves zoom by 1. */
  wheelPerZoom: 400, // TUNE
  /** How much pinch (log of the finger spread ratio) moves zoom by 1. */
  pinchPerZoom: 0.9, // TUNE
} as const;

/** Kid height (`kidPose`, `blend`, `wallFade`): walking into a room. */
export const HOUSE_KID = {
  /** Eye height above the room's floor: a small squishy's eye level. */
  eyeHeight: 0.83, // TUNE: the approved captures
  /** Tilted up this much, degrees, so faces sit just under the middle (owner check #2: 3–4°). */
  tiltUp: 3.5, // TUNE
  /** Horizontal view angle, degrees: the room's walls and its residents across the frame. */
  horizontalFov: 44, // TUNE
  /** A tall phone's vertical view angle is capped here, degrees (less floor in view). */
  maxVerticalFov: 72, // TUNE
  /** Kid height stands at least this far in front of the room's front, metres. */
  minStandBack: 3.4, // TUNE: residents a third of the frame, not all of it
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
  /** How tall the soft foot is: a faded wall fades to nothing at the floor over this, metres. */
  softFoot: 1.2, // TUNE
  /** Walk in / Step out takes this long, seconds. */
  walkSeconds: 1.2, // TUNE
  /** The porch you stand on at kid height, outside the open front, metres deep. */
  porch: 5.4, // TUNE
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
