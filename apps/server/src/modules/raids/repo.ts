import type { DefenseStance, RaidOutcome } from '@heartpatch/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { battles, mapMembers, raids, tileAttacks, tiles, users } from '../../db/schema.js';
import { activeMember } from '../maps/repo.js';

/** A `raids` row, with its tile and whether its battle can still be replayed. */
export interface RaidRow {
  id: string;
  mapId: string;
  battleId: string;
  attackerUserId: string;
  attackerName: string;
  defenderUserId: string;
  q: number;
  r: number;
  outcome: RaidOutcome;
  reason: string;
  stance: DefenseStance | null;
  resolvedAt: Date;
  seenAt: Date | null;
  /** The battle's status and content hash, for "can it be replayed?". */
  battleStatus: (typeof battles.$inferSelect)['status'];
  contentHash: string;
  /** My fire there came down with the capture (#202): what came back. */
  lostFire: Record<string, number> | null;
}

export interface NewRaid {
  mapId: string;
  battleId: string;
  tileId: string;
  attackerUserId: string;
  defenderUserId: string;
  outcome: RaidOutcome;
  reason: string;
  stance: DefenseStance | null;
  resolvedAt: Date;
}

/** A challenge's attempt-log row, as the raid log needs it. */
export interface ChallengeRow {
  tileId: string;
  q: number;
  r: number;
  attackerUserId: string;
  defenderUserId: string | null;
  outcome: (typeof tileAttacks.$inferSelect)['outcome'];
}

/**
 * Raid log storage (#16): `raids` and the defender's stance on
 * `map_members`. Plain queries; the service and the consumer decide the rules.
 */
export interface RaidsRepo {
  transaction: <T>(fn: (repo: RaidsTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** The tile battle's attempt-log row (#15) and its tile, or null. */
  challengeFor: (battleId: string) => Promise<ChallengeRow | null>;
  /** Writes the raid once per battle; null if it was already there (a re-run). */
  insertRaid: (raid: NewRaid) => Promise<{ id: string } | null>;
  /** The defender's latest raids on the map, newest first. */
  listFor: (mapId: string, defenderUserId: string, limit: number) => Promise<RaidRow[]>;
  findRaid: (raidId: string) => Promise<RaidRow | null>;
  /** Marks these raids of the defender's seen (once; a second call changes nothing). */
  markSeen: (
    mapId: string,
    defenderUserId: string,
    raidIds: readonly string[],
    at: Date,
  ) => Promise<void>;

  /** The member's stance, or null if they're not an active member. */
  stanceOf: (mapId: string, userId: string) => Promise<DefenseStance | null>;
  /**
   * Row-locks the active member's row (`for no key update`, the lock a
   * challenge's start takes) and sets their stance. False if not a member.
   */
  setStance: (mapId: string, userId: string, stance: DefenseStance) => Promise<boolean>;
}

export interface RaidsTxRepo extends RaidsRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const raidColumns = {
  id: raids.id,
  mapId: raids.mapId,
  battleId: raids.battleId,
  attackerUserId: raids.attackerUserId,
  attackerName: users.username,
  defenderUserId: raids.defenderUserId,
  q: tiles.q,
  r: tiles.r,
  outcome: raids.outcome,
  reason: raids.reason,
  stance: raids.stance,
  resolvedAt: raids.resolvedAt,
  seenAt: raids.seenAt,
  battleStatus: battles.status,
  contentHash: battles.contentHash,
  // The capture took my fire down (#202): what came back.
  lostFire: tileAttacks.lostFireRefund,
};

export function createRaidsRepo(db: Executor): RaidsRepo {
  return queries(db);
}

export function createRaidsTxRepo(tx: Transaction): RaidsTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): RaidsRepo {
  const raidsWhere = (where: ReturnType<typeof and>) =>
    db
      .select(raidColumns)
      .from(raids)
      .innerJoin(tiles, eq(tiles.id, raids.tileId))
      .innerJoin(battles, eq(battles.id, raids.battleId))
      .innerJoin(users, eq(users.id, raids.attackerUserId))
      .leftJoin(tileAttacks, eq(tileAttacks.battleId, raids.battleId))
      .where(where);

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createRaidsTxRepo(tx), tx)),

    challengeFor: async (battleId) => {
      const [row] = await db
        .select({
          tileId: tileAttacks.tileId,
          q: tiles.q,
          r: tiles.r,
          attackerUserId: tileAttacks.attackerUserId,
          defenderUserId: tileAttacks.defenderUserId,
          outcome: tileAttacks.outcome,
        })
        .from(tileAttacks)
        .innerJoin(tiles, eq(tiles.id, tileAttacks.tileId))
        .where(eq(tileAttacks.battleId, battleId));
      return row ?? null;
    },

    insertRaid: async (raid) => {
      const [row] = await db
        .insert(raids)
        .values(raid)
        .onConflictDoNothing({ target: raids.battleId })
        .returning({ id: raids.id });
      return row ?? null;
    },

    listFor: (mapId, defenderUserId, limit) =>
      raidsWhere(and(eq(raids.mapId, mapId), eq(raids.defenderUserId, defenderUserId)))
        .orderBy(desc(raids.resolvedAt), desc(raids.id))
        .limit(limit),

    findRaid: async (raidId) => {
      const [row] = await raidsWhere(eq(raids.id, raidId));
      return row ?? null;
    },

    markSeen: async (mapId, defenderUserId, raidIds, at) => {
      if (raidIds.length === 0) return;
      await db
        .update(raids)
        .set({ seenAt: at })
        .where(
          and(
            eq(raids.mapId, mapId),
            eq(raids.defenderUserId, defenderUserId),
            inArray(raids.id, [...raidIds]),
            isNull(raids.seenAt),
          ),
        );
    },

    stanceOf: async (mapId, userId) => {
      const [row] = await db
        .select({ stance: mapMembers.defenseStance })
        .from(mapMembers)
        .where(activeMember(mapId, userId));
      return row?.stance ?? null;
    },

    setStance: async (mapId, userId, stance) => {
      const [locked] = await db
        .select({ userId: mapMembers.userId })
        .from(mapMembers)
        .where(activeMember(mapId, userId))
        .for('no key update');
      if (!locked) return false;
      await db.update(mapMembers).set({ defenseStance: stance }).where(activeMember(mapId, userId));
      return true;
    },
  };
}
