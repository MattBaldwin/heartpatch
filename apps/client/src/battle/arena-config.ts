import type { BattleTimeOfDay } from '@heartpatch/shared';
import type { PropKind } from '../map/map-config.js';

/**
 * The battle arena's look (owner decision 2026-10-04): every battle plays on
 * a small diorama of the terrain it happens on, at the patch's time of day.
 * The ground and props come from the map's own terrain looks and prop
 * builders (`TERRAIN_LOOKS`, `buildProp`); this file only says how a terrain
 * is composed into an arena. Every number is a first guess for the playtest.
 */

/** Arena-only props, drawn by `arena-props.ts` (the map has no use for them). */
export type ArenaPropKind = 'tuft' | 'flower' | 'reed' | 'mushroom' | 'glow-tree' | 'mound';

/** A group of props, scattered on a ring around the fight (behind it and to the sides). */
export interface ArenaPropGroup {
  readonly kind: PropKind | ArenaPropKind;
  readonly count: number;
  /** Distance from the arena's middle, world units: [nearest, furthest]. */
  readonly ring: readonly [number, number];
  /** Size against the map's prop (or the arena prop's unit size): [smallest, biggest]. */
  readonly scale: readonly [number, number];
  /**
   * Also in front of the fighters (between them and the camera): small things
   * only, like grass tufts. Default: only behind and to the sides.
   */
  readonly front?: boolean;
  /** Colour for arena-only props (mounds, tufts); the terrain's by default. Map props keep theirs. */
  readonly color?: string;
}

export interface ArenaSpec {
  /** Ground colour when it differs from the map tile's (a lake's shore is sand, not water). */
  readonly ground?: string;
  readonly props: readonly ArenaPropGroup[];
  /** A pool behind the fighters (the lake), in this colour; null for none. */
  readonly water: string | null;
  /** A hint of the terrain in the sky's haze (mixed into the horizon, 0–1 by `hazeMix`). */
  readonly haze: string;
  /** Little things drifting in the air while nothing else moves; null for none. */
  readonly motes: ArenaMotes | null;
}

/** Ambient bits in the air: pollen, falling leaves, glow motes, mist, fireflies (night). */
export type ArenaMotes = 'pollen' | 'leaves' | 'glow' | 'dust' | 'mist';

const ring = (near: number, far: number): readonly [number, number] => [near, far];

/** Keyed by terrain id (packages/shared/src/data/terrains.ts); `arenaSpecFor` falls back to meadow. */
export const ARENA_SPECS: Readonly<Record<string, ArenaSpec>> = {
  meadow: {
    props: [
      { kind: 'tree', count: 4, ring: ring(11, 15), scale: [4.5, 6] }, // TUNE
      { kind: 'rock', count: 3, ring: ring(7, 11), scale: [3, 4.5] }, // TUNE
      { kind: 'flower', count: 18, ring: ring(4.5, 12), scale: [0.8, 1.2], front: true }, // TUNE
      { kind: 'tuft', count: 22, ring: ring(4, 13), scale: [0.8, 1.3], front: true }, // TUNE
    ],
    water: null,
    haze: '#d9f2c4',
    motes: 'pollen',
  },
  forest: {
    props: [
      { kind: 'tree', count: 14, ring: ring(8, 15), scale: [5, 7] }, // TUNE
      { kind: 'tree', count: 6, ring: ring(13.5, 15.5), scale: [7, 9] }, // TUNE: a treeline behind
      { kind: 'mushroom', count: 6, ring: ring(5, 9), scale: [0.9, 1.4] }, // TUNE
      { kind: 'tuft', count: 16, ring: ring(4, 12), scale: [0.8, 1.2], front: true }, // TUNE
    ],
    water: null,
    haze: '#bfe6c8',
    motes: 'leaves',
  },
  'old-forest': {
    props: [
      { kind: 'old-tree', count: 10, ring: ring(8, 15), scale: [5.5, 7.5] }, // TUNE
      { kind: 'old-tree', count: 5, ring: ring(13.5, 15.5), scale: [8, 10] }, // TUNE
      { kind: 'mushroom', count: 10, ring: ring(4.5, 10), scale: [1, 1.6] }, // TUNE
      { kind: 'rock', count: 3, ring: ring(6, 10), scale: [3, 4] }, // TUNE
    ],
    water: null,
    haze: '#a9d4b8',
    motes: 'glow',
  },
  hills: {
    props: [
      { kind: 'mound', count: 7, ring: ring(12, 16), scale: [3.5, 5.5] }, // TUNE: rolling hills
      { kind: 'rock', count: 8, ring: ring(6, 13), scale: [3.5, 6] }, // TUNE
      { kind: 'tuft', count: 14, ring: ring(4, 12), scale: [0.8, 1.2], front: true }, // TUNE
    ],
    water: null,
    haze: '#f3e4c2',
    motes: 'dust',
  },
  mountains: {
    props: [
      { kind: 'peak', count: 6, ring: ring(12.5, 15.5), scale: [8, 12] }, // TUNE
      { kind: 'rock', count: 9, ring: ring(6, 12), scale: [3.5, 6] }, // TUNE
      { kind: 'mound', count: 4, ring: ring(10, 14), scale: [3, 4.5], color: '#b9adcf' }, // TUNE
    ],
    water: null,
    haze: '#ddd6ec',
    motes: 'mist',
  },
  lake: {
    ground: '#f2e2b8', // TUNE: a sandy shore; the lake itself is the water behind
    props: [
      { kind: 'reed', count: 16, ring: ring(6.5, 10), scale: [1, 1.6] }, // TUNE
      { kind: 'rock', count: 5, ring: ring(6, 10), scale: [3, 4.5] }, // TUNE
      { kind: 'tree', count: 4, ring: ring(13.5, 15.5), scale: [5, 6.5] }, // TUNE: the far shore
    ],
    water: '#9fd6f5', // TUNE: the map's lake colour
    haze: '#d6effa',
    motes: 'mist',
  },
  'pumpkin-fields': {
    props: [
      { kind: 'pumpkin', count: 22, ring: ring(5.5, 14), scale: [3.5, 6] }, // TUNE
      { kind: 'tree', count: 3, ring: ring(13.5, 15.5), scale: [5, 6.5] }, // TUNE
      { kind: 'tuft', count: 14, ring: ring(4, 12), scale: [0.8, 1.2], front: true }, // TUNE
    ],
    water: null,
    haze: '#ffe2b0',
    motes: 'leaves',
  },
  'junipers-gap': {
    props: [
      { kind: 'glow-tree', count: 1, ring: ring(10, 10), scale: [1, 1] }, // TUNE: the Gap's tree
      { kind: 'flower', count: 20, ring: ring(4.5, 12), scale: [0.9, 1.3], front: true }, // TUNE
      { kind: 'rock', count: 4, ring: ring(7, 12), scale: [3, 4] }, // TUNE
      { kind: 'mound', count: 5, ring: ring(12, 16), scale: [3, 4.5], color: '#d5b8f5' }, // TUNE
    ],
    water: null,
    haze: '#f1dcff',
    motes: 'glow',
  },
};

/** The arena for a terrain this client doesn't know yet. */
export const FALLBACK_ARENA = 'meadow';

/** Sizes of the diorama, world units. */
export const ARENA_STAGE = {
  /** Radius of the ground disc. */
  groundRadius: 16, // TUNE
  /** Thickness of the ground disc (its edge shows: it's a little diorama). */
  groundDepth: 0.8, // TUNE
  /** Props stay this far from the fighters (they never stand in the fight). */
  clearRadius: 4, // TUNE
  /**
   * Props only stand behind the fighters and to the sides: angles off the
   * camera's line, radians (0 is straight behind, π straight in front).
   */
  propArc: 2.1, // TUNE: about 120° each side
  /** Where the lake's water starts behind the fighters (+z, away from the camera). */
  waterFrom: 5, // TUNE
  /** Sky dome radius (well inside the camera's far plane). */
  skyRadius: 90, // TUNE
  /** Fog: soft haze on the far props so the diorama has depth. */
  fogStart: 30, // TUNE
  fogEnd: 95, // TUNE
  /** How much of the terrain's haze colour tints the horizon. */
  hazeMix: 0.35, // TUNE
  /** Stars on a night sky. */
  stars: 70, // TUNE
  /** On the low quality tier, scatter this share of the props. */
  lowTierProps: 0.6, // TUNE
} as const;

/**
 * The sky and light for each time of day: the dome's colours, the key light
 * (the sun, or the moon at night) and how much the sky lights the scene.
 * Night is a soft, friendly blue (style guide: spooky is cozy, never scary),
 * bright enough that every squishy reads.
 */
export interface ArenaMood {
  readonly zenith: string;
  readonly horizon: string;
  /** Below the horizon (the land past the diorama's edge). */
  readonly below: string;
  readonly light: string;
  readonly lightIntensity: number;
  readonly environment: number;
  /** A moon and stars. */
  readonly night: boolean;
  /** Ground and props tinted towards this (dusk's warm, night's blue), 0–1 by `tint`. */
  readonly tintColor: string;
  readonly tint: number;
}

export const ARENA_MOODS: Readonly<Record<BattleTimeOfDay, ArenaMood>> = {
  day: {
    zenith: '#9cc7f4', // TUNE
    horizon: '#ffe9d8', // TUNE
    below: '#c9b7c9', // TUNE
    light: '#fff4e6',
    lightIntensity: 1.6, // TUNE: the stage's sun
    environment: 0.9, // TUNE: the stage's sky light
    night: false,
    tintColor: '#ffffff',
    tint: 0,
  },
  dusk: {
    zenith: '#7f7bd0', // TUNE
    horizon: '#ffb98f', // TUNE
    below: '#8f6f8f', // TUNE
    light: '#ffb98a', // TUNE: low warm sun
    lightIntensity: 1.25, // TUNE
    environment: 0.65, // TUNE
    night: false,
    tintColor: '#ffb08a',
    tint: 0.18, // TUNE
  },
  night: {
    zenith: '#232a63', // TUNE
    horizon: '#5b5aa6', // TUNE
    below: '#2e2c55', // TUNE
    light: '#b9c6ff', // TUNE: moonlight
    lightIntensity: 0.95, // TUNE
    environment: 0.42, // TUNE
    night: true,
    tintColor: '#6f7fd6',
    tint: 0.3, // TUNE
  },
};
