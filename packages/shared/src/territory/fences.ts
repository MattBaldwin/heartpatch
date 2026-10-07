import { HEX_DIRECTIONS, hex, hexAdd, hexKey, type Hex } from '../hex/index.js';
import type { BattleFenceSetup, BattleStats } from '../schemas/battle.js';
import type { FenceBuilding } from '../schemas/data/buildings.js';
import type { FenceRules } from '../schemas/data/fences.js';
import type { ItemCounts } from '../gathering/index.js';
import { spentOn } from '../home/costs.js';

// Fences (#203, #204): segments on a tile's hex edges. Edge `e` of a tile is
// the side it shares with its neighbour in `HEX_DIRECTIONS[e]`. A segment
// belongs to the tile's owner, on their side of the edge, so two neighbours
// can each fence a shared edge. Pure: the server decides with these and the
// client explains with the same code.

/** Hex edges per tile, in `HEX_DIRECTIONS` order. */
export const HEX_EDGES = [0, 1, 2, 3, 4, 5] as const;
export type HexEdge = (typeof HEX_EDGES)[number];

export function isHexEdge(edge: number): edge is HexEdge {
  return Number.isSafeInteger(edge) && edge >= 0 && edge < HEX_DIRECTIONS.length;
}

/** The tile on the other side of `edge`. */
export function edgeNeighbor(tile: Hex, edge: HexEdge): Hex {
  const direction = HEX_DIRECTIONS[edge];
  if (!direction) throw new RangeError(`edgeNeighbor(): no edge ${String(edge)}`);
  return hexAdd(tile, direction);
}

/** The same edge seen from the neighbour's side. */
export function oppositeEdge(edge: HexEdge): HexEdge {
  return ((edge + 3) % 6) as HexEdge;
}

/** A fence segment's place: its tile and edge. */
export interface FenceSpot extends Hex {
  readonly edge: number;
}

/** A segment as the battle and the cards need it. */
export interface FenceSegmentStats extends FenceSpot {
  /** Energy left (its bar). */
  readonly hp: number;
}

/**
 * Edges of `tile` that touch land its owner doesn't hold (neutral, wild or a
 * rival's): the ones a fence has to cover. `ownedTiles` are the owner's.
 */
export function borderEdges(tile: Hex, ownedTiles: readonly Hex[]): HexEdge[] {
  const owned = new Set(ownedTiles.map(hexKey));
  return HEX_EDGES.filter((edge) => !owned.has(hexKey(edgeNeighbor(tile, edge))));
}

/**
 * Is `tile` fenced (#204)? Yes when every edge touching land its owner
 * doesn't hold has a segment. Edges between two of the owner's tiles need
 * none, so an interior tile is fenced already (nobody can reach it anyway).
 * `ownedTiles` and `segments` are the owner's. A tile they don't own isn't.
 */
export function isTileFenced(
  tile: Hex,
  ownedTiles: readonly Hex[],
  segments: readonly FenceSpot[],
): boolean {
  if (!ownedTiles.some((t) => t.q === tile.q && t.r === tile.r)) return false;
  const fenced = new Set(
    segments.filter((s) => s.q === tile.q && s.r === tile.r).map((s) => s.edge),
  );
  return borderEdges(tile, ownedTiles).every((edge) => fenced.has(edge));
}

/**
 * The segments of `tile` between it and the challenger's land: the ones a
 * challenger has to break through (owner decision 2026-10-06).
 */
export function exposedSegments<S extends FenceSpot>(
  tile: Hex,
  segments: readonly S[],
  challengerTiles: readonly Hex[],
): S[] {
  const theirs = new Set(challengerTiles.map(hexKey));
  return segments.filter(
    (s) =>
      s.q === tile.q &&
      s.r === tile.r &&
      isHexEdge(s.edge) &&
      theirs.has(hexKey(edgeNeighbor(hex(s.q, s.r), s.edge))),
  );
}

/**
 * The segment a challenger fights: the weakest exposed one (least energy
 * left; a tie goes to the lowest edge, so it's always the same one).
 */
export function weakestSegment<S extends FenceSegmentStats>(segments: readonly S[]): S | null {
  let weakest: S | null = null;
  for (const s of segments) {
    if (!weakest || s.hp < weakest.hp || (s.hp === weakest.hp && s.edge < weakest.edge)) {
      weakest = s;
    }
  }
  return weakest;
}

/** A fence level's stat block; level is clamped to the fence's levels. */
export function fenceLevel(fence: FenceBuilding, level: number): FenceBuilding['levels'][number] {
  const step = fence.levels[Math.max(1, Math.min(level, fence.levels.length)) - 1];
  if (!step) throw new RangeError(`fenceLevel(): "${fence.id}" has no levels`);
  return step;
}

/** A fence's full energy at `level`. */
export function fenceMaxHp(fence: FenceBuilding, level: number): number {
  return fenceLevel(fence, level).hp;
}

/** The battle stats of a fence at `level`: its energy and toughness, and the stats it never uses. */
export function fenceStats(fence: FenceBuilding, level: number, rules: FenceRules): BattleStats {
  const step = fenceLevel(fence, level);
  return {
    hp: step.hp,
    attack: rules.battle.attack,
    defense: step.defense,
    speed: rules.battle.speed,
  };
}

/**
 * A segment as the other side of a fence battle (#203): the battle engine's
 * fence participant, starting with the energy it has left (damage stays,
 * owner decision 2026-10-07).
 */
export function fenceBattleSetup(
  id: string,
  fence: FenceBuilding,
  level: number,
  hp: number,
  rules: FenceRules,
): BattleFenceSetup {
  const stats = fenceStats(fence, level, rules);
  return {
    id,
    fence: fence.id,
    level,
    element: fence.element,
    stats,
    energy: Math.max(1, Math.min(hp, stats.hp)),
  };
}

/**
 * What repairing a segment back to full costs: `repairPercent` of everything
 * spent on it, scaled by the share of energy it lost, rounded up per item
 * (so any repair costs something). Nothing when it's full.
 */
export function fenceRepairCost(
  fence: FenceBuilding,
  level: number,
  hp: number,
  rules: Pick<FenceRules, 'repairPercent'>,
): ItemCounts {
  const max = fenceMaxHp(fence, level);
  const missing = Math.max(0, max - hp);
  if (missing === 0) return {};
  const cost: ItemCounts = {};
  for (const [id, n] of Object.entries(spentOn(fence, level))) {
    const share = Math.ceil((n * rules.repairPercent * missing) / (100 * max));
    if (share > 0) cost[id] = share;
  }
  return cost;
}

/**
 * A segment's energy after an upgrade: the new level's full energy, less
 * what it had lost (an upgrade isn't a free repair). At least 1.
 */
export function fenceHpAfterUpgrade(fence: FenceBuilding, fromLevel: number, hp: number): number {
  const lost = Math.max(0, fenceMaxHp(fence, fromLevel) - hp);
  return Math.max(1, fenceMaxHp(fence, fromLevel + 1) - lost);
}

/** Whole percent of energy left, rounded down but never 0 for a standing fence. */
export function fencePercent(hp: number, maxHp: number): number {
  if (hp <= 0 || maxHp <= 0) return 0;
  return Math.max(1, Math.min(100, Math.floor((hp * 100) / maxHp)));
}
