import {
  BattleActionSchema,
  BattleSideSetupSchema,
  ClientBattleViewSchema,
  RngStateSchema,
  type BattleAction,
  type BattleEvent,
  type BattleKind,
  type BattleResult,
  type BattleSetup,
  type BattleState,
  type BattleStatus,
  ElementIdSchema,
  FeelingIdSchema,
  type ElementId,
  type FeelingId,
  type OwnedSquishy,
} from '@heartpatch/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { battles, squishies } from '../../db/schema.js';

/** A `battles` row with its JSON columns typed (checked on read). */
export interface BattleRow {
  id: string;
  mapId: string;
  kind: BattleKind;
  status: BattleStatus;
  playerUserId: string;
  seed: string;
  contentHash: string;
  setup: BattleSetup['sides'];
  actions: BattleAction[];
  state: BattleState;
  result: BattleResult | null;
  log: BattleEvent[] | null;
  startedAt: Date;
  endedAt: Date | null;
  /** The tile and spawn window a wild squishy came from (#14), or null. */
  spawn: BattleSpawn | null;
}

/** Where a battle's wild squishy spawned: a tile and spawn window. */
export interface BattleSpawn {
  q: number;
  r: number;
  window: string;
}

export interface NewBattle {
  mapId: string;
  kind: BattleKind;
  playerUserId: string;
  seed: string;
  contentHash: string;
  setup: BattleSetup['sides'];
  state: BattleState;
  startedAt: Date;
  spawn: BattleSpawn | null;
}

/** A squishy as the battle service needs it (a `squishies` row). */
export interface TeamSquishyRow {
  id: string;
  speciesId: string;
  level: number;
  element: ElementId;
  feeling: FeelingId;
}

/**
 * Battle storage. Plain queries; the service decides the rules and runs each
 * command in one transaction. Map and membership reads go through the maps
 * repo (`createMapsRepo(tx)`) on the same transaction.
 */
export interface BattlesRepo {
  transaction: <T>(fn: (repo: BattlesTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /**
   * The player's active squishies on the map, strongest first, at most `limit`
   * (team picking is a later feature).
   */
  listTeam: (mapId: string, userId: string, limit: number) => Promise<TeamSquishyRow[]>;
  /** Row-locks the squishies until commit (XP is written under it, care's `applyXp`). */
  lockSquishies: (ids: readonly string[]) => Promise<void>;
  /** Dev/test only: hands a player a squishy. */
  insertSquishy: (squishy: {
    mapId: string;
    ownerUserId: string;
    speciesId: string;
    element: ElementId;
    feeling: FeelingId;
    level: number;
  }) => Promise<OwnedSquishy>;

  insertBattle: (battle: NewBattle) => Promise<BattleRow>;
  findBattle: (battleId: string) => Promise<BattleRow | null>;
  /** Row-locks the battle until commit; every action runs under it. */
  lockBattle: (battleId: string) => Promise<BattleRow | null>;
  /** The player's active battle on the map, if any. */
  findActive: (mapId: string, userId: string) => Promise<BattleRow | null>;
  /** After an action that didn't end the battle. */
  saveProgress: (
    battleId: string,
    progress: { actions: BattleAction[]; state: BattleState },
  ) => Promise<void>;
  /** The battle is over: stores the outcome and the resolved log. */
  finish: (
    battleId: string,
    outcome: {
      status: Exclude<BattleStatus, 'active'>;
      actions: BattleAction[];
      state: BattleState;
      result: BattleResult | null;
      log: BattleEvent[];
      endedAt: Date;
    },
  ) => Promise<void>;
}

/** The repo inside `transaction`: the only place it can write game events. */
export interface BattlesTxRepo extends BattlesRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

// JSON columns are checked on read, so a hand-edited or outdated row fails
// loudly instead of feeding the engine something it didn't write.
const SetupSidesSchema = z.object({ a: BattleSideSetupSchema, b: BattleSideSetupSchema });
const ActionsSchema = z.array(BattleActionSchema);
const BattleStateSchema = ClientBattleViewSchema.extend({ rng: RngStateSchema });
const ResultSchema = ClientBattleViewSchema.shape.phase.options[2].shape.result;
const LogSchema = ClientBattleViewSchema.shape.log;

type RawBattleRow = typeof battles.$inferSelect;

function toRow(row: RawBattleRow): BattleRow {
  return {
    id: row.id,
    mapId: row.mapId,
    kind: row.kind,
    status: row.status,
    playerUserId: row.playerUserId,
    seed: row.seed,
    contentHash: row.contentHash,
    setup: SetupSidesSchema.parse(row.setup),
    actions: ActionsSchema.parse(row.actions),
    state: BattleStateSchema.parse(row.state),
    result: row.result === null ? null : ResultSchema.parse(row.result),
    log: row.log === null ? null : LogSchema.parse(row.log),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    spawn:
      row.spawnWindow !== null && row.spawnQ !== null && row.spawnR !== null
        ? { q: row.spawnQ, r: row.spawnR, window: row.spawnWindow }
        : null,
  };
}

const toSquishy = (row: typeof squishies.$inferSelect): OwnedSquishy => ({
  id: row.id,
  mapId: row.mapId,
  ownerUserId: row.ownerUserId,
  speciesId: row.speciesId,
  element: ElementIdSchema.parse(row.element),
  feeling: FeelingIdSchema.parse(row.feeling),
  nickname: row.nickname,
  level: row.level,
  xp: row.xp,
  state: row.state,
});

export function createBattlesRepo(db: Executor): BattlesRepo {
  return queries(db);
}

function createBattlesTxRepo(tx: Transaction): BattlesTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): BattlesRepo {
  const one = async (where: ReturnType<typeof eq>, lock = false): Promise<BattleRow | null> => {
    const query = db.select().from(battles).where(where);
    const [row] = lock ? await query.for('update') : await query;
    return row ? toRow(row) : null;
  };

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createBattlesTxRepo(tx), tx)),

    listTeam: async (mapId, userId, limit) => {
      const rows = await db
        .select({
          id: squishies.id,
          speciesId: squishies.speciesId,
          level: squishies.level,
          element: squishies.element,
          feeling: squishies.feeling,
        })
        .from(squishies)
        .where(
          and(
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
            eq(squishies.state, 'active'),
          ),
        )
        .orderBy(desc(squishies.level), asc(squishies.createdAt), asc(squishies.id))
        .limit(limit);
      // Content ids are plain text in the database; check them on the way out.
      return rows.map((r) => ({
        ...r,
        element: ElementIdSchema.parse(r.element),
        feeling: FeelingIdSchema.parse(r.feeling),
      }));
    },

    lockSquishies: async (ids) => {
      if (ids.length === 0) return;
      await db
        .select({ id: squishies.id })
        .from(squishies)
        .where(inArray(squishies.id, [...ids]))
        .for('update');
    },

    insertSquishy: async (squishy) => {
      const [row] = await db.insert(squishies).values(squishy).returning();
      if (!row) throw new Error('insertSquishy: insert returned no row');
      return toSquishy(row);
    },

    insertBattle: async ({ spawn, ...battle }) => {
      const [row] = await db
        .insert(battles)
        .values({
          ...battle,
          actions: [],
          status: 'active',
          spawnQ: spawn?.q ?? null,
          spawnR: spawn?.r ?? null,
          spawnWindow: spawn?.window ?? null,
        })
        .returning();
      if (!row) throw new Error('insertBattle: insert returned no row');
      return toRow(row);
    },

    findBattle: (battleId) => one(eq(battles.id, battleId)),

    lockBattle: (battleId) => one(eq(battles.id, battleId), true),

    findActive: async (mapId, userId) => {
      const [row] = await db
        .select()
        .from(battles)
        .where(
          and(
            eq(battles.mapId, mapId),
            eq(battles.playerUserId, userId),
            eq(battles.status, 'active'),
          ),
        );
      return row ? toRow(row) : null;
    },

    saveProgress: async (battleId, progress) => {
      await db.update(battles).set(progress).where(eq(battles.id, battleId));
    },

    finish: async (battleId, outcome) => {
      await db.update(battles).set(outcome).where(eq(battles.id, battleId));
    },
  };
}
