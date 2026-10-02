/**
 * Map look tunables (design doc §11, §19): tile size, terrain colours and
 * heights, props, and player colours. Every number is a first guess to check
 * on the playtest devices.
 */

/** Centre-to-corner size of one hex tile, in world units. */
export const HEX_SIZE = 0.65; // TUNE: about 7 tiles across a portrait iPhone at the start zoom

/** Drawn tile radius as a fraction of `HEX_SIZE`; the gap shows the island below. */
export const TILE_FILL = 0.95; // TUNE

export type PropKind = 'tree' | 'old-tree' | 'rock' | 'peak' | 'pumpkin';

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
