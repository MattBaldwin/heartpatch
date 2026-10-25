import { TERRAINS } from '../data/terrains.js';
import { hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import { patchRules, type PatchType } from '../patch-types/index.js';
import { buildsOnPatchType, type TravelBuilding } from '../schemas/data/buildings.js';
import { lakeBodies, lakesTouching, type WaterTile } from './water.js';

// Can a bridge, ferry dock or waystation go on this tile (Wild Isle, #621)?
// The client's Build sheet asks this to grey a spot out and say why; the
// server stays the judge. It mirrors apps/server/src/modules/buildings/
// service.ts, in the server's order:
//  - `travelRulesFor`: the patch type must allow the building
//    (`buildsOnPatchType`) and have travel rules (Cozy: none), else
//    `wrong-patch`; a waystation is refused for now (`not-yet`).
//  - `checkSpot` (bridge): the tile is a nobody's, non-village tile of the
//    bridge's `onWater` kind (river), else `not-river`.
//  - `checkCrossing` (bridge): no building there yet (`taken`), and a
//    neighbour is supplied land (`too-far`).
//  - `checkSpot` (dock): the tile is the player's own land (`not-mine`) with
//    no building (`taken`).
//  - `checkCrossing` (dock): it touches a lake (`no-lake`) and, while
//    `ferry.oneDockPerLake`, none of those lakes already has a dock of the
//    player's (`one-dock`).
// Slot/home-ring/house checks of `checkSpot` stay server-side; they are not
// about water. Pure.

/** Why a spot won't take the building; the client maps each to kid-readable text. */
export type BuildableProblem =
  | 'wrong-patch'
  | 'not-yet'
  | 'not-river'
  | 'taken'
  | 'too-far'
  | 'not-mine'
  | 'no-lake'
  | 'one-dock';

export type BuildableResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: BuildableProblem };

/** The tile asked about, with what the rules read from it. */
export interface BuildableTile extends WaterTile {
  readonly ownerUserId: string | null;
  /** Set on a Hollowed Community's tiles; those are nobody's to bridge. */
  readonly communityId?: string | null;
  /** True when a building already stands here. */
  readonly hasBuilding?: boolean;
}

export interface BuildableOnInput {
  readonly building: TravelBuilding;
  readonly patchType: PatchType;
  readonly userId: string;
  readonly tile: BuildableTile;
  /** Every tile of the patch (terrain), for lakes. Needed for a dock. */
  readonly tiles: readonly WaterTile[];
  /** The player's supplied land (`supplyMap(...).supplied`). Needed for a bridge. */
  readonly supplied: ReadonlySet<HexKey>;
  /** Where the player's ferry docks already stand. Needed for a dock. */
  readonly ownDocks?: readonly Hex[];
}

const WATER_OF = new Map(TERRAINS.map((t) => [t.id, t.water ?? null]));

export function isBuildableOn(input: BuildableOnInput): BuildableResult {
  const { building, patchType, userId, tile } = input;
  const travel = patchRules(patchType).travel;
  if (!travel || !buildsOnPatchType(building, patchType)) return no('wrong-patch');
  if (building.role === 'waystation') return no('not-yet');

  if (building.role === 'bridge') {
    const water =
      tile.ownerUserId === null && (tile.communityId ?? null) === null
        ? WATER_OF.get(tile.terrain)
        : null;
    if (water !== building.onWater) return no('not-river');
    if (tile.hasBuilding) return no('taken');
    if (!hexNeighbors(tile).some((n) => input.supplied.has(hexKey(n)))) return no('too-far');
    return { ok: true };
  }

  if (tile.ownerUserId !== userId || WATER_OF.get(tile.terrain)) return no('not-mine');
  if (tile.hasBuilding) return no('taken');
  const bodies = lakeBodies(input.tiles);
  const lakes = lakesTouching(bodies, tile);
  if (lakes.length === 0) return no('no-lake');
  if (travel.ferry.oneDockPerLake) {
    const docked = new Set((input.ownDocks ?? []).flatMap((d) => lakesTouching(bodies, d)));
    if (lakes.some((lake) => docked.has(lake))) return no('one-dock');
  }
  return { ok: true };
}

function no(reason: BuildableProblem): BuildableResult {
  return { ok: false, reason };
}
