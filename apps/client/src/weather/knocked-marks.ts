import type { MapView, PublicTile } from '@heartpatch/shared';
import type { MapLayer } from '../map/map-screen.js';
import type { TileMarks } from '../map/tile-marks.js';

/** The tiles where one of my buildings waits to be fixed. */
export function knockedTiles(view: MapView, me: string | null): PublicTile[] {
  if (me === null) return [];
  return view.tiles.filter(
    (t) => t.ownerUserId === me && t.buildings.some((b) => b.knocked === true),
  );
}

/**
 * The 🩹 on my knocked buildings (#621 W1-9). Mine only, the quiet-map rule
 * (#602): neighbours' maps stay calm. It follows the live `building.knocked`
 * and `building.repaired` events through `update`.
 */
export function createKnockedMarks(marks: TileMarks, me: () => string | null): MapLayer {
  const show = (view: MapView): void => {
    marks.set(
      'weather',
      knockedTiles(view, me()).map((tile) => ({ tile, kind: 'knocked' as const })),
    );
  };
  return {
    attach: (_scene, view) => {
      show(view);
    },
    update: show,
  };
}
