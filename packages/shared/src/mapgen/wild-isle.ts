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
  /** Spring tiles (each river's first), whose ring turns to hills. */
  readonly springs: readonly Hex[];
}

/** Why a try at the water failed (each one means: roll again). */
type WildIsleFailure =
  'river' | 'lake' | 'water-near-home' | 'region' | 'balance' | 'posts' | 'communities';

/**
 * Generates a Wild Isle (#621) from its seed: Juniper's Gap at the centre,
 * homes evenly spaced as on a Cozy Patch, patchy terrain over the land, then
 * rivers and lakes (each home gets one within `homeWaterSteps`), a coast
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
  const springTerrain = terrainOf(rules.rivers.sourceTerrain);
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
      layout,
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
    for (const spring of tried.springs) {
      for (const h of hexRing(spring, 1)) {
        const key = hexKey(h);
        if (landKeys.has(key) && !tried.water.has(key) && !homeSlot.has(key)) {
          terrain.set(key, springTerrain);
        }
      }
    }
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
  readonly layout: WildIsleLayout;
  readonly homes: readonly Hex[];
  readonly seed: string;
  readonly ringOf: (h: Hex) => number;
  readonly toSeed: (h: Hex) => number;
  readonly isGap: (h: Hex) => boolean;
  readonly coastRadius: number;
  readonly landR: number;
}

/**
 * One try at the rivers and lakes. Each river runs from a spring inside the
 * home ring, past one home (within `homeWaterSteps`), straight-ish out to
 * the coast's nearest tile, so it always reaches the sea; some widen into a
 * lake on the way and keep flowing out of its far side. Every other home
 * gets a lake of its own. Water never comes within `waterMinFromSeed` of a
 * Heart Seed, never touches the Gap, and separate rivers and lakes never
 * touch each other, so lake bodies stay apart.
 */
function tryWaterways(input: WaterwayInput): Waterways | WildIsleFailure {
  const { rules, homes, ringOf, toSeed, isGap, coastRadius, landR } = input;
  const rng = Rng.fromSeed(input.seed);
  const water = new Map<HexKey, string>();
  /** Which river or lake each water tile belongs to, so a body may touch itself. */
  const bodyOf = new Map<HexKey, number>();
  const springs: Hex[] = [];
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

  const slots = shuffled(
    rng,
    homes.map((_, i) => i),
  );
  const riverCount = Math.min(homes.length, rng.int(...rules.rivers.count));
  let lakes = 0;
  const riverPaths: Hex[][] = [];
  for (let i = 0; i < riverCount; i++) {
    const home = homes[slots[i] as number] as Hex;
    const b = body++;
    const path = riverPast(home, b);
    if (path === null) return 'river';
    for (const h of path) add(h, 'river', b);
    springs.push(path[0] as Hex);
    riverPaths.push(path);
  }
  const lakeHomes = slots.slice(riverCount);
  // River lakes, while the lake budget leaves room for every home's own.
  for (const path of riverPaths) {
    if (lakeHomes.length + lakes >= rules.lakes.count[1]) break;
    if (!rng.chance(rules.rivers.lakePercent)) continue;
    // Away from the spring and the mouth, so the river runs in and out.
    const middle = path.filter((h, i) => i > 1 && ringOf(h) < landR);
    if (middle.length === 0) continue;
    const at = rng.pick(middle);
    const b = bodyOf.get(hexKey(at)) as number;
    const grown = growLake(at, b, true);
    if (grown === null) continue;
    for (const h of grown) add(h, 'lake', b);
    lakes++;
  }
  // A lake for every home with no river, then any the count still wants.
  for (const slot of lakeHomes) {
    const home = homes[slot] as Hex;
    const b = body++;
    const centres = hexRing(home, rules.homeWaterSteps).filter(
      (h) => ringOf(h) < landR && canTake(h, b),
    );
    const grown = centres.length === 0 ? null : growLake(rng.pick(centres), b, false);
    if (grown === null) return 'lake';
    for (const h of grown) add(h, 'lake', b);
    lakes++;
  }
  const wanted = rng.int(...rules.lakes.count);
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
  return { water, springs };

  /**
   * A river for `home`: spring → a tile `homeWaterSteps` from the home, beside
   * it → the nearest coast tile. Each step goes to a random neighbour nearer
   * the next goal that the river may take, never touching its own earlier
   * tiles (so it's one tile wide), or null when it's boxed in.
   */
  function riverPast(home: Hex, b: number): Hex[] | null {
    const byHome = hexRing(home, rules.homeWaterSteps).filter(
      (h) => Math.abs(ringOf(h) - input.layout.homeDistance) <= 1 && canTake(h, b),
    );
    if (byHome.length === 0) return null;
    const pass = rng.pick(byHome);
    const [minRing, maxRing] = rules.rivers.sourceRing;
    const sources = hexSpiral(hex(0, 0), maxRing).filter(
      (h) =>
        ringOf(h) >= minRing &&
        canTake(h, b) &&
        hexDistance(h, pass) >= 3 &&
        springs.every((s) => hexDistance(s, h) > 3),
    );
    if (sources.length === 0) return null;
    // The nearest springs to the pass tile, so the river runs past the home.
    const nearest = Math.min(...sources.map((h) => hexDistance(h, pass)));
    const spring = rng.pick(sources.filter((h) => hexDistance(h, pass) <= nearest + 1));
    const coastRing = hexRing(hex(0, 0), coastRadius);
    const toCoast = Math.min(...coastRing.map((h) => hexDistance(h, pass)));
    const mouth = rng.pick(coastRing.filter((h) => hexDistance(h, pass) === toCoast));
    const path: Hex[] = [spring];
    const own = new Set<HexKey>([hexKey(spring)]);
    for (const goal of [pass, mouth]) {
      let at = path[path.length - 1] as Hex;
      while (hexDistance(at, goal) > 0) {
        const from = at;
        const steps = hexNeighbors(from).filter(
          (n) =>
            hexDistance(n, goal) < hexDistance(from, goal) &&
            !own.has(hexKey(n)) &&
            canTake(n, b) &&
            hexNeighbors(n).every((m) => !own.has(hexKey(m)) || hexKey(m) === hexKey(from)),
        );
        if (steps.length === 0) return null;
        at = rng.pick(steps);
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
 * Is this water layout fair? Every home has water within `homeWaterSteps`,
 * at least `minRegionLand` land it can walk to, a land share within
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
    const near = hexSpiral(home, rules.homeWaterSteps).some((h) => {
      const t = terrainAt(h);
      return isWater(t) && t?.water !== 'deep';
    });
    if (!near) return 'water-near-home';
  }
  const regions = homes.map((home) => hexBfs([home], isLand));
  if (regions.some((r) => r.size < rules.minRegionLand)) return 'region';
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
