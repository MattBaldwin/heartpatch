import type { QualityTier } from '../engine/config.js';

/**
 * The explore land kit (#335 art reset, hero biome first): sculpted ground,
 * layered vegetation, soft light and haze around the tile you walk on. Every
 * number is a first guess to judge on the playtest devices.
 *
 * Lengths here are world units (the tile is `EXPLORE_VIEW.hexSize` = 7 from
 * the middle to a corner; the Keeper is about 1.2 tall). The tile's own hex
 * is the play area: the Keeper never leaves it, so nothing that blocks a walk
 * grows inside it. Outside it, the land rolls on and curves gently away (a
 * hilltop meadow), so the sky still shows over the far trees.
 */

/** One biome's palette, sRGB hex. */
export interface LandPalette {
  /** Grass, from shade to sun, blended by a soft noise. */
  readonly grass: readonly [string, string, string];
  /** Grass on the rises and far hilltops (a warm, sunny green). */
  readonly sunny: string;
  /** The worn path and its darker rim. */
  readonly path: string;
  readonly pathEdge: string;
  /** Specks of clover and tiny flowers painted into the grass. */
  readonly specks: readonly string[];
  /** Soft contact shade painted under trees, bushes and rocks (baked AO). */
  readonly shade: string;
}

/** How a biome's land is shaped, world units. */
export interface LandShape {
  /** Gentle bumps over the whole land: height and how often (per world unit). */
  readonly bumps: { readonly height: number; readonly scale: number };
  /** Finer ripples on top. */
  readonly ripples: { readonly height: number; readonly scale: number };
  /** Little rises inside the tile: how many, how high, how wide (a Gaussian's sigma). */
  readonly rises: { readonly count: number; readonly height: number; readonly width: number };
  /** The land starts to fall away this far from the middle. */
  readonly edge: number;
  /** …down by `depth` in all, over about `length` (a smooth shoulder, then a long slope). */
  readonly fall: { readonly depth: number; readonly length: number };
  /** Rolling hills out past the edge: their height and how often. */
  readonly hills: { readonly height: number; readonly scale: number };
  /** The path: width, how far it wanders side to side, and how often it bends. */
  readonly path: {
    readonly width: number;
    readonly sway: number;
    readonly bend: number;
    /** It sinks this far into the grass (worn). */
    readonly sink: number;
  };
}

/** What grows on a biome's land, in thin-instanced layers. */
export interface LandGrowth {
  /** Grass tufts per square world unit inside the tile, and in the ring outside it. */
  readonly tufts: { readonly inside: number; readonly outside: number };
  /** Flower clusters per square world unit inside the tile and outside it. */
  readonly flowers: { readonly inside: number; readonly outside: number };
  /** Bushes along the tile's edge (a soft hedge), and scattered further out. */
  readonly bushes: { readonly edge: number; readonly outside: number };
  /** Trees in the ring round the tile, and out on the far hills. */
  readonly trees: { readonly near: number; readonly far: number };
  /** Rock clusters, logs and mushroom rings outside the tile, and pebbles inside. */
  readonly rocks: number;
  readonly logs: number;
  readonly mushrooms: number;
  readonly pebbles: number;
  /** Lantern posts along the path (lit at dusk and night). */
  readonly lamps: number;
  /** Butterflies by day, pollen by day, fireflies at dusk and night. */
  readonly butterflies: number;
  readonly pollen: number;
  readonly fireflies: number;
}

export interface LandLook {
  readonly palette: LandPalette;
  readonly shape: LandShape;
  readonly growth: LandGrowth;
}

/**
 * The biomes built on the kit so far. Meadow is the hero biome (#335); the
 * lake, trail and cave follow on the same kit once the owner approves it.
 * Other terrains keep today's tile until then.
 */
export const LAND_LOOKS: Readonly<Record<string, LandLook>> = {
  meadow: {
    palette: {
      grass: ['#74b462', '#93cb75', '#b4df92'], // TUNE
      sunny: '#c4e28e', // TUNE
      path: '#ecd3a2', // TUNE
      pathEdge: '#cfae7c', // TUNE
      specks: ['#e6f5c8', '#fff4c2', '#ffd6e6', '#d9ccff'], // TUNE
      shade: '#5a8a55', // TUNE
    },
    shape: {
      bumps: { height: 0.16, scale: 0.16 }, // TUNE
      ripples: { height: 0.04, scale: 0.6 }, // TUNE
      rises: { count: 2, height: 0.32, width: 1.6 }, // TUNE
      edge: 7.0, // TUNE: just past the tile's corners (6.65)
      fall: { depth: 16, length: 10 }, // TUNE: steep enough that the far land sits under the sky band
      hills: { height: 1.8, scale: 0.075 }, // TUNE
      path: { width: 0.9, sway: 1.4, bend: 0.32, sink: 0.035 }, // TUNE
    },
    growth: {
      tufts: { inside: 6, outside: 3.5 }, // TUNE
      flowers: { inside: 0.35, outside: 0.6 }, // TUNE
      bushes: { edge: 26, outside: 26 }, // TUNE
      trees: { near: 16, far: 70 }, // TUNE
      rocks: 9, // TUNE
      logs: 3, // TUNE
      mushrooms: 6, // TUNE
      pebbles: 26, // TUNE
      lamps: 3, // TUNE
      butterflies: 7, // TUNE
      pollen: 40, // TUNE
      fireflies: 36, // TUNE
    },
  },
};

/** How far out the land and its growth go, world units (the ground mesh's half-width). */
export const LAND_RADIUS = 46; // TUNE

/**
 * The ground mesh is a grid that's fine in the middle and coarse far away
 * (`warp`: the middle is `1 + warp` times finer than an even grid), and the
 * ground's painted texture uses the same warp.
 */
export const LAND_GRID = {
  warp: 3, // TUNE
  /** Vertices along each side, by tier. */
  cells: { high: 168, medium: 140, low: 100 } as Readonly<Record<QualityTier, number>>, // TUNE
  /** The painted ground texture's size, by tier (texels a side). */
  texture: { high: 1024, medium: 1024, low: 512 } as Readonly<Record<QualityTier, number>>, // TUNE
} as const;

/**
 * Per tier: the share of the grass and flowers drawn (instances are
 * shuffled, so any share is spread evenly). Shadows are painted into the
 * ground (soft, cast along the sun), so every tier has them for free.
 */
export const LAND_TIERS: Readonly<Record<QualityTier, { readonly grass: number }>> = {
  high: { grass: 1 }, // TUNE
  medium: { grass: 0.7 }, // TUNE
  low: { grass: 0.45 }, // TUNE
};

/** Light, haze and shadow (the time-of-day sky sets their colours). */
export const LAND_LIGHT = {
  /**
   * The sun's direction while exploring: from ahead and to the left, where
   * the sky draws it (explore-sky-look.ts), so shadows fall towards the
   * camera and read, instead of hiding behind what casts them.
   */
  sunDirection: { x: 0.42, y: -0.72, z: -0.55 }, // TUNE
  /** The hemispheric fill: strength, and how much of the zenith colour it takes. */
  fill: 0.3, // TUNE
  /** How much of the sky's zenith colour the fill takes (lavender shade at dusk). */
  fillSky: 0.6, // TUNE
  /**
   * The sun, times what the sky sets: the environment light is soft and
   * even, so on its own the land looks flat; a stronger key gives the
   * shading and the shadows something to say.
   */
  sun: 2.0, // TUNE
  /** The fill's ground bounce (a warm green), sRGB. */
  bounce: '#c9d8a0', // TUNE
  /** The sky light from the environment, times today's, while the fill is on. */
  environment: 0.5, // TUNE
  /** Haze: linear fog from `start` to `end` world units, its colour the sky's horizon mixed with `tint`. */
  haze: { start: 16, end: 72, tint: '#ffffff', mix: 0.15 }, // TUNE
  /**
   * Painted shadows: how dark a cast shadow is, and the contact shade right
   * under something (0–1), and how far a shadow reaches for each unit of
   * height (the sun is high: about half).
   */
  shadow: { cast: 0.5, contact: 0.55, length: 0.55 }, // TUNE
  /** The lanterns' glow, by how dark it is (sky light below `dusk`: on). */
  lamp: { color: '#ffd38a', glow: 1.6, dusk: 0.9 }, // TUNE
  /** Fireflies' glow, times their colour (over 1 blooms). */
  firefly: 1.8, // TUNE
} as const;

/** Ambient motion per layer (the map's terrain plugin): sway strength, world units per unit height². */
export const LAND_SWAY = {
  tufts: 0.5, // TUNE
  flowers: 0.35, // TUNE
  bushes: 0.012, // TUNE
  trees: 0.004, // TUNE
} as const;
