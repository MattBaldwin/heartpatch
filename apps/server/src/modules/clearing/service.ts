import {
  CLEARED_TERRAIN,
  CLEARING_RULES,
  clearDrop,
  clearToolFor,
  GAME_DATA,
  JOB_RULES,
  type ClearedTile,
  type ClearResponse,
  type PublicUser,
  type StartClearRequest,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { homesteadOf } from '../explore/homesteads.js';
import { createExploreRepo } from '../explore/repo.js';
import { createGatheringRepo } from '../gathering/repo.js';
import { bankGather, gatherFate } from '../gathering/service.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems, lockGrantRows } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { toClearing } from './view.js';
import {
  createClearingRepo,
  type ClearingRepo,
  type ClearRow,
  type SettleClearRow,
} from './repo.js';

/*
 * Clearing land (#242, owner decisions 2026-10-11). A clear is two timestamps
 * (CLAUDE.md rule 4): starting spends one use of the terrain's tool and fixes
 * what it drops; the next settle after `ready_at` turns the tile into cleared
 * land (`tiles.terrain = 'clearing'`, its node gone) and banks the drop
 * (owner decision 2026-10-06: no Collect). Only the owner, on their own
 * joined homesteads, on terrain `CLEARING_RULES` lists, with nothing standing
 * on or working the tile. Cleared land stays cleared for good, whoever holds
 * it later; a clear never clears land someone else holds when it settles.
 */

const RESOURCE_NAMES = new Map(GAME_DATA.resources.map((r) => [r.id, r.name]));
const TERRAIN_NAMES = new Map(GAME_DATA.terrains.map((t) => [t.id, t.name]));

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noTile: "We couldn't find that spot.",
  notYours: 'You can only clear your own land.',
  home: 'Your home stays just as it is. Clear a homestead instead!',
  notHomestead: 'Explore this land first, so it joins your home as a homestead!',
  notJoined:
    'Clear land works on homesteads: land that touches your home 🏡. Explore the land between to join it up!',
  napping: 'This homestead is napping. Join it back up to home first!',
  cleared: "This land's already cleared. Ready to build!",
  cantClear: (terrain: string) => `${terrain} can't be cleared.`,
  needTool: (tool: string) =>
    `You need ${/^[aeiou]/i.test(tool) ? 'an' : 'a'} ${tool} first. Make one in your recipe book!`,
  built: 'A building stands here. Take it down first!',
  gathering: "You're gathering here. Let it finish first!",
  squishyBusy: 'Ask your squishy to move first!',
  already: "You're already clearing land. One at a time!",
} as const;

/**
 * What happens to a clear when it's settled, like a gather (`gatherFate`):
 * `clear` when it finished while the tile was still the clearer's (even if
 * the land changed hands since: the drop is theirs, though land someone else
 * holds stays as it is, `planClearSettlement`), `lose` when the land changed
 * hands first, `wait` while it's still going.
 */
export function clearFate(
  clear: Pick<SettleClearRow, 'userId' | 'readyAt' | 'tileOwner' | 'lostAt'>,
  at: Date,
): 'clear' | 'lose' | 'wait' {
  if (clear.lostAt !== null) return clear.readyAt <= clear.lostAt ? 'clear' : 'lose';
  if (clear.tileOwner !== clear.userId) return 'lose';
  return clear.readyAt <= at ? 'clear' : 'wait';
}

/**
 * Settle's part (tech spec §7 "Settling"): finishes the player's clears that
 * are due, inside settle's transaction. The caller has locked the member row
 * and the clears' tiles (step 6, with its other tiles) and, after its own
 * gathers, calls `lock` (step 7, the clears in id order); after locking every
 * inventory row it grants (step 11, `grants`), it calls `apply`.
 */
export interface ClearSettlement {
  /** Grants `apply` makes, for settle's one `lockGrantRows`. */
  readonly grants: { userId: string; items: Record<string, number> }[];
  /** When each still-going clear finishes (ms), for settle's `nextAt`. */
  readonly due: number[];
  /** How many clears `apply` ends (finished or lost). */
  readonly ending: number;
  /** Turns finished clears' tiles into cleared land and banks their drops; returns what landed and the events. */
  readonly apply: () => Promise<{ cleared: ClearedTile[]; events: NewGameEvent[] }>;
}

/** The player's clears' tile ids, for settle's tile lock (read unlocked; settle reads them again). */
export async function clearTilesToSettle(
  db: Executor,
  mapId: string,
  userId: string,
): Promise<{ ids: string[]; tileIds: string[] }> {
  const rows = await createClearingRepo(db).listToSettle(mapId, userId);
  return { ids: rows.map((r) => r.id), tileIds: rows.map((r) => r.tileId) };
}

/** Locks the clears (step 7) and plans what settling does with each. */
export async function planClearSettlement(
  tx: Executor,
  clearIds: readonly string[],
  lockedTiles: ReadonlySet<string>,
  at: Date,
): Promise<ClearSettlement> {
  const repo = createClearingRepo(tx);
  // A clear whose tile wasn't locked (none: a clear's tile never changes) waits.
  const rows = (await repo.lockToSettle(clearIds)).filter(
    (c) => c.endedAt === null && lockedTiles.has(c.tileId),
  );
  const plans = rows.map((clear) => ({ clear, fate: clearFate(clear, at) }));
  return {
    grants: plans.flatMap((p) =>
      p.fate === 'clear' && Object.keys(p.clear.drop).length > 0
        ? [{ userId: p.clear.userId, items: p.clear.drop }]
        : [],
    ),
    due: plans.flatMap((p) => (p.fate === 'wait' ? [p.clear.readyAt.getTime()] : [])),
    ending: plans.filter((p) => p.fate !== 'wait').length,
    apply: async () => {
      const cleared: ClearedTile[] = [];
      const events: NewGameEvent[] = [];
      for (const { clear, fate } of plans) {
        if (fate === 'wait') continue;
        if (fate === 'lose') {
          await repo.endClear(clear.id, { reason: 'lost', at });
          continue;
        }
        // Finished in time, but the land changed hands before it settled: the
        // drop is still theirs, and a new owner's land stays as it is (they
        // may be gathering or building there already). Wild land has no one
        // to disturb, so it clears as it would have at `ready_at`.
        const landCleared = await finishClear(
          tx,
          repo,
          clear,
          at,
          clear.tileOwner === clear.userId || clear.tileOwner === null,
        );
        cleared.push({ q: clear.q, r: clear.r, items: clear.drop, landCleared });
        if (!landCleared) continue;
        events.push({
          mapId: clear.mapId,
          type: 'tile.cleared',
          actorUserId: clear.userId,
          payload: {
            clearId: clear.id,
            userId: clear.userId,
            q: clear.q,
            r: clear.r,
            terrain: CLEARED_TERRAIN,
            from: clear.fromTerrain,
            drop: clear.drop,
          },
        });
      }
      return { cleared, events };
    },
  };
}

/**
 * The drop lands and the clear ends; when `mayClear`, the tile becomes
 * cleared land too, if it's still the land the clear started on. Returns
 * whether it did.
 */
async function finishClear(
  tx: Executor,
  repo: Pick<ClearingRepo, 'clearTile' | 'endClear'>,
  clear: ClearRow,
  at: Date,
  mayClear: boolean,
): Promise<boolean> {
  const landCleared = mayClear && (await repo.clearTile(clear.tileId, clear.fromTerrain));
  if (Object.keys(clear.drop).length > 0) {
    await grantItems(
      tx,
      { mapId: clear.mapId, userId: clear.userId },
      clear.drop,
      'clear',
      clear.id,
    );
  }
  await repo.endClear(clear.id, { reason: 'cleared', at });
  return landCleared;
}

/**
 * Before a clear starts (#242): settles, in its own transaction, what's left
 * over that would otherwise stand in its way, as settle would. On the tile,
 * if it's the player's: a previous owner's clear or gather (one that
 * finished before the land changed hands banks into its maker's bag, a clear
 * clearing the land; else it ends `lost`) and the player's own finished
 * gather. Anywhere: the player's own clear, done or lost but not settled
 * yet. Lock order (tech spec §7): tiles in id order, the gather, the clears,
 * inventory rows, `maps`. True when anything changed.
 */
async function settleLeftovers(
  store: ClearingRepo,
  user: PublicUser,
  mapId: string,
  q: number,
  r: number,
  at: Date,
): Promise<boolean> {
  return store.transaction(async (repo, tx) => {
    await requireMember(tx, user, mapId);
    const tileId = await repo.tileIdAt(mapId, q, r);
    const own = await repo.findActive({ mapId, userId: user.id });
    const locked = await repo.lockTiles(
      [tileId, own?.tileId].filter((id): id is string => id !== null && id !== undefined),
    );
    // Only the tile's owner settles what's left on it.
    const tile = locked.find((t) => t.id === tileId && t.ownerUserId === user.id);

    const gathering = createGatheringRepo(tx);
    const found = tile ? await gathering.findActiveOnTile(tile.id) : null;
    const [gather] = found ? await gathering.lockToSettle([found.id]) : [];
    const fate = gather?.status === 'active' ? gatherFate(gather, at) : 'wait';

    const onTile = tile ? await repo.findActive({ tileId: tile.id }) : null;
    const clearIds = [...new Set([own?.id, onTile?.id])].filter(
      (id): id is string => id !== undefined,
    );
    const clears = await planClearSettlement(
      tx,
      clearIds.sort(),
      new Set(locked.map((t) => t.id)),
      at,
    );
    if ((!gather || fate === 'wait') && clears.ending === 0) return false;

    await lockGrantRows(tx, mapId, [
      ...(gather && fate === 'bank' ? [gather] : []),
      ...clears.grants,
    ]);
    if (gather && fate === 'bank') {
      await grantItems(tx, { mapId, userId: gather.userId }, gather.items, 'gather', gather.id);
    }
    if (gather && fate === 'lose') await gathering.endGather(gather.id, { status: 'lost', at });
    const { events } = await clears.apply();
    // The gather's found-clothing roll takes `maps`: after every inventory row.
    if (gather && fate === 'bank') {
      events.push(await bankGather(tx, gathering, gather, at, { granted: true }));
    }
    for (const event of events) await repo.appendEvent(event);
    return true;
  });
}

export interface ClearingService {
  /** Starts clearing a homestead the player owns. */
  start: (user: PublicUser, mapId: string, at: StartClearRequest) => Promise<ClearResponse>;
}

export interface ClearingServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

export function createClearingService(options: ClearingServiceOptions): ClearingService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createClearingRepo(db);

  return {
    start: async (user, mapId, { q, r }) => {
      const at = now();
      const owner = { mapId, userId: user.id };
      // What's left over settles first, and stays settled even if this start is refused.
      const tidied = await settleLeftovers(store, user, mapId, q, r, at);
      let result: ClearResponse;
      try {
        result = await store.transaction(async (repo, tx) => {
          await requireMember(tx, user, mapId);
          // Lock order (tech spec §7): the tile (step 6: it can't change hands,
          // and no gather, gatherer or guard starts on it meanwhile), reads of
          // what's on it, the clear's insert, the tool's inventory row (step
          // 11), then `maps`.
          const tileId = await repo.tileIdAt(mapId, q, r);
          const [tile] = tileId ? await repo.lockTiles([tileId]) : [];
          if (!tile) throw new AppError('NOT_FOUND', MESSAGES.noTile);
          if (tile.ownerUserId !== user.id) throw new AppError('FORBIDDEN', MESSAGES.notYours);
          if (tile.homeSlot !== null) throw new AppError('CONFLICT', MESSAGES.home);
          if (tile.terrain === CLEARED_TERRAIN) throw new AppError('CONFLICT', MESSAGES.cleared);
          const toolId = clearToolFor(tile.terrain, CLEARING_RULES);
          if (!toolId) {
            const name = TERRAIN_NAMES.get(tile.terrain) ?? 'This land';
            throw new AppError('CONFLICT', MESSAGES.cantClear(name));
          }
          const row = await createExploreRepo(tx).findRow(user.id, tile.id);
          const homestead = homesteadOf(row);
          if (homestead === 'paused') throw new AppError('CONFLICT', MESSAGES.napping);
          // Explored but not touching home says so, not "explore it" (#242).
          if (homestead !== 'joined') {
            throw new AppError(
              'CONFLICT',
              row?.completedAt ? MESSAGES.notJoined : MESSAGES.notHomestead,
            );
          }

          const busy = await repo.tileBusy(tile.id, user.id);
          if (busy.buildings > 0) throw new AppError('CONFLICT', MESSAGES.built);
          // Left over gathers have settled, so one still here is the player's, still going.
          if (await createGatheringRepo(tx).findActiveOnTile(tile.id)) {
            throw new AppError('CONFLICT', MESSAGES.gathering);
          }
          if (busy.workers > 0 || busy.guards > 0) {
            throw new AppError('CONFLICT', MESSAGES.squishyBusy);
          }
          if (await repo.findActive({ mapId, userId: user.id })) {
            throw new AppError('CONFLICT', MESSAGES.already);
          }

          const inventory = createInventoryRepo(tx);
          const uses = (await inventory.list(owner))[toolId] ?? 0;
          if (uses < 1) {
            throw new AppError('CONFLICT', MESSAGES.needTool(RESOURCE_NAMES.get(toolId) ?? toolId));
          }

          const clear = await repo.insertClear({
            mapId,
            userId: user.id,
            tileId: tile.id,
            fromTerrain: tile.terrain,
            fromNode: tile.nodeResource,
            tool: toolId,
            drop: clearDrop(tile, GAME_DATA.resources, JOB_RULES, CLEARING_RULES),
            startedAt: at,
            readyAt: new Date(at.getTime() + CLEARING_RULES.seconds * 1000),
          });
          // The tool wears one use, ledgered against the clear.
          await consumeItems(tx, owner, { [toolId]: 1 }, 'clear', clear.id);
          await repo.appendEvent({
            mapId,
            type: 'clearing.started',
            actorUserId: user.id,
            payload: {
              clearId: clear.id,
              userId: user.id,
              q: clear.q,
              r: clear.r,
              tool: clear.tool,
              drop: clear.drop,
              readyAt: clear.readyAt.toISOString(),
            },
          });
          return {
            clearing: toClearing(clear),
            items: await inventory.list(owner),
            now: at.toISOString(),
          };
        });
      } catch (err) {
        if (tidied) void options.publish?.(mapId);
        // A double tap raced us to a one-clear index (left overs on the tile
        // settled first, so the tile's index is the player's own too).
        if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.already);
        throw err;
      }
      void options.publish?.(mapId);
      return result;
    },
  };
}
