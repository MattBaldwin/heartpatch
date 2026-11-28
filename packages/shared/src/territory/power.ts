import { BUILDINGS } from '../data/buildings.js';
import { hexDistance, hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import type { PowerRules } from '../schemas/data/power.js';
import { isWaterTerrain } from './reach.js';

// Clockwork Isle power (#874, owner answer Q3: wires like roads). Power is a
// reach rule, not a flow: a `needsPower` building works while it is joined
// to one of its owner's generators (`POWER_RULES.model`). Pure: the server
// writes `buildings.unpowered_since` from it and the client can draw the
// same wires lit.

/** A tile as the power rules need it: where, whose, and what terrain. */
export interface PowerTile extends Hex {
  readonly ownerUserId: string | null;
  readonly terrain: string;
}

/** A wire (`tile_lines` kind `wire`): where and whose. */
export interface WireSpot extends Hex {
  readonly ownerUserId: string;
}

/** A standing generator (a works row marked `generator`): where and whose. */
export interface GeneratorSpot extends Hex {
  readonly ownerUserId: string;
}

const GENERATOR_IDS = new Set(
  BUILDINGS.flatMap((b) => (b.kind === 'works' && b.generator ? [b.id] : [])),
);
const NEEDS_POWER_IDS = new Set(BUILDINGS.flatMap((b) => (b.needsPower ? [b.id] : [])));

/** Is this building content id a generator (the Windmill)? */
export const isGenerator = (buildingId: string): boolean => GENERATOR_IDS.has(buildingId);

/** Does this building content id need power (the Sorter, the Beacon…)? */
export const needsPower = (buildingId: string): boolean => NEEDS_POWER_IDS.has(buildingId);

/** Every content id whose row power touches: generators and `needsPower` rows. Sorted. */
export const POWER_BUILDING_IDS: readonly string[] = [
  ...new Set([...GENERATOR_IDS, ...NEEDS_POWER_IDS]),
].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** The player's land tiles, by key. */
function landOf(tiles: readonly PowerTile[], userId: string): Map<HexKey, PowerTile> {
  return new Map(
    tiles
      .filter((t) => t.ownerUserId === userId && !isWaterTerrain(t.terrain))
      .map((t) => [hexKey(t), t]),
  );
}

/**
 * How many wires from a generator each of the player's live wires is
 * (`model: 'wires'`), cloned from `canalReach`: a wire on or next to one
 * of their generators is 1, a wire next to that 2, and so on, the fewest
 * steps winning. Only the player's own wires on land they hold count, and
 * only their own generators standing on land they hold (another owner's
 * generator never powers them). A wire past `maxRun`, or in a chain that
 * never reaches a generator, carries nothing and is left out.
 */
export function powerReach(
  tiles: readonly PowerTile[],
  wires: readonly WireSpot[],
  generators: readonly GeneratorSpot[],
  userId: string,
  rules: Pick<PowerRules, 'wire'>,
): Map<HexKey, number> {
  const land = landOf(tiles, userId);
  const mine = (h: Hex & { ownerUserId: string }) =>
    h.ownerUserId === userId && land.has(hexKey(h));
  const at = new Set(wires.filter(mine).map(hexKey));
  const sources = new Set(generators.filter(mine).map(hexKey));
  const joined = (h: Hex) =>
    sources.has(hexKey(h)) || hexNeighbors(h).some((n) => sources.has(hexKey(n)));
  const reach = new Map<HexKey, number>();
  let frontier: Hex[] = wires.filter((w) => at.has(hexKey(w)) && joined(w));
  for (const w of frontier) reach.set(hexKey(w), 1);
  for (let run = 2; run <= rules.wire.maxRun && frontier.length > 0; run++) {
    const next: Hex[] = [];
    for (const w of frontier) {
      for (const n of hexNeighbors(w)) {
        const k = hexKey(n);
        if (!at.has(k) || reach.has(k)) continue;
        reach.set(k, run);
        next.push(n);
      }
    }
    frontier = next;
  }
  return reach;
}

/**
 * The player's land tiles where a `needsPower` building of theirs is
 * powered, by `rules.model`:
 * - `wires`: a tile with or next to one of their generators, or with or
 *   next to a wire that carries power (`powerReach`);
 * - `radius`: within `radius` tiles of one of their generators;
 * - `none`: all their land, while they have a generator anywhere on it.
 * Only the player's generators on land they hold count.
 */
export function poweredSet(
  tiles: readonly PowerTile[],
  wires: readonly WireSpot[],
  generators: readonly GeneratorSpot[],
  userId: string,
  rules: PowerRules,
): Set<HexKey> {
  const land = landOf(tiles, userId);
  const sources = generators.filter((g) => g.ownerUserId === userId && land.has(hexKey(g)));
  const powered = new Set<HexKey>();
  if (sources.length === 0) return powered;
  if (rules.model === 'none') return new Set(land.keys());
  if (rules.model === 'radius') {
    for (const [key, tile] of land) {
      if (sources.some((g) => hexDistance(g, tile) <= rules.radius)) powered.add(key);
    }
    return powered;
  }
  const lit = (h: Hex) => {
    for (const n of [h, ...hexNeighbors(h)]) {
      const key = hexKey(n);
      if (land.has(key)) powered.add(key);
    }
  };
  for (const g of sources) lit(g);
  for (const key of powerReach(tiles, wires, generators, userId, rules).keys()) {
    const tile = land.get(key);
    if (tile) lit(tile);
  }
  return powered;
}
