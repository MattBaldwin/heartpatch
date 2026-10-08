import { hexKey, hexNeighbors, type Hex } from '../hex/index.js';
import type { TerritoryRules } from '../schemas/data/territory.js';
import type { PvpMode } from '../schemas/maps.js';
import type { SquishyState } from '../schemas/squishies.js';

// Territory rules (design doc §11, decisions B and C), shared so the server
// decides and the client explains with the same logic. Pure: the server
// passes in the tiles and the clock-based counts (cooldowns, daily caps).

/** What a tile needs to know about itself for these rules (`PublicTile` fits). */
export interface TerritoryTile extends Hex {
  readonly ownerUserId: string | null;
  /** Set on a home base's tiles; those can never be battled for. */
  readonly homeSlot: number | null;
}

/**
 * Why a player can't battle for a tile, or null if they can (time-based
 * limits, like cooldowns and daily caps, are checked separately):
 * - `home`: a Heart Seed or its ring, never taken (design doc §11).
 * - `mine`: it's already theirs.
 * - `too-far`: not next to their land (outposts come in Phase 2).
 * - `pvp-off`: another player's land, and the map's PvP mode is Off.
 */
export type AttackTargetProblem = 'home' | 'mine' | 'too-far' | 'pvp-off';

export function attackTargetProblem(
  target: TerritoryTile,
  tiles: readonly TerritoryTile[],
  userId: string,
  pvpMode: PvpMode,
): AttackTargetProblem | null {
  if (target.homeSlot !== null) return 'home';
  if (target.ownerUserId === userId) return 'mine';
  const mine = new Set(tiles.filter((t) => t.ownerUserId === userId).map(hexKey));
  if (!hexNeighbors(target).some((n) => mine.has(hexKey(n)))) return 'too-far';
  if (target.ownerUserId !== null && pvpMode === 'off') return 'pvp-off';
  return null;
}

/** Neutral land is claimed from its guardians; a rival's is challenged. */
export function tileBattleKindFor(target: TerritoryTile): 'tile' | 'rival-tile' {
  return target.ownerUserId === null ? 'tile' : 'rival-tile';
}

/** How many tiles a player can lose to challenges per map-local day (0: challenges are off). */
export function dailyLossCap(rules: TerritoryRules, pvpMode: PvpMode): number {
  return pvpMode === 'off' ? 0 : rules.dailyLossCap[pvpMode];
}

/** A player's land for the Gentle rewards rule: the tiles they own, home rings not counted. */
export function landCount(tiles: readonly TerritoryTile[], userId: string): number {
  return tiles.filter((t) => t.ownerUserId === userId && t.homeSlot === null).length;
}

/**
 * The share (%) of capture rewards a challenge earns (decision B): under
 * Gentle, challenging a player with far less land than you earns less.
 */
export function challengeRewardPercent(
  rules: TerritoryRules,
  pvpMode: PvpMode,
  attackerLand: number,
  defenderLand: number,
): number {
  if (pvpMode !== 'gentle') return 100;
  // Integer maths: defender < attacker × share%.
  const smaller = defenderLand * 100 < attackerLand * rules.gentle.smallerBelowPercent;
  return smaller ? rules.gentle.rewardPercent : 100;
}

/** Where a squishy is stationed: the tile it defends, and who owns that tile now. */
export interface WatchPost {
  readonly tileOwnerUserId: string | null;
}

/**
 * Decision C: a squishy stationed to defend its owner's tile is on watch, so
 * the Hollow Man doesn't count it as exposed (#21 uses this). A post on land
 * that changed hands doesn't count (the squishy went home). The server's SQL
 * twin is territory's `squishyOnWatch` (without the `state` check).
 */
export function isOnWatch(
  squishy: { readonly ownerUserId: string; readonly state: SquishyState },
  post: WatchPost | null,
): boolean {
  return (
    post !== null && squishy.state === 'active' && post.tileOwnerUserId === squishy.ownerUserId
  );
}
export * from './tending.js';
export * from './fences.js';
