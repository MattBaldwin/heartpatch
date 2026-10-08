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
  // Seasonal home nodes: Halloween's pumpkin patch, Thanksgiving's leaf pile.
  | 'pumpkin-patch'
  | 'leaf-pile'
  // New things to gather (#238): a lakeside well, a patch of greens, ice crystals.
  | 'well'
  | 'greens-patch'
  | 'ice-crystals'
  // Trading posts (#269): the post's hut on its centre spot.
  | 'trading-post';

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
  // Trading posts (#269): cream-gold and a little lit, never washed out (nobody owns one).
  'trading-post': look('#fbe2a2', 0.25, { roughness: 0.5, glow: 0.12 }), // TUNE
  'junipers-gap': look('#e6cdfc', 0.3, { glow: 0.25 }), // TUNE
};

/** Used for a terrain id this client doesn't know yet. */
export const FALLBACK_LOOK: TerrainLook = TERRAIN_LOOKS['meadow'] ?? look('#c2eaa6', 0.22);

/** Home base tiles: a cosy cream patch, a little raised, never a terrain look. */
export const HOME_LOOK: TerrainLook = look('#fff0d4', 0.27, { roughness: 0.5 }); // TUNE

/** One colour per home slot, for territory borders and the Heart Seed. Bright enough to read on pastels. */
export const PLAYER_COLORS: readonly string[] = ['#ff6f9f', '#4fa3ff', '#a77bff', '#ff9d3d']; // TUNE

/** How a Keeper's border line is drawn (#278), so colour is never the only signal. */
export type BorderLine = 'solid' | 'dash' | 'dot' | 'double';
/** A Keeper's icon on their land and in the map legend (#278). */
export type KeeperIcon = 'heart' | 'star' | 'flower' | 'diamond';

/**
 * Land borders (#278, owner decision 2026-10-08: direction D). A light, even
 * wash over a Keeper's land and a thick soft ribbon along its outer edges,
 * with a line style and an icon per home slot, as colour is. Scales are
 * shares of the drawn tile radius; lifts are world units above the tile top.
 */
export const BORDER = {
  /** Wash opacity over every owned tile, with no rim of its own. */
  wash: 0.26, // TUNE
  /** Ribbon: fades in from `fade`, solid from `inner` out to `outer` (past the rim, over the gap). */
  ribbon: { fade: 0.7, inner: 0.82, outer: 1.035, alpha: 0.96 }, // TUNE
  /**
   * Above the tile top: the wash, the ribbon and the icon badges. Each stays
   * clear of a lake's bob (`AMBIENT.water.bob`); the safe glow and selection
   * still draw on top (border-field.ts `alphaIndex`).
   */
  lift: { wash: 0.016, ribbon: 0.017, icon: 0.018 }, // TUNE
  /** One per home slot, in `PLAYER_COLORS` order. */
  lines: ['solid', 'dash', 'dot', 'double'] as readonly BorderLine[], // TUNE
  icons: ['heart', 'star', 'flower', 'diamond'] as readonly KeeperIcon[], // TUNE
  /** An icon badge on every this-many-th border tile (home tiles never), and its size (world units). */
  iconEvery: 4, // TUNE
  iconSize: 0.15, // TUNE
  /** How much the borders dim at night (0 = not at all), so #277's fire light reads. */
  night: 0.25, // TUNE
} as const;

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
}

export interface TerrainDressing {
  /** Fewest and most props per tile. */
  readonly count: readonly [number, number];
  /** The first spot always picks from these (a mountain's peak), if set. */
  readonly lead?: readonly DressingItem[];
  readonly items: readonly DressingItem[];
  /** Per-instance colour multipliers (sRGB hex), picked per prop, for a little variety. */
  readonly tints: readonly string[];
  /** Colour jitter between tiles of this terrain (fraction of brightness), and height jitter (world units). */
  readonly jitter: { readonly color: number; readonly height: number };
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
    count: [2, 4],
    items: [
      item('flowers', 4, [1.1, 1.5]),
      item('grass', 4, [1.1, 1.5]),
      item('mushroom', 1, [1, 1.3]),
      item('bush', 1, [0.8, 1]),
    ],
    tints: PLAIN,
    jitter: { color: 0.05, height: 0.012 },
  },
  forest: {
    count: [2, 4],
    items: [
      item('tree', 5),
      item('pine', 3, [0.85, 1.2]),
      item('tall-tree', 2, [0.85, 1.1]),
      item('stump', 1, [0.9, 1.1]),
      item('mushroom', 1, [1, 1.2]),
    ],
    tints: LEAFY,
    jitter: { color: 0.05, height: 0.012 },
  },
  'old-forest': {
    count: [2, 3],
    items: [
      item('old-tree', 5, [0.9, 1.15]),
      item('pine', 2, [1, 1.3]),
      item('log', 1, [0.8, 1], { single: true }),
      item('mushroom', 2, [1, 1.35]),
    ],
    tints: ['#ffffff', '#e4efe8', '#eef6e6', '#dfe8ee'],
    jitter: { color: 0.05, height: 0.012 },
  },
  hills: {
    count: [2, 3],
    items: [
      item('rock', 4),
      item('bush', 3, [0.9, 1.2]),
      item('grass', 2, [1.1, 1.4]),
      item('flowers', 1, [1, 1.3]),
    ],
    tints: ['#ffffff', '#f5efe6', '#eef5e6', '#fbf4ea'],
    jitter: { color: 0.05, height: 0.02 },
  },
  mountains: {
    count: [1, 3],
    lead: [item('peak', 1), item('snow-peak', 2, [0.9, 1.1])],
    items: [item('pine', 3, [0.7, 0.95]), item('rock', 2, [0.7, 0.9])],
    tints: ['#ffffff', '#f2eefb', '#f8f4ff'],
    jitter: { color: 0.04, height: 0.025 },
  },
  lake: {
    count: [1, 3],
    items: [
      item('lily-pad', 5, [1.1, 1.5]),
      item('reeds', 3, [1, 1.3], { edge: true }),
      item('stones', 1, [1, 1.2]),
      item('dock', 0.6, [1, 1], { edge: true, single: true }),
    ],
    tints: PLAIN,
    // Water stays level: no height jitter.
    jitter: { color: 0.03, height: 0 },
  },
  'pumpkin-fields': {
    count: [2, 4],
    items: [
      item('pumpkin', 6, [0.75, 1.2]),
      item('hay-bale', 1, [0.85, 1], { single: true }),
      item('grass', 1, [1.1, 1.4]),
    ],
    tints: ['#ffffff', '#fff1dc', '#ffe8d2', '#fff8e6'],
    jitter: { color: 0.05, height: 0.012 },
  },
  // Trading posts (#269): the hut stands in the middle (`middle`), with a few
  // flowers round it. No height wobble, so the connected ring sits flush.
  'trading-post': {
    count: [2, 3],
    items: [item('flowers', 3, [0.9, 1.2]), item('grass', 2, [0.8, 1.1])],
    tints: ['#ffffff', '#fff6e0', '#ffeef6'],
    jitter: { color: 0.02, height: 0 },
  },
  'junipers-gap': {
    count: [2, 3],
    items: [item('crystal', 3, [1, 1.4]), item('flowers', 2, [1.1, 1.4])],
    tints: ['#ffffff', '#fbeaff', '#eef0ff'],
    jitter: { color: 0.03, height: 0 },
  },
};

/** Used for a terrain id this client doesn't know yet. */
export const FALLBACK_DRESSING: TerrainDressing = TERRAIN_DRESSING['meadow'] ?? {
  count: [0, 0],
  items: [],
  tints: ['#ffffff'],
  jitter: { color: 0, height: 0 },
};

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

/**
 * Homesteads (#199): fully explored land joined to home wears home's cream
 * glow; one cut off from home (napping) a pale lavender. Linear RGB, alpha.
 */
export const HOMESTEAD_GLOW = {
  joined: { rgb: [1, 0.95, 0.82], fill: 0.62, edge: 1 },
  paused: { rgb: [0.74, 0.7, 0.86], fill: 0.55, edge: 0.95 },
} as const; // TUNE

/** The little gold sparkle on a fully explored tile (#199). */
export const EXPLORED_MARK = {
  /** Offset from the tile's middle (world units): the corner across from the wild tuft. */
  offset: { x: 0.18, z: 0.16 }, // TUNE
  scale: 1.8, // TUNE: readable at the map's start zoom
} as const;

/**
 * The wild-squishy tuft (#209) on a tile in reach with a wild squishy. It
 * stands off the tile's middle (where the Heart Seed and the props crowd),
 * and sways in the map's breeze a little more than grass, so it looks like
 * something's moving in there. No motion of its own beyond the terrain clock.
 */
export const WILD_MARKER = {
  /** Offset from the tile's middle (world units). */
  offset: { x: -0.17, z: -0.17 }, // TUNE
  scale: 1.5, // TUNE
  /** As `PROP_SWAY`: how far the top sways, and that top's height (before scale). */
  sway: { tip: 0.05, top: 0.26 }, // TUNE
} as const;

/**
 * Wild land (no owner) is drawn soft and grey-ish; claimed land is in full
 * colour (Sprout: "See the grey land? … the color comes back"). `saturation`
 * is the share of colour kept, `shade` dims it a little (grey that keeps its
 * brightness reads as white once tone-mapped), and `wash` mixes towards the
 * soft `tint`. Enough colour stays that each terrain still reads.
 */
export const MUTED = {
  saturation: 0.5,
  shade: 0.88,
  wash: 0.1,
  tint: '#d9d3e2',
  /** The island under the tiles is never owned: muted this much (0–1), so it doesn't outline grey tiles in bright green. */
  island: 0.6,
} as const; // TUNE

/**
 * Land that misses its owner (owner decision 2026-10-06): how far towards
 * wild (`MUTED`) a tile is drawn when it's just about to go wild. Short of 1,
 * so fading land still reads as someone's until it goes.
 */
export const LAND_FADE = { most: 0.8 } as const; // TUNE

/** Ambient life: when it runs, and how busy it is per quality tier. */
export const AMBIENT = {
  /**
   * Ask for a frame this often while ambient life runs: about 30 a second (a
   * 30 fps interval less half a tick, like the close-up's breathing).
   */
  frameMs: 29, // TUNE
  /** Share of the motes drawn on each tier; low drops motes and motion (and draws nothing while idle). */
  motes: { high: 1, medium: 0.5, low: 0 }, // TUNE
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
   * The lake's gentle bob (world units) and glint strength. Keep `bob` under
   * the border wash's lift above the tile (`BORDER.lift.wash`), or wave
   * crests poke through the wash on owned lakes.
   */
  water: { bob: 0.008, glint: 0.14 }, // TUNE
} as const;

/** Every kind of mote, in drawing order. */
export const MOTE_KINDS = ['pollen', 'leaves', 'fireflies', 'sparkles', 'bats', 'fog'] as const;
export type MoteKind = (typeof MOTE_KINDS)[number];

/** Motes over the map: how many per tile of their terrain, and the most of each. */
export const MOTES: Readonly<Record<MoteKind, { perTile: number; max: number; color: string }>> = {
  pollen: { perTile: 0.35, max: 70, color: '#fff6cf' }, // TUNE: daylight, over meadows and flowers
  leaves: { perTile: 0.3, max: 40, color: '#f2b26b' }, // TUNE: daylight, drifting down in forests
  fireflies: { perTile: 0.4, max: 90, color: '#f4ffa8' }, // TUNE: night, over meadows, forests and lakes
  sparkles: { perTile: 4, max: 40, color: '#ffd8ff' }, // TUNE: Juniper's Gap, day and night
  bats: { perTile: 0.06, max: 9, color: '#ffffff' }, // TUNE: Halloween, over the woods and peaks
  fog: { perTile: 0.5, max: 36, color: '#ece4ff' }, // TUNE: Halloween, low land
};

/** Halloween dressing (season on, map-local date): jack-o'-lanterns and the dusk glow. */
export const HALLOWEEN = {
  /** Share of pumpkins that grin. */
  lanterns: 0.4, // TUNE
  /** A jack-o'-lantern's glow colour (sRGB), by day and at night. Not muted on wild land: a lit lantern glows anywhere. */
  glowColor: '#ff9a3c', // TUNE
  glow: { day: 0.06, night: 0.32 }, // TUNE
} as const;

/**
 * Thanksgiving dressing (season on, map-local date; owner decision
 * 2026-10-06): leaves tumble over the meadows and hills too, more of them,
 * and the daytime backdrop warms to amber.
 */
export const THANKSGIVING = {
  leaves: { perTile: 0.5, max: 80, terrains: ['forest', 'old-forest', 'meadow', 'hills'] }, // TUNE
  day: { inner: '#fff0d6', mid: '#f6d2a8', cloud: '#fff8ee' }, // TUNE
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
