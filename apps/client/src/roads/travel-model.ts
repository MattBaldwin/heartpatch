import {
  buildCost,
  GAME_DATA,
  hexDistance,
  hexFromKey,
  hexKey,
  hexNeighbors,
  travelBuildCheck,
  supplyMap,
  TRAVEL_RULES,
  ferryShore,
  type BuildableProblem,
  type BridgeSpot,
  type DockSpot,
  type Hex,
  type HexKey,
  type MapView,
  type PublicRoad,
  type PublicTile,
  type Supply,
  type TravelBuilding,
} from '@heartpatch/shared';
import type { BuildCard } from '../building/build-model.js';

// Bridges, ferry docks and the supply line on a Wild Isle (#621 W1-6). The
// Build sheet greys a spot out and says why with the shared `travelBuildCheck`;
// the server stays the judge. Pure, so every case is unit-tested.

export const BRIDGE_ID = 'bridge';
export const DOCK_ID = 'ferry-dock';

/** Bridges and docks go on ring spot 1 (spot 0 is the Heart Seed's; one per tile). */
export const TRAVEL_SPOT = 1;

export const TRAVEL_TEXT = {
  bridgeIcon: '🪵',
  dockIcon: '🛶',
  bridgeEffect: 'Everyone on the patch can hop across!',
  dockEffect: 'Ferry to the far shore of the lake!',
  bridgeBuilt: 'Ta-da! A bridge! Everyone can hop across now. 🪵',
  dockBuilt: 'Ta-da! Your ferry dock is ready. 🛶',
  ferryAcross: 'Ferry across',
  ferryHide: 'Hide ferry',
  /** On a far-shore tile of the ferry map. */
  ferryReach: 'Your ferry can take you here 🛶',
  /** On the dock's own tile. */
  dockHere: 'Your ferry waits here 🛶',
  /** On the dock's own tile while the ferry map shows. */
  dockShowing: 'Your ferry waits here! The aqua land is where it goes. 🛶',
  bridgeHint: 'The bridge goes right across the river! 🪵',
  /** The Build sheet's top line when the bridge can't go here yet. */
  bridgeBlockedHint: "A bridge can't go here yet. 🪵",
  dockBlockedHint: "A dock can't go here yet. 🛶",
  dockHint: 'The dock goes right by the water! 🛶',
  ferryNowhere: 'No far shore to reach from this dock yet.',
  problems: {
    'wrong-patch': 'Only Wild Isles have these.',
    'not-yet': 'Coming soon!',
    'not-river': 'Bridges go on river tiles.',
    taken: 'There is already something built here!',
    'too-far': 'A bridge starts from land that is joined to your home. Join that land up first!',
    'not-mine': 'Docks go on your own land.',
    'no-lake': 'A dock needs a lake right next to it.',
    'one-dock': 'You already have a dock on this lake! 🛶',
  } satisfies Record<BuildableProblem, string>,
} as const;

/** Problems that mean the building isn't for this tile at all: the card isn't shown. */
const NOT_FOR_THIS_TILE: ReadonlySet<BuildableProblem> = new Set([
  'wrong-patch',
  'not-yet',
  'not-river',
  'not-mine',
  'no-lake',
]);

const BUILDINGS = new Map(GAME_DATA.buildings.map((b) => [b.id, b]));

const travelBuilding = (id: string): TravelBuilding | null => {
  const b = BUILDINGS.get(id);
  return b?.kind === 'travel' ? b : null;
};

/** The bridges on the map, as `supplyMap` takes them (a bridge has no owner on the view). */
export function bridgesOf(tiles: readonly PublicTile[]): BridgeSpot[] {
  return tiles
    .filter((t) => t.buildings.some((b) => b.buildingId === BRIDGE_ID))
    .map((t) => ({ q: t.q, r: t.r, ownerUserId: '' }));
}

/** The ferry docks on the map (they stand on their owner's land). */
export function docksOf(tiles: readonly PublicTile[]): DockSpot[] {
  return tiles
    .filter((t) => t.ownerUserId !== null && t.buildings.some((b) => b.buildingId === DOCK_ID))
    .map((t) => ({ q: t.q, r: t.r, ownerUserId: t.ownerUserId ?? '' }));
}

/** My supply line on a Wild Isle (what the server checks a road, bridge or claim against). */
export function supplyOf(
  view: Pick<MapView, 'tiles'>,
  roads: readonly PublicRoad[],
  me: string,
): Supply {
  return supplyMap(view.tiles, roads, bridgesOf(view.tiles), me, TRAVEL_RULES, docksOf(view.tiles));
}

function travelCard(
  id: string,
  icon: string,
  effect: string,
  blocked: string | null,
  hint: string,
  blockedHint: string,
): BuildCard | null {
  const building = travelBuilding(id);
  if (!building) return null;
  return {
    id,
    icon,
    name: building.name,
    effect,
    cost: buildCost(building),
    area: 'spot',
    blocked,
    craft: null,
    hint: blocked ? blockedHint : hint,
  };
}

export interface TravelCardInput {
  readonly tile: PublicTile;
  readonly view: Pick<MapView, 'map' | 'tiles'>;
  readonly me: string | null;
  /** `supplyOf(...).supplied`; null while roads haven't loaded (the server decides). */
  readonly supplied: ReadonlySet<HexKey> | null;
}

/** Can `id` go on this tile, by the shared rule (`travelBuildCheck`)? */
export function travelProblem(id: string, input: TravelCardInput): BuildableProblem | null {
  const { tile, view, me } = input;
  const building = travelBuilding(id);
  if (!building || !me) return 'wrong-patch';
  const result = travelBuildCheck({
    building,
    patchType: view.map.patchType ?? 'cozy',
    userId: me,
    tile: {
      q: tile.q,
      r: tile.r,
      terrain: tile.terrain,
      ownerUserId: tile.ownerUserId,
      communityId: tile.communityId ?? null,
      hasBuilding: tile.buildings.length > 0,
    },
    tiles: view.tiles,
    // Unknown yet: let the server judge the bridge's reach.
    supplied: input.supplied ?? new Set(hexNeighbors(tile).map(hexKey)),
    ownDocks: docksOf(view.tiles).filter((d) => d.ownerUserId === me),
  });
  return result.ok ? null : result.reason;
}

/** The bridge card for a river tile, or none (blocked, with why, when it can't go here yet). */
export function bridgeCards(input: TravelCardInput): BuildCard[] {
  // A river tile that already has its bridge has nothing left to build.
  if (input.tile.buildings.some((b) => b.buildingId === BRIDGE_ID)) return [];
  const problem = travelProblem(BRIDGE_ID, input);
  if (problem && NOT_FOR_THIS_TILE.has(problem)) return [];
  const card = travelCard(
    BRIDGE_ID,
    TRAVEL_TEXT.bridgeIcon,
    TRAVEL_TEXT.bridgeEffect,
    problem ? TRAVEL_TEXT.problems[problem] : null,
    TRAVEL_TEXT.bridgeHint,
    TRAVEL_TEXT.bridgeBlockedHint,
  );
  return card ? [card] : [];
}

/** The ferry dock card for a homestead by a lake, or none. */
export function dockCards(input: TravelCardInput): BuildCard[] {
  if (input.tile.homeSlot !== null) return [];
  const problem = travelProblem(DOCK_ID, input);
  if (problem && NOT_FOR_THIS_TILE.has(problem)) return [];
  const card = travelCard(
    DOCK_ID,
    TRAVEL_TEXT.dockIcon,
    TRAVEL_TEXT.dockEffect,
    problem ? TRAVEL_TEXT.problems[problem] : null,
    TRAVEL_TEXT.dockHint,
    TRAVEL_TEXT.dockBlockedHint,
  );
  return card ? [card] : [];
}

/** Does this tile of mine have a ferry dock? */
export function hasDock(tile: PublicTile, me: string | null): boolean {
  return (
    me !== null && tile.ownerUserId === me && tile.buildings.some((b) => b.buildingId === DOCK_ID)
  );
}

/** The land a dock ferries to (shared `ferryShore`), by water steps. */
export function ferryReach(view: Pick<MapView, 'tiles'>, dock: Hex): Map<HexKey, number> {
  return ferryShore(view.tiles, dock, TRAVEL_RULES.ferry.range);
}

/**
 * The ferry's far shore: the reach without land I already own or have joined to
 * home (`supplied`), which I can walk to and needs no ferry. Tinting only the
 * land across the water keeps the picture honest.
 */
export function farShoreOnly(
  reach: ReadonlyMap<HexKey, number>,
  tiles: readonly PublicTile[],
  me: string | null,
  supplied: ReadonlySet<HexKey> | null,
): Map<HexKey, number> {
  const mine = new Set(tiles.filter((t) => me !== null && t.ownerUserId === me).map(hexKey));
  return new Map([...reach].filter(([k]) => !mine.has(k) && !supplied?.has(k)));
}

/**
 * Where to look first when the ferry is shown: the nearest tile of the far
 * shore, which is the reach not already joined to my land (`supplied`); with
 * nothing but joined land, the nearest reach tile. Null with no reach.
 */
export function nearestFarShore(
  reach: ReadonlyMap<HexKey, number>,
  dock: Hex,
  supplied: ReadonlySet<HexKey> | null,
): Hex | null {
  const all = [...reach.keys()];
  const far = all.filter((k) => !supplied?.has(k));
  const pool = far.length > 0 ? far : all;
  let best: { key: HexKey; d: number } | null = null;
  for (const key of pool) {
    const d = hexDistance(hexFromKey(key), dock);
    if (!best || d < best.d || (d === best.d && key < best.key)) best = { key, d };
  }
  return best ? hexFromKey(best.key) : null;
}
