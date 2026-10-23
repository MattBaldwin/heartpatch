import {
  GAME_DATA,
  RESOURCE_BUILDING_RULES,
  buildCost,
  type HomeResponse,
  type MyBuilding,
  type WarehouseBuilding,
} from '@heartpatch/shared';
import { buildingIcon, homesteadSpot } from '../home/home-view.js';
import { RESOURCE_TEXT, type ResourceBuildCard, type ResourceTile } from './resource-model.js';

// The Warehouse on the client (#601 PR 9): its Build card, its tile card in
// its three states (delivering, needs 💛, napping), and the 📦 mark it puts
// on level 3+ resource cards. Pure, so every case is unit-tested; the server
// decides whether it delivers (`MyBuilding.warehouse`,
// `BuildingProduction.delivering`) and this only reads its replies.

/** The one Warehouse in the data. */
export const WAREHOUSE: WarehouseBuilding | undefined = GAME_DATA.buildings.find(
  (b): b is WarehouseBuilding => b.kind === 'warehouse',
);

// Player-facing text (style guide: cozy, short, kid-readable). Each sleep
// has its own words (#620 approval): "needs 💛" short of coins, "napping"
// cut off from home.
export const WAREHOUSE_TEXT = {
  /** The Build card's line. */
  effect: (fromLevel: number) =>
    `📦 Level ${String(fromLevel)}+ buildings send everything straight to your bag`,
  built: 'Built! Your Warehouse is open for deliveries 📦',
  delivering: (fromLevel: number) =>
    `📦 Delivering! Your level ${String(fromLevel)}+ buildings send everything straight to your bag.`,
  waiting: (fromLevel: number) =>
    `📦 Open! Get a building to level ${String(fromLevel)} and it sends everything straight to your bag.`,
  deliveringFor: (n: number) => `Delivering for ${String(n)} ${n === 1 ? 'building' : 'buildings'}`,
  paused: (coins: number) =>
    `⏸️ Warehouse needs 💛: huts back to their own storage. It opens again as soon as you have 💛 ${String(coins)}!`,
  napping:
    'zZ Warehouse napping: huts back to their own storage. It wakes up when this homestead joins home again.',
  // The 📦 mark on a level 3+ resource building's card.
  markDelivering: '📦 Delivering to your bag',
  markPaused: '📦 Warehouse needs 💛: back to its own storage',
  markNapping: '📦 Warehouse napping: back to its own storage',
} as const;

/** My Warehouse, wherever it stands. */
export function myWarehouse(home: Pick<HomeResponse, 'buildings'>): MyBuilding | undefined {
  return home.buildings.find((b) => b.kind === 'warehouse');
}

/** My Warehouse on this tile, if it stands there. */
export function warehouseHere(
  home: Pick<HomeResponse, 'buildings'>,
  tile: { q: number; r: number },
): MyBuilding | undefined {
  const w = myWarehouse(home);
  return w && w.q === tile.q && w.r === tile.r ? w : undefined;
}

/**
 * The Build sheet's Warehouse card on one of my homestead tiles out on the
 * land: an empty, joined homestead with no spot to clear, while I have no
 * Warehouse yet (one a patch). Null otherwise. Short of Timber, Stone or
 * Glimmer is the Build sheet's own "needs" row, as for every card.
 */
export function warehouseBuildCard(
  tile: ResourceTile,
  home: Pick<HomeResponse, 'buildings'>,
  me: string | null,
): ResourceBuildCard | null {
  if (!WAREHOUSE || me === null || tile.ownerUserId !== me || tile.homeSlot !== null) return null;
  if (tile.homestead !== 'joined' || tile.clearing) return null;
  if (tile.buildings.length > 0 || tile.nodeResource !== null) return null;
  if (myWarehouse(home)) return null;
  const spot = homesteadSpot(tile, WAREHOUSE);
  if (spot === undefined) return null;
  return {
    id: WAREHOUSE.id,
    icon: buildingIcon(WAREHOUSE.id),
    name: WAREHOUSE.name,
    effect: WAREHOUSE_TEXT.effect(RESOURCE_BUILDING_RULES.warehouseDeliversFromLevel),
    cost: buildCost(WAREHOUSE),
    area: 'spot',
    blocked: null,
    craft: null,
    spot,
  };
}

/** The Warehouse's three states: delivering, paused for upkeep, napping. */
export type WarehouseState = 'delivering' | 'paused' | 'napping';

export interface WarehouseCard {
  readonly state: WarehouseState;
  /** What it's doing, in a line. */
  readonly line: string;
  /** "Delivering for 2 buildings", while it delivers for any. */
  readonly count: string | null;
  /** Its morning upkeep line, or "Free while it sleeps". */
  readonly upkeep: string;
}

/**
 * My Warehouse's tile card: napping (its homestead is cut off) wins, then
 * paused for upkeep, else delivering. Null for a building that isn't the
 * Warehouse, or an older server's reply without its `warehouse`.
 */
export function warehouseCard(
  b: Pick<MyBuilding, 'kind' | 'warehouse'>,
  tile: { homestead?: 'joined' | 'paused' | null },
  home: Pick<HomeResponse, 'buildings'>,
): WarehouseCard | null {
  const w = b.warehouse;
  if (b.kind !== 'warehouse' || !w) return null;
  const state: WarehouseState =
    w.napping || tile.homestead === 'paused'
      ? 'napping'
      : w.pausedAt !== null
        ? 'paused'
        : 'delivering';
  const n = home.buildings.filter((m) => m.production?.delivering === true).length;
  return {
    state,
    line:
      state === 'napping'
        ? WAREHOUSE_TEXT.napping
        : state === 'paused'
          ? WAREHOUSE_TEXT.paused(w.upkeep)
          : n > 0
            ? WAREHOUSE_TEXT.delivering(w.fromLevel)
            : WAREHOUSE_TEXT.waiting(w.fromLevel),
    count: state === 'delivering' && n > 0 ? WAREHOUSE_TEXT.deliveringFor(n) : null,
    // A napping Warehouse owes nothing (owner decision Q4).
    upkeep: state === 'napping' ? RESOURCE_TEXT.upkeepFree : RESOURCE_TEXT.upkeep(w.upkeep),
  };
}

/**
 * The 📦 mark on a resource building's card: "Delivering to your bag" while
 * the server says so (`production.delivering`, never `maxCycles === null`,
 * which stays null while the building itself sleeps). A level 3+ building
 * whose Warehouse is asleep says why it's back to its own storage. Null for
 * a lower level, no Warehouse, or a building that's asleep itself (its own
 * line says so).
 */
export function deliveryMark(
  b: Pick<MyBuilding, 'level' | 'production'>,
  warehouse: MyBuilding['warehouse'] | undefined,
  asleep: boolean,
): string | null {
  if (b.production?.delivering) return WAREHOUSE_TEXT.markDelivering;
  if (asleep || !warehouse || warehouse.delivering || b.level < warehouse.fromLevel) return null;
  if (warehouse.napping) return WAREHOUSE_TEXT.markNapping;
  return warehouse.pausedAt !== null ? WAREHOUSE_TEXT.markPaused : null;
}
