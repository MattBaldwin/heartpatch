import { HOLLOW_RULES, upkeepOrder, type HeartCoins } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { canWorkAt, nextMorningAt, upkeepOf } from './production.js';
import { createBuildingsRepo } from './repo.js';

/**
 * My building upkeep on a patch for the Heart Coins sheet (#601): the next
 * morning it's charged, each upkeep building in charge order with what it
 * pays then (nothing while paused, napping or out of season, owner
 * decisions Q4, Q6), and the total. Undefined when I have none. A read: it
 * charges nothing (the settle does).
 */
export async function upkeepView(
  tx: Executor,
  map: { id: string; timeZone: string },
  userId: string,
  at: Date,
): Promise<HeartCoins['upkeep']> {
  const rows = (await createBuildingsRepo(tx).listOwned(map.id, userId)).flatMap((row) => {
    const upkeep = upkeepOf(row);
    return upkeep !== null && (row.kind === 'resource' || row.kind === 'warehouse')
      ? [{ row, upkeep, kind: row.kind }]
      : [];
  });
  if (rows.length === 0) return undefined;
  const morning = nextMorningAt(at, HOLLOW_RULES.morningMinute, map.timeZone);
  const ordered = upkeepOrder(
    rows.map(({ row, upkeep, kind }) => ({
      id: row.id,
      kind,
      level: row.level,
      upkeep,
      placedAtMs: row.placedAt.getTime(),
      rank: row.upkeepRank,
      row,
    })),
  );
  const due = ordered.map(({ row, upkeep }) => {
    const paused = row.pausedAt !== null;
    const pays = !paused && canWorkAt(row, morning, map.timeZone);
    return {
      buildingRowId: row.id,
      buildingId: row.buildingId,
      level: row.level,
      q: row.q,
      r: row.r,
      coins: pays ? upkeep : 0,
      paused,
    };
  });
  return {
    nextMorningAt: morning.toISOString(),
    total: due.reduce((sum, d) => sum + d.coins, 0),
    due,
  };
}
