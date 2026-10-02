import { hexKey, hexSpiral, type Hex, type HexKey } from '../hex/index.js';

// Hearthfire safe radii (design doc §11, §14): measured in hex tiles from the
// fire's own tile. A lit fire also covers its whole home base ("squishies
// inside the home base with a lit Hearthfire are safe"), wherever on it the
// fire stands. Nightfall (#21) asks this which tiles are protected.

export interface SafeFire {
  /** The tile the fire stands on. */
  readonly at: Hex;
  /** `safeRadius` at its level, in tiles. */
  readonly radius: number;
  /** Every tile of the home base it's built on (the Heart Seed and its ring). */
  readonly homeTiles: readonly Hex[];
}

/**
 * Every tile a set of **lit** fires protects: each fire's home base plus all
 * tiles within its radius. Pass only fires that are lit for the night being
 * asked about (`protectsNight` / `hearthfireState().lit`).
 */
export function safeTiles(fires: readonly SafeFire[]): Set<HexKey> {
  const safe = new Set<HexKey>();
  for (const fire of fires) {
    for (const h of fire.homeTiles) safe.add(hexKey(h));
    for (const h of hexSpiral(fire.at, fire.radius)) safe.add(hexKey(h));
  }
  return safe;
}
