/**
 * Map look tunables (design doc §11, §19): tile size, terrain colours and
 * heights, props, and player colours. Every number is a first guess to check
 * on the playtest devices.
 */

/** Centre-to-corner size of one hex tile, in world units. */
export const HEX_SIZE = 0.65; // TUNE: about 7 tiles across a portrait iPhone at the start zoom

/** Drawn tile radius as a fraction of `HEX_SIZE`; the gap shows the island below. */
export const TILE_FILL = 0.95; // TUNE

export type PropKind =
  | 'tree'
  | 'old-tree'
  | 'rock'
  | 'peak'
  | 'pumpkin'
  // Terrain dressing (map-dressing.ts): variety on every terrain.
  | 'pine'
  | 'tall-tree'
  | 'stump'
  | 'log'
  | 'bush'
  | 'grass'
  | 'flowers'
  | 'mushroom'
  | 'lily-pad'
  | 'reeds'
  | 'stones'
  | 'dock'
  | 'snow-peak'
  | 'crystal'
  | 'hay-bale'
  | 'jack-o-lantern'
  // Ground clutter and claimed-land flourishes (terrain pass 2).
  | 'tuft'
  | 'clover'
  | 'pebbles'
  | 'petals'
  | 'lantern';

export interface TerrainLook {
  /** Top colour, sRGB hex. */
  color: string;
  /** Height of the tile's flat top above the island, world units. */
  height: number;
  roughness: number;
  /** Glossy coat (lakes); off elsewhere to keep full-screen pixels cheap. */
  clearCoat: boolean;
  /** A soft self-glow (Juniper's Gap). */
  glow: number;
  /** Props on each tile of this terrain, chosen per tile from `propsPerTile`. */
  prop: PropKind | null;
  /** Fewest and most props per tile. */
  propsPerTile: readonly [number, number];
}

const look = (color: string, height: number, extra: Partial<TerrainLook> = {}): TerrainLook => ({
  color,
  height,
  roughness: 0.6,
  clearCoat: false,
  glow: 0,
  prop: null,
  propsPerTile: [0, 0],
  ...extra,
});

/** Keyed by terrain id (packages/shared/src/data/terrains.ts). */
export const TERRAIN_LOOKS: Readonly<Record<string, TerrainLook>> = {
  meadow: look('#c2eaa6', 0.22), // TUNE
  forest: look('#93d6a0', 0.24, { prop: 'tree', propsPerTile: [2, 3] }), // TUNE
  'old-forest': look('#74b994', 0.26, { prop: 'old-tree', propsPerTile: [1, 2] }), // TUNE
  hills: look('#e2d1a4', 0.32, { prop: 'rock', propsPerTile: [1, 2] }), // TUNE
  mountains: look('#c9bddb', 0.42, { prop: 'peak', propsPerTile: [1, 1] }), // TUNE
  lake: look('#9fd6f5', 0.12, { roughness: 0.2, clearCoat: true }), // TUNE
  'pumpkin-fields': look('#f4d68e', 0.22, { prop: 'pumpkin', propsPerTile: [2, 3] }), // TUNE
  'junipers-gap': look('#e6cdfc', 0.3, { glow: 0.25 }), // TUNE
};

/** Used for a terrain id this client doesn't know yet. */
export const FALLBACK_LOOK: TerrainLook = TERRAIN_LOOKS['meadow'] ?? look('#c2eaa6', 0.22);

/** Home base tiles: a cosy cream patch, a little raised, never a terrain look. */
export const HOME_LOOK: TerrainLook = look('#fff0d4', 0.27, { roughness: 0.5 }); // TUNE

/** One colour per home slot, for territory tint and the Heart Seed. Bright enough to read on pastels. */
export const PLAYER_COLORS: readonly string[] = ['#ff6f9f', '#4fa3ff', '#a77bff', '#ff9d3d']; // TUNE

/** Territory tint opacity: the middle of a tile, and the soft border band near its edge. */
export const TINT = { fill: 0.32, edge: 0.78 } as const; // TUNE

/** The soft island everything sits on. */
export const ISLAND = { color: '#a9d897', margin: 1.2, thickness: 0.6 } as const; // TUNE

// ---------------------------------------------------------------------------
// Terrain dressing and ambient life (the terrain visual pass). Every number is
// a first guess to judge on the playtest devices.

/** One kind of prop a terrain can grow, and how often next to its siblings. */
export interface DressingItem {
  readonly kind: PropKind;
  /** Relative chance against the terrain's other items. */
  readonly weight: number;
  /** Smallest and largest scale. */
  readonly scale: readonly [number, number];
  /** Near the tile's edge (reeds, the dock), turned to face outwards. */
  readonly edge?: boolean;
  /** At most one per tile (a dock, a log). */
  readonly single?: boolean;
  /** How many grow together in one clump (fewest, most); one by default. */
  readonly clump?: readonly [number, number];
}

export interface TerrainDressing {
  /** Fewest and most clumps per tile (each clump is one kind, `DressingItem.clump` strong). */
  readonly count: readonly [number, number];
  /** The first spot always picks from these (a mountain's peak), if set. */
  readonly lead?: readonly DressingItem[];
  readonly items: readonly DressingItem[];
  /** Per-instance colour multipliers (sRGB hex), picked per prop, for a little variety. */
  readonly tints: readonly string[];
  /** Colour jitter between tiles of this terrain (fraction of brightness), and height jitter (world units). */
  readonly jitter: { readonly color: number; readonly height: number };
  /** Tiny ground clutter scattered over the whole tile (tufts, clover, pebbles, petals). */
  readonly clutter: {
    readonly count: readonly [number, number];
    readonly items: readonly DressingItem[];
  };
}

const item = (
  kind: PropKind,
  weight: number,
  scale: readonly [number, number] = [0.85, 1.15],
  extra: Partial<DressingItem> = {},
): DressingItem => ({ kind, weight, scale, ...extra });

const LEAFY = ['#ffffff', '#eef8e4', '#f6ffe8', '#e2f0e6', '#fff6e0']; // TUNE
const PLAIN = ['#ffffff', '#f6f2fb', '#fff8ef']; // TUNE

/**
 * What grows on each terrain (keyed like `TERRAIN_LOOKS`). Placement is
 * hash-seeded per tile (`dressTile`), so every device sees the same spots.
 */
export const TERRAIN_DRESSING: Readonly<Record<string, TerrainDressing>> = {
  meadow: {
    count: [2, 3],
    items: [
      item('flowers', 4, [1.1, 1.5], { clump: [2, 4] }),
      item('grass', 4, [1.1, 1.5], { clump: [2, 4] }),
      item('mushroom', 1, [1, 1.3], { clump: [2, 3] }),
      item('bush', 1, [0.8, 1], { clump: [1, 2] }),
    ],
    tints: PLAIN,
    jitter: { color: 0.05, height: 0.012 },
    clutter: {
      count: [8, 12],
      items: [item('tuft', 4), item('clover', 3), item('petals', 3), item('pebbles', 1)],
    },
  },
  forest: {
    count: [2, 4],
    items: [
      item('tree', 5, [0.85, 1.15], { clump: [1, 3] }),
      item('pine', 3, [0.85, 1.2], { clump: [2, 3] }),
      item('tall-tree', 2, [0.85, 1.1], { clump: [1, 2] }),
      item('stump', 1, [0.9, 1.1]),
      item('mushroom', 1, [1, 1.2], { clump: [2, 3] }),
    ],
    tints: LEAFY,
    jitter: { color: 0.05, height: 0.012 },
    clutter: { count: [6, 9], items: [item('tuft', 3), item('clover', 2), item('pebbles', 1)] },
  },
  'old-forest': {
    count: [2, 3],
    items: [
      item('old-tree', 5, [0.9, 1.15], { clump: [1, 2] }),
      item('pine', 2, [1, 1.3], { clump: [2, 3] }),
      item('log', 1, [0.8, 1], { single: true }),
      item('mushroom', 2, [1, 1.35], { clump: [2, 4] }),
    ],
    tints: ['#ffffff', '#e4efe8', '#eef6e6', '#dfe8ee'],
    jitter: { color: 0.05, height: 0.012 },
    clutter: { count: [6, 9], items: [item('tuft', 2), item('clover', 2), item('pebbles', 1)] },
  },
  hills: {
    count: [2, 3],
    items: [
      item('rock', 4, [0.85, 1.15], { clump: [1, 3] }),
      item('bush', 3, [0.9, 1.2], { clump: [1, 3] }),
      item('grass', 2, [1.1, 1.4], { clump: [2, 3] }),
      item('flowers', 1, [1, 1.3], { clump: [2, 3] }),
    ],
    tints: ['#ffffff', '#f5efe6', '#eef5e6', '#fbf4ea'],
    jitter: { color: 0.05, height: 0.02 },
    clutter: { count: [7, 10], items: [item('tuft', 3), item('pebbles', 3), item('petals', 1)] },
  },
  mountains: {
    count: [1, 3],
    lead: [item('peak', 1), item('snow-peak', 2, [0.9, 1.1])],
    items: [
      item('pine', 3, [0.7, 0.95], { clump: [2, 3] }),
      item('rock', 2, [0.7, 0.9], { clump: [1, 3] }),
    ],
    tints: ['#ffffff', '#f2eefb', '#f8f4ff'],
    jitter: { color: 0.04, height: 0.025 },
    clutter: { count: [4, 7], items: [item('pebbles', 3), item('tuft', 1)] },
  },
  lake: {
    count: [1, 3],
    items: [
      item('lily-pad', 5, [1.1, 1.5], { clump: [2, 3] }),
      item('reeds', 3, [1, 1.3], { edge: true, clump: [1, 2] }),
      item('stones', 1, [1, 1.2]),
      item('dock', 0.6, [1, 1], { edge: true, single: true }),
    ],
    tints: PLAIN,
    // Water stays level: no height jitter.
    jitter: { color: 0.03, height: 0 },
    clutter: { count: [0, 0], items: [] },
  },
  'pumpkin-fields': {
    count: [2, 4],
    items: [
      item('pumpkin', 6, [0.75, 1.2], { clump: [2, 4] }),
      item('hay-bale', 1, [0.85, 1], { single: true }),
      item('grass', 1, [1.1, 1.4], { clump: [2, 3] }),
    ],
    tints: ['#ffffff', '#fff1dc', '#ffe8d2', '#fff8e6'],
    jitter: { color: 0.05, height: 0.012 },
    clutter: { count: [6, 9], items: [item('tuft', 3), item('clover', 1), item('pebbles', 1)] },
  },
  'junipers-gap': {
    count: [2, 3],
    items: [
      item('crystal', 3, [1, 1.4], { clump: [1, 3] }),
      item('flowers', 2, [1.1, 1.4], { clump: [2, 3] }),
    ],
    tints: ['#ffffff', '#fbeaff', '#eef0ff'],
    jitter: { color: 0.03, height: 0 },
    clutter: { count: [6, 9], items: [item('petals', 3), item('clover', 1)] },
  },
};

/** Used for a terrain id this client doesn't know yet. */
export const FALLBACK_DRESSING: TerrainDressing = TERRAIN_DRESSING['meadow'] ?? {
  count: [0, 0],
  items: [],
  tints: ['#ffffff'],
  jitter: { color: 0, height: 0 },
  clutter: { count: [0, 0], items: [] },
};

/**
 * The ground (terrain pass 2): one continuous surface. Its colours are the
 * map's own, richer than `TERRAIN_LOOKS` (which the cinematic and battle
 * arenas also use). A lake's ground is its sandy bed, under the water.
 */
export const GROUND = {
  /** The flat middle of a tile as a fraction of the hex; the rest slopes to the shared edge. */
  plateau: 0.55, // TUNE
  /** Brightness noise per ground vertex (±). */
  noise: 0.05, // TUNE
  /** The map's outer edge drops to the island top. */
  skirtTo: -0.02,
  colors: {
    meadow: '#8fcf63', // TUNE: bright spring grass
    forest: '#5fb563', // TUNE
    'old-forest': '#469a64', // TUNE: deep moss
    hills: '#b9c56b', // TUNE: sunny grassy hills
    mountains: '#ad9fcb', // TUNE: lavender rock
    lake: '#d9c48c', // TUNE: the sandy bed (and beach where it meets land)
    'pumpkin-fields': '#d9bd5c', // TUNE: wheat
    'junipers-gap': '#dcb2f2', // TUNE
  } as Readonly<Record<string, string>>,
  /** Home tiles: a warm garden path. */
  home: '#f2dca8', // TUNE
  /** A lake's bed sits this low; its water is at `WATER.level`. */
  lakeBed: 0.04, // TUNE
} as const;

/** Lakes' water (terrain pass 2): depth colour, a soft shore with foam, glints. */
export const WATER = {
  /** Height of the surface: under the land around it, so the shore slopes into it. */
  level: 0.15, // TUNE
  /** How far the water tucks under the bank past the hex (fraction). */
  reach: 0.08, // TUNE
  deep: { color: '#2f86c9', alpha: 0.88 }, // TUNE
  shallow: { color: '#8fe0ee', alpha: 0.42 }, // TUNE
  foam: '#ffffff', // TUNE
} as const;

/**
 * Claimed land (owner decision 2026-10-05): every tile is in full colour;
 * owned land reads by a warm glow, a soft border around the whole territory
 * (never between its own tiles), and flourishes (flowers and lanterns).
 */
export const CLAIMED = {
  /** The glow over each owned tile: alpha in the middle and at the edge. */
  glow: { fill: 0.14, edge: 0.22 }, // TUNE
  /** The border band: opacity at the territory's edge and its width (fraction of the hex). */
  border: { alpha: 0.85, width: 0.2 }, // TUNE
  /** Flourishes per owned tile: a lantern's chance, and flower clumps. */
  lanternChance: 0.55, // TUNE
  flowerClumps: [1, 2] as const, // TUNE
  /** A lantern's warm glow. */
  lanternGlow: { color: '#ffc46b', day: 0.35, night: 1.1 }, // TUNE
} as const;

/** Sandy paths from each home's Heart Seed out to neighbouring land. */
export const PATHS = {
  color: '#e8cf93', // TUNE
  /** Width (world units) and how many neighbours each home links to. */
  width: 0.13, // TUNE
  links: 3, // TUNE
  alpha: 0.9, // TUNE
} as const;

/** The map's light (terrain pass 2): a warm golden sun and a gentle warm grade. */
export const MAP_LIGHT = {
  sun: '#ffe2b0', // TUNE: golden hour
  sunIntensity: 1.15, // TUNE: times the stage's sun
  /** Colour grade (image processing curves): saturation and a warm lift (hue in degrees, density 0–100). */
  saturation: 18, // TUNE
  warmHue: 40, // TUNE
  warmDensity: 12, // TUNE
} as const;

/**
 * How far each prop kind's top sways (world units at its top, before scale),
 * and that top's height. Rocks, docks and stumps stay still.
 */
export const PROP_SWAY: Readonly<Partial<Record<PropKind, { tip: number; top: number }>>> = {
  tree: { tip: 0.018, top: 0.42 }, // TUNE
  'tall-tree': { tip: 0.024, top: 0.55 }, // TUNE
  pine: { tip: 0.014, top: 0.5 }, // TUNE
  'old-tree': { tip: 0.012, top: 0.6 }, // TUNE
  bush: { tip: 0.008, top: 0.16 }, // TUNE
  grass: { tip: 0.03, top: 0.14 }, // TUNE
  flowers: { tip: 0.028, top: 0.15 }, // TUNE
  reeds: { tip: 0.035, top: 0.3 }, // TUNE
  'lily-pad': { tip: 0, top: 0.02 }, // bobs with the water instead
};

/** Ambient life: when it runs, and how busy it is per quality tier. */
export const AMBIENT = {
  /**
   * Ask for a frame this often while ambient life runs: about 30 a second (a
   * 30 fps interval less half a tick, like the close-up's breathing).
   */
  frameMs: 29, // TUNE
  /** Share of the motes drawn on each tier; low drops motes and motion (and draws nothing while idle). */
  motes: { high: 1, medium: 0.5, low: 0 }, // TUNE
  /** Share of the ground clutter drawn on each tier (it doesn't move, so low keeps some). */
  clutter: { high: 1, medium: 0.6, low: 0.35 }, // TUNE
  /**
   * If most ambient frames arrive further apart than this (ms; about
   * 18 fps), ambient life switches off for this visit: the device needs its
   * frame budget for the player's own taps and drags. iOS Low Power Mode's
   * 30 fps cap (33 ms) stays under it.
   */
  maxFrameGapMs: 55, // TUNE
  /** The window of ambient frames judged at a time (more than half slow: off). */
  judgeFrames: 10, // TUNE
  /** Not judged in the first moments after the map opens (shader compiles, uploads). */
  graceMs: 2000, // TUNE
  /** How often the quality tier is looked at again (it has no change event), ms. */
  checkMs: 500, // TUNE
  /**
   * The lake's gentle bob (world units), glint strength and shore foam
   * strength. Keep `bob` under the overlays' lift above the ground
   * (`OVERLAY_LIFT` in map-scene.ts), or wave crests poke through them.
   */
  water: { bob: 0.008, glint: 0.16, foam: 0.55 }, // TUNE
} as const;

/** Every kind of mote, in drawing order. */
export const MOTE_KINDS = [
  'pollen',
  'leaves',
  'fireflies',
  'sparkles',
  'bats',
  'fog',
  'butterflies',
  'birds',
  'fish',
  'bunnies',
] as const;
export type MoteKind = (typeof MOTE_KINDS)[number];

/** Motes over the map: how many per tile of their terrain, and the most of each. */
export const MOTES: Readonly<Record<MoteKind, { perTile: number; max: number; color: string }>> = {
  pollen: { perTile: 0.35, max: 70, color: '#fff6cf' }, // TUNE: daylight, over meadows and flowers
  leaves: { perTile: 0.3, max: 40, color: '#f2b26b' }, // TUNE: daylight, drifting down in forests
  fireflies: { perTile: 0.4, max: 90, color: '#f4ffa8' }, // TUNE: night, over meadows, forests and lakes
  sparkles: { perTile: 4, max: 40, color: '#ffd8ff' }, // TUNE: Juniper's Gap, day and night
  bats: { perTile: 0.06, max: 9, color: '#ffffff' }, // TUNE: Halloween, over the woods and peaks
  fog: { perTile: 0.5, max: 36, color: '#ece4ff' }, // TUNE: Halloween, low land
  butterflies: { perTile: 0.25, max: 40, color: '#ffffff' }, // TUNE: daylight, over meadows and flowers
  birds: { perTile: 0.02, max: 7, color: '#ffffff' }, // TUNE: daylight, high over the land
  fish: { perTile: 0.5, max: 24, color: '#ffffff' }, // TUNE: jumping in the lakes, day and night
  bunnies: { perTile: 0.03, max: 8, color: '#ffffff' }, // TUNE: daylight, hopping in meadows
};

/** Halloween dressing (season on, map-local date): jack-o'-lanterns and the dusk glow. */
export const HALLOWEEN = {
  /** Share of pumpkins that grin. */
  lanterns: 0.4, // TUNE
  /** A jack-o'-lantern's glow colour (sRGB), by day and at night. Not muted on wild land: a lit lantern glows anywhere. */
  glowColor: '#ff9a3c', // TUNE
  glow: { day: 0.06, night: 0.32 }, // TUNE
} as const;

/** Juniper's Gap's crystals glow softly, day and night (sRGB colour, strength). */
export const CRYSTAL_GLOW = { color: '#e6b8ff', strength: 0.35 } as const; // TUNE

/**
 * The soft backdrop under the island (instead of a flat clear colour): a
 * glow under the island fading out, and slow clouds. sRGB.
 */
export const SKY_BACKDROP = {
  day: { inner: '#fff3e6', mid: '#fbdbe9', cloud: '#ffffff' }, // TUNE
  night: { inner: '#5a4f86', mid: '#363058', cloud: '#7b70a8' }, // TUNE
  /** Halloween at night: an orange glow under the island into purple dusk. */
  halloweenNight: { inner: '#c46a3c', mid: '#3f2a5e', cloud: '#8a6aa8' }, // TUNE
  /** Backdrop radius as a multiple of the island's, and its depth below the tiles. */
  radius: 4, // TUNE
  depth: 1.4, // TUNE
  clouds: 12, // TUNE
} as const;
