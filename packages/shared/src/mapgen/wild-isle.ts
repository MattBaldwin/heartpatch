import { placeCommunities, type PlacedCommunity } from './communities.js';
import { extraNodes } from './extra-nodes.js';
import { placeTradingPosts } from './trading-posts.js';
import type { GeneratedMap, GenerateMapOptions, MapGenData, MapTile } from './index.js';
import {
  hex,
  hexBfs,
  hexDistance,
  hexKey,
  hexNeighbors,
  hexRing,
  hexSpiral,
  type Hex,
  type HexKey,
} from '../hex/index.js';
import { patchRules } from '../patch-types/index.js';
import { deriveSeed, Rng } from '../rng/index.js';
import { landRadius, type WildIsleLayout, type WildIsleMapGen } from '../schemas/data/map-gen.js';
import { isWater, type Terrain } from '../schemas/data/terrains.js';
import { TRADING_POST_TERRAIN } from '../territory/reach.js';

// The Wild Isle generator (#621, plan §2 and revision 1). Pure and
// deterministic like `generateMap`: integer maths, fixed iteration order, and
// every roll from a seed derived from the map's (secret) seed. Each pass has
// its own derived seed, so re-rolling the water never moves the terrain.

/** The map size for a player count, or a `RangeError` if none is configured. */
export function wildIsleLayout(rules: WildIsleMapGen, playerCount: number): WildIsleLayout {
  const layout = rules.layouts.find((l) => l.players === playerCount);
  if (layout === undefined) {
    throw new RangeError(`no Wild Isle layout for ${playerCount} players`);
  }
  return layout;
}

/** The Wild Isle rules from the data, or a `RangeError` when it has none. */
function wildIsleRules(data: MapGenData): WildIsleMapGen {
  const rules = data.mapGen.wildIsle;
  if (rules === undefined) throw new RangeError('no Wild Isle settings in mapGen');
  return rules;
}

/** Removes and returns a uniformly random item (swap-remove: order isn't kept). */
function takeRandom<T>(rng: Rng, items: T[]): T {
  const i = rng.int(0, items.length - 1);
  const item = items[i] as T; // i is in range
  items[i] = items[items.length - 1] as T;
  items.pop();
  return item;
}

/** A shuffled copy (Fisher–Yates), so the input order stays the tie-break. */
function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Each home's share of the land: the land tiles closer to it (straight-line
 * steps) than to any other home, ties split evenly, scaled by 12 so every
 * split is whole. Water counts for nobody, so a lake by one home shrinks
 * only that home's share. Straight-line, not walking: a river is a wall
 * only until someone bridges it.
 */
export function landShares(homes: readonly Hex[], land: readonly Hex[]): number[] {
  const shares = homes.map(() => 0);
  for (const tile of land) {
    const steps = homes.map((home) => hexDistance(home, tile));
    const nearest = Math.min(...steps);
    const tied = steps.filter((s) => s === nearest).length;
    steps.forEach((s, slot) => {
      if (s === nearest) shares[slot] = (shares[slot] ?? 0) + 12 / tied;
    });
  }
  return shares;
}

/** One try at the island's rivers and lakes. */
interface Waterways {
  /** Every water tile on the land, by key: the river and lake ids. */
  readonly water: ReadonlyMap<HexKey, string>;
}

/** Why a try at the water failed (each one means: roll again). */
type WildIsleFailure =
  'river' | 'lake' | 'water-near-home' | 'region' | 'sliver' | 'balance' | 'posts' | 'communities';

/**
 * Generates a Wild Isle (#621) from its seed: Juniper's Gap at the centre,
 * homes evenly spaced as on a Cozy Patch, patchy terrain over the land, then
 * rivers that run from the sea right across to the sea on another side
 * (each home has one within `homeWaterSteps`) and a few lakes, a coast
 * ring, the sea and its offshore isles, nodes and guardians, and finally
 * trading posts and villages on the land. A water layout that leaves a home
 * short of land, water or a post is re-rolled up to `attempts` times, then
 * it's a `RangeError`.
 *
 * Like `generateMap`, the seed is secret and stays on the server.
 */
export function generateWildIsle(data: MapGenData, options: GenerateMapOptions): GeneratedMap {
  const { seed, playerCount } = options;
  const { mapGen } = data;
  const rules = wildIsleRules(data);
  const layout = wildIsleLayout(rules, playerCount);
  const center = hex(0, 0);
  const coastRadius = layout.radius - layout.oceanRings;
  const landR = landRadius(rules, layout);
  const ringOf = (h: Hex) => hexDistance(h, center);
  const isGap = (h: Hex) => ringOf(h) <= mapGen.gapRadius;
  const terrainById = new Map(data.terrains.map((t) => [t.id, t]));
  const terrainOf = (id: string): Terrain => {
    const terrain = terrainById.get(id);
    if (terrain === undefined) throw new RangeError(`unknown terrain "${id}"`);
    return terrain;
  };
  const ocean = terrainOf(rules.oceanTerrain);
  const coast = terrainOf(rules.coastTerrain);
  const river = terrainOf(rules.riverTerrain);
  const lake = terrainOf(rules.lakeTerrain);
  const gapTerrain = terrainOf(mapGen.gapTerrain);
  const homeTerrain = terrainOf(mapGen.homeTerrain);
  if (!isWater(ocean) || !isWater(river) || !isWater(lake) || isWater(coast)) {
    throw new RangeError('Wild Isle sea, river and lake terrains must be water, coast land');
  }
  // Only the terrains a Wild Isle may hold (never Cozy's claimable lake).
  const allowed = new Set(patchRules('wild-isle').terrains.map((t) => t.id));
  const scatterable = data.terrains.filter((t) => t.weight > 0 && allowed.has(t.id));

  const tiles = hexSpiral(center, layout.radius);
  const rng = Rng.fromSeed(deriveSeed(seed, 'wild-isle'));

  // Home bases: evenly spaced round one ring, turned by a random choice
  // among the rotations that split the island's land most evenly.
  const homeRing = hexRing(center, layout.homeDistance);
  const spacing = homeRing.length / playerCount;
  const homesAt = (rotation: number) =>
    Array.from(
      { length: playerCount },
      (_, slot) => homeRing[(rotation + slot * spacing) % homeRing.length] as Hex,
    );
  const onIsland = (h: Hex) => ringOf(h) <= coastRadius;
  const island = tiles.filter(onIsland);
  const fairest = fairestRotations(spacing, (r) => landShares(homesAt(r), island));
  const homes = homesAt(fairest[rng.int(0, fairest.length - 1)] ?? 0);
  const homeSlot = new Map<HexKey, number>();
  homes.forEach((home, slot) => {
    for (const h of hexSpiral(home, 1)) homeSlot.set(hexKey(h), slot);
  });
  const toSeed = (h: Hex) => Math.min(...homes.map((home) => hexDistance(home, h)));

  // Terrain: patches over the land inside the coast, as on a Cozy Patch.
  const baseTerrain = new Map<HexKey, Terrain>();
  const land = tiles.filter((h) => ringOf(h) <= landR && !isGap(h));
  const landKeys = new Set(land.map(hexKey));
  const patchCount = Math.max(
    1,
    Math.floor((land.length + (mapGen.patchSize >> 1)) / mapGen.patchSize),
  );
  const unseeded = [...land];
  const frontier: Hex[] = [];
  for (let i = 0; i < patchCount && unseeded.length > 0; i++) {
    const patchStart = takeRandom(rng, unseeded);
    baseTerrain.set(hexKey(patchStart), rng.weighted(scatterable));
    frontier.push(patchStart);
  }
  while (frontier.length > 0) {
    const from = takeRandom(rng, frontier);
    const patch = baseTerrain.get(hexKey(from)) as Terrain; // every frontier hex has terrain
    for (const h of hexRing(from, 1)) {
      const key = hexKey(h);
      if (!landKeys.has(key) || baseTerrain.has(key)) continue;
      baseTerrain.set(key, patch);
      frontier.push(h);
    }
  }
  for (const h of tiles) {
    const ring = ringOf(h);
    if (isGap(h)) baseTerrain.set(hexKey(h), gapTerrain);
    else if (ring > coastRadius) baseTerrain.set(hexKey(h), ocean);
    else if (ring > landR) baseTerrain.set(hexKey(h), coast);
  }
  for (const home of homes) baseTerrain.set(hexKey(home), homeTerrain);

  // Offshore isles: short runs of land along the outer sea ring, a sea ring
  // off the coast, so nobody walks there (the Wave 2 ferry does).
  const isleOf = placeIsles(rules, layout, seed);
  for (const [key, isle] of isleOf) {
    baseTerrain.set(key, isle.middle ? isleTerrain(seed, key, scatterable) : coast);
  }

  // Rivers and lakes, re-rolled until every home is fairly served.
  let picked: {
    terrain: Map<HexKey, Terrain>;
    posts: Hex[];
    communities: PlacedCommunity[];
  } | null = null;
  for (let attempt = 0; attempt < rules.attempts && picked === null; attempt++) {
    const tried = tryWaterways({
      rules,
      homes,
      seed: deriveSeed(seed, 'wild-isle-water', attempt),
      ringOf,
      toSeed,
      isGap,
      coastRadius,
      landR,
    });
    if (typeof tried === 'string') continue;
    const terrain = new Map(baseTerrain);
    for (const [key, id] of tried.water) terrain.set(key, id === 'lake' ? lake : river);
    const result = checkIsland({
      terrain,
      tiles,
      homes,
      homeSlot,
      isleOf,
      rules,
      mapGen,
      options,
      onIsland,
    });
    if (typeof result === 'string') continue;
    picked = { terrain, ...result };
  }
  if (picked === null) {
    throw new RangeError(`no fair Wild Isle for ${playerCount} players`);
  }
  const { terrain, posts, communities } = picked;

  // Nodes and guardians as on a Cozy Patch, on their own seed; water holds
  // neither.
  const nodeRng = Rng.fromSeed(deriveSeed(seed, 'wild-isle-nodes'));
  const homeNodes = new Map<HexKey, string>();
  for (const home of homes) {
    const ring = hexRing(home, 1);
    for (const resource of mapGen.homeRingNodes) {
      homeNodes.set(hexKey(takeRandom(nodeRng, ring)), resource);
    }
  }
  const { guardianStrength: strength } = mapGen;
  const postKeys = new Set(posts.map(hexKey));
  const result = tiles.map((h): MapTile => {
    const key = hexKey(h);
    const tileTerrain = terrain.get(key) as Terrain; // every tile got one above
    const slot = homeSlot.get(key) ?? null;
    const isle = isleOf.get(key)?.isle;
    const base = { q: h.q, r: h.r, homeSlot: slot, ...(isle === undefined ? {} : { isle }) };
    if (postKeys.has(key)) {
      return { ...base, terrain: TRADING_POST_TERRAIN, nodeResource: null, guardianStrength: null };
    }
    if (isWater(tileTerrain)) {
      return { ...base, terrain: tileTerrain.id, nodeResource: null, guardianStrength: null };
    }
    let nodeResource: string | null = null;
    let guardianStrength: number | null = null;
    if (slot !== null) {
      nodeResource = homeNodes.get(key) ?? null;
    } else {
      if (tileTerrain.nodeChance > 0 && nodeRng.chance(tileTerrain.nodeChance)) {
        nodeResource = nodeRng.pick(tileTerrain.nodeResources);
      }
      if (isGap(h)) {
        guardianStrength = strength.gap;
      } else {
        const level = strength.min + Math.floor((toSeed(h) - 2) / strength.stepsPerLevel);
        guardianStrength = Math.min(strength.max, level);
      }
    }
    return { ...base, terrain: tileTerrain.id, nodeResource, guardianStrength };
  });
  const added = new Map(
    extraNodes(result, data.terrains, seed).map((n) => [hexKey(n), n.resource]),
  );
  return {
    playerCount,
    radius: layout.radius,
    tiles: result.map((t) => {
      const resource = added.get(hexKey(t));
      return resource === undefined ? t : { ...t, nodeResource: resource };
    }),
    homes,
    hollowEntrance: center,
    communities,
  };
}

/** The rotations whose biggest and smallest land shares are closest together. */
function fairestRotations(spacing: number, sharesAt: (rotation: number) => number[]): number[] {
  let best = Infinity;
  let rotations: number[] = [];
  for (let rotation = 0; rotation < spacing; rotation++) {
    const shares = sharesAt(rotation);
    const spread = Math.max(...shares) - Math.min(...shares);
    if (spread < best) {
      best = spread;
      rotations = [];
    }
    if (spread === best) rotations.push(rotation);
  }
  return rotations;
}

/** An isle tile: which isle (1 up), and whether it's the isle's middle. */
interface IsleTile {
  readonly isle: number;
  readonly middle: boolean;
}

/**
 * The offshore isles: `count` runs of `size` tiles along the sea ring
 * `offshore + 1` past the coast, at least 2 apart so no two touch.
 * Numbered from 1 in placement order (`tiles.isle`); the main island is null.
 */
function placeIsles(
  rules: WildIsleMapGen,
  layout: WildIsleLayout,
  seed: string,
): Map<HexKey, IsleTile> {
  const rng = Rng.fromSeed(deriveSeed(seed, 'wild-isle-isles'));
  const ring = hexRing(hex(0, 0), layout.radius - layout.oceanRings + rules.isles.offshore + 1);
  const count = rng.int(...rules.isles.count);
  const out = new Map<HexKey, IsleTile>();
  const taken: Hex[] = [];
  for (let isle = 1; isle <= count; isle++) {
    const size = rng.int(...rules.isles.size);
    // Every start where the whole run is clear of the isles already placed.
    const starts = ring
      .map((_, i) => i)
      .filter((i) =>
        Array.from({ length: size }, (_, k) => ring[(i + k) % ring.length] as Hex).every((h) =>
          taken.every((t) => hexDistance(t, h) > 2),
        ),
      );
    if (starts.length === 0) break;
    const start = rng.pick(starts);
    for (let k = 0; k < size; k++) {
      const h = ring[(start + k) % ring.length] as Hex;
      out.set(hexKey(h), { isle, middle: k === size >> 1 });
      taken.push(h);
    }
  }
  return out;
}

/** An isle's middle: a weighted roll of the island's terrains, on the tile's own seed. */
function isleTerrain(seed: string, key: HexKey, scatterable: readonly Terrain[]): Terrain {
  return Rng.fromSeed(deriveSeed(seed, 'wild-isle-isle-terrain', key)).weighted(scatterable);
}

interface WaterwayInput {
  readonly rules: WildIsleMapGen;
  readonly homes: readonly Hex[];
  readonly seed: string;
  readonly ringOf: (h: Hex) => number;
  readonly toSeed: (h: Hex) => number;
  readonly isGap: (h: Hex) => boolean;
  readonly coastRadius: number;
  readonly landR: number;
}

/**
 * Where `h` sits against the line from the centre through `axis`, in whole
 * numbers: `side` is the signed offset across it (axial cross product) and
 * `along` the distance down it (the dot product of the pixel positions,
 * times 4/3 so it stays whole). Only compared, never converted to steps.
 */
function sideOf(h: Hex, axis: Hex): number {
  return h.q * axis.r - axis.q * h.r;
}
function alongOf(h: Hex, axis: Hex): number {
  return (2 * h.q + h.r) * (2 * axis.q + axis.r) + 3 * h.r * axis.r;
}

/**
 * The homes each river runs past: a line from the centre through one home
 * (picked at random) is the island's grain, and homes the same distance
 * across it share a river, which runs along the grain. Six homes make three
 * rivers: one through the middle (past the axis home and the home opposite)
 * and one either side, past the two homes there. Each group is ordered down
 * the grain, so its river passes them in turn. Other seat counts group
 * differently (4 seats: one, two, one; 3 seats: one each), so a new layout
 * should revisit the river count and the tests.
 */
function riverGroups(homes: readonly Hex[], axis: Hex): number[][] {
  const order = homes
    .map((_, i) => i)
    .sort((a, b) => {
      const bySide = sideOf(homes[a] as Hex, axis) - sideOf(homes[b] as Hex, axis);
      return bySide !== 0 ? bySide : a - b;
    });
  const sides = order.map((i) => sideOf(homes[i] as Hex, axis));
  const spread = (sides[sides.length - 1] ?? 0) - (sides[0] ?? 0);
  const groups: number[][] = [];
  order.forEach((slot, i) => {
    // A new group when the gap to the last home is a real step across, not
    // the hex grid's rounding (a quarter of the whole spread or more).
    const gap = i === 0 ? Infinity : (sides[i] ?? 0) - (sides[i - 1] ?? 0);
    if (gap * 4 > spread) groups.push([slot]);
    else groups[groups.length - 1]?.push(slot);
  });
  for (const group of groups) {
    group.sort((a, b) => alongOf(homes[a] as Hex, axis) - alongOf(homes[b] as Hex, axis));
  }
  return groups;
}

/**
 * One try at the rivers and lakes. Rivers run sea to sea: each starts on
 * the coast, passes its homes `homeWaterSteps` away, and runs on to the
 * coast on the far side, so it cuts the island right through (there are no
 * fords: kids build bridges). Some widen into a lake on the way and keep
 * flowing out of its far side; a few more lakes lie about the land. Water
 * never comes within `waterMinFromSeed` of a Heart Seed, never touches the
 * Gap or the ring of land round it, and separate rivers and lakes never
 * touch each other, so no two rivers cross or join; rivers keep
 * `rivers.apart` steps apart, so the land between two is never a sliver.
 */
function tryWaterways(input: WaterwayInput): Waterways | WildIsleFailure {
  const { rules, homes, ringOf, toSeed, isGap, coastRadius, landR } = input;
  const rng = Rng.fromSeed(input.seed);
  const water = new Map<HexKey, string>();
  /** Which river or lake each water tile belongs to, so a body may touch itself. */
  const bodyOf = new Map<HexKey, number>();
  let body = 0;
  const dry = (h: Hex) =>
    ringOf(h) <= coastRadius &&
    !isGap(h) &&
    toSeed(h) >= rules.waterMinFromSeed &&
    !water.has(hexKey(h));
  /** Can body `b` take `h`: dry, and touching no other body's water? */
  const canTake = (h: Hex, b: number) =>
    dry(h) &&
    !isGapEdge(h) &&
    hexNeighbors(h).every((n) => {
      const other = bodyOf.get(hexKey(n));
      return other === undefined || other === b;
    });
  // One tile of land round the Gap, so it's always walkable to.
  function isGapEdge(h: Hex): boolean {
    return hexNeighbors(h).some(isGap);
  }
  const add = (h: Hex, id: string, b: number) => {
    water.set(hexKey(h), id);
    bodyOf.set(hexKey(h), b);
  };
  /**
   * The river (or -1: more than one) within `rivers.apart - 1` steps of each
   * tile, so a river keeps that far from the others.
   */
  const nearRiver = new Map<HexKey, number>();
  /** Can river `b` take `h`: as `canTake`, and no other river this close? */
  const riverCanTake = (h: Hex, b: number) => {
    const near = nearRiver.get(hexKey(h));
    return (near === undefined || near === b) && canTake(h, b);
  };
  /** A random pick among the `wiggle` best of `tiles` (highest score first). */
  const pickBest = (tiles: readonly Hex[], score: (h: Hex) => number): Hex | undefined => {
    const ranked = [...tiles].sort((a, b) => score(b) - score(a));
    return ranked.length === 0
      ? undefined
      : rng.pick(ranked.slice(0, Math.min(ranked.length, rules.rivers.wiggle)));
  };

  const axis = homes[rng.int(0, homes.length - 1)] as Hex;
  const groups = shuffled(rng, riverGroups(homes, axis));
  const coastRing = hexRing(hex(0, 0), coastRadius);
  let lakes = 0;
  const riverPaths: Hex[][] = [];
  for (const group of groups) {
    const b = body++;
    const path = riverAcross(group, b);
    if (path === null) return 'river';
    for (const h of path) {
      add(h, 'river', b);
      for (const n of hexSpiral(h, rules.rivers.apart - 1)) {
        const key = hexKey(n);
        const near = nearRiver.get(key);
        nearRiver.set(key, near === undefined || near === b ? b : -1);
      }
    }
    riverPaths.push(path);
  }
  // River lakes first, then any more the count still wants.
  const wanted = rng.int(...rules.lakes.count);
  for (const path of riverPaths) {
    if (lakes >= wanted) break;
    if (!rng.chance(rules.rivers.lakePercent)) continue;
    // Away from both mouths, so the river runs in and out.
    const middle = path.filter((h) => ringOf(h) < landR - 1);
    if (middle.length === 0) continue;
    const at = rng.pick(middle);
    const b = bodyOf.get(hexKey(at)) as number;
    const grown = growLake(at, b, true);
    if (grown === null) continue;
    for (const h of grown) add(h, 'lake', b);
    lakes++;
  }
  for (let tries = 0; lakes < wanted && tries < 20; tries++) {
    const b = body++;
    const centres = hexSpiral(hex(0, 0), landR - 1).filter((h) => canTake(h, b));
    if (centres.length === 0) break;
    const grown = growLake(rng.pick(centres), b, false);
    if (grown === null) continue;
    for (const h of grown) add(h, 'lake', b);
    lakes++;
  }
  if (lakes < rules.lakes.count[0]) return 'lake';
  return { water };

  /**
   * The river past the homes in `group`: from a coast tile up the grain,
   * past a tile `homeWaterSteps` from each home on one side of it (the same
   * side for the whole river), to a coast tile down the grain. Each leg is
   * one of the shortest walks between its ends over tiles the river may
   * take, picked step by step at random, and never touches the river's
   * earlier tiles, so it's one tile wide. Null when it's boxed in.
   */
  function riverAcross(group: readonly number[], b: number): Hex[] | null {
    // A river off the middle passes its homes on the inland side, so it
    // crosses the island instead of hugging the coast; the middle one picks.
    const across = group.reduce((sum, slot) => sum + sideOf(homes[slot] as Hex, axis), 0);
    const side = across > 0 ? -1 : across < 0 ? 1 : rng.chance(50) ? 1 : -1;
    const passes: Hex[] = [];
    for (const slot of group) {
      const home = homes[slot] as Hex;
      const homeSide = sideOf(home, axis);
      const toSide = (h: Hex) => side * (sideOf(h, axis) - homeSide);
      const pass = pickBest(
        hexRing(home, rules.homeWaterSteps).filter(
          (h) => toSide(h) > 0 && ringOf(h) < landR && riverCanTake(h, b),
        ),
        toSide,
      );
      if (pass === undefined) return null;
      passes.push(pass);
    }
    const first = passes[0] as Hex;
    const last = passes[passes.length - 1] as Hex;
    /** The coast tile straight on from `from`, up (-1) or down (+1) the grain. */
    const mouth = (from: Hex, way: number) =>
      pickBest(
        coastRing.filter(
          (h) => way * (alongOf(h, axis) - alongOf(from, axis)) > 0 && riverCanTake(h, b),
        ),
        (h) => -Math.abs(sideOf(h, axis) - sideOf(from, axis)),
      );
    const start = mouth(first, -1);
    const end = mouth(last, 1);
    // Mouths on far-apart coasts, so the river crosses the island.
    if (start === undefined || end === undefined || hexDistance(start, end) < coastRadius) {
      return null;
    }
    /** Beside the coast only for the step into a mouth, so no river runs along it. */
    const inland = (h: Hex) =>
      ringOf(h) < landR ||
      (ringOf(h) === landR && (hexDistance(h, start) === 1 || hexDistance(h, end) === 1));
    const path: Hex[] = [start];
    const own = new Set<HexKey>([hexKey(start)]);
    for (const goal of [...passes, end]) {
      const from = path[path.length - 1] as Hex;
      const goalKey = hexKey(goal);
      // Inland tiles (or this leg's goal) this river may take that touch
      // none of its earlier tiles but the one it sets off from.
      const open = (h: Hex) =>
        (hexKey(h) === goalKey || inland(h)) &&
        !own.has(hexKey(h)) &&
        riverCanTake(h, b) &&
        hexNeighbors(h).every((n) => !own.has(hexKey(n)) || hexKey(n) === hexKey(from));
      if (!open(goal)) return null;
      const stepsTo = hexBfs([goal], open);
      const stepsLeft = Math.min(
        ...hexNeighbors(from).map((n) => stepsTo.get(hexKey(n)) ?? Infinity),
      );
      if (stepsLeft === Infinity) return null;
      // Each step goes one nearer the goal, so the leg is a shortest walk.
      let at = from;
      for (let left = stepsLeft; left >= 0; left--) {
        const here = at;
        at = rng.pick(hexNeighbors(here).filter((n) => stepsTo.get(hexKey(n)) === left));
        path.push(at);
        own.add(hexKey(at));
      }
    }
    return path;
  }

  /**
   * A lake of `size` tiles grown from `from` (a river tile when `onRiver`),
   * never onto the coast or within `waterMinFromSeed` of a seed. Null if it
   * can't reach the size.
   */
  function growLake(from: Hex, b: number, onRiver: boolean): Hex[] | null {
    const size = rng.int(...rules.lakes.size);
    const blob: Hex[] = [from];
    const inBlob = new Set<HexKey>([hexKey(from)]);
    const fits = (h: Hex) =>
      !inBlob.has(hexKey(h)) &&
      ringOf(h) < landR &&
      (onRiver && water.has(hexKey(h)) ? bodyOf.get(hexKey(h)) === b : canTake(h, b));
    while (blob.length < size) {
      const edge = blob.flatMap((h) => hexNeighbors(h).filter(fits));
      if (edge.length === 0) return null;
      const next = rng.pick(edge);
      blob.push(next);
      inBlob.add(hexKey(next));
    }
    return blob;
  }
}

interface CheckInput {
  readonly terrain: ReadonlyMap<HexKey, Terrain>;
  readonly tiles: readonly Hex[];
  readonly homes: readonly Hex[];
  readonly homeSlot: ReadonlyMap<HexKey, number>;
  readonly isleOf: ReadonlyMap<HexKey, IsleTile>;
  readonly rules: WildIsleMapGen;
  readonly mapGen: MapGenData['mapGen'];
  readonly options: GenerateMapOptions;
  readonly onIsland: (h: Hex) => boolean;
}

/**
 * Is this water layout fair? Every home has a river within `homeWaterSteps`,
 * at least `minRegionLand` land it can walk to without a bridge, every
 * piece of land with no home holds at least `minPieceLand`, a land share within
 * `landBandPercent` of the average, and a trading post on its own land; and
 * the villages fit. Returns the posts and villages, or why not.
 */
function checkIsland(
  input: CheckInput,
): { posts: Hex[]; communities: PlacedCommunity[] } | WildIsleFailure {
  const { terrain, rules, homes, mapGen, options } = input;
  const terrainAt = (h: Hex) => terrain.get(hexKey(h));
  const isLand = (h: Hex) => input.onIsland(h) && !isWater(terrainAt(h));
  for (const home of homes) {
    // A river, not just a lake: a lake grown over the river's pass tile
    // could leave a home with only a lake close by.
    const near = hexSpiral(home, rules.homeWaterSteps).some(
      (h) => terrainAt(h)?.id === rules.riverTerrain,
    );
    if (!near) return 'water-near-home';
  }
  const regions = homes.map((home) => hexBfs([home], isLand));
  if (regions.some((r) => r.size < rules.minRegionLand)) return 'region';
  // Land with no home on it (a bridge away) is a real piece, never a pocket.
  const reached = new Set(regions.flatMap((r) => [...r.keys()]));
  for (const h of input.tiles) {
    if (!isLand(h) || reached.has(hexKey(h))) continue;
    const piece = hexBfs([h], isLand);
    if (piece.size < rules.minPieceLand) return 'sliver';
    for (const key of piece.keys()) reached.add(key);
  }
  const shares = landShares(homes, input.tiles.filter(isLand));
  const total = shares.reduce((a, b) => a + b, 0);
  const band = rules.landBandPercent;
  for (const share of shares) {
    // share / (total / n) within 100 ± band %, in whole numbers.
    const percent = share * 100 * homes.length;
    if (percent > total * (100 + band) || percent < total * (100 - band)) return 'balance';
  }
  // Posts and villages stand on the main island's land only.
  const landTiles = input.tiles.filter(isLand).map((h) => ({
    q: h.q,
    r: h.r,
    terrain: (terrainAt(h) as Terrain).id,
    homeSlot: input.homeSlot.get(hexKey(h)) ?? null,
  }));
  const posts = placeTradingPosts({
    tiles: landTiles,
    homes,
    gapTerrain: mapGen.gapTerrain,
    rules: mapGen.tradingPosts,
    seed: options.seed,
  });
  if (posts === null) return 'posts';
  if (!regions.every((r) => posts.some((p) => r.has(hexKey(p))))) return 'posts';
  const postKeys = new Set(posts.map(hexKey));
  const villageInput = {
    tiles: landTiles.map((t) =>
      postKeys.has(hexKey(t)) ? { ...t, terrain: TRADING_POST_TERRAIN } : t,
    ),
    homes,
    gapTerrain: mapGen.gapTerrain,
    rules: mapGen.communities,
    seed: options.seed,
    ...(options.cellarKeys ? { keys: options.cellarKeys } : {}),
  };
  const communities =
    placeCommunities(villageInput) ??
    placeCommunities({ ...villageInput, maxFromSeed: mapGen.communities.relaxedMaxFromSeed });
  if (communities === null) return 'communities';
  return { posts, communities };
}
