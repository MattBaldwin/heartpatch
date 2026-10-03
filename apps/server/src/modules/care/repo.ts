import {
  ElementIdSchema,
  FeelingIdSchema,
  type ElementId,
  type FeelingId,
} from '@heartpatch/shared';
import { and, asc, desc, eq, gt, inArray, isNull, max, sql, sum } from 'drizzle-orm';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { squishyOnWatch } from '../territory/repo.js';
import { buildings, careLog, squishies, squishyEvolutions, users } from '../../db/schema.js';

/** A squishy as care and growth need it (a `squishies` row). */
export interface CareSquishyRow {
  id: string;
  mapId: string;
  ownerUserId: string;
  speciesId: string;
  element: ElementId;
  feeling: FeelingId;
  nickname: string | null;
  level: number;
  xp: number;
  state: 'active' | 'hollowed';
  habitatBuildingId: string | null;
  /**
   * Standing watch on its owner's land (decision C). A squishy is housed or
   * on watch, not both (owner decision 2026-10-03): one that is both, from
   * before that rule, counts as on watch only, so its habitat gives no bonus.
   */
  onWatch: boolean;
  contentmentAtLastCare: number;
  lastCaredAt: Date | null;
}

export interface NewCare {
  mapId: string;
  userId: string;
  squishyId: string;
  action: string;
  day: string;
  gained: number;
  full: boolean;
  coins: number;
  caredAt: Date;
}

export interface EvolutionRow {
  squishyId: string;
  fromSpeciesId: string;
  intoSpeciesId: string;
  level: number;
  evolvedAt: Date;
}

/**
 * Care and growth storage (#19). Plain queries; the service decides the
 * rules and runs each command in one transaction. Lock order for a care
 * action: the account (the maps repo's `lockUser`, so the daily coin cap
 * can't race across squishies or patches), the squishy, inventory rows (`consumeItems`), the
 * account's coin balance (`creditCoins`, #45), then `maps` (the event). XP from battles locks the squishies (under the battle
 * row) and never the account.
 */
export interface CareRepo {
  transaction: <T>(fn: (repo: CareTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** The account's IANA time zone (its day for daily caps), or null if there's no such user. */
  timeZoneOf: (userId: string) => Promise<string | null>;

  /** The player's active squishies on this map, oldest first. */
  listActive: (mapId: string, userId: string) => Promise<CareSquishyRow[]>;
  findSquishy: (squishyId: string) => Promise<CareSquishyRow | null>;
  /** Row-locks a squishy until commit. */
  lockSquishy: (squishyId: string) => Promise<CareSquishyRow | null>;
  /** The content id of each habitat building (`buildings.building_id`), by row id. */
  habitatBuildingIds: (buildingRowIds: readonly string[]) => Promise<Map<string, string>>;

  /** Care actions per squishy on `day`. */
  countCareOn: (squishyIds: readonly string[], day: string) => Promise<Map<string, number>>;
  /** When each action was last done on each squishy since `since` (`squishyId` → action → when). */
  lastCare: (squishyIds: readonly string[], since: Date) => Promise<Map<string, Map<string, Date>>>;
  /** Patch Coins care earned the account on `day`, across every patch. */
  coinsOn: (userId: string, day: string) => Promise<number>;
  insertCare: (care: NewCare) => Promise<string>;
  setContentment: (squishyId: string, contentment: number, at: Date) => Promise<void>;
  /** A new nickname, or null for the species name (#20). */
  setNickname: (squishyId: string, nickname: string | null) => Promise<void>;

  setGrowth: (
    squishyId: string,
    growth: { xp: number; level: number; speciesId: string; element: ElementId },
  ) => Promise<void>;
  insertEvolution: (evolution: EvolutionRow & { mapId: string }) => Promise<void>;
  /** The newest evolution each squishy's owner hasn't seen celebrated yet. */
  unseenEvolutions: (squishyIds: readonly string[]) => Promise<Map<string, EvolutionRow>>;
  markEvolutionsSeen: (squishyId: string, at: Date) => Promise<void>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface CareTxRepo extends CareRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const squishyColumns = {
  id: squishies.id,
  mapId: squishies.mapId,
  ownerUserId: squishies.ownerUserId,
  speciesId: squishies.speciesId,
  element: squishies.element,
  feeling: squishies.feeling,
  nickname: squishies.nickname,
  level: squishies.level,
  xp: squishies.xp,
  state: squishies.state,
  habitatBuildingId: squishies.habitatBuildingId,
  onWatch: squishyOnWatch(),
  contentmentAtLastCare: squishies.contentmentAtLastCare,
  lastCaredAt: squishies.lastCaredAt,
};

// Text columns are checked on read, so a hand-edited row fails loudly.
const toSquishy = <T extends { element: string; feeling: string }>(row: T) => ({
  ...row,
  element: ElementIdSchema.parse(row.element),
  feeling: FeelingIdSchema.parse(row.feeling),
});

export function createCareRepo(db: Executor): CareRepo {
  return queries(db);
}

function createCareTxRepo(tx: Transaction): CareTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): CareRepo {
  const oneSquishy = async (squishyId: string, lock: boolean) => {
    const query = db.select(squishyColumns).from(squishies).where(eq(squishies.id, squishyId));
    const [row] = lock ? await query.for('update') : await query;
    return row ? toSquishy(row) : null;
  };

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createCareTxRepo(tx), tx)),

    timeZoneOf: async (userId) => {
      const [row] = await db
        .select({ timeZone: users.timeZone })
        .from(users)
        .where(eq(users.id, userId));
      return row?.timeZone ?? null;
    },

    listActive: async (mapId, userId) => {
      const rows = await db
        .select(squishyColumns)
        .from(squishies)
        .where(
          and(
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
            eq(squishies.state, 'active'),
          ),
        )
        .orderBy(asc(squishies.createdAt), asc(squishies.id));
      return rows.map(toSquishy);
    },

    findSquishy: (squishyId) => oneSquishy(squishyId, false),

    lockSquishy: (squishyId) => oneSquishy(squishyId, true),

    habitatBuildingIds: async (buildingRowIds) => {
      if (buildingRowIds.length === 0) return new Map();
      const rows = await db
        .select({ id: buildings.id, buildingId: buildings.buildingId })
        .from(buildings)
        .where(inArray(buildings.id, [...buildingRowIds]));
      return new Map(rows.map((r) => [r.id, r.buildingId]));
    },

    countCareOn: async (squishyIds, day) => {
      if (squishyIds.length === 0) return new Map();
      const rows = await db
        .select({ squishyId: careLog.squishyId, n: sql<number>`count(*)::int` })
        .from(careLog)
        .where(and(inArray(careLog.squishyId, [...squishyIds]), eq(careLog.day, day)))
        .groupBy(careLog.squishyId);
      return new Map(rows.map((r) => [r.squishyId, r.n]));
    },

    lastCare: async (squishyIds, since) => {
      const byId = new Map<string, Map<string, Date>>();
      if (squishyIds.length === 0) return byId;
      const rows = await db
        .select({ squishyId: careLog.squishyId, action: careLog.action, at: max(careLog.caredAt) })
        .from(careLog)
        .where(and(inArray(careLog.squishyId, [...squishyIds]), gt(careLog.caredAt, since)))
        .groupBy(careLog.squishyId, careLog.action);
      for (const row of rows) {
        if (!row.at) continue;
        const actions = byId.get(row.squishyId) ?? new Map<string, Date>();
        actions.set(row.action, row.at);
        byId.set(row.squishyId, actions);
      }
      return byId;
    },

    coinsOn: async (userId, day) => {
      const [row] = await db
        .select({ coins: sum(careLog.coins).mapWith(Number) })
        .from(careLog)
        .where(and(eq(careLog.userId, userId), eq(careLog.day, day)));
      return row?.coins ?? 0;
    },

    insertCare: async (care) => {
      const [row] = await db.insert(careLog).values(care).returning({ id: careLog.id });
      if (!row) throw new Error('insertCare: insert returned no row');
      return row.id;
    },

    setContentment: async (squishyId, contentment, at) => {
      await db
        .update(squishies)
        .set({ contentmentAtLastCare: contentment, lastCaredAt: at })
        .where(eq(squishies.id, squishyId));
    },

    setNickname: async (squishyId, nickname) => {
      await db.update(squishies).set({ nickname }).where(eq(squishies.id, squishyId));
    },

    setGrowth: async (squishyId, growth) => {
      await db.update(squishies).set(growth).where(eq(squishies.id, squishyId));
    },

    insertEvolution: async (evolution) => {
      await db.insert(squishyEvolutions).values(evolution);
    },

    unseenEvolutions: async (squishyIds) => {
      if (squishyIds.length === 0) return new Map();
      const rows = await db
        .select({
          squishyId: squishyEvolutions.squishyId,
          fromSpeciesId: squishyEvolutions.fromSpeciesId,
          intoSpeciesId: squishyEvolutions.intoSpeciesId,
          level: squishyEvolutions.level,
          evolvedAt: squishyEvolutions.evolvedAt,
        })
        .from(squishyEvolutions)
        .where(
          and(
            inArray(squishyEvolutions.squishyId, [...squishyIds]),
            isNull(squishyEvolutions.seenAt),
          ),
        )
        .orderBy(desc(squishyEvolutions.evolvedAt), desc(squishyEvolutions.id));
      const newest = new Map<string, EvolutionRow>();
      for (const row of rows) if (!newest.has(row.squishyId)) newest.set(row.squishyId, row);
      return newest;
    },

    markEvolutionsSeen: async (squishyId, at) => {
      await db
        .update(squishyEvolutions)
        .set({ seenAt: at })
        .where(and(eq(squishyEvolutions.squishyId, squishyId), isNull(squishyEvolutions.seenAt)));
    },
  };
}
