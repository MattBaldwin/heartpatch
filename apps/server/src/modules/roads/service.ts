import {
  HOME_BASE_RULES,
  hexKey,
  isWaterTerrain,
  roadCost,
  roadRefund,
  topRoadLevel,
  type ItemCounts,
  type PublicUser,
  type RoadRequest,
  type RoadsView,
  type RoadTileResponse,
  type TravelRules,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { mapPatchRules, refreshSupply, supplyFor } from '../territory/supply.js';
import { createRoadsRepo, type RoadRow, type RoadsTxRepo, type RoadTileRow } from './repo.js';

/*
 * Wild Isle roads (#621): Path → Road → Paved road, a tile attribute
 * (`tile_roads`) laid on my own supplied land, raised, or taken up for half
 * back. A road reaches past my land (shared `supplyMap`) and speeds my
 * gatherers on its tile. Owner-only (owner answer Q3). Each command is one
 * transaction (CLAUDE.md rule 7). Lock order (tech spec §7): my member row
 * (step 2, so the road's key to it is never taken after a tile lock), the
 * tile (6), its road (6b), the tending rows the supply line moves (6, never
 * waited for), my bag (11), `maps` last. Cozy Patches have no roads.
 */

export const MESSAGES = {
  noRoads: 'There are no roads on this patch.',
  noTile: "That tile isn't on this map.",
  notMine: 'You can only lay roads on your own land.',
  water: "You can't lay a road on water. A bridge would do it!",
  cutOff: 'This land is cut off from home. Join it up with a road or a bridge first!',
  taken: "There's already a road here!",
  noRoad: "There's no road of yours here.",
  top: 'This road is as fancy as it gets! ✨',
} as const;

export interface RoadsService {
  /** Every road on my Wild Isle. */
  view: (user: PublicUser, mapId: string) => Promise<RoadsView>;
  /** Lays a Path on one of my supplied tiles. */
  build: (user: PublicUser, mapId: string, request: RoadRequest) => Promise<RoadTileResponse>;
  /** Raises my road a level. */
  upgrade: (user: PublicUser, mapId: string, request: RoadRequest) => Promise<RoadTileResponse>;
  /** Takes my road up for half back. */
  remove: (user: PublicUser, mapId: string, request: RoadRequest) => Promise<RoadTileResponse>;
}

export interface RoadsServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

/** The map's travel rules, or `NOT_FOUND` on a Cozy Patch. */
async function travelOf(tx: Executor, mapId: string): Promise<TravelRules> {
  const travel = (await mapPatchRules(tx, mapId))?.travel ?? null;
  if (!travel) throw new AppError('NOT_FOUND', MESSAGES.noRoads);
  return travel;
}

/** A road counts only while its owner holds its tile. */
const liveRoad = (road: RoadRow | null): RoadRow | null =>
  road !== null && road.tileOwnerUserId === road.ownerUserId ? road : null;

export function createRoadsService(options: RoadsServiceOptions): RoadsService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createRoadsRepo(db);

  /** Runs one command in one transaction, then publishes. */
  async function command(
    user: PublicUser,
    mapId: string,
    run: (
      repo: RoadsTxRepo,
      tx: Executor,
      ctx: { at: Date; travel: TravelRules; tile: RoadTileRow; road: RoadRow | null },
    ) => Promise<RoadTileResponse>,
    request: RoadRequest,
  ): Promise<RoadTileResponse> {
    let result: RoadTileResponse;
    try {
      result = await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        const travel = await travelOf(tx, mapId);
        // Step 2: my member row, before the tile (a new road's key to it).
        if (!(await createMapsRepo(tx).lockMember(mapId, user.id))) {
          throw new AppError('NOT_FOUND', MESSAGES.noTile);
        }
        const tile = await repo.lockTileAt(mapId, request.q, request.r);
        if (!tile) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        if (isWaterTerrain(tile.terrain)) throw new AppError('FORBIDDEN', MESSAGES.water);
        if (tile.ownerUserId !== user.id) throw new AppError('FORBIDDEN', MESSAGES.notMine);
        const road = await repo.lockRoad(tile.id);
        return run(repo, tx, { at: now(), travel, tile, road });
      });
    } catch (err) {
      // Two taps raced to lay the same tile's road (`tile_roads_pkey`).
      if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.taken);
      throw err;
    }
    void options.publish?.(mapId);
    return result;
  }

  /** The tile's road now and my bag, in the command's transaction. */
  async function tileView(
    tx: Executor,
    mapId: string,
    userId: string,
    tile: RoadTileRow,
    level: number | null,
    refund: ItemCounts = {},
  ): Promise<RoadTileResponse> {
    const items = await createInventoryRepo(tx).list({ mapId, userId });
    return { q: tile.q, r: tile.r, road: level === null ? null : { level }, items, refund };
  }

  /** The supply line moved: strand or join up my land, events to append. */
  const resupply = (tx: Executor, mapId: string, userId: string, at: Date) =>
    refreshSupply(tx, mapId, [userId], at);

  return {
    view: async (user, mapId) => {
      await requireMember(db, user, mapId);
      await travelOf(db, mapId);
      const roads = await store.listLive(mapId);
      return {
        roads: roads.map(({ q, r, ownerUserId, level }) => ({ q, r, ownerUserId, level })),
      };
    },

    build: (user, mapId, request) =>
      command(
        user,
        mapId,
        async (repo, tx, { at, travel, tile, road }) => {
          if (liveRoad(road)) throw new AppError('CONFLICT', MESSAGES.taken);
          const supply = await supplyFor(tx, mapId, user.id, travel);
          if (!supply.supplied.has(hexKey(tile))) throw new AppError('FORBIDDEN', MESSAGES.cutOff);
          // A leaver's road left behind (its owner no longer holds the tile) goes quietly.
          if (road) await repo.deleteRoads([tile.id]);
          const cost = roadCost(1, travel) ?? {};
          await repo.insertRoad({
            tileId: tile.id,
            mapId,
            ownerUserId: user.id,
            level: 1,
            builtAt: at,
          });
          const events = await resupply(tx, mapId, user.id, at);
          // Short of anything: CONFLICT ("You need 2 more Timber first!").
          await consumeItems(tx, { mapId, userId: user.id }, cost, 'road', tile.id);
          await repo.appendEvent({
            mapId,
            type: 'road.built',
            actorUserId: user.id,
            payload: { userId: user.id, q: tile.q, r: tile.r, level: 1, cost },
          });
          for (const event of events) await repo.appendEvent(event);
          return tileView(tx, mapId, user.id, tile, 1);
        },
        request,
      ),

    upgrade: (user, mapId, request) =>
      command(
        user,
        mapId,
        async (repo, tx, { at, travel, tile, road: row }) => {
          const road = liveRoad(row);
          if (!road) throw new AppError('NOT_FOUND', MESSAGES.noRoad);
          const level = road.level + 1;
          const cost = level > topRoadLevel(travel) ? null : roadCost(level, travel);
          if (!cost) throw new AppError('CONFLICT', MESSAGES.top);
          await repo.setLevel(tile.id, level);
          const events = await resupply(tx, mapId, user.id, at);
          await consumeItems(tx, { mapId, userId: user.id }, cost, 'road', tile.id);
          await repo.appendEvent({
            mapId,
            type: 'road.upgraded',
            actorUserId: user.id,
            payload: { userId: user.id, q: tile.q, r: tile.r, fromLevel: road.level, level, cost },
          });
          for (const event of events) await repo.appendEvent(event);
          return tileView(tx, mapId, user.id, tile, level);
        },
        request,
      ),

    remove: (user, mapId, request) =>
      command(
        user,
        mapId,
        async (repo, tx, { at, travel, tile, road: row }) => {
          const road = liveRoad(row);
          if (!road) throw new AppError('NOT_FOUND', MESSAGES.noRoad);
          const refund = roadRefund(road.level, travel, HOME_BASE_RULES);
          await repo.deleteRoads([tile.id]);
          const events = await resupply(tx, mapId, user.id, at);
          if (Object.keys(refund).length > 0) {
            await grantItems(tx, { mapId, userId: user.id }, refund, 'road-refund', tile.id);
          }
          await repo.appendEvent({
            mapId,
            type: 'road.removed',
            actorUserId: user.id,
            payload: { userId: user.id, q: tile.q, r: tile.r, level: road.level, refund },
          });
          for (const event of events) await repo.appendEvent(event);
          return tileView(tx, mapId, user.id, tile, null, refund);
        },
        request,
      ),
  };
}

/** A road that came down with its land, for the caller to finish. */
export interface LostRoad {
  readonly ownerUserId: string;
  readonly tileId: string;
  readonly refund: ItemCounts;
  /** `road.removed`, `lost` set: append it with the caller's other events. */
  readonly event: NewGameEvent<'road.removed'>;
}

/**
 * Roads on land that changed hands (captured, or gone wild) come down
 * (step 6b, tile id order), each worth its take-down share to the Keeper
 * who held the tile (`heldBy`, before the change). The caller locks those
 * players' inventory rows with its other grants and calls `grantLostRoads`.
 * A road a leaver left behind (not its tile's holder) just goes. Nothing on
 * a Cozy Patch, which has no roads.
 */
export async function takeDownRoadsOnLostLand(
  tx: Executor,
  mapId: string,
  heldBy: ReadonlyMap<string, string | null>,
  lost: 'captured' | 'wild',
): Promise<LostRoad[]> {
  const travel = (await mapPatchRules(tx, mapId))?.travel ?? null;
  if (!travel || heldBy.size === 0) return [];
  const repo = createRoadsRepo(tx);
  const rows = await repo.lockOnTiles([...heldBy.keys()]);
  if (rows.length === 0) return [];
  await repo.deleteRoads(rows.map((r) => r.tileId));
  return rows.flatMap((row) => {
    if (heldBy.get(row.tileId) !== row.ownerUserId) return [];
    const refund = roadRefund(row.level, travel, HOME_BASE_RULES);
    const event: NewGameEvent<'road.removed'> = {
      mapId,
      type: 'road.removed',
      actorUserId: null,
      payload: { userId: row.ownerUserId, q: row.q, r: row.r, level: row.level, refund, lost },
    };
    return [{ ownerUserId: row.ownerUserId, tileId: row.tileId, refund, event }];
  });
}

/** What lost roads give back, as `lockGrantRows` wants it. */
export const lostRoadGrants = (roads: readonly LostRoad[]) =>
  roads
    .filter((l) => Object.keys(l.refund).length > 0)
    .map((l) => ({ userId: l.ownerUserId, items: l.refund }));

/** Grants lost roads' take-down share (`road-refund`); their rows are locked already. */
export async function grantLostRoads(
  tx: Executor,
  mapId: string,
  roads: readonly LostRoad[],
): Promise<void> {
  for (const l of roads) {
    if (Object.keys(l.refund).length === 0) continue;
    await grantItems(tx, { mapId, userId: l.ownerUserId }, l.refund, 'road-refund', l.tileId);
  }
}
