import { BUILDINGS } from '../../src/data/buildings.js';
import { hexKey, hexSpiral, type HexKey } from '../../src/hex/index.js';
import type { MapTile } from '../../src/mapgen/index.js';

/*
 * Where may a Hearthfire stand? (#295, one building per tile, with clearing
 * from #242.) For each rule, fires go where they light the most of the kid's
 * outer land (level 1 while the fuel lasts, else level 3), and the report
 * says how much of the land they reach. It also says whether two homesteads
 * are left free for the Training Grounds and the Crafting Factory, which now
 * take a homestead each. A report for the owner's choice; nothing here gates.
 */

/** Terrains a kid can clear (owner decision 2026-10-11; Old Forest and Pumpkin Fields wait on the owner). */
export const CLEARABLE = new Set(['meadow', 'forest', 'hills', 'mountains']); // TUNE:

export interface PlacementRule {
  readonly id: string;
  readonly label: string;
  /** Can a fire stand here? `homestead` says if the tile is a joined homestead. */
  readonly site: (tile: MapTile, homestead: boolean) => boolean;
}

export const PLACEMENT_RULES: readonly PlacementRule[] = [
  { id: 'today', label: 'Today: any owned land without a spot', site: (t) => !t.nodeResource },
  {
    id: 'homesteads',
    label: 'Homesteads only, spots cleared',
    site: (t, homestead) => homestead && (!t.nodeResource || CLEARABLE.has(t.terrain)),
  },
  {
    id: 'any-land',
    label: 'Any owned land, spots cleared on homesteads',
    site: (t, homestead) => !t.nodeResource || (homestead && CLEARABLE.has(t.terrain)),
  },
];

const hearthfire = BUILDINGS.find((b) => b.id === 'hearthfire');
if (hearthfire?.kind !== 'hearthfire') throw new Error('no Hearthfire in the building data');
const RADII = hearthfire.levels.map((l) => l.safeRadius);
const LOW = Math.min(...RADII);
const HIGH = Math.max(...RADII);

/** Greedy fires lighting what they can of `need`, at one radius. */
function greedy(need: ReadonlySet<HexKey>, sites: readonly MapTile[], radius: number): HexKey[] {
  const left = new Set(need);
  const fires: HexKey[] = [];
  const reach = new Map(sites.map((s) => [hexKey(s), hexSpiral(s, radius).map(hexKey)]));
  for (;;) {
    let best: HexKey | null = null;
    let gain = 0;
    for (const [at, lit] of reach) {
      const n = lit.filter((k) => left.has(k)).length;
      if (n > gain || (n === gain && n > 0 && best !== null && at < best)) {
        best = at;
        gain = n;
      }
    }
    if (best === null) return fires;
    fires.push(best);
    for (const k of reach.get(best) ?? []) left.delete(k);
    reach.delete(best);
  }
}

/** One rule's result on one day. */
export interface PlacementCover {
  readonly rule: string;
  readonly fires: number;
  /** Outer tiles a fire lights. */
  readonly lit: number;
  readonly outer: number;
  /** Joined homesteads with no fire, left for the Training Grounds and the Factory. */
  readonly freeHomesteads: number;
}

/** How much of the kid's outer land each placement rule can light. */
export function placementCover(
  land: readonly HexKey[],
  tiles: ReadonlyMap<HexKey, MapTile>,
  homesteads: ReadonlySet<HexKey>,
  fuelFires: number,
): PlacementCover[] {
  const owned = land.flatMap((k) => {
    const t = tiles.get(k);
    return t && t.homeSlot === null ? [t] : [];
  });
  const outer = new Set(owned.map(hexKey));
  return PLACEMENT_RULES.map((rule) => {
    const sites = owned.filter((t) => rule.site(t, homesteads.has(hexKey(t))));
    const plain = greedy(outer, sites, LOW);
    const wide = plain.length > fuelFires;
    const fires = wide ? greedy(outer, sites, HIGH) : plain;
    const lit = new Set<HexKey>();
    for (const at of fires) {
      const tile = tiles.get(at);
      if (!tile) continue;
      for (const h of hexSpiral(tile, wide ? HIGH : LOW)) {
        if (outer.has(hexKey(h))) lit.add(hexKey(h));
      }
    }
    const firesAt = new Set(fires);
    return {
      rule: rule.id,
      fires: fires.length,
      lit: lit.size,
      outer: outer.size,
      freeHomesteads: [...homesteads].filter((k) => !firesAt.has(k)).length,
    };
  });
}
