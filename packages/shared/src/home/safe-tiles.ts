import { hexKey, hexSpiral, type Hex, type HexKey } from '../hex/index.js';

// Safe tiles at nightfall (design doc §11, §14). Every home base is always
// safe: the Heart Seed keeps it so (owner decision 2026-10-07), fire or not.
// Out on captured land, a lit Hearthfire keeps its own tile and every tile
// within its safe radius safe, measured in hex tiles. Nightfall (#21) asks
// this which tiles are protected.

export interface SafeFire {
  /** The tile the fire stands on. */
  readonly at: Hex;
  /** `safeRadius` at its level, in tiles. */
  readonly radius: number;
}

/**
 * Every tile that's safe tonight: all of `homeTiles` (every home base's
 * tiles), plus each **lit** fire's tile and its radius. Pass only fires that
 * are lit for the night being asked about (`protectsNight` /
 * `hearthfireState().lit`).
 */
export function safeTiles(fires: readonly SafeFire[], homeTiles: readonly Hex[] = []): Set<HexKey> {
  const safe = new Set<HexKey>(homeTiles.map(hexKey));
  for (const fire of fires) {
    for (const h of hexSpiral(fire.at, fire.radius)) safe.add(hexKey(h));
  }
  return safe;
}
