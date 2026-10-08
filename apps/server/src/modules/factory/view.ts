import {
  factoryDone,
  factoryDoneAtMs,
  factoryNextAtMs,
  factoryQueues,
  GAME_DATA,
  type FactoryTiming,
  type FactoryView,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { ItemOwner } from '../inventory/repo.js';
import { createFactoryRepo, type BatchRow } from './repo.js';

// What the Crafting Factory looks like to its owner (#294), read-only, for
// every inventory reply. Kept apart from the service so the inventory
// module can read it without importing the commands.

const BUILDINGS = new Map(GAME_DATA.buildings.map((b) => [b.id, b]));

/** A batch's timing, for the shared batch maths. */
export const timing = (row: BatchRow): FactoryTiming => ({
  total: row.total,
  itemSeconds: row.itemSeconds,
  startedAtMs: row.startedAt.getTime(),
});

/** My Factory and its batches, for every inventory reply (`InventoryResponse.factory`). */
export async function factoryView(
  db: Executor,
  owner: ItemOwner,
  at: Date,
): Promise<FactoryView | null> {
  const repo = createFactoryRepo(db);
  const [factory, rows] = await Promise.all([repo.findFactory(owner), repo.listRunning(owner)]);
  if (!factory) return null;
  return {
    buildingId: factory.id,
    level: factory.level,
    slots: Math.max(1, factoryQueues(BUILDINGS.get(factory.buildingId), factory.level)),
    batches: rows.map((row) => {
      const next = factoryNextAtMs(timing(row), at.getTime());
      return {
        id: row.id,
        recipeId: row.recipeId,
        total: row.total,
        done: factoryDone(timing(row), at.getTime()),
        itemSeconds: row.itemSeconds,
        startedAt: row.startedAt.toISOString(),
        nextAt: next === null ? null : new Date(next).toISOString(),
        doneAt: new Date(factoryDoneAtMs(timing(row))).toISOString(),
      };
    }),
  };
}
