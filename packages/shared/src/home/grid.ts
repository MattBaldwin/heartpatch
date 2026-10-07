import { HEX_DIRECTIONS, hex, type Hex } from '../hex/index.js';
import type { BuildingSlot } from '../schemas/data/buildings.js';
import type { HomeBaseRules } from '../schemas/data/home-base.js';

// Building spots on a home tile (design doc §13: "placed on a grid within
// home-base tiles"). Spot 0 is the tile's middle and spots 1–6 sit around it
// in `HEX_DIRECTIONS` order, like a tiny hex ring inside the tile. Each
// building takes one spot. The middle is the `centre` slot (lights such as a
// Hearthfire, #204) and the six around it the `ring` (habitats and the like).
// Edges (fences, #203) aren't spots.

/** What a home tile has standing in its middle already. */
export interface HomeTileFeatures {
  /** The Heart Seed tile (the middle of the home base). */
  readonly heartSeed: boolean;
  /** Resource id of the tile's node, if it has one. */
  readonly nodeResource: string | null;
}

/** Where a spot sits inside its tile, in sub-hex steps from the middle (spot 0 = `0,0`). */
export function spotOffset(spot: number): Hex {
  if (spot === 0) return hex(0, 0);
  const direction = HEX_DIRECTIONS[spot - 1];
  if (!direction || !Number.isSafeInteger(spot)) {
    throw new RangeError(`spotOffset(): no spot ${spot}`);
  }
  return direction;
}

/** Is `spot` a real spot on a tile? */
export function isSpot(rules: Pick<HomeBaseRules, 'spotsPerTile'>, spot: number): boolean {
  return Number.isSafeInteger(spot) && spot >= 0 && spot < rules.spotsPerTile;
}

/** The middle of a tile holds its Heart Seed or resource node, if it has one. */
export function isReservedSpot(tile: HomeTileFeatures, spot: number): boolean {
  return spot === 0 && (tile.heartSeed || tile.nodeResource !== null);
}

/** Which slot a spot belongs to: the middle is the `centre`, the rest the `ring`. */
export function slotOfSpot(spot: number): Exclude<BuildingSlot, 'edge'> {
  return spot === 0 ? 'centre' : 'ring';
}

/** Can a building that takes `slot` stand on `spot`? Edge buildings never take a spot. */
export function fitsSlot(slot: BuildingSlot, spot: number): boolean {
  return slot !== 'edge' && slotOfSpot(spot) === slot;
}

/**
 * Spots a building could go on this tile, in order, given the ones already
 * taken: only its `slot`'s spots when one is given (#204).
 */
export function freeSpots(
  rules: Pick<HomeBaseRules, 'spotsPerTile'>,
  tile: HomeTileFeatures,
  taken: ReadonlySet<number>,
  slot?: BuildingSlot,
): number[] {
  const free: number[] = [];
  for (let spot = 0; spot < rules.spotsPerTile; spot++) {
    if (slot !== undefined && !fitsSlot(slot, spot)) continue;
    if (!isReservedSpot(tile, spot) && !taken.has(spot)) free.push(spot);
  }
  return free;
}
