import { hexKey, type Hex, type HexKey } from '@heartpatch/shared';

// Picking which wild squishy to meet (#209): the words, and which tiles the
// tile panel offers "Meet it" on. Pure, so every case is unit-tested; the DOM
// is wild-picker.ts. Copy follows docs/STYLE_GUIDE.md.

export const WILD_TEXT = {
  /** The tile panel's line on a tile with a tuft. */
  rustling: "Something's rustling here!",
  meet: 'Meet it',
  none: 'No wild squishies nearby right now.',
  /** Under "Find a squishy" (owner decision 2026-10-07). */
  nearby: (count: number) => `${String(count)} nearby! Or tap a rustle to pick.`,
} as const;

/** The note under "Find a squishy": how many tufts are on the map. */
export function nearbyNote(count: number): string {
  return count > 0 ? WILD_TEXT.nearby(count) : WILD_TEXT.none;
}

/**
 * The hints the map on screen shows (tiles only, no species), so the tile
 * panel can offer "Meet it" on exactly the tiles with a tuft.
 */
export class WildHints {
  private mapId: string | null = null;
  private keys = new Set<HexKey>();

  /** New hints for `mapId` (null: no map on screen). */
  set(mapId: string | null, tiles: readonly Hex[]): void {
    this.mapId = mapId;
    this.keys = new Set(mapId === null ? [] : tiles.map((t) => hexKey({ q: t.q, r: t.r })));
  }

  /** True when `tile` on map `mapId` has a tuft right now. */
  has(mapId: string, tile: Hex): boolean {
    return mapId === this.mapId && this.keys.has(hexKey({ q: tile.q, r: tile.r }));
  }

  get count(): number {
    return this.keys.size;
  }
}
