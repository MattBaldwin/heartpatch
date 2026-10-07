import {
  buildCost,
  buildingPageKey,
  edgeNeighbor,
  fenceHpAfterUpgrade,
  fenceMaxHp,
  fenceRepairCost,
  FENCE_RULES,
  GAME_DATA,
  HOME_BASE_RULES,
  hexDistance,
  hexKey,
  isBuildable,
  isHexEdge,
  removeRefund,
  upgradeCost,
  type BuildFenceRequest,
  type FenceBuilding,
  type FenceRules,
  type FenceTileResponse,
  type ItemCounts,
  type PlacedFence,
  type PublicFence,
  type PublicUser,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createInventoryRepo } from '../inventory/repo.js';
import {
  consumeItems,
  grantItems,
  lockGrantRows,
  recipeBookPage,
  requirePageOpen,
} from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createFencesRepo, type FenceRow, type FencesTxRepo, type FenceTileRow } from './repo.js';

/*
 * Fences (#203, #204; owner decisions 2026-10-06 and 2026-10-07). Segments
 * on the hex edges of a tile the player holds, on their side of the edge.
 * A tile is fenced when every edge facing land they don't hold has one
 * (shared `isTileFenced`); a challenger then has to break the weakest
 * exposed segment before beating the guard (territory's two-part
 * challenge). Built, upgraded, repaired and taken down here, each in one
 * transaction with what it costs (CLAUDE.md rule 7). Lock order (tech spec
 * §7): the tile (step 6), the segment (step 8, with buildings), inventory
 * rows (step 11), `maps` last.
 */

/** Every fence kind in the data, by id. */
export const FENCE_DATA = new Map<string, FenceBuilding>(
  GAME_DATA.buildings.flatMap((b) => (b.kind === 'fence' ? [[b.id, b] as const] : [])),
);

// Kid-readable messages (style guide §2, §6, §9).
const MESSAGES = {
  unknown: "We don't know that fence.",
  notYet: "That one isn't ready to build yet. Soon!",
  noTile: "We couldn't find that spot.",
  notMine: 'You can only put fences on your own land.',
  edgeTaken: 'That edge has a fence already. Try another one!',
  noFence: "We couldn't find that fence.",
  topLevel: (name: string) => `Your ${name} is as strong as it gets!`,
  full: (name: string) => `Your ${name} is as good as new!`,
} as const;

/** A segment as every member sees it. */
export function toPublicFence(
  row: Pick<FenceRow, 'id' | 'edge' | 'buildingId' | 'level' | 'hp'>,
): PublicFence {
  const fence = FENCE_DATA.get(row.buildingId);
  const maxHp = fence ? fenceMaxHp(fence, row.level) : row.hp;
  return {
    id: row.id,
    edge: row.edge,
    buildingId: row.buildingId,
    level: row.level,
    hp: Math.min(row.hp, maxHp),
    maxHp: Math.max(maxHp, row.hp),
  };
}

/** A segment with its tile, as fence events carry it. */
export function toPlacedFence(row: FenceRow): PlacedFence {
  return { ...toPublicFence(row), q: row.q, r: row.r };
}

/** What taking a segment down gives back: the usual share of everything spent on it. */
export function fenceRefund(row: Pick<FenceRow, 'buildingId' | 'level'>): ItemCounts {
  const fence = FENCE_DATA.get(row.buildingId);
  return fence ? removeRefund(fence, row.level, HOME_BASE_RULES) : {};
}

export interface FencesService {
  build: (
    user: PublicUser,
    mapId: string,
    request: BuildFenceRequest,
  ) => Promise<FenceTileResponse>;
  upgrade: (user: PublicUser, mapId: string, fenceId: string) => Promise<FenceTileResponse>;
  repair: (user: PublicUser, mapId: string, fenceId: string) => Promise<FenceTileResponse>;
  remove: (user: PublicUser, mapId: string, fenceId: string) => Promise<FenceTileResponse>;
}

export interface FencesServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** Tests pass their own. */
  rules?: FenceRules;
}

export function createFencesService(options: FencesServiceOptions): FencesService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const rules = options.rules ?? FENCE_RULES;
  const store = createFencesRepo(db);

  /** The tile's segments now and my bag, read in the command's transaction. */
  async function tileView(
    repo: FencesTxRepo,
    tx: Executor,
    mapId: string,
    userId: string,
    tile: Pick<FenceTileRow, 'id' | 'q' | 'r'>,
    refund: ItemCounts = {},
  ): Promise<FenceTileResponse> {
    const [fences, items] = await Promise.all([
      repo.listOnTile(tile.id),
      createInventoryRepo(tx).list({ mapId, userId }),
    ]);
    return { q: tile.q, r: tile.r, fences: fences.map(toPublicFence), items, refund };
  }

  /** Runs one command in one transaction, then publishes. */
  async function command<T>(
    user: PublicUser,
    mapId: string,
    run: (repo: FencesTxRepo, tx: Executor, at: Date) => Promise<T>,
  ): Promise<T> {
    let result: T;
    try {
      result = await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        return run(repo, tx, now());
      });
    } catch (err) {
      // Two taps raced for the same edge (`fence_segments_tile_id_edge_key`).
      if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.edgeTaken);
      throw err;
    }
    void options.publish?.(mapId);
    return result;
  }

  /**
   * One of my segments and its tile, locked: the tile first (step 6, so a
   * capture can't land meanwhile), then the segment (step 8). The tile must
   * still be mine.
   */
  async function lockMine(
    repo: FencesTxRepo,
    mapId: string,
    userId: string,
    fenceId: string,
  ): Promise<{ tile: FenceTileRow; row: FenceRow; fence: FenceBuilding }> {
    const seen = await repo.findFence(fenceId);
    if (seen?.mapId !== mapId || seen.ownerUserId !== userId) {
      throw new AppError('NOT_FOUND', MESSAGES.noFence);
    }
    const tile = await repo.lockTile(seen.tileId);
    const row = await repo.lockFence(fenceId);
    if (!tile || !row || row.ownerUserId !== userId || tile.ownerUserId !== userId) {
      throw new AppError('NOT_FOUND', MESSAGES.noFence);
    }
    const fence = FENCE_DATA.get(row.buildingId);
    if (!fence) throw new AppError('NOT_FOUND', MESSAGES.unknown);
    return { tile, row, fence };
  }

  return {
    build: (user, mapId, request) => {
      const fence = FENCE_DATA.get(request.buildingId);
      if (!fence) throw new AppError('NOT_FOUND', MESSAGES.unknown);
      if (!isBuildable(HOME_BASE_RULES, fence)) throw new AppError('CONFLICT', MESSAGES.notYet);
      return command(user, mapId, async (repo, tx, at) => {
        // A sealed recipe book page can't be built (owner decision 2026-10-05).
        const page = recipeBookPage(buildingPageKey(fence.id));
        if (page) await requirePageOpen(tx, user.id, page);
        const tile = await repo.lockTileAt(mapId, request.q, request.r);
        if (!tile) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        if (tile.ownerUserId !== user.id) throw new AppError('FORBIDDEN', MESSAGES.notMine);
        const taken = new Set((await repo.listOnTile(tile.id)).map((f) => f.edge));
        if (request.edges.some((edge) => taken.has(edge))) {
          throw new AppError('CONFLICT', MESSAGES.edgeTaken);
        }
        const cost = buildCost(fence);
        const hp = fenceMaxHp(fence, 1);
        const built: FenceRow[] = [];
        for (const edge of [...request.edges].sort((a, b) => a - b)) {
          const row = await repo.insertFence({
            mapId,
            ownerUserId: user.id,
            tileId: tile.id,
            edge,
            buildingId: fence.id,
            hp,
            builtAt: at,
          });
          // Short of anything: CONFLICT ("You need 2 more Emberwood first!"),
          // and every segment rolls back with it.
          await consumeItems(tx, { mapId, userId: user.id }, cost, 'build', row.id);
          built.push(row);
        }
        for (const row of built) {
          await repo.appendEvent({
            mapId,
            type: 'fence.built',
            actorUserId: user.id,
            payload: { userId: user.id, fence: toPlacedFence(row), cost },
          });
        }
        return tileView(repo, tx, mapId, user.id, tile);
      });
    },

    upgrade: (user, mapId, fenceId) =>
      command(user, mapId, async (repo, tx) => {
        const { tile, row, fence } = await lockMine(repo, mapId, user.id, fenceId);
        const cost = upgradeCost(fence, row.level);
        if (!cost) throw new AppError('CONFLICT', MESSAGES.topLevel(fence.name));
        await consumeItems(tx, { mapId, userId: user.id }, cost, 'upgrade', row.id);
        // An upgrade isn't a free repair: it keeps what it had lost.
        const level = row.level + 1;
        const hp = fenceHpAfterUpgrade(fence, row.level, row.hp);
        await repo.setLevelAndHp(row.id, level, hp);
        await repo.appendEvent({
          mapId,
          type: 'fence.upgraded',
          actorUserId: user.id,
          payload: {
            userId: user.id,
            fence: toPlacedFence({ ...row, level, hp }),
            fromLevel: row.level,
            cost,
          },
        });
        return tileView(repo, tx, mapId, user.id, tile);
      }),

    repair: (user, mapId, fenceId) =>
      command(user, mapId, async (repo, tx) => {
        const { tile, row, fence } = await lockMine(repo, mapId, user.id, fenceId);
        const cost = fenceRepairCost(fence, row.level, row.hp, rules);
        if (Object.keys(cost).length === 0)
          throw new AppError('CONFLICT', MESSAGES.full(fence.name));
        await consumeItems(tx, { mapId, userId: user.id }, cost, 'repair', row.id);
        const hp = fenceMaxHp(fence, row.level);
        await repo.setHp(row.id, hp);
        await repo.appendEvent({
          mapId,
          type: 'fence.repaired',
          actorUserId: user.id,
          payload: { userId: user.id, fence: toPlacedFence({ ...row, hp }), cost },
        });
        return tileView(repo, tx, mapId, user.id, tile);
      }),

    remove: (user, mapId, fenceId) =>
      command(user, mapId, async (repo, tx) => {
        const { tile, row } = await lockMine(repo, mapId, user.id, fenceId);
        const refund = fenceRefund(row);
        await repo.deleteFence(row.id);
        if (Object.keys(refund).length > 0) {
          await grantItems(tx, { mapId, userId: user.id }, refund, 'build-refund', row.id);
        }
        await repo.appendEvent({
          mapId,
          type: 'fence.removed',
          actorUserId: user.id,
          payload: {
            userId: user.id,
            fenceId: row.id,
            buildingId: row.buildingId,
            q: row.q,
            r: row.r,
            edge: row.edge,
            refund,
          },
        });
        return tileView(repo, tx, mapId, user.id, tile, refund);
      }),
  };
}

/** A segment that came down with its land, for the caller to finish. */
export interface LostFence {
  readonly ownerUserId: string;
  readonly tileId: string;
  readonly fenceId: string;
  readonly refund: ItemCounts;
  /** `fence.removed`, `lost` set: append it with the caller's other events. */
  readonly event: NewGameEvent<'fence.removed'>;
}

/**
 * Land changed hands or went wild (#203, as fires do in #202): its fence
 * segments come down in the caller's transaction, after its tile locks.
 * Locks them (step 8, id order, after any buildings) and deletes them; the
 * caller grants each `refund` (the take-down share) to its owner at step 11
 * and appends the events. A segment a challenger broke is already gone
 * (deleted with nothing back), so only standing segments come down here.
 */
export async function takeDownFencesOnLostLand(
  tx: Executor,
  mapId: string,
  tileIds: readonly string[],
  lost: 'captured' | 'wild' | 'left',
): Promise<LostFence[]> {
  const repo = createFencesRepo(tx);
  const rows = await repo.lockOnTiles(tileIds);
  await repo.deleteFences(rows.map((r) => r.id));
  return rows.map((row) => lostFence(mapId, row, lost));
}

/**
 * A capture (#203, owner decision on #244): the old owner's segments on the
 * tile come down (`captured`), and so do the capturer's own segments on
 * their tiles next to it that faced it, now inner edges of their land
 * (`inner`). Both for the take-down share, in the capture's transaction
 * after its tile lock. One lock over every tile involved (step 8, id
 * order), so two captures side by side can't lock each other's rows in
 * opposite orders. `tiles` is the map as it is now, the capture applied.
 */
export async function takeDownFencesOnCapture(
  tx: Executor,
  mapId: string,
  tile: { id: string; q: number; r: number },
  capturerUserId: string,
  tiles: readonly { id: string; q: number; r: number; ownerUserId: string | null }[],
): Promise<LostFence[]> {
  const repo = createFencesRepo(tx);
  const captured = hexKey(tile);
  const mine = tiles.filter(
    (t) => t.id !== tile.id && t.ownerUserId === capturerUserId && hexDistance(t, tile) === 1,
  );
  const rows = await repo.lockOnTiles([tile.id, ...mine.map((t) => t.id)]);
  const lost = rows.flatMap((row): LostFence[] => {
    if (row.tileId === tile.id) return [lostFence(mapId, row, 'captured')];
    const inward =
      row.ownerUserId === capturerUserId &&
      isHexEdge(row.edge) &&
      hexKey(edgeNeighbor(row, row.edge)) === captured;
    return inward ? [lostFence(mapId, row, 'inner')] : [];
  });
  await repo.deleteFences(lost.map((l) => l.fenceId));
  return lost;
}

/** A segment coming down with the take-down share back, and its event. */
function lostFence(
  mapId: string,
  row: FenceRow,
  lost: 'captured' | 'wild' | 'left' | 'inner',
): LostFence {
  const refund = fenceRefund(row);
  return {
    ownerUserId: row.ownerUserId,
    tileId: row.tileId,
    fenceId: row.id,
    refund,
    event: {
      mapId,
      type: 'fence.removed',
      actorUserId: null,
      payload: {
        userId: row.ownerUserId,
        fenceId: row.id,
        buildingId: row.buildingId,
        q: row.q,
        r: row.r,
        edge: row.edge,
        refund,
        lost,
      },
    },
  };
}

/** Adds up what several lost segments gave back to one owner. */
export function sumRefunds(refunds: readonly ItemCounts[]): ItemCounts {
  const total: ItemCounts = {};
  for (const refund of refunds) {
    for (const [id, n] of Object.entries(refund)) total[id] = (total[id] ?? 0) + n;
  }
  return total;
}

/**
 * A departing member's segments come down (they left the patch), after
 * their tiles are released, inside the maps module's leave transaction:
 * the take-down share comes back to their bag (step 11) and one
 * `fence.removed` (`lost: 'left'`) per segment is returned to append.
 */
export async function removeMemberFences(
  tx: Executor,
  mapId: string,
  userId: string,
): Promise<NewGameEvent<'fence.removed'>[]> {
  const owned = await createFencesRepo(tx).listOwned(mapId, userId);
  const lost = await takeDownFencesOnLostLand(
    tx,
    mapId,
    [...new Set(owned.map((f) => f.tileId))],
    'left',
  );
  const mine = lost.filter((l) => l.ownerUserId === userId);
  const total = sumRefunds(mine.map((l) => l.refund));
  if (Object.keys(total).length > 0) {
    await lockGrantRows(tx, mapId, [{ userId, items: total }]);
    for (const l of mine) {
      if (Object.keys(l.refund).length > 0) {
        await grantItems(tx, { mapId, userId }, l.refund, 'build-refund', l.fenceId);
      }
    }
  }
  return lost.map((l) => l.event);
}

/** Every segment on a map, by tile (`"q,r"`), for the map view (`PublicTile.fences`). */
export async function listPublicFences(
  tx: Executor,
  mapId: string,
): Promise<Map<string, PublicFence[]>> {
  const byTile = new Map<string, PublicFence[]>();
  for (const row of await createFencesRepo(tx).listOnMap(mapId)) {
    const key = `${String(row.q)},${String(row.r)}`;
    const list = byTile.get(key) ?? [];
    list.push(toPublicFence(row));
    byTile.set(key, list);
  }
  return byTile;
}
