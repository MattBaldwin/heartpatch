import {
  completeKeeperConfig,
  KEEPER_DATA,
  type CompleteKeeperConfig,
  type KeeperConfig,
} from '@heartpatch/shared';

/**
 * Saves `config` and returns the Keeper the server kept, complete (#289) —
 * unless the player changed while it was on its way (#372): then null, so a
 * late save from the last player never becomes the next player's Keeper.
 */
export async function saveForSession(
  save: (config: KeeperConfig) => Promise<KeeperConfig>,
  config: KeeperConfig,
  session: () => number,
): Promise<CompleteKeeperConfig | null> {
  const mine = session();
  const kept = completeKeeperConfig(await save(config), KEEPER_DATA);
  return mine === session() ? kept : null;
}
