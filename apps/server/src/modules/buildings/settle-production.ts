import { HOLLOW_RULES, type ItemCounts } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { bankOutput, nextMorningAt, productionAt, upkeepOf, type Produced } from './production.js';
import { createBuildingsRepo, type BuildingRow } from './repo.js';
import { chargeUpkeep, resumeUpkeep } from './upkeep.js';

/*
 * The settle's part for resource buildings and the Warehouse (#601):
 * collection is the settle (owner decision Q3), and the morning upkeep is
 * charged there too. Split around the settle's lock order (tech spec §7):
 * the tiles (step 6), then the buildings (step 8, `lockProducing`), every
 * inventory row the settle grants (step 11, the caller's one
 * `lockGrantRows`, given `grants`), then `apply`, which takes the Heart
 * Coin balance (step 12b) and must run after anything else at step 11
 * (training's `species_seen`) and before the caller's events (`maps`).
 */

/** The tiles of the player's upkeep buildings, read unlocked: the settle locks them with its own. */
export async function producingTiles(
  tx: Executor,
  mapId: string,
  userId: string,
): Promise<string[]> {
  const owned = await createBuildingsRepo(tx).listOwned(mapId, userId);
  return owned.filter((r) => upkeepOf(r) !== null).map((r) => r.tileId);
}

/** What `apply` did. */
export interface ProductionSettled {
  produced: Produced[];
  /** `building.paused`, `building.produced`, `building.resumed`, for the caller to append. */
  events: NewGameEvent[];
  /** When something next finishes or the next morning's upkeep is due (epoch ms). */
  due: number[];
}

export interface ProductionSettlement {
  /** Everything the output could land (a pause only makes less): lock with the settle's grants. */
  grants: { userId: string; items: ItemCounts }[];
  apply: () => Promise<ProductionSettled>;
}

/**
 * Locks the player's upkeep buildings (step 8, id order) whose tiles the
 * settle holds (one placed since the first read waits for the next settle),
 * and plans their part: the morning charges, the output up to now (or a
 * pause), and any wake-up.
 */
export async function lockProducing(
  tx: Executor,
  map: { id: string; timeZone: string },
  userId: string,
  lockedTiles: ReadonlySet<string>,
  at: Date,
): Promise<ProductionSettlement> {
  const rows = (await createBuildingsRepo(tx).lockUpkeepBuildings(map.id, userId)).filter((r) =>
    lockedTiles.has(r.tileId),
  );
  const grants = rows.flatMap((row) => {
    const items = productionAt(row, at, map.timeZone)?.ready ?? {};
    return Object.keys(items).length > 0 ? [{ userId, items }] : [];
  });
  return {
    grants,
    apply: async () => {
      if (rows.length === 0) return { produced: [], events: [], due: [] };
      // Mornings first: a pause stops the count at that morning.
      const charged = await chargeUpkeep(tx, map, userId, rows, at);
      const events: NewGameEvent[] = [...charged.events];
      const produced: Produced[] = [];
      const banked: BuildingRow[] = [];
      for (const row of charged.rows) {
        const made = productionAt(row, at, map.timeZone);
        const bank = made ? await bankOutput(tx, row, made) : null;
        if (bank) {
          produced.push(bank.produced);
          events.push(bank.event);
        }
        banked.push(
          made && made.progress.cycles > 0
            ? { ...row, producedSince: new Date(made.progress.nextSinceMs) }
            : row,
        );
      }
      const woken = await resumeUpkeep(tx, banked, charged.balance, at);
      events.push(...woken.events);
      const due = [nextMorningAt(at, HOLLOW_RULES.morningMinute, map.timeZone).getTime()];
      for (const row of woken.rows) {
        const next = productionAt(row, at, map.timeZone)?.progress.nextReadyMs ?? null;
        if (next !== null) due.push(next);
      }
      return { produced, events, due };
    },
  };
}
