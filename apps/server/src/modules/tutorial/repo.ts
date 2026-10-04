import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { mapMembers, maps, squishies, users } from '../../db/schema.js';
import { activeMember, createMapsRepo } from '../maps/repo.js';

/** A player's tutorial columns (`users`). */
export interface TutorialProgress {
  /** Current step id while a run is going; null otherwise. */
  tutorialStep: string | null;
  /** First completion; replaying never clears it. */
  tutorialCompletedAt: Date | null;
  /** The Partner's species (set when the befriend step finishes), or null. */
  partnerSpeciesId: string | null;
}

/** The run's Partner squishy (`findPartner`). */
export interface PartnerRow {
  id: string;
  speciesId: string;
  nickname: string | null;
  level: number;
  xp: number;
}

/**
 * Tutorial storage. Plain queries; the service decides the rules and runs
 * each command in one transaction. Map, member and tile rows are written
 * through the maps repo (`createMapsRepo(tx)`) on the same transaction.
 */
export interface TutorialRepo {
  /** Runs `fn` in one transaction, with this repo (and `tx` for other modules' repos). */
  transaction: <T>(fn: (repo: TutorialTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /**
   * Row-locks the player's account until commit (`FOR NO KEY UPDATE`, the
   * same lock the maps module takes) and returns their progress and zone.
   * Every tutorial write takes it first, so runs never race each other.
   */
  lockPlayer: (userId: string) => Promise<(TutorialProgress & { timeZone: string }) | null>;
  progress: (userId: string) => Promise<TutorialProgress | null>;
  /** The player's live tutorial map: their active membership on one (newest first). */
  currentRun: (userId: string) => Promise<string | null>;
  /** A hand-authored map (no seed) for one player. */
  insertTutorialMap: (map: { name: string; timeZone: string }) => Promise<{ id: string }>;
  setStep: (userId: string, stepId: string | null) => Promise<void>;
  /** Remembers the Partner's species (a starter; the caller checks) for the starter pick. */
  setPartnerSpecies: (userId: string, speciesId: string) => Promise<void>;
  /**
   * The run's Partner: the player's first squishy on the map whose species is
   * one of `speciesIds` (the stored Partner species and what it grows into), or null.
   */
  findPartner: (
    mapId: string,
    userId: string,
    speciesIds: readonly string[],
  ) => Promise<PartnerRow | null>;
  /** Ends the run; `completedAt` is the first completion (callers keep an earlier one). */
  complete: (userId: string, completedAt: Date) => Promise<void>;
  /**
   * For the step engine: the player of a tutorial map, with their account
   * locked as in `lockPlayer`. Null if the map isn't a tutorial or its player
   * has left it (an old run, replaced by a replay or skip).
   */
  lockMapPlayer: (mapId: string) => Promise<(TutorialProgress & { userId: string }) | null>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface TutorialTxRepo extends TutorialRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const progressColumns = {
  tutorialStep: users.tutorialStep,
  tutorialCompletedAt: users.tutorialCompletedAt,
  partnerSpeciesId: users.partnerSpeciesId,
};

export function createTutorialRepo(db: Executor): TutorialRepo {
  return queries(db);
}

/** This repo on a transaction someone else opened (the event consumer runner). */
export function createTutorialTxRepo(tx: Transaction): TutorialTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): TutorialRepo {
  const lockPlayer: TutorialRepo['lockPlayer'] = async (userId) => {
    const [row] = await db
      .select({ ...progressColumns, timeZone: users.timeZone })
      .from(users)
      .where(eq(users.id, userId))
      .for('no key update');
    return row ?? null;
  };

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createTutorialTxRepo(tx), tx)),

    lockPlayer,

    progress: async (userId) => {
      const [row] = await db.select(progressColumns).from(users).where(eq(users.id, userId));
      return row ?? null;
    },

    currentRun: async (userId) => {
      const [row] = await db
        .select({ id: maps.id })
        .from(mapMembers)
        .innerJoin(maps, eq(maps.id, mapMembers.mapId))
        .where(
          and(
            eq(mapMembers.userId, userId),
            eq(mapMembers.status, 'active'),
            eq(maps.kind, 'tutorial'),
          ),
        )
        .orderBy(desc(mapMembers.joinedAt))
        .limit(1);
      return row?.id ?? null;
    },

    insertTutorialMap: async (map) => {
      const [row] = await db
        .insert(maps)
        .values({ kind: 'tutorial', maxPlayers: 1, pvpMode: 'off', seed: null, ...map })
        .returning({ id: maps.id });
      if (!row) throw new Error('insertTutorialMap: insert returned no row');
      return row;
    },

    setStep: async (userId, stepId) => {
      await db.update(users).set({ tutorialStep: stepId }).where(eq(users.id, userId));
    },

    setPartnerSpecies: async (userId, speciesId) => {
      await db.update(users).set({ partnerSpeciesId: speciesId }).where(eq(users.id, userId));
    },

    findPartner: async (mapId, userId, speciesIds) => {
      if (speciesIds.length === 0) return null;
      const [row] = await db
        .select({
          id: squishies.id,
          speciesId: squishies.speciesId,
          nickname: squishies.nickname,
          level: squishies.level,
          xp: squishies.xp,
        })
        .from(squishies)
        .where(
          and(
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
            inArray(squishies.speciesId, [...speciesIds]),
          ),
        )
        .orderBy(asc(squishies.createdAt), asc(squishies.id))
        .limit(1);
      return row ?? null;
    },

    complete: async (userId, completedAt) => {
      await db
        .update(users)
        .set({ tutorialStep: null, tutorialCompletedAt: completedAt })
        .where(eq(users.id, userId));
    },

    lockMapPlayer: async (mapId) => {
      const userId = await createMapsRepo(db).tutorialPlayerOf(mapId);
      if (userId === null) return null;
      const player = await lockPlayer(userId);
      // Read the membership after the lock: a replay or skip archives it under the same lock.
      const [member] = await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(activeMember(mapId, userId));
      if (!player || !member) return null;
      return { userId, ...player };
    },
  };
}
