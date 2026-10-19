import { hexKey, hexNeighbors, type Hex } from '../hex/index.js';
import { isTradingPost } from '../territory/reach.js';
import type { CommunityPlacementRules, CommunityRules } from '../schemas/data/communities.js';

// Restoring a grey village (#306 PR 3). Pure: the server charges and claims
// with these, and the restore sheet shows the same numbers and reasons, so
// the two never disagree.

/**
 * What one piece costs on a tile of `terrain` (owner decision 1): its
 * terrain's building resources (`default` for the rest) plus the joy,
 * `heartdustPerPiece` Heartdust. Item id → how many.
 */
export function pieceCost(terrain: string, rules: CommunityRules): Record<string, number> {
  const each = rules.pieceCost[terrain] ?? rules.pieceCost['default'];
  if (!each) throw new Error(`no pieceCost for "${terrain}" and no default`);
  const cost: Record<string, number> = { ...each };
  cost[rules.joyResource] = (cost[rules.joyResource] ?? 0) + rules.heartdustPerPiece;
  return cost;
}

/** The village's ring (plan v3): the square and its six neighbours, square first. */
export function villageRing(square: Hex): Hex[] {
  return [{ q: square.q, r: square.r }, ...hexNeighbors(square)];
}

/** A village tile as the win rule sees it. */
export interface WinTile {
  readonly restored: boolean;
  readonly ownerUserId: string | null;
}

/**
 * Who has won the village: the one player who owns every village tile, all
 * of them restored (plan Q2's "every tile restored by one owner"). Null
 * while a tile is still grey, or two kids hold its tiles.
 */
export function villageWinner(tiles: readonly WinTile[]): string | null {
  const owner = tiles[0]?.ownerUserId ?? null;
  if (owner === null) return null;
  return tiles.every((t) => t.restored && t.ownerUserId === owner) ? owner : null;
}

/** A ring tile as the planting rule sees it. */
export interface RingTile extends Hex {
  readonly ownerUserId: string | null;
  readonly homeSlot: number | null;
  readonly terrain: string;
  readonly communityId: string | null;
}

/**
 * The ring tiles that become the winner's home tiles at the claim moment
 * (plan v3 Q3): wild or already the winner's, and never another home's
 * tile, a trading post or another village's tile. A tile someone else holds
 * stays theirs (a gap in the ring). Only tiles found on the map count.
 */
export function ringToPlant<T extends RingTile>(
  square: Hex,
  tiles: readonly T[],
  winnerUserId: string,
  communityId: string,
): T[] {
  const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
  return villageRing(square).flatMap((h) => {
    const t = byKey.get(hexKey(h));
    if (!t || t.homeSlot !== null || isTradingPost(t)) return [];
    if (t.communityId !== null && t.communityId !== communityId) return [];
    if (t.ownerUserId !== null && t.ownerUserId !== winnerUserId) return [];
    return [t];
  });
}

/**
 * Three restored-name ideas for a village, the tap-to-fill chips on the
 * naming card: its generated name's stem with the restored endings
 * ("Bramble Hollow" → "Bramble Glen", "Bramble Meadow", "Bramble Hearth").
 * The first is the name a won village wears until its winner types one.
 */
export function restoredNameIdeas(
  name: string,
  rules: Pick<CommunityRules, 'restoredSuffixes'>,
  placement: Pick<CommunityPlacementRules, 'nameSuffix'>,
): string[] {
  // A won village wears a restored name already ("Bramble Glen"): its stem too.
  const ending = [placement.nameSuffix, ...rules.restoredSuffixes]
    .map((s) => ` ${s}`)
    .find((s) => name.endsWith(s) && name.length > s.length);
  const stem = ending ? name.slice(0, -ending.length) : name;
  return rules.restoredSuffixes.slice(0, 3).map((suffix) => `${stem} ${suffix}`);
}

/**
 * Why a player can't put a piece on a village tile now, or null if they can
 * (what they can afford is checked against the bag separately):
 * - `won`: the village has its winner already;
 * - `restored`: this tile has all its pieces;
 * - `night`: villages are open by day only;
 * - `away`: the player's land joined to home doesn't touch the village.
 */
export type RestoreProblem = 'won' | 'restored' | 'night' | 'away';

export function restoreProblem(input: {
  readonly won: boolean;
  readonly piecesDone: number;
  readonly piecesNeeded: number;
  readonly open: boolean;
  readonly reach: 'touching' | 'away' | null;
}): RestoreProblem | null {
  if (input.won) return 'won';
  if (input.piecesDone >= input.piecesNeeded) return 'restored';
  if (!input.open) return 'night';
  if (input.reach !== 'touching') return 'away';
  return null;
}
