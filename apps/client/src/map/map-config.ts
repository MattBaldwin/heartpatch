/**
 * Map look tunables (design doc §11, §19): tile size, terrain colours and
 * heights, props, and player colours. Every number is a first guess to check
 * on the playtest devices.
 */

import type { CommunityKindId } from '@heartpatch/shared';

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
  | 'trading-post'
  // Wild Isle's coast (#621): shells and driftwood on the sand.
  | 'shell'
  | 'driftwood';

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
  /**
   * Draw with this terrain's tile mesh, in this look's own colour and height,
   * so the terrain adds no draw call (cleared land, #242). Gloss and glow
   * come from that mesh's look (they're its material).
   */
  meshOf?: string;
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
  // Cleared land (#242): sandy ground drawn with the meadow's tiles.
  clearing: look('#efcf95', 0.22, { meshOf: 'meadow' }), // TUNE
  // Wild Isle (#621): its lakes look just like Cozy's (the lake's tiles,
  // bob and glint), rivers are a lighter, lower ribbon on the same tiles, and
  // the coast is pale sand on the meadow's tiles, so none adds a draw call.
  // The ocean has no look: it's never a tile instance (`OCEAN`, revision 1).
  'wild-lake': look('#9fd6f5', 0.12, { meshOf: 'lake' }), // TUNE
  river: look('#c2eefb', 0.09, { meshOf: 'lake' }), // TUNE
  coast: look('#f7dfa8', 0.18, { meshOf: 'meadow' }), // TUNE
};

/** Used for a terrain id this client doesn't know yet. */
export const FALLBACK_LOOK: TerrainLook = TERRAIN_LOOKS['meadow'] ?? look('#c2eaa6', 0.22);

/** Home base tiles: a cosy cream patch, a little raised, never a terrain look. */
export const HOME_LOOK: TerrainLook = look('#fff0d4', 0.27, { roughness: 0.5 }); // TUNE

/**
 * One colour per home slot, for territory borders and the Heart Seed. Bright
 * enough to read on pastels. Homes 5 and 6 (#318, owner pick "Candy Jar"):
 * Cherry next to Tangerine, Mint next to Strawberry, so neighbours differ.
 */
export const PLAYER_COLORS: readonly string[] = [
  '#ff6f9f', // Strawberry
  '#4fa3ff', // Blueberry
  '#a77bff', // Grape
  '#ff9d3d', // Tangerine
  '#e5484d', // Cherry
  '#19b38f', // Mint
]; // TUNE

/** How a Keeper's border line is drawn (#278), so colour is never the only signal. */
export type BorderLine = 'solid' | 'dash' | 'dot' | 'double' | 'dash-dot' | 'long-dash';
/** A Keeper's icon on their land and in the map legend (#278). */
export type KeeperIcon = 'heart' | 'star' | 'flower' | 'diamond' | 'moon' | 'leaf';

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
  lines: ['solid', 'dash', 'dot', 'double', 'dash-dot', 'long-dash'] as readonly BorderLine[], // TUNE
  icons: ['heart', 'star', 'flower', 'diamond', 'moon', 'leaf'] as readonly KeeperIcon[], // TUNE
  /**
   * A home nobody has joined yet (#318): a soft lavender dashed outline and
   * no wash, never a Keeper's colour. All of them draw as one mesh.
   */
  openHome: { color: '#ddd2e4', line: 'dash' as BorderLine }, // TUNE
  /**
   * A Hollowed village's doorstep (#306): a soft lavender line round its
   * tiles, no wash and no badges. Every village draws in one mesh.
   */
  hollowed: { color: '#b9a6e6', line: 'solid' as BorderLine }, // TUNE
  /** An icon badge on every this-many-th border tile (home tiles never), and its size (world units). */
  iconEvery: 4, // TUNE
  iconSize: 0.15, // TUNE
  /** How much the borders dim at night (0 = not at all), so #277's fire light reads. */
  night: 0.25, // TUNE
} as const;

/**
 * Map detail by zoom (#318). Zoomed out, tiles and props draw from
 * low-detail meshes (one per terrain look and prop kind, as up close, so the
 * draw calls don't change) and the props' contact shadows hide. Heights are
 * the camera's above the ground: the start zoom is about 17, the farthest 32.
 * (Splitting the map into culled chunks was measured and dropped: at the
 * map's tilt the camera sees most of the map, so it doubled the draw calls
 * for a fifth fewer triangles.)
 */
export const MAP_DETAIL = {
  /**
   * The switch sits in a band `hysteresis` either side of this camera
   * height: zooming out past the top of the band goes to low detail, and
   * zooming back in below the bottom returns, so a pinch near it never flickers.
   */
  farHeight: 25, // TUNE
  hysteresis: 1.5, // TUNE
} as const;

/** The soft island everything sits on. */
export const ISLAND = { color: '#a9d897', margin: 1.2, thickness: 0.6 } as const; // TUNE

/**
 * Wild Isle's sea (#621 revision 1): the ocean is never tile instances, but
 * one water disc under the island reaching past the map's edge, shallow
 * turquoise by the shore deepening to blue, with the lake's glint. The
 * island it rings is smaller than Cozy's (`margin`), with a sandy rim for a
 * beach. Isles out at sea stand in the water on their own. sRGB.
 */
export const OCEAN = {
  shallow: '#b2e9f2', // TUNE
  deep: '#6cb4e4', // TUNE
  /** Water level (world units): just under the island's top, so its rim pokes out as a beach. */
  level: -0.06, // TUNE
  /** How far the water reaches past the outermost ocean tile, world units. */
  reach: 10, // TUNE: far enough that the farthest zoom sees sea, not sky, past the island
  /** World units from the island's edge over which the shallows deepen. */
  shallows: 3.5, // TUNE
  /** Ring steps in the disc (more: a smoother shallow-to-deep blend). */
  rings: 8, // TUNE
  beach: '#f3e3bd', // TUNE
  /**
   * The beach's top edge past the outermost land tiles' corners (Cozy's island
   * uses `ISLAND.margin`). 0: the sand fills the notches between coast tiles
   * and stops there, never over the first ring of sea.
   */
  margin: 0, // TUNE
  /** How far past its top edge the beach slopes down to the water line (world units). */
  shore: 0.25, // TUNE
  /** What marks an ocean tile (the selection ring) sits at: the island's top, clear of the beach. */
  markTop: 0,
  /** Each isle tile's sand skirt, as a multiple of a tile's size: neighbours' skirts join into a sandbar. */
  isleSand: 1.1, // TUNE
  /** An isle skirt's reach at the water line, as a multiple of its top's. */
  isleSandWater: 1.12,
  /** Height steps between neighbouring sand skirts (world units), so overlaps never z-fight. */
  sandStep: 0.006, // TUNE
  /** The sea's glint by day and by night (softer, so it never reads as snow); the lakes' is `AMBIENT.water.glint`. */
  glint: { day: 0.14, night: 0.035 }, // TUNE
} as const;

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
  // Cleared land (#242): a stump, a log and a few stones left from clearing.
  clearing: {
    count: [3, 4],
    items: [
      item('stump', 3, [1.5, 1.9]),
      item('stones', 2, [1.4, 1.7]),
      item('log', 1, [1.1, 1.3], { single: true }),
    ],
    tints: ['#ffffff', '#fff6e0'],
    jitter: { color: 0.03, height: 0.004 },
  },
  // Wild Isle (#621). The coast: shells and driftwood on the sand, a few
  // stones and dune tufts. Its lakes grow the lake's lily pads and reeds (no
  // dock: a Ferry dock is a building, W1-5b); a river now and then a pad.
  // The ocean is never a tile, so it has no dressing.
  coast: {
    count: [1, 3],
    items: [
      item('shell', 3, [1.3, 1.7]),
      item('driftwood', 2, [0.9, 1.15], { single: true }),
      item('stones', 2, [1, 1.3]),
      item('grass', 1, [0.9, 1.1]),
    ],
    tints: ['#ffffff', '#fff6e0', '#f8f0dc'],
    jitter: { color: 0.03, height: 0.006 },
  },
  'wild-lake': {
    count: [1, 3],
    items: [
      item('lily-pad', 5, [1.1, 1.5]),
      item('reeds', 3, [1, 1.3], { edge: true }),
      item('stones', 1, [1, 1.2]),
    ],
    tints: PLAIN,
    jitter: { color: 0.03, height: 0 },
  },
  river: {
    count: [0, 1],
    items: [item('lily-pad', 1, [0.6, 0.85])],
    tints: ['#ffffff'],
    jitter: { color: 0.02, height: 0 },
  },
  // A Hollowed village's square (#306): the kind's broken building stands in
  // the middle (`HOLLOWED_SQUARE`) with ruins round it. Stand-ins from props
  // the map already draws, so no new meshes. No height wobble.
  'hollowed-lantern-tower': {
    count: [2, 3],
    items: [
      item('stones', 3, [1.2, 1.5]),
      item('stump', 2, [1.2, 1.4]),
      item('log', 1, [1, 1.2], { single: true }),
    ],
    tints: ['#ffffff', '#efe9f4'],
    jitter: { color: 0.02, height: 0 },
  },
  'hollowed-workshop': {
    count: [2, 3],
    items: [item('log', 3, [1, 1.2]), item('stump', 2, [1.2, 1.5])],
    tints: ['#ffffff', '#efe9f4'],
    jitter: { color: 0.02, height: 0 },
  },
  'hollowed-old-well': {
    count: [2, 3],
    items: [item('stones', 3, [1.2, 1.6]), item('grass', 1, [1, 1.2])],
    tints: ['#ffffff', '#efe9f4'],
    jitter: { color: 0.02, height: 0 },
  },
  'hollowed-bakery': {
    count: [2, 3],
    items: [
      item('stump', 3, [1.2, 1.5]),
      item('stones', 2, [1.1, 1.4]),
      item('log', 1, [1, 1.2], { single: true }),
    ],
    tints: ['#ffffff', '#efe9f4'],
    jitter: { color: 0.02, height: 0 },
  },
  'hollowed-watchtower': {
    count: [2, 3],
    items: [item('rock', 3, [0.8, 1]), item('stones', 2, [1.2, 1.5])],
    tints: ['#ffffff', '#efe9f4'],
    jitter: { color: 0.02, height: 0 },
  },
  'junipers-gap': {
    count: [2, 3],
    items: [item('crystal', 3, [1, 1.4]), item('flowers', 2, [1.1, 1.4])],
    tints: ['#ffffff', '#fbeaff', '#eef0ff'],
    jitter: { color: 0.03, height: 0 },
  },
};

/**
 * What stands in the middle of a Hollowed village's square, per kind (#306),
 * with the square's dressing `hollowed-<kind>` round it. Stand-ins until the
 * kinds' own buildings are drawn: the trading post's hut is the broken
 * house, and the Old Well is the lakeside well. TUNE.
 */
export const HOLLOWED_SQUARE: Readonly<Record<CommunityKindId, PropKind>> = {
  'lantern-tower': 'trading-post',
  workshop: 'trading-post',
  'old-well': 'well',
  bakery: 'trading-post',
  watchtower: 'trading-post',
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

/**
 * The porch lantern (#515): a lit Jack-o'-Lantern beside a patch-mate's Heart
 * Seed while they have one burning tonight, so trick-or-treaters see whose
 * treats are extra good. Across the seed from their Keeper (`KEEPER_PLACES.map`).
 */
export const PORCH_LANTERN = {
  /** Offset from the Heart Seed (world units). */
  offset: { x: -0.55, z: -0.25 }, // TUNE: mirrors the Keeper's spot
  /** Its size as a share of `HEX_SIZE`. */
  scale: 0.7, // TUNE: about a home tile's fire (`MAP_BUILDING_SCALE`)
} as const;

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
 * A gatherer standing on the tile it works (#602): the squishy itself,
 * small, off the tile's middle (where the node and props crowd), facing the
 * camera. Still: no breathing or shadow on the map, like the Keepers.
 */
export const GATHERER_ON_TILE = {
  /** Offset from the tile's middle (world units): left, clear of the night's 🌙 in the middle. */
  offset: { x: -0.25, z: -0.1 }, // TUNE
  /** Times the squishy's own size: about a Keeper's height on the map. */
  scale: 0.5, // TUNE
  /**
   * A patch-mate's gatherer, whose species the map view never names: a plain
   * little squishy in its family's colour (`fallback` before the members
   * list knows the owner).
   */
  standIn: {
    body: 'bun',
    belly: '#fff3e2',
    parts: ['oval-eyes', 'smile', 'blush-cheeks'],
    fallback: '#c9b8ff',
  }, // TUNE
} as const;

/**
 * The one quiet mark on a tile of mine that needs me (#602): a small round
 * chip just beside my gatherer's head (or, with nothing to sit by, in the
 * tile's top right), only for my own gatherers (and #601's resource
 * buildings). Kinds are listed most pressing first: a tile shows one.
 */
export const TILE_MARK = {
  /**
   * From the top of what it's about (its head) to the chip's middle, CSS px,
   * tried in order until one keeps clear of the flags and everything over
   * the map: up and to the right, up and to the left, then straight above.
   */
  beside: [
    { x: 12, y: -10 },
    { x: -12, y: -10 },
    { x: 0, y: -36 },
  ], // TUNE
  /** The chip's size, CSS px (as `.tile-mark` in map.css). */
  size: 24,
  /** With nothing to sit by: where on the tile's screen box the chip's middle sits (0–1 across, 0–1 down). */
  across: 0.78, // TUNE
  down: 0.3, // TUNE
  /**
   * What a mark can say, most pressing first: `meh`, a gatherer of mine
   * that isn't keen on this job (#393's 🌧️); `napping`, a gatherer of mine
   * with a full basket or on a homestead cut off from home; `knocked`, a
   * building of mine a storm knocked about (Wild Isle, #621): fix it.
   */
  kinds: ['knocked', 'meh', 'napping'],
  glyphs: { knocked: '🩹', meh: '🌧️', napping: '💤' },
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

/**
 * A Hollowed village's tiles (#306): drained past wild land, so they read
 * at a glance next to it. Applied after the wild mute: keep `saturation` of
 * the colour, dim by `shade`, then wash `wash` of the way to a cool lilac
 * grey (`tint` × the tile's own lightness). Per instance colour, so it costs
 * no mesh or draw call. Its props are tinted `props` too (×, sRGB).
 */
export const HOLLOWED_LOOK = {
  saturation: 0.08,
  shade: 0.74,
  tint: '#8f8aa3',
  wash: 0.3,
  props: '#b4b0c2',
} as const; // TUNE

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
  /**
   * Not judged for this long after a find starts and after it lands (#501 H:
   * the scene update, the cheer, the card or the flying finds, about
   * `EXPLORE_FIND.flyMs` plus their stagger).
   */
  hitchMs: 1500, // TUNE
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
