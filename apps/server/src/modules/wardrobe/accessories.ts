import { CLOTHING_BY_ID, SQUISHY_SLOT, STARTER_CLOTHING } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { listWornAccessories } from './repo.js';

const STARTERS = new Set(STARTER_CLOTHING);

/**
 * Squishy id → the accessory it wears (#340), for the squishy reads (care,
 * home, the job board). Read back through ownership (DECISIONS "Wardrobe
 * (#43)"): the squishy is still the player's, and so is the piece (a starter,
 * or a stored piece not held for a trade). A row that fails either is left
 * out, so the squishy reads as wearing nothing; the row itself stays.
 */
export async function wornAccessories(
  db: Executor,
  userId: string,
  squishyIds: readonly string[],
): Promise<Map<string, string>> {
  const worn = new Map<string, string>();
  for (const row of await listWornAccessories(db, userId, squishyIds)) {
    if (CLOTHING_BY_ID.get(row.itemId)?.slot !== SQUISHY_SLOT) continue;
    if (row.stored || STARTERS.has(row.itemId)) worn.set(row.squishyId, row.itemId);
  }
  return worn;
}
