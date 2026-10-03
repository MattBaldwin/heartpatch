import { and, eq, isNull } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { mapMembers } from '../../db/schema.js';

/** Starter pick storage: the `map_members.starter_squishy_id` marker. */
export interface StartersRepo {
  /** Runs `fn` in one transaction; `tx` builds other modules' repos on it too. */
  transaction: <T>(fn: (repo: StartersRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** True if the player is an active member who hasn't picked a starter here yet. */
  needsStarter: (mapId: string, userId: string) => Promise<boolean>;
  /**
   * Row-locks the player's active membership until commit (tech spec §7
   * "a member row locked to check it"), so two picks run one at a time.
   * Null if they aren't an active member.
   */
  lockMember: (
    mapId: string,
    userId: string,
  ) => Promise<{ starterSquishyId: string | null } | null>;
  /** Records the pick on the membership; throws if it already has one (a backstop to the lock). */
  setStarter: (mapId: string, userId: string, squishyId: string) => Promise<void>;
}

export function createStartersRepo(db: Executor): StartersRepo {
  const member = (mapId: string, userId: string) =>
    and(
      eq(mapMembers.mapId, mapId),
      eq(mapMembers.userId, userId),
      eq(mapMembers.status, 'active'),
    );

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createStartersRepo(tx), tx)),

    needsStarter: async (mapId, userId) => {
      const [row] = await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(and(member(mapId, userId), isNull(mapMembers.starterSquishyId)));
      return row !== undefined;
    },

    lockMember: async (mapId, userId) => {
      const [row] = await db
        .select({ starterSquishyId: mapMembers.starterSquishyId })
        .from(mapMembers)
        .where(member(mapId, userId))
        .for('no key update');
      return row ?? null;
    },

    setStarter: async (mapId, userId, squishyId) => {
      const updated = await db
        .update(mapMembers)
        .set({ starterSquishyId: squishyId })
        .where(and(member(mapId, userId), isNull(mapMembers.starterSquishyId)))
        .returning({ userId: mapMembers.userId });
      if (updated.length !== 1) throw new Error('setStarter: membership already has a starter');
    },
  };
}
