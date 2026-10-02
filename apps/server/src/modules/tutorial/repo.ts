import { and, desc, eq } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { mapMembers, maps, users } from '../../db/schema.js';

/** A player's tutorial columns (`users`). */
export interface TutorialProgress {
  /** Current step id while a run is going; null otherwise. */
  tutorialStep: string | null;
  /** First completion; replaying never clears it. */
  tutorialCompletedAt: Date | null;
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

    complete: async (userId, completedAt) => {
      await db
        .update(users)
        .set({ tutorialStep: null, tutorialCompletedAt: completedAt })
        .where(eq(users.id, userId));
    },

    lockMapPlayer: async (mapId) => {
      const [owner] = await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .innerJoin(maps, eq(maps.id, mapMembers.mapId))
        .where(
          and(eq(mapMembers.mapId, mapId), eq(mapMembers.role, 'owner'), eq(maps.kind, 'tutorial')),
        );
      if (!owner) return null;
      const player = await lockPlayer(owner.userId);
      // Read the membership after the lock: a replay or skip archives it under the same lock.
      const [member] = await db
        .select({ status: mapMembers.status })
        .from(mapMembers)
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, owner.userId)));
      if (!player || member?.status !== 'active') return null;
      return { userId: owner.userId, ...player };
    },
  };
}
