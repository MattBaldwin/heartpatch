import {
  BattleActionSchema,
  BattleAiPolicySchema,
  BattleChoiceSchema,
  BattleSideIdSchema,
  type BattleAiPolicy,
  type BattleChoice,
  type BattleSideId,
  BattleSideSetupSchema,
  ClientBattleViewSchema,
  RngStateSchema,
  type BattleAction,
  type BattleEvent,
  type BattleKind,
  type BattleResult,
  BattleRewardsSchema,
  type BattleRewards,
  BattleTimeOfDaySchema,
  type BattleTimeOfDay,
  type BattleSetup,
  type BattleState,
  type BattleStatus,
  ElementIdSchema,
  FeelingIdSchema,
  type ElementId,
  type FeelingId,
  type OwnedSquishy,
} from '@heartpatch/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, not, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { battles, liveBattles, mapMembers, maps, squishies, tiles } from '../../db/schema.js';
import { squishyAtWork } from '../jobs/repo.js';
import { squishyOnWatch } from '../territory/repo.js';

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
  /** What it granted the player's squishies, once finished (null before rewards were stored). */
  rewards: BattleRewards | null;
  startedAt: Date;
  endedAt: Date | null;
  /** The tile and spawn window a wild squishy came from (#14), or null. */
  spawn: BattleSpawn | null;
  /** Where it happens (the arena), or null for battles started before it was stored. */
  arena: BattleArena | null;
}

/** Where a battle happens: the terrain the client draws, and the patch's time of day then. */
export interface BattleArena {
  terrain: string;
  timeOfDay: BattleTimeOfDay;
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
  arena: BattleArena;
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
   * Who fights for the player (owner decisions 2026-10-04): their picked
   * team in slot order (active ones only), or, with nobody picked, their
   * strongest resting squishies (never guards or gatherers), at most `limit`.
   * `guardsToo` (the Tutorial Glade): squishies on watch still fight, so the
   * tutorial's battles keep the team they had before team picking.
   */
  listTeam: (
    mapId: string,
    userId: string,
    limit: number,
    options?: { guardsToo?: boolean },
  ) => Promise<TeamSquishyRow[]>;
  /** Does the player have a squishy that isn't in the Hollow (busy ones too)? */
  hasActiveSquishy: (mapId: string, userId: string) => Promise<boolean>;
  /**
   * How many finished battles each of `squishyIds` joined and won for the
   * player on this map on `at`'s map-local day (the daily battle-XP
   * falloff, `GROWTH_RULES.battleXpFalloff`). Missing ids won none.
   */
  winsToday: (
    mapId: string,
    userId: string,
    squishyIds: readonly string[],
    at: Date,
  ) => Promise<Map<string, number>>;
  /** Row-locks the squishies until commit (XP is written under it, care's `applyXp`). */
  lockSquishies: (ids: readonly string[]) => Promise<void>;
  /**
   * A new squishy for a player (befriended, a starter, the tutorial's
   * Partner, or the dev grant; every insert comes through here, which sets
   * its joining level, #205). It starts at
   * `contentment`, sliding down from `at` (its creation) like care.
   */
  insertSquishy: (squishy: {
    mapId: string;
    ownerUserId: string;
    speciesId: string;
    element: ElementId;
    feeling: FeelingId;
    level: number;
    contentment: number;
    at: Date;
  }) => Promise<OwnedSquishy>;

  insertBattle: (battle: NewBattle) => Promise<BattleRow>;
  /** A tile's terrain id, or null if the map has no such tile (the arena, `arenaFor`). */
  tileTerrain: (mapId: string, q: number, r: number) => Promise<string | null>;
  /** The player's home base tiles on the map (seven, or none before they have one). */
  homeTiles: (mapId: string, userId: string) => Promise<{ q: number; r: number }[]>;
  findBattle: (battleId: string) => Promise<BattleRow | null>;
  /**
   * Takes each player's battle seat on the map until commit (#29): a
   * transaction-scoped advisory lock per player, in id order, before any row
   * lock. Every battle start takes it for the player(s) it seats, so "one
   * battle at a time on either side" holds between a live battle's side `b`
   * and that player starting one of their own (the two unique indexes can't
   * see each other).
   */
  lockBattleSeats: (mapId: string, userIds: readonly string[]) => Promise<void>;
  /** Row-locks the battle until commit; every action runs under it. */
  lockBattle: (battleId: string) => Promise<BattleRow | null>;
  /** The player's active battle on the map, if any: as side `a`, or side `b` of a live one (#29). */
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
      rewards: BattleRewards | null;
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

/**
 * A battle's whole setup, as `replayBattle` takes it: its seed and stored
 * sides, plus a fence battle's turn limit (#203), which lives in its state.
 */
export function setupOf(row: Pick<BattleRow, 'seed' | 'setup' | 'state'>): BattleSetup {
  const { turnLimit } = row.state;
  return { seed: row.seed, sides: row.setup, ...(turnLimit !== undefined && { turnLimit }) };
}

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
    rewards: row.rewards === null ? null : BattleRewardsSchema.parse(row.rewards),
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    spawn:
      row.spawnWindow !== null && row.spawnQ !== null && row.spawnR !== null
        ? { q: row.spawnQ, r: row.spawnR, window: row.spawnWindow }
        : null,
    arena: arenaOf(row),
  };
}

/** The stored arena; a row from before it was stored (or a hand-edited one) has none. */
function arenaOf(row: RawBattleRow): BattleArena | null {
  const timeOfDay = BattleTimeOfDaySchema.safeParse(row.timeOfDay);
  if (row.terrain === null || !timeOfDay.success) return null;
  return { terrain: row.terrain, timeOfDay: timeOfDay.data };
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

    listTeam: async (mapId, userId, limit, options = {}) => {
      const columns = {
        id: squishies.id,
        speciesId: squishies.speciesId,
        level: squishies.level,
        element: squishies.element,
        feeling: squishies.feeling,
      };
      // Read when a battle starts (it's stored in the battle's setup), and when
      // a craft starts (#238: a Frost squishy on the team freezes Water faster).
      const mine = and(
        eq(squishies.mapId, mapId),
        eq(squishies.ownerUserId, userId),
        eq(squishies.state, 'active'),
        options.guardsToo ? undefined : not(squishyOnWatch()),
        not(squishyAtWork()),
        // Practicing at the Training Grounds is a job too (owner decision 2026-10-06).
        isNull(squishies.trainingBuildingId),
      );
      const picked = await db
        .select(columns)
        .from(squishies)
        .where(and(mine, isNotNull(squishies.teamSlot)))
        .orderBy(asc(squishies.teamSlot))
        .limit(limit);
      // Nobody picked (or all picked are away): the strongest resting ones, so
      // a new player is never stuck.
      const rows =
        picked.length > 0
          ? picked
          : await db
              .select(columns)
              .from(squishies)
              .where(mine)
              .orderBy(desc(squishies.level), asc(squishies.createdAt), asc(squishies.id))
              .limit(limit);
      // Content ids are plain text in the database; check them on the way out.
      return rows.map((r) => ({
        ...r,
        element: ElementIdSchema.parse(r.element),
        feeling: FeelingIdSchema.parse(r.feeling),
      }));
    },

    hasActiveSquishy: async (mapId, userId) => {
      const [row] = await db
        .select({ id: squishies.id })
        .from(squishies)
        .where(
          and(
            eq(squishies.mapId, mapId),
            eq(squishies.ownerUserId, userId),
            eq(squishies.state, 'active'),
          ),
        )
        .limit(1);
      return row !== undefined;
    },

    winsToday: async (mapId, userId, squishyIds, at) => {
      const wins = new Map<string, number>();
      if (squishyIds.length === 0) return wins;
      const rows = await db
        .select({ result: battles.result })
        .from(battles)
        .innerJoin(maps, eq(maps.id, battles.mapId))
        .where(
          and(
            eq(battles.mapId, mapId),
            eq(battles.playerUserId, userId),
            eq(battles.status, 'finished'),
            // A friendly battle (#29) earns no XP, so it never cuts a later one's.
            not(eq(battles.kind, 'friendly')),
            // The player is always side `a` (battles service, `PLAYER_SIDE`).
            sql`${battles.result} ->> 'winner' = 'a'`,
            sql`(${battles.endedAt} at time zone ${maps.timeZone})::date = (${at.toISOString()}::timestamptz at time zone ${maps.timeZone})::date`,
          ),
        );
      const wanted = new Set(squishyIds);
      for (const row of rows) {
        for (const award of ResultSchema.parse(row.result).xp) {
          if (award.side !== 'a' || !wanted.has(award.squishyId)) continue;
          wins.set(award.squishyId, (wins.get(award.squishyId) ?? 0) + 1);
        }
      }
      return wins;
    },

    lockSquishies: async (ids) => {
      if (ids.length === 0) return;
      await db
        .select({ id: squishies.id })
        .from(squishies)
        .where(inArray(squishies.id, [...ids]))
        // Id order, like nightfall's (tech spec §7 "Lock order"), so two
        // transactions locking overlapping squishies never deadlock.
        .orderBy(asc(squishies.id))
        .for('update');
    },

    insertSquishy: async ({ contentment, at, ...squishy }) => {
      const [row] = await db
        .insert(squishies)
        .values({
          ...squishy,
          // Every new squishy joins at the level it's inserted at (#205): the
          // starter at 1, a befriended one at its battle level, a dev grant at
          // the asked-for level.
          joinedLevel: squishy.level,
          // Passed explicitly (the column default stays 0, no migration);
          // `lastCaredAt` = creation, so contentment decays from here.
          contentmentAtLastCare: contentment,
          lastCaredAt: at,
          createdAt: at,
        })
        .returning();
      if (!row) throw new Error('insertSquishy: insert returned no row');
      return toSquishy(row);
    },

    insertBattle: async ({ spawn, arena, ...battle }) => {
      const [row] = await db
        .insert(battles)
        .values({
          ...battle,
          actions: [],
          status: 'active',
          spawnQ: spawn?.q ?? null,
          spawnR: spawn?.r ?? null,
          spawnWindow: spawn?.window ?? null,
          terrain: arena.terrain,
          timeOfDay: arena.timeOfDay,
        })
        .returning();
      if (!row) throw new Error('insertBattle: insert returned no row');
      return toRow(row);
    },

    tileTerrain: async (mapId, q, r) => {
      const [row] = await db
        .select({ terrain: tiles.terrain })
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.q, q), eq(tiles.r, r)));
      return row?.terrain ?? null;
    },

    homeTiles: (mapId, userId) =>
      db
        .select({ q: tiles.q, r: tiles.r })
        .from(tiles)
        .innerJoin(
          mapMembers,
          and(eq(mapMembers.mapId, tiles.mapId), eq(mapMembers.homeSlot, tiles.homeSlot)),
        )
        .where(and(eq(tiles.mapId, mapId), eq(mapMembers.userId, userId))),

    findBattle: (battleId) => one(eq(battles.id, battleId)),

    lockBattle: (battleId) => one(eq(battles.id, battleId), true),

    lockBattleSeats: async (mapId, userIds) => {
      for (const userId of [...new Set(userIds)].sort()) {
        await db.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`battle-seat:${mapId}:${userId}`}, 0))`,
        );
      }
    },

    findActive: async (mapId, userId) => {
      const [row] = await db
        .select()
        .from(battles)
        .where(
          and(
            eq(battles.mapId, mapId),
            eq(battles.status, 'active'),
            // Side `a`, or side `b` of a live battle (#29).
            or(
              eq(battles.playerUserId, userId),
              inArray(
                battles.id,
                db
                  .select({ id: liveBattles.battleId })
                  .from(liveBattles)
                  .where(
                    and(
                      eq(liveBattles.mapId, mapId),
                      eq(liveBattles.bUserId, userId),
                      eq(liveBattles.active, true),
                    ),
                  ),
              ),
            ),
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

// ── Live battles (#29) ──────────────────────────────────────────────────────

/**
 * A live battle's turn state (#29, `live_battles`): side `b`'s player, the
 * hidden picks for this turn, the deadline and what the AI covered.
 * Server-only; the client gets `LiveBattleView`, which never holds the
 * opponent's pick.
 */
export interface LiveRow {
  battleId: string;
  mapId: string;
  bUserId: string;
  active: boolean;
  picks: Partial<Record<BattleSideId, BattleChoice>>;
  deadlineAt: Date;
  graceUsed: Record<BattleSideId, boolean>;
  coverPolicy: Record<BattleSideId, BattleAiPolicy>;
  covered: LiveCover[];
}

/** A pick the AI made for a side whose time ran out. */
export interface LiveCover {
  turn: number;
  side: BattleSideId;
}

// JSON columns are checked on read, like `battles`' (repo.ts).
const PicksSchema = z.strictObject({
  a: BattleChoiceSchema.optional(),
  b: BattleChoiceSchema.optional(),
});
const CoveredSchema = z.array(
  z.strictObject({ turn: z.number().int().min(0), side: BattleSideIdSchema }),
);

type RawLiveRow = typeof liveBattles.$inferSelect;

function toLiveRow(row: RawLiveRow): LiveRow {
  return {
    battleId: row.battleId,
    mapId: row.mapId,
    bUserId: row.bUserId,
    active: row.active,
    picks: PicksSchema.parse(row.picks),
    deadlineAt: row.deadlineAt,
    graceUsed: { a: row.graceUsedA, b: row.graceUsedB },
    coverPolicy: {
      a: BattleAiPolicySchema.parse(row.coverPolicyA),
      b: BattleAiPolicySchema.parse(row.coverPolicyB),
    },
    covered: CoveredSchema.parse(row.covered),
  };
}

/** What a step changes on a live battle's row. */
export type LivePatch = Partial<Pick<LiveRow, 'picks' | 'deadlineAt' | 'graceUsed' | 'covered'>>;

export interface LiveBattlesRepo {
  insert: (row: Omit<LiveRow, 'active' | 'picks' | 'graceUsed' | 'covered'>) => Promise<void>;
  /** Read under the battle's row lock (lock order step 5): the battle lock covers it. */
  find: (battleId: string) => Promise<LiveRow | null>;
  save: (battleId: string, patch: LivePatch) => Promise<void>;
  /** The battle ended: side `b` is free to battle again, and no pick is kept. */
  end: (battleId: string) => Promise<void>;
}

export function createLiveBattlesRepo(db: Executor): LiveBattlesRepo {
  return {
    insert: async (row) => {
      await db.insert(liveBattles).values({
        battleId: row.battleId,
        mapId: row.mapId,
        bUserId: row.bUserId,
        deadlineAt: row.deadlineAt,
        coverPolicyA: row.coverPolicy.a,
        coverPolicyB: row.coverPolicy.b,
      });
    },

    find: async (battleId) => {
      const [row] = await db.select().from(liveBattles).where(eq(liveBattles.battleId, battleId));
      return row ? toLiveRow(row) : null;
    },

    save: async (battleId, patch) => {
      await db
        .update(liveBattles)
        .set({
          ...(patch.picks !== undefined && { picks: patch.picks }),
          ...(patch.deadlineAt !== undefined && { deadlineAt: patch.deadlineAt }),
          ...(patch.graceUsed !== undefined && {
            graceUsedA: patch.graceUsed.a,
            graceUsedB: patch.graceUsed.b,
          }),
          ...(patch.covered !== undefined && { covered: patch.covered }),
        })
        .where(eq(liveBattles.battleId, battleId));
    },

    end: async (battleId) => {
      await db
        .update(liveBattles)
        .set({ active: false, picks: {} })
        .where(eq(liveBattles.battleId, battleId));
    },
  };
}
