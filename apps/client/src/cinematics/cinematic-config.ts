import type { CinematicGround } from '@heartpatch/shared';
import { TERRAIN_LOOKS, FALLBACK_LOOK, type TerrainLook } from '../map/map-config.js';

/**
 * Opening cinematic look tunables (#46, design doc §25). The story's timing
 * and staging are data (`packages/shared/src/data/cinematics`); this is how
 * the client draws it. Every number is a first guess to judge on the
 * playtest devices.
 */

const look = (color: string, height: number, extra: Partial<TerrainLook> = {}): TerrainLook => ({
  ...FALLBACK_LOOK,
  color,
  height,
  prop: null,
  propsPerTile: [0, 0],
  ...extra,
});

/** Extra props only the story's grounds use. */
export type CinematicProp = 'leaf-pile' | 'snow-mound';

/**
 * Ground looks: the map's terrains, plus the Heartpatch (a warm glowing
 * field), autumn leaves and snow for shot 2's seasons.
 */
export const GROUND_LOOKS: Readonly<
  Record<CinematicGround, TerrainLook & { extraProp?: CinematicProp }>
> = {
  meadow: TERRAIN_LOOKS['meadow'] ?? FALLBACK_LOOK,
  forest: TERRAIN_LOOKS['forest'] ?? FALLBACK_LOOK,
  'old-forest': TERRAIN_LOOKS['old-forest'] ?? FALLBACK_LOOK,
  hills: TERRAIN_LOOKS['hills'] ?? FALLBACK_LOOK,
  lake: TERRAIN_LOOKS['lake'] ?? FALLBACK_LOOK,
  'pumpkin-fields': TERRAIN_LOOKS['pumpkin-fields'] ?? FALLBACK_LOOK,
  'junipers-gap': TERRAIN_LOOKS['junipers-gap'] ?? FALLBACK_LOOK,
  heartpatch: look('#ffd3e6', 0.26, { roughness: 0.5, glow: 0.55 }), // TUNE
  autumn: { ...look('#f3b980', 0.22), extraProp: 'leaf-pile', propsPerTile: [2, 3] }, // TUNE
  snow: {
    ...look('#f4f6ff', 0.24, { roughness: 0.45 }),
    extraProp: 'snow-mound',
    propsPerTile: [1, 2],
  }, // TUNE
};

/** Sizes in the story's world, on top of what the data asks for. */
export const ACTOR_SIZE = {
  /** Hearthfire models are ~1 unit across: this times the world's hex size. */
  building: 0.5, // TUNE: a little bigger than the map's MAP_BUILDING_SCALE
  /** Keepers lean back a little so faces show under a camera above them. */
  keeperLean: 0.12, // TUNE
} as const;

/** Sky (the clear colour), by day and by night, sRGB. */
export const SKY = {
  day: '#ffe6d6', // TUNE: golden hour peach
  night: '#3c3358', // TUNE: lavender dusk, never black
} as const;

/** Light by day and at full night (multipliers of the stage's own lighting). */
export const NIGHT_LIGHT = {
  sun: 0.25, // TUNE
  environment: 0.45, // TUNE
} as const;

/**
 * The colour drain (shots 4–6): saturation falls and a dusky vignette creeps
 * in from the edges of the frame. Both are uniforms of the in-material image
 * processing, switched on from the start so nothing recompiles mid-shot.
 */
export const DRAIN = {
  /** Babylon ColorCurves saturation at full drain (−100 is grey). */
  saturation: -82, // TUNE
  /** Slightly dimmer when drained. */
  exposure: -12, // TUNE
  /** Vignette weight at full drain (0 is none). */
  vignetteWeight: 3.2, // TUNE
  vignetteColor: [0.42, 0.38, 0.55], // TUNE: dusky lavender, linear
  /** Clear colour pulled this far towards grey at full drain. */
  skyGrey: 0.8, // TUNE
} as const;

/** The Heart Seeds' shards streaking across the sky (shot 5). */
export const SHARDS = {
  count: 36, // TUNE
  /** Seconds for a shard to cross the sky. */
  flightS: 5.5, // TUNE
  /** Starting speed range, world units a second. */
  speed: [5, 9], // TUNE
  gravity: 1.6, // TUNE: a gentle arc, not a fall
  /** Size of one shard, and how long its streak stretches per unit of speed. */
  size: 0.11, // TUNE
  stretch: 0.09, // TUNE
  color: '#ffb7d5', // TUNE: Heart Seed pink
} as const;

/** Snow drifting over the snowy patch (shot 2). */
export const SNOW = {
  flakes: 60, // TUNE
  /** Box the snow falls through, world units around the snow patch centre. */
  spread: 3.2, // TUNE
  height: 3.5, // TUNE
  fallPerS: 0.45, // TUNE
  size: 0.07, // TUNE
} as const;

/** Heart Seed glow: emissive at glow 0 and at glow 1 (multiplies its pink). */
export const SEED_GLOW = { min: 0.25, max: 1.3 } as const; // TUNE
