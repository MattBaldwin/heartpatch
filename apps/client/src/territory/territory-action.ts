import {
  attackTargetProblem,
  type MapView,
  type PublicTile,
  type TerritoryStatus,
} from '@heartpatch/shared';

// What the tile panel offers for land (design doc §11): claim wild land next
// to yours, challenge a neighbour's, or pick who stands watch on your own.
// Pure, so every case is unit-tested; the server still decides every rule
// (CLAUDE.md rule 1), this only says what to show.

export type TerritoryAction =
  /** Nothing to offer (too far, a home base, nothing known yet). */
  | { readonly kind: 'none' }
  /** Wild land next to yours: "Claim". */
  | { readonly kind: 'claim'; readonly attemptsLeft: number }
  /** Someone's land next to yours: "Challenge". */
  | { readonly kind: 'challenge'; readonly attemptsLeft: number }
  /** Battled for recently: it rests until then. */
  | { readonly kind: 'resting'; readonly until: string }
  /** No tries left today. */
  | { readonly kind: 'no-tries' }
  /** Someone's land, but challenges are off on this map. */
  | { readonly kind: 'pvp-off' }
  /** Your land outside your home base: pick who stands watch. */
  | { readonly kind: 'watch'; readonly squishyIds: readonly string[] };

export function territoryAction(
  tile: PublicTile,
  view: Pick<MapView, 'tiles' | 'map'>,
  me: string | null,
  status: TerritoryStatus | null,
  now: number,
): TerritoryAction {
  if (me === null || !status) return { kind: 'none' };
  const problem = attackTargetProblem(tile, view.tiles, me, view.map.pvpMode);
  if (problem === 'mine') {
    if (tile.homeSlot !== null) return { kind: 'none' };
    const post = status.defenders.find((d) => d.q === tile.q && d.r === tile.r);
    return { kind: 'watch', squishyIds: post?.squishyIds ?? [] };
  }
  if (problem === 'pvp-off') return { kind: 'pvp-off' };
  if (problem !== null) return { kind: 'none' };
  if (tile.cooldownUntil !== null && Date.parse(tile.cooldownUntil) > now) {
    return { kind: 'resting', until: tile.cooldownUntil };
  }
  if (status.attemptsLeft === 0) return { kind: 'no-tries' };
  return tile.ownerUserId === null
    ? { kind: 'claim', attemptsLeft: status.attemptsLeft }
    : { kind: 'challenge', attemptsLeft: status.attemptsLeft };
}
