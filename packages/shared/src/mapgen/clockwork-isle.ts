import type { GeneratedMap, GenerateMapOptions, MapGenData, MapTile } from './index.js';
import { generateWildIsle } from './wild-isle.js';
import { hexBfs, hexDistance, hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import { deriveSeed, Rng } from '../rng/index.js';
import type { ClockworkIsleMapGen } from '../schemas/data/map-gen.js';
import type { Wind } from '../schemas/data/power.js';
import { isWater, type Terrain } from '../schemas/data/terrains.js';
import { TRADING_POST_TERRAIN } from '../territory/reach.js';

// The Clockwork Isle generator (#874, lane C1, plan §3 row C1). A Clockwork
// Isle is a Wild Isle you wire up: the island is the Wild Isle generator's,
// run on `mapGen.clockworkIsle.island`, then two passes of its own, each on
// its own seed derived from the map's (secret) seed, so a change to one never
// moves the other or the island: the wind map, then the Scrap Heaps. Pure
// and deterministic like `generateMap`: integer maths, fixed iteration order.

/**
 * The share of land tiles at wind 1, 2 and 3, in percent (plan §3 row C1:
 * about 15 / 50 / 35). Tiles are ranked by their smoothed, bonused score
 * and cut at these shares, so every island gets the split to the tile.
 * Here rather than in `mapGen.clockworkIsle.wind`: that schema (C0) has no
 * field for it yet.
 */
export const WIND_SPLIT = { calm: 15, breezy: 50 } as const; // TUNE: windy is the rest (35 %)

/** Terrains that count as hills for `wind.hillBonus`: high ground is blowy. */
export const WINDY_HIGH_GROUND: readonly string[] = ['hills', 'mountains']; // TUNE:

/**
 * The most walking steps from a Heart Seed a home's Scrap Heaps sit (the
 * plan: at least one within 3 steps of every Heart Seed). Not in the C0
 * schema yet, like `WIND_SPLIT`.
 */
export const SCRAP_HEAP_REACH = 3; // TUNE:

/** The resource a Scrap Heap node yields. */
export const SCRAP_HEAP_RESOURCE = 'parts';

/** The Clockwork Isle rules from the data, or a `RangeError` when it has none. */
function clockworkIsleRules(data: MapGenData): ClockworkIsleMapGen {
  const rules = data.mapGen.clockworkIsle;
  if (rules === undefined) throw new RangeError('no Clockwork Isle settings in mapGen');
  return rules;
}

/**
 * Generates a Clockwork Isle (#874) from its seed: a Wild Isle island (its
 * rivers, lakes, coast, posts and villages) from `clockworkIsle.island`,
 * then `wind` 1–3 on every land tile (`windMap`) and `scrapHeaps.perHome`
 * Parts nodes near each Heart Seed (`placeScrapHeaps`). Water tiles never
 * get wind. A seat count with no layout is a `RangeError`, as on a Wild Isle.
 *
 * Like `generateMap`, the seed is secret and stays on the server; the wind
 * values are public, the sub-seeds behind them are not.
 */
export function generateClockworkIsle(data: MapGenData, options: GenerateMapOptions): GeneratedMap {
  const rules = clockworkIsleRules(data);
  const island = generateWildIsle(
    { terrains: data.terrains, mapGen: { ...data.mapGen, wildIsle: rules.island } },
    options,
  );
  const terrainById = new Map(data.terrains.map((t) => [t.id, t]));
  const wind = windMap(island.tiles, terrainById, rules, options.seed);
  const heaps = placeScrapHeaps(island, terrainById, rules, data.mapGen.gapTerrain, options.seed);
  return {
    ...island,
    tiles: island.tiles.map((t): MapTile => {
      const key = hexKey(t);
      const tileWind = wind.get(key);
      const withWind = tileWind === undefined ? t : { ...t, wind: tileWind };
      return heaps.has(key) ? { ...withWind, nodeResource: SCRAP_HEAP_RESOURCE } : withWind;
    }),
  };
}

/** What the wind pass reads of a tile. */
export type WindTile = Pick<MapTile, 'q' | 'r' | 'terrain'>;

/** What the Scrap Heap pass reads of a tile (a `MapTile` or a view's tile). */
export type ScrapHeapTile = WindTile & Pick<MapTile, 'homeSlot' | 'nodeResource' | 'isle'>;

/** Is this tile land (anything but water: a post, the Gap and the coast count)? */
function isLandTile(t: WindTile, terrainById: ReadonlyMap<string, Terrain>): boolean {
  return !isWater(terrainById.get(t.terrain));
}

/**
 * The wind on every land tile, 1 (calm) to 3 (windy), by key. Each land
 * tile rolls a score 0–999 on the wind seed, in tile order; `smoothing`
 * passes then average each score with its land neighbours' (its own counted
 * twice), so wind comes in breezy stretches, not speckles. Coast tiles add
 * `coastBonus` and high ground `hillBonus` (percent of the scale), then the
 * tiles are ranked (score, then tile order) and cut at `WIND_SPLIT`.
 */
export function windMap(
  tiles: readonly WindTile[],
  terrainById: ReadonlyMap<string, Terrain>,
  rules: ClockworkIsleMapGen,
  seed: string,
): Map<HexKey, Wind> {
  const land = tiles.filter((t) => isLandTile(t, terrainById));
  const index = new Map(land.map((t, i) => [hexKey(t), i]));
  const rng = Rng.fromSeed(deriveSeed(seed, 'clockwork-isle-wind'));
  let score = land.map(() => rng.int(0, 999));
  const neighbours = land.map((t) =>
    hexNeighbors(t)
      .map((n) => index.get(hexKey(n)))
      .filter((i): i is number => i !== undefined),
  );
  for (let pass = 0; pass < rules.wind.smoothing; pass++) {
    const before = score;
    score = before.map((own, i) => {
      const around = neighbours[i] ?? [];
      const sum = around.reduce((s, n) => s + (before[n] ?? 0), 2 * own);
      return Math.floor(sum / (around.length + 2));
    });
  }
  const coastTerrain = rules.island.coastTerrain;
  const bonused = land.map((t, i) => {
    let s = score[i] ?? 0;
    if (t.terrain === coastTerrain) s += rules.wind.coastBonus * 10;
    if (WINDY_HIGH_GROUND.includes(t.terrain)) s += rules.wind.hillBonus * 10;
    return s;
  });
  // Calmest first; equal scores keep tile order, so the cut is deterministic.
  const ranked = land
    .map((_, i) => i)
    .sort((a, b) => (bonused[a] ?? 0) - (bonused[b] ?? 0) || a - b);
  const calm = Math.round((land.length * WIND_SPLIT.calm) / 100);
  const breezy = Math.round((land.length * (WIND_SPLIT.calm + WIND_SPLIT.breezy)) / 100);
  const out = new Map<HexKey, Wind>();
  ranked.forEach((i, rank) => {
    const t = land[i] as WindTile; // i indexes land
    out.set(hexKey(t), rank < calm ? 1 : rank < breezy ? 2 : 3);
  });
  return out;
}

/**
 * The Scrap Heaps (Parts nodes), by key: for each home in slot order,
 * `perHome` land tiles `minFromSeed` to `SCRAP_HEAP_REACH` walking steps
 * from its Heart Seed (no water crossed), off home bases, trading posts,
 * the Gap and villages, and never beside another heap. A tile with no node
 * is picked first; a home with too few of those turns a nearby node into
 * a heap instead. A home with no room at all is a `RangeError`.
 */
export function placeScrapHeaps(
  map: {
    readonly tiles: readonly ScrapHeapTile[];
    readonly homes: readonly Hex[];
    readonly communities: readonly { readonly tiles: readonly Hex[] }[];
  },
  terrainById: ReadonlyMap<string, Terrain>,
  rules: ClockworkIsleMapGen,
  gapTerrain: string,
  seed: string,
): Set<HexKey> {
  const byKey = new Map(map.tiles.map((t) => [hexKey(t), t]));
  const village = new Set(map.communities.flatMap((c) => c.tiles.map(hexKey)));
  const rng = Rng.fromSeed(deriveSeed(seed, 'clockwork-isle-scrap'));
  const { perHome, minFromSeed } = rules.scrapHeaps;
  const heaps: Hex[] = [];
  const out = new Set<HexKey>();
  const walkable = (h: Hex) => {
    const t = byKey.get(hexKey(h));
    return t !== undefined && t.isle === undefined && isLandTile(t, terrainById);
  };
  map.homes.forEach((home, slot) => {
    const steps = hexBfs([home], walkable);
    const fits = (t: ScrapHeapTile) => {
      const d = steps.get(hexKey(t));
      return (
        d !== undefined &&
        d >= minFromSeed &&
        d <= SCRAP_HEAP_REACH &&
        t.homeSlot === null &&
        t.terrain !== TRADING_POST_TERRAIN &&
        t.terrain !== gapTerrain &&
        !village.has(hexKey(t)) &&
        heaps.every((h) => hexDistance(h, t) > 1)
      );
    };
    for (let n = 0; n < perHome; n++) {
      const open = map.tiles.filter(fits);
      const bare = open.filter((t) => t.nodeResource === null);
      const from = bare.length > 0 ? bare : open;
      if (from.length === 0) {
        if (n === 0) throw new RangeError(`no room for a Scrap Heap by home ${slot}`);
        break;
      }
      const at = rng.pick(from);
      heaps.push(at);
      out.add(hexKey(at));
    }
  });
  return out;
}
