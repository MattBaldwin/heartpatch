import type { PublicTile } from '@heartpatch/shared';
import { buildingIcon, buildingName } from './home-view.js';

// What the map's tile panel says about the buildings on a home tile (#18).
// Fires and habitats are public (everyone sees them); copy follows
// docs/STYLE_GUIDE.md. Pure, so it's unit-tested.

/** One line per building on the tile, in spot order. */
export function homeTileLines(tile: PublicTile, me: string | null): string[] {
  const mine = me !== null && tile.ownerUserId === me;
  return tile.buildings.map((b) => {
    const name = `${buildingIcon(b.buildingId)} ${buildingName(b.buildingId)}`;
    if (b.lit === null) return name;
    if (b.lit) return `${name}: lit and keeping everyone cozy.`;
    return mine ? `${name}: out! Add Emberwood at home.` : `${name}: out.`;
  });
}
