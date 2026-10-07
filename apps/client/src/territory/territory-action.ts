import {
  attackTargetProblem,
  hexKey,
  TERRITORY_RULES,
  type MapView,
  type PublicTile,
  type TerritoryStatus,
} from '@heartpatch/shared';
import { mapSafeTiles } from '../home/home-layout.js';

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
  /** A new Keeper's land: nobody can challenge it until then (design doc §11). */
  | { readonly kind: 'shielded'; readonly until: string }
  /** Land that isn't next to yours (wild or someone's): nothing to do from here. */
  | { readonly kind: 'too-far' }
  /** Your land outside your home base: pick who stands watch. */
  | { readonly kind: 'watch'; readonly squishyIds: readonly string[] };

export function territoryAction(
  tile: PublicTile,
  view: Pick<MapView, 'tiles' | 'map' | 'members'>,
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
  // A home base can never be taken: the tile's info says so already.
  if (problem === 'home') return { kind: 'none' };
  // A new Keeper's shield is the rule the server checks (territory service),
  // from the same public facts: when they joined, and the shield's length.
  const shield = shieldUntil(tile, view, now);
  if (shield !== null) return { kind: 'shielded', until: shield };
  if (problem === 'too-far') return { kind: 'too-far' };
  if (tile.cooldownUntil !== null && Date.parse(tile.cooldownUntil) > now) {
    return { kind: 'resting', until: tile.cooldownUntil };
  }
  if (status.attemptsLeft === 0) return { kind: 'no-tries' };
  return tile.ownerUserId === null
    ? { kind: 'claim', attemptsLeft: status.attemptsLeft }
    : { kind: 'challenge', attemptsLeft: status.attemptsLeft };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * When the new-player shield on this tile's owner ends (ISO), while it's on;
 * null for wild land, an unknown owner, or a shield that's over. Mirrors the
 * server's check (`joinedAt + newPlayerShieldHours`), never a rule of its own.
 */
export function shieldUntil(
  tile: Pick<PublicTile, 'ownerUserId'>,
  view: Pick<MapView, 'members'>,
  now: number,
): string | null {
  if (tile.ownerUserId === null) return null;
  const owner = view.members.find((m) => m.user.id === tile.ownerUserId);
  if (!owner) return null;
  const until = Date.parse(owner.joinedAt) + TERRITORY_RULES.newPlayerShieldHours * HOUR_MS;
  return until > now ? new Date(until).toISOString() : null;
}

/**
 * A guard on this tile would spend the night in the dark: no lit Hearthfire
 * reaches it, so the Hollow Man may take one (owner decision 2026-10-07).
 * Home tiles are always safe. What the map shows; nightfall decides.
 */
export function watchInTheDark(tile: Pick<PublicTile, 'q' | 'r'>, view: MapView): boolean {
  return !mapSafeTiles(view).has(hexKey(tile));
}
