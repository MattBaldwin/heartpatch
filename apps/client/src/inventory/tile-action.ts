import {
  canGather,
  GAME_DATA,
  gatherYield,
  type Gather,
  type ItemCounts,
  type PublicTile,
} from '@heartpatch/shared';

// What the tile panel offers on a tile (design doc §12): gather on your own
// node, wait, or collect. Pure, so every case is unit-tested; the server
// still decides (CLAUDE.md rule 1), this only says what to show.

export type TileAction =
  /** Nothing to do here (no node, or not yours and nobody's gathering). */
  | { readonly kind: 'none' }
  /** Your node, free: "Gather" for `yields`. */
  | { readonly kind: 'gather'; readonly yields: ItemCounts }
  /** Your gather is still going. */
  | { readonly kind: 'waiting'; readonly gather: Gather }
  /** Your gather is done. */
  | { readonly kind: 'collect'; readonly gather: Gather }
  /** Your seasonal node, sleeping until its season. */
  | { readonly kind: 'sleeping'; readonly note: string }
  /** Someone else's node, being gathered. */
  | { readonly kind: 'busy'; readonly readyAt: string };

const RESOURCES = new Map(GAME_DATA.resources.map((r) => [r.id, r]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));

export function tileAction(
  tile: PublicTile,
  me: string | null,
  state: { gathers: readonly Gather[]; seasons: readonly string[] },
  now: number,
): TileAction {
  const resource = tile.nodeResource ? RESOURCES.get(tile.nodeResource) : undefined;
  if (!resource?.gather) return { kind: 'none' };
  if (me === null || tile.ownerUserId !== me) {
    return tile.gathering ? { kind: 'busy', readyAt: tile.gathering.readyAt } : { kind: 'none' };
  }
  const mine = state.gathers.find((g) => g.q === tile.q && g.r === tile.r);
  if (mine) {
    return Date.parse(mine.readyAt) <= now
      ? { kind: 'collect', gather: mine }
      : { kind: 'waiting', gather: mine };
  }
  const seasons = new Set(state.seasons);
  if (!canGather(resource, seasons)) {
    const season = SEASON_NAMES.get(resource.season ?? '') ?? 'their season';
    return { kind: 'sleeping', note: `${resource.name} only turn up around ${season}!` };
  }
  return { kind: 'gather', yields: gatherYield(resource, GAME_DATA.resources, seasons) };
}
