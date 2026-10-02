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
};

export function createKeepersRepo(db: Executor): KeepersRepo {
  return {
    find: async (userId) => {
      const [row] = await db.select(keeperColumns).from(keepers).where(eq(keepers.userId, userId));
      return row ?? null;
    },

    save: async (userId, config, at) => {
      await db
        .insert(keepers)
        .values({ userId, ...config, createdAt: at, updatedAt: at })
        .onConflictDoUpdate({ target: keepers.userId, set: { ...config, updatedAt: at } });
    },
  };
}
