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
}

export const HOUSE_TIERS: Readonly<Record<QualityTier, HouseTierLook>> = {
  high: { lights: 4, shadowMap: 2048, specular: true, clearCoat: true, trees: 30 }, // TUNE
  medium: { lights: 3, shadowMap: 1024, specular: true, clearCoat: true, trees: 20 }, // TUNE
  low: { lights: 2, shadowMap: 0, specular: false, clearCoat: false, trees: 12 }, // TUNE
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
  fill: { intensity: 2.1, color: '#fff7f0', specular: 0.35 }, // TUNE
} as const;

/** Residents and the Keeper in the room. */
export const HOUSE_CAST = {
  /** A resident's size (a squishy at 1 is about a metre tall). */
  squishyScale: 0.95, // TUNE
  /** The Keeper, standing by the hearth until PR C lets it walk. */
  keeperScale: 0.8, // TUNE
  keeperLean: 0.05, // TUNE
  /** At most this far off facing the camera, radians. */
  faceTurn: 0.3, // TUNE
} as const;

/** The dollhouse camera (`fitHouse`). */
export const HOUSE_CAMERA = {
  /** A viewport narrower than this (width / height) is a portrait phone. */
  phoneAspect: 0.62, // TUNE
  /** Tilt down, degrees: portrait phones look down steeper so a tall frame fills. */
  pitch: { phone: 56, wide: 48 }, // TUNE: plan 52–58° phones, 40–52° iPad/landscape
  /** Vertical field of view, degrees. */
  fov: { phone: 50, wide: 44 }, // TUNE
  /** Space kept round the house inside the safe area, CSS px. */
  margin: 10, // TUNE
  /** Pinch zoom in the dollhouse: closest, as a share of the fitted distance. */
  closest: 0.6, // TUNE
  /** Pinch out past the dollhouse by this much (zoom units) and you're back home. */
  exitOvershoot: 0.18, // TUNE
  /** How much pinch (log of the finger spread ratio) moves zoom by 1. */
  pinchPerZoom: 0.9, // TUNE
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
