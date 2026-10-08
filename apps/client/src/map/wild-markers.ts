import { hexKey, type Hex, type HexKey, type PublicTile } from '@heartpatch/shared';
import { hash01 } from './map-layout.js';

// The map's wild-squishy markers (#209): a rustling tuft on each tile in
// reach that has a wild squishy this spawn window. The server's hints are
// tiles only, never a species (CLAUDE.md rule 6), so every tuft is the same.
// Pure, so the list is unit-tested; map-scene.ts draws it as one instanced mesh.

export interface WildMarker {
  readonly key: HexKey;
  readonly q: number;
  readonly r: number;
  /** Where in the breeze this tuft is (radians), so neighbours don't sway in step. */
  readonly phase: number;
}

/**
 * The tufts to draw for the server's hints: one per hinted tile that's on the
 * map on screen, in the server's order (nearest first), each tile once. A
 * hint for a tile this map doesn't have (a stale reply) draws nothing.
 */
export function wildMarkers(
  hints: readonly Hex[],
  tileAt: (key: HexKey) => PublicTile | undefined,
): WildMarker[] {
  const seen = new Set<HexKey>();
  const out: WildMarker[] = [];
  for (const { q, r } of hints) {
    const key = hexKey({ q, r });
    if (seen.has(key) || !tileAt(key)) continue;
    seen.add(key);
    out.push({ key, q, r, phase: hash01(q, r, 209) * Math.PI * 2 });
  }
  return out;
}
