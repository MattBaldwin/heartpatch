import {
  hex,
  hexDistance,
  hexKey,
  hexRing,
  hexSpiral,
  type Hex,
  type HexKey,
} from '../hex/index.js';
import { Rng, type Seed } from '../rng/index.js';
import type { GameData } from '../schemas/data/game-data.js';
import type { MapLayout } from '../schemas/data/map-gen.js';
import type { Terrain } from '../schemas/data/terrains.js';

/** One generated tile, ready to persist as a `tiles` row. */
export interface MapTile {
  readonly q: number;
  readonly r: number;
  /** Terrain id from the terrain table. */
  readonly terrain: string;
  /**
   * The player slot (0-based, index into `GeneratedMap.homes`) whose home
   * base this tile is part of: the Heart Seed tile and its ring. Home tiles
   * are permanently owned and can never be captured. `null` = neutral.
   */
  readonly homeSlot: number | null;
  /** The resource this tile's node yields, or `null` if it has no node. */
  readonly nodeResource: string | null;
  /**
   * Strength of the wild guardian slot on a neutral tile (higher is tougher;
   * Juniper's Gap is toughest). Which guardians fill it is picked server-side
   * from the secret spawn tables. `null` on home tiles.
   */
  readonly guardianStrength: number | null;
}

export interface GeneratedMap {
  readonly playerCount: number;
  readonly radius: number;
  /** Every tile within `radius` of the centre, centre first, ring by ring. */
  readonly tiles: readonly MapTile[];
  /** Each player slot's Heart Seed tile, all `homeDistance` steps from the centre. */
  readonly homes: readonly Hex[];
  /** The Hollow's entrance: the centre tile of Juniper's Gap. */
  readonly hollowEntrance: Hex;
}

/** The game data the generator reads. */
export type MapGenData = Pick<GameData, 'terrains' | 'mapGen'>;

export interface GenerateMapOptions {
  /**
   * The map's seed, made server-side with `crypto.randomBytes`. **Secret:
   * never send it to clients.** It predicts every guardian and spawn (tech
   * spec §8).
   */
  readonly seed: Seed;
  readonly playerCount: number;
}

/** The map size for a player count, or a `RangeError` if none is configured. */
export function mapLayout(data: MapGenData, playerCount: number): MapLayout {
  const layout = data.mapGen.layouts.find((l) => l.players === playerCount);
  if (layout === undefined) {
    throw new RangeError(`no map layout for ${playerCount} players`);
  }
  return layout;
}

/** Removes and returns a uniformly random item (swap-remove: order isn't kept). */
function takeRandom<T>(rng: Rng, items: T[]): T {
  const i = rng.int(0, items.length - 1);
  const item = items[i] as T; // i is in range
  items[i] = items[items.length - 1] as T;
  items.pop();
  return item;
}

/**
 * Each home's share of the map: the tiles closer to it than to any other
 * home, with ties split evenly. Scaled by 12 so every split is a whole number.
 */
export function homeShares(homes: readonly Hex[], tiles: readonly Hex[]): number[] {
  const shares = homes.map(() => 0);
  for (const tile of tiles) {
    const steps = homes.map((home) => hexDistance(home, tile));
    const nearest = Math.min(...steps);
    const tied = steps.filter((s) => s === nearest).length;
    steps.forEach((s, slot) => {
      if (s === nearest) shares[slot] = (shares[slot] ?? 0) + 12 / tied;
    });
  }
  return shares;
}

/**
 * Hex grids have six-fold symmetry, so four evenly spaced homes can split the
 * map unevenly depending on where they start. Returns the ring rotations whose
 * biggest and smallest home shares are closest together. Turning by a whole
 * `spacing` only swaps which slot sits where, so those are the only distinct
 * rotations.
 */
function fairestRotations(
  spacing: number,
  homesAt: (rotation: number) => Hex[],
  tiles: readonly Hex[],
): number[] {
  let best = Infinity;
  let rotations: number[] = [];
  for (let rotation = 0; rotation < spacing; rotation++) {
    const shares = homeShares(homesAt(rotation), tiles);
    const spread = Math.max(...shares) - Math.min(...shares);
    if (spread < best) {
      best = spread;
      rotations = [];
    }
    if (spread === best) rotations.push(rotation);
  }
  return rotations;
}

/**
 * Generates a map's tiles from its seed (design doc §3, §11–12): Juniper's
 * Gap at the centre, home bases spaced evenly around it, patchy terrain, resource
 * nodes and wild guardian slots. Pure and deterministic: the same seed, player
 * count and data always give an identical map, on every JS engine (integer
 * maths and fixed iteration order only).
 *
 * The map seed must stay on the server and is never sent to clients: anyone
 * holding it could predict every tile's guardians and spawns.
 */
export function generateMap(data: MapGenData, options: GenerateMapOptions): GeneratedMap {
  const { seed, playerCount } = options;
  const { mapGen } = data;
  const layout = mapLayout(data, playerCount);
  const rng = Rng.fromSeed(seed);
  const center = hex(0, 0);
  const tiles = hexSpiral(center, layout.radius);
  const terrainById = new Map(data.terrains.map((t) => [t.id, t]));
  const terrainOf = (id: string): Terrain => {
    const terrain = terrainById.get(id);
    if (terrain === undefined) throw new RangeError(`unknown terrain "${id}"`);
    return terrain;
  };
  const gapTerrain = terrainOf(mapGen.gapTerrain);
  const homeTerrain = terrainOf(mapGen.homeTerrain);
  const isGap = (h: Hex) => hexDistance(h, center) <= mapGen.gapRadius;

  // Home bases: evenly spaced around one ring (the schema guarantees the
  // spacing is a whole number of tiles), turned by a random choice among the
  // fairest rotations.
  const homeRing = hexRing(center, layout.homeDistance);
  const spacing = homeRing.length / playerCount;
  const homesAt = (rotation: number) =>
    Array.from(
      { length: playerCount },
      (_, slot) => homeRing[(rotation + slot * spacing) % homeRing.length] as Hex,
    );
  const fairest = fairestRotations(spacing, homesAt, tiles);
  const homes = homesAt(fairest[rng.int(0, fairest.length - 1)] ?? 0);
  const homeSlot = new Map<HexKey, number>();
  homes.forEach((home, slot) => {
    for (const h of hexSpiral(home, 1)) homeSlot.set(hexKey(h), slot);
  });

  // Terrain: scatter patch starts over the land outside the Gap, then grow
  // every patch outwards in random order until the land is covered.
  const terrain = new Map<HexKey, Terrain>();
  const land = tiles.filter((h) => !isGap(h));
  const landKeys = new Set(land.map(hexKey));
  const scatterable = data.terrains.filter((t) => t.weight > 0);
  const patchCount = Math.max(
    1,
    Math.floor((land.length + (mapGen.patchSize >> 1)) / mapGen.patchSize),
  );
  const unseeded = [...land];
  const frontier: Hex[] = [];
  for (let i = 0; i < patchCount && unseeded.length > 0; i++) {
    const patchStart = takeRandom(rng, unseeded);
    terrain.set(hexKey(patchStart), rng.weighted(scatterable));
    frontier.push(patchStart);
  }
  while (frontier.length > 0) {
    const from = takeRandom(rng, frontier);
    const patch = terrain.get(hexKey(from)) as Terrain; // every frontier hex has terrain
    for (const h of hexRing(from, 1)) {
      const key = hexKey(h);
      if (!landKeys.has(key) || terrain.has(key)) continue;
      terrain.set(key, patch);
      frontier.push(h);
    }
  }
  for (const h of tiles) if (isGap(h)) terrain.set(hexKey(h), gapTerrain);
  for (const home of homes) terrain.set(hexKey(home), homeTerrain);

  // Guaranteed home resources (design doc §11): each listed node on its own
  // ring tile, shuffled, regardless of the ring's terrain.
  const homeNodes = new Map<HexKey, string>();
  for (const home of homes) {
    const ring = hexRing(home, 1);
    for (const resource of mapGen.homeRingNodes) {
      homeNodes.set(hexKey(takeRandom(rng, ring)), resource);
    }
  }

  // Guardians get tougher further from the nearest Heart Seed. The map is a
  // solid hex, so straight-line steps are walking steps.
  const stepsToHome = (h: Hex) => Math.min(...homes.map((home) => hexDistance(home, h)));
  const { guardianStrength: strength } = mapGen;

  const result = tiles.map((h): MapTile => {
    const key = hexKey(h);
    const tileTerrain = terrain.get(key);
    // The land is one connected band, so the patches cover every tile.
    if (tileTerrain === undefined) throw new Error(`tile ${key} got no terrain`);
    const slot = homeSlot.get(key) ?? null;
    let nodeResource: string | null = null;
    let guardianStrength: number | null = null;
    if (slot !== null) {
      nodeResource = homeNodes.get(key) ?? null;
    } else {
      if (tileTerrain.nodeChance > 0 && rng.chance(tileTerrain.nodeChance)) {
        nodeResource = rng.pick(tileTerrain.nodeResources);
      }
      if (isGap(h)) {
        guardianStrength = strength.gap;
      } else {
        // Neutral tiles are at least 2 steps from a Heart Seed.
        const level = strength.min + Math.floor((stepsToHome(h) - 2) / strength.stepsPerLevel);
        guardianStrength = Math.min(strength.max, level);
      }
    }
    return {
      q: h.q,
      r: h.r,
      terrain: tileTerrain.id,
      homeSlot: slot,
      nodeResource,
      guardianStrength,
    };
  });

  return { playerCount, radius: layout.radius, tiles: result, homes, hollowEntrance: center };
}
