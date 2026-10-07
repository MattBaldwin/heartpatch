import {
  attackTargetProblem,
  exposedSegments,
  hexKey,
  isTileFenced,
  weakestSegment,
  type PublicFence,
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
  | { readonly kind: 'claim'; readonly attemptsLeft: number; readonly triesResetAt: string }
  /**
   * Someone's land next to yours: "Challenge". On a fenced tile (#203),
   * `fence` is the segment my first squishy has to break first.
   */
  | {
      readonly kind: 'challenge';
      readonly attemptsLeft: number;
      readonly triesResetAt: string;
      readonly fence: PublicFence | null;
    }
  /** I just broke this tile's fence (#203): "Keep going!" beats the guard, no new try. */
  | { readonly kind: 'keep-going'; readonly until: string }
  /** Battled for recently: it rests until then. */
  | { readonly kind: 'resting'; readonly until: string }
  /** No tries left today. */
  | { readonly kind: 'no-tries'; readonly triesResetAt: string }
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
  // The guard battle after I broke the fence finishes that challenge: the
  // tile's rest and my tries don't stop it (the server's `brokenFenceFor`).
  // Not once the owner has fenced it up again.
  const broke = status.fenceBroken?.find((b) => b.q === tile.q && b.r === tile.r);
  const fence = fenceToBreak(tile, view, me);
  if (broke && Date.parse(broke.until) > now && !fence) {
    return { kind: 'keep-going', until: broke.until };
  }
  if (tile.cooldownUntil !== null && Date.parse(tile.cooldownUntil) > now) {
    return { kind: 'resting', until: tile.cooldownUntil };
  }
  // When tries refill (#201), for the sheet's countdown.
  const { attemptsLeft, triesResetAt } = status;
  if (attemptsLeft === 0) return { kind: 'no-tries', triesResetAt };
  return tile.ownerUserId === null
    ? { kind: 'claim', attemptsLeft, triesResetAt }
    : { kind: 'challenge', attemptsLeft, triesResetAt, fence };
}

/**
 * The fence segment a challenge on `tile` breaks first (#203), as the server
 * picks it: when the owner has fenced the tile all round, the weakest segment
 * between it and my land. Null when it isn't fenced.
 */
export function fenceToBreak(
  tile: PublicTile,
  view: Pick<MapView, 'tiles'>,
  me: string,
): PublicFence | null {
  const owner = tile.ownerUserId;
  const segments = (tile.fences ?? []).map((f) => ({ ...f, q: tile.q, r: tile.r }));
  if (owner === null || owner === me || segments.length === 0) return null;
  const theirs = view.tiles.filter((t) => t.ownerUserId === owner);
  if (!isTileFenced(tile, theirs, segments)) return null;
  const mine = view.tiles.filter((t) => t.ownerUserId === me);
  const weakest = weakestSegment(exposedSegments(tile, segments, mine));
  return weakest ? ((tile.fences ?? []).find((f) => f.id === weakest.id) ?? null) : null;
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
