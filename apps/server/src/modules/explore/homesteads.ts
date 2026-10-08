import { homesteadChanges, homesteadStates, type Hex, type HomesteadRow } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { createExploreRepo, type ExploredRow } from './repo.js';

/*
 * Homestead tiles (#199, owner design 2026-10-07; contract on the issue): a
 * fully explored tile joins its owner's home when it borders their home ring
 * or another of their homesteads. Worked out from ownership and the explore
 * rows (`homesteadStates`); `joined_at`, `paused_at` and `resumed_at`
 * remember the last answer, so a change is noticed and announced once.
 */

/** A stored row's homestead flags, as the shared check reads them. */
export function homesteadRowOf(row: ExploredRow): HomesteadRow {
  return {
    q: row.q,
    r: row.r,
    completed: row.completedAt !== null,
    joined: row.joinedAt !== null,
    paused: isPaused(row),
  };
}

/** Cut off from home right now: its latest pause hasn't ended. */
export function isPaused(row: { pausedAt: Date | null; resumedAt: Date | null }): boolean {
  return row.pausedAt !== null && row.resumedAt === null;
}

/**
 * A tile's homestead state from its owner's row (null: not their homestead):
 * what the map view, gathering and jobs read.
 */
export function homesteadOf(
  row: { joinedAt: Date | null; pausedAt: Date | null; resumedAt: Date | null } | null,
): 'joined' | 'paused' | null {
  if (!row?.joinedAt) return null;
  return isPaused(row) ? 'paused' : 'joined';
}

/**
 * A pause to leave out of a gatherer's work there (jobs'
 * `workProgressAround`), or null: its latest pause, ended or not. Only the
 * latest is kept: if a homestead pauses twice before its gatherer is next
 * settled, the earlier window counts as work, which the stored-cycle cap
 * bounds (a rare edge: two captures of the land between, both before the
 * player opens the game).
 */
export function workPauseOf(row: {
  pausedAt: Date | null;
  resumedAt: Date | null;
}): { fromMs: number; toMs: number | null } | null {
  if (!row.pausedAt) return null;
  return { fromMs: row.pausedAt.getTime(), toMs: row.resumedAt?.getTime() ?? null };
}

const tilesEvent = (
  mapId: string,
  type: 'homestead.joined' | 'homestead.paused' | 'homestead.resumed',
  userId: string,
  tiles: readonly Hex[],
): NewGameEvent => ({
  mapId,
  type,
  actorUserId: userId,
  payload: { userId, tiles: tiles.map((t) => ({ q: t.q, r: t.r })) },
});

/**
 * Works these players' homesteads out again after their land or exploring
 * changed (a search that finished a tile, a capture), writes what changed,
 * and returns the events to append after the caller's own writes. Locks the
 * players' fully explored rows in `(user_id, tile_id)` order: call it after
 * the tile locks (tech spec §7 step 6) and before squishies, buildings and
 * the bag. Land going wild and leaving a patch need no call: a joined
 * homestead never fades, and a leaver keeps no land.
 */
export async function refreshHomesteads(
  tx: Executor,
  mapId: string,
  userIds: readonly string[],
  at: Date,
): Promise<NewGameEvent[]> {
  const players = [...new Set(userIds)].sort();
  const repo = createExploreRepo(tx);
  const rows = await repo.lockExplored(mapId, players);
  if (rows.length === 0) return [];
  const mapTiles = await repo.listTiles(mapId);
  const events: NewGameEvent[] = [];
  for (const userId of players) {
    const mine = rows.filter((r) => r.userId === userId);
    if (mine.length === 0) continue;
    const flags = mine.map(homesteadRowOf);
    const changes = homesteadChanges(flags, homesteadStates(mapTiles, flags, userId));
    const byPlace = new Map(mine.map((r) => [`${String(r.q)},${String(r.r)}`, r]));
    const rowAt = (h: Hex) => {
      const row = byPlace.get(`${String(h.q)},${String(h.r)}`);
      if (!row) throw new Error('refreshHomesteads: change for a row it did not read');
      return row;
    };
    for (const h of changes.joined)
      await repo.setHomestead(userId, rowAt(h).tileId, { joinedAt: at }, at);
    for (const h of changes.paused) {
      await repo.setHomestead(userId, rowAt(h).tileId, { pausedAt: at, resumedAt: null }, at);
    }
    for (const h of changes.resumed) {
      await repo.setHomestead(userId, rowAt(h).tileId, { resumedAt: at }, at);
    }
    if (changes.joined.length > 0)
      events.push(tilesEvent(mapId, 'homestead.joined', userId, changes.joined));
    if (changes.paused.length > 0)
      events.push(tilesEvent(mapId, 'homestead.paused', userId, changes.paused));
    if (changes.resumed.length > 0) {
      events.push(tilesEvent(mapId, 'homestead.resumed', userId, changes.resumed));
    }
  }
  return events;
}
