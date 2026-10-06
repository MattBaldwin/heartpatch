import type { KeeperConfig } from '@heartpatch/shared';
import { eq } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { keepers } from '../../db/schema.js';

/** Keeper storage (`keepers`, one row per player). Plain queries; the service checks the ids. */
export interface KeepersRepo {
  find: (userId: string) => Promise<KeeperConfig | null>;
  /** Writes the player's Keeper, replacing any earlier one. */
  save: (userId: string, config: KeeperConfig, at: Date) => Promise<void>;
}

export const keeperColumns = {
  base: keepers.base,
  hairColor: keepers.hairColor,
  eyeColor: keepers.eyeColor,
  outfit: keepers.outfit,
  hairstyle: keepers.hairstyle,
};

/** A stored row as a config: no hairstyle (null) means the base's own. */
export function keeperFromRow({
  hairstyle,
  ...rest
}: Omit<KeeperConfig, 'hairstyle'> & { hairstyle: string | null }): KeeperConfig {
  return hairstyle === null ? rest : { ...rest, hairstyle };
}

export function createKeepersRepo(db: Executor): KeepersRepo {
  return {
    find: async (userId) => {
      const [row] = await db.select(keeperColumns).from(keepers).where(eq(keepers.userId, userId));
      return row ? keeperFromRow(row) : null;
    },

    save: async (userId, config, at) => {
      // Saving without a hairstyle goes back to the base's own (null).
      const row = { ...config, hairstyle: config.hairstyle ?? null };
      await db
        .insert(keepers)
        .values({ userId, ...row, createdAt: at, updatedAt: at })
        .onConflictDoUpdate({ target: keepers.userId, set: { ...row, updatedAt: at } });
    },
  };
}
