import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { withTransaction, type Executor } from '../../db/client.js';
import { mapMembers, users } from '../../db/schema.js';
import { activeMember } from '../maps/repo.js';

/** Starter pick storage: the `map_members.starter_squishy_id` marker. */
export interface StartersRepo {
  /** Runs `fn` in one transaction; `tx` builds other modules' repos on it too. */
  transaction: <T>(fn: (repo: StartersRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** True if the player is an active member who hasn't picked a starter here yet. */
  needsStarter: (mapId: string, userId: string) => Promise<boolean>;
  /** The player's tutorial Partner species (`users.partner_species_id`), or null. */
  partnerSpecies: (userId: string) => Promise<string | null>;
  /**
   * True if the account has picked a starter on any patch before (a marker on
   * any of its memberships, archived ones too): Sprout's first-pick gift is
   * for the very first only.
   */
  pickedBefore: (userId: string) => Promise<boolean>;
  /** Records the pick on the membership; throws if it already has one (a backstop to the lock). */
  setStarter: (mapId: string, userId: string, squishyId: string) => Promise<void>;
}

export function createStartersRepo(db: Executor): StartersRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createStartersRepo(tx), tx)),

    needsStarter: async (mapId, userId) => {
      const [row] = await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(and(activeMember(mapId, userId), isNull(mapMembers.starterSquishyId)));
      return row !== undefined;
    },

    partnerSpecies: async (userId) => {
      const [row] = await db
        .select({ speciesId: users.partnerSpeciesId })
        .from(users)
        .where(eq(users.id, userId));
      return row?.speciesId ?? null;
    },

    pickedBefore: async (userId) => {
      const [row] = await db
        .select({ mapId: mapMembers.mapId })
        .from(mapMembers)
        .where(and(eq(mapMembers.userId, userId), isNotNull(mapMembers.starterSquishyId)))
        .limit(1);
      return row !== undefined;
    },

    setStarter: async (mapId, userId, squishyId) => {
      const updated = await db
        .update(mapMembers)
        .set({ starterSquishyId: squishyId })
        .where(and(activeMember(mapId, userId), isNull(mapMembers.starterSquishyId)))
        .returning({ userId: mapMembers.userId });
      if (updated.length !== 1) throw new Error('setStarter: membership already has a starter');
    },
  };
}
