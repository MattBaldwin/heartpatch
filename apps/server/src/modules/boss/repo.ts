import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { Hex } from '@heartpatch/shared';
import type { BossTileCandidate } from '@heartpatch/shared/server';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  battles,
  bossBarChips,
  bossBars,
  bossBonds,
  bossEncounters,
  bossWindows,
  buildings,
  mapMembers,
  maps,
  patchTrees,
  speciesSeen,
  squishies,
  tiles,
  users,
} from '../../db/schema.js';
import { activeMember } from '../maps/repo.js';
import { heartSeeds } from '../territory/supply.js';

/** Juniper's Gap's tiles (`MAP_GEN.gapTerrain`) and trading posts are never a boss's ground. */
const GAP_TERRAIN = 'junipers-gap';
const NOT_GROUND = ['trading-post', GAP_TERRAIN];
/** Twinkle Lights' building kind (#37 C0): a lit tile warms the Christmas Eve bar up. */
const LIGHTS = 'lights';

export type BossWindowRow = typeof bossWindows.$inferSelect;
export type BossEncounterRow = typeof bossEncounters.$inferSelect;
export type BossBondRow = typeof bossBonds.$inferSelect;
export type BossBarDbRow = typeof bossBars.$inferSelect;
export type NewBossBar = typeof bossBars.$inferInsert;

/** A patch as the boss schedule reads it: its seed is server-only. */
export interface BossMapRow {
  id: string;
  seed: string;
  timeZone: string;
  longNightWeekday: number | null;
  /** The patch owner's username (the mini-boss switch, #234), or null with no owner. */
  ownerUsername: string | null;
}

export interface BossRepo extends BossBarRepo {
  transaction: <T>(fn: (repo: BossTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
  /** One patch map with a seed (a hand-made map has none, so no boss), or null. */
  findMap: (mapId: string) => Promise<BossMapRow | null>;
  /** Every patch map with a seed, in id order (the sweep). */
  listMaps: () => Promise<BossMapRow[]>;
  findWindow: (mapId: string, windowId: string) => Promise<BossWindowRow | null>;
  /** Inserts a visit once; null if it was already there (the insert is the idempotency). */
  insertWindow: (row: BossWindowRow) => Promise<BossWindowRow | null>;
  /**
   * Christmas Eve (#37 X1): turns the week's pinned weekly visit into the
   * Eve visit (kind, boss, close; the tile stays), once: null if it isn't a
   * weekly row any more. `opens_at` stays the weekly one, so the week's
   * fights (`visitOf`, by start time) still belong to this row. Its
   * Keepers' goes at the weekly boss are reset (win and asks cleared, the
   * idle clock kept), so everyone meets the Eve visit fresh. Only a visit
   * pinned before X1 shipped is ever converted.
   */
  convertToChristmasEve: (
    mapId: string,
    windowId: string,
    visit: Pick<BossWindowRow, 'speciesId' | 'endsAt'>,
  ) => Promise<BossWindowRow | null>;
  /** The patch's Christmas Eve visit out at `at` (`MapView.christmas.eve`), or null. */
  findChristmasEve: (mapId: string, at: Date) => Promise<BossWindowRow | null>;
  /**
   * The latest Christmas Eve visit on the patch whose thanks this Keeper was
   * paid after `since` (#37 X5a: their thanks outlives the visit's close
   * while its asks are open), or null.
   */
  findThankedEve: (mapId: string, userId: string, since: Date) => Promise<BossWindowRow | null>;
  /**
   * The Keeper's latest finished mini-boss fight that started in `[from,
   * until)` (#37 X5a: the Eve fight their thanks' asks go on), or null.
   */
  lastFinishedFight: (
    mapId: string,
    userId: string,
    from: Date,
    until: Date,
  ) => Promise<string | null>;
  /** The highest Partner level among the patch's active members, or null. */
  topPartnerLevel: (mapId: string) => Promise<number | null>;
  /** Neutral land a boss could stand on, and Juniper's Gap's tiles as the fallback. */
  groundTiles: (
    mapId: string,
  ) => Promise<{ neutral: BossTileCandidate[]; gap: BossTileCandidate[] }>;
  /** Each active member's Heart Seed. */
  homes: (mapId: string) => Promise<Hex[]>;
  /** Mini-boss fights the Keeper started since `since` that weren't called off (tries). */
  triesSince: (mapId: string, userId: string, since: Date) => Promise<number>;
  /**
   * Whether the Keeper already won another mini-boss fight that started in
   * `[from, until)` on this patch (#37 X2b: the Eve pays its win once). Reads
   * finished battles, so the caller holds the lock that orders those finishes.
   */
  wonOtherBetween: (
    mapId: string,
    userId: string,
    from: Date,
    until: Date,
    battleId: string,
  ) => Promise<boolean>;
  findEncounter: (
    mapId: string,
    userId: string,
    windowId: string,
  ) => Promise<typeof bossEncounters.$inferSelect | null>;
  /** The Keeper's first fight with this visit: their row, once. */
  insertEncounter: (mapId: string, userId: string, windowId: string, at: Date) => Promise<void>;
  /**
   * A won fight ends the visit for its Keeper (#190): the visit it started
   * in gets the battle's id, once. A no-op if they already won it.
   */
  markWon: (mapId: string, userId: string, startedAt: Date, battleId: string) => Promise<void>;
  /** The Keeper stepped a fight (#190 plan §12): its visit's idle clock starts again. */
  touch: (mapId: string, userId: string, startedAt: Date, at: Date) => Promise<void>;
  /** When the Keeper last started or stepped a fight in the visit `startedAt` fell in, or null. */
  lastActionAt: (mapId: string, userId: string, startedAt: Date) => Promise<Date | null>;
  /** Has the Keeper met this species (catalog seen)? */
  hasSeen: (mapId: string, userId: string, speciesId: string) => Promise<boolean>;
  /** The visit this Keeper's mini-boss battle started in, or null (not theirs, not a boss fight). */
  visitOfBattle: (battleId: string, userId: string) => Promise<BossWindowRow | null>;
  /** The visit a fight started in (the latest window opened by then), or null. */
  visitOf: (mapId: string, startedAt: Date) => Promise<BossWindowRow | null>;
  /** The Keeper's row for the visit this battle won, or null (befriend reads it unlocked for the view). */
  findWonEncounter: (
    mapId: string,
    userId: string,
    battleId: string,
  ) => Promise<BossEncounterRow | null>;
  /** The same row `FOR UPDATE` (tech spec §7 step 5e, after the battle): one ask at a time. */
  lockWonEncounter: (
    mapId: string,
    userId: string,
    battleId: string,
  ) => Promise<BossEncounterRow | null>;
  /** The befriend asks after a win (server-only record: chance, roll, warmth). */
  setAsks: (mapId: string, userId: string, windowId: string, asks: unknown[]) => Promise<void>;
  findBond: (mapId: string, userId: string, speciesId: string) => Promise<BossBondRow | null>;
  /**
   * The Keeper's bond with this boss kind, made at 0 misses if new, and
   * locked (step 5e, after the visit row).
   */
  lockBond: (mapId: string, userId: string, speciesId: string) => Promise<BossBondRow>;
  /** A "not yet": one more miss (warmth) on the bond. */
  addMiss: (mapId: string, userId: string, speciesId: string) => Promise<void>;
  /** A yes: the bond holds the friend, and stays "friends" even if it's traded or let go. */
  befriended: (
    mapId: string,
    userId: string,
    speciesId: string,
    squishyId: string,
    at: Date,
  ) => Promise<void>;
}

export interface BossBarRepo {
  /**
   * The visit a fight started in, `FOR SHARE` (#37 X2): a finish takes it
   * right after the battle's lock (tech spec §7 step 5e), so a weekly row's
   * conversion to the Eve (which updates it) can't commit between the read
   * and what the finish does with it.
   */
  shareVisitOf: (mapId: string, startedAt: Date) => Promise<BossWindowRow | null>;
  findBar: (mapId: string, windowId: string) => Promise<BossBarDbRow | null>;
  /** The bar `FOR UPDATE` (step 5e, after its `boss_windows` row): one chip at a time. */
  lockBar: (mapId: string, windowId: string) => Promise<BossBarDbRow | null>;
  /** Opens a visit's bar once; null if it was already there. */
  insertBar: (row: NewBossBar) => Promise<BossBarDbRow | null>;
  /** Writes a locked bar's new total and state. */
  setBar: (
    mapId: string,
    windowId: string,
    bar: Pick<BossBarDbRow, 'chipped' | 'state' | 'fellAt'>,
  ) => Promise<void>;
  /** A finished fight's chip, once per battle (`boss_bar_chips_battle_id_key`); false on a retry. */
  insertChip: (chip: {
    mapId: string;
    windowId: string;
    userId: string;
    battleId: string;
    points: number;
    createdAt: Date;
  }) => Promise<boolean>;
  /** How many Keepers chipped the visit's bar (#37 X5a): a count, never who. */
  chippers: (mapId: string, windowId: string) => Promise<number>;
  /** Fights this Keeper finished on the visit before `before` (who shares the fall). */
  chipsBy: (mapId: string, windowId: string, userId: string, before: Date) => Promise<number>;
  /** Keepers with at least `minFights` chips before `before` whose thanks isn't paid yet. */
  unthanked: (
    mapId: string,
    windowId: string,
    before: Date,
    minFights: number,
  ) => Promise<string[]>;
  /**
   * Stamps the Keeper's thanks on their visit row, once (`thanked_at IS
   * NULL`): false if it was already paid. The row lock is the uniqueness.
   */
  markThanked: (mapId: string, userId: string, windowId: string, at: Date) => Promise<boolean>;
  /** The Keeper's row for a visit `FOR UPDATE` (a Christmas Eve ask, step 5e after the battle). */
  lockEncounter: (
    mapId: string,
    userId: string,
    windowId: string,
  ) => Promise<BossEncounterRow | null>;
  /**
   * Bars due a settle: open past their close (they doze), or settled with a
   * contributor (`minFights` chips before the close) whose thanks is unpaid.
   */
  barsToSettle: (at: Date, minFights: number) => Promise<BossBarDbRow[]>;
  /** Active real Keepers on the patch (the goal): computer patch-mates never fight. */
  activeKeepers: (mapId: string) => Promise<number>;
  /** Tiles with Twinkle Lights on them (`buildings.kind` `lights`), for the head start. */
  litLights: (mapId: string) => Promise<number>;
  /** Whether the patch's Patch Tree star is lit. */
  starLit: (mapId: string) => Promise<boolean>;
  /**
   * Dev only (`POST /maps/:mapId/dev/christmas-eve-now`): makes the week's
   * row a Christmas Eve visit from `opensAt` (its own `opens_at` never moves
   * later, so the week's fights keep their row), resets every Keeper's go
   * and thanks, and drops the old bar and its chips.
   */
  devEveNow: (
    row: Pick<BossWindowRow, 'mapId' | 'windowId' | 'speciesId' | 'q' | 'r' | 'opensAt' | 'endsAt'>,
  ) => Promise<BossWindowRow>;
}

export interface BossTxRepo extends BossRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const mapColumns = {
  id: maps.id,
  seed: maps.seed,
  timeZone: maps.timeZone,
  longNightWeekday: maps.longNightWeekday,
  ownerUsername: users.username,
};
// The owner's seat (at most one per map, `map_members_one_owner_key`). Its
// `status` is ignored on purpose: the switch follows who owns the patch.
const ownerSeat = and(eq(mapMembers.mapId, maps.id), eq(mapMembers.role, 'owner'));

const withSeed = (
  rows: {
    id: string;
    seed: string | null;
    timeZone: string;
    longNightWeekday: number | null;
    ownerUsername: string | null;
  }[],
) => rows.flatMap((r) => (r.seed === null ? [] : [{ ...r, seed: r.seed }]));

export function createBossRepo(db: Executor): BossRepo {
  /** The visit a fight started in: the latest window opened by then. */
  const visitOf = async (mapId: string, startedAt: Date) => {
    const [visit] = await db
      .select()
      .from(bossWindows)
      .where(and(eq(bossWindows.mapId, mapId), lte(bossWindows.opensAt, startedAt)))
      .orderBy(desc(bossWindows.opensAt))
      .limit(1);
    return visit ?? null;
  };
  // By the primary key's prefix, then the battle (no index on `won_battle_id`).
  const wonEncounter = (mapId: string, userId: string, battleId: string) =>
    db
      .select()
      .from(bossEncounters)
      .where(
        and(
          eq(bossEncounters.mapId, mapId),
          eq(bossEncounters.userId, userId),
          eq(bossEncounters.wonBattleId, battleId),
        ),
      );
  const barKey = (mapId: string, windowId: string) =>
    and(eq(bossBars.mapId, mapId), eq(bossBars.windowId, windowId));
  const bondKey = (mapId: string, userId: string, speciesId: string) =>
    and(
      eq(bossBonds.mapId, mapId),
      eq(bossBonds.userId, userId),
      eq(bossBonds.speciesId, speciesId),
    );
  return {
    transaction: (fn) =>
      withTransaction(db, (tx) =>
        fn({ ...createBossRepo(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
      ),

    findMap: async (mapId) => {
      const rows = await db
        .select(mapColumns)
        .from(maps)
        .leftJoin(mapMembers, ownerSeat)
        .leftJoin(users, eq(users.id, mapMembers.userId))
        .where(and(eq(maps.id, mapId), eq(maps.kind, 'multiplayer')));
      return withSeed(rows)[0] ?? null;
    },

    listMaps: async () =>
      withSeed(
        await db
          .select(mapColumns)
          .from(maps)
          .leftJoin(mapMembers, ownerSeat)
          .leftJoin(users, eq(users.id, mapMembers.userId))
          .where(and(eq(maps.kind, 'multiplayer'), isNotNull(maps.seed)))
          .orderBy(maps.id),
      ),

    findWindow: async (mapId, windowId) => {
      const [row] = await db
        .select()
        .from(bossWindows)
        .where(and(eq(bossWindows.mapId, mapId), eq(bossWindows.windowId, windowId)));
      return row ?? null;
    },

    insertWindow: async (row) => {
      const [inserted] = await db.insert(bossWindows).values(row).onConflictDoNothing().returning();
      return inserted ?? null;
    },

    convertToChristmasEve: async (mapId, windowId, visit) => {
      const [row] = await db
        .update(bossWindows)
        .set({ ...visit, kind: 'christmas-eve' })
        .where(
          and(
            eq(bossWindows.mapId, mapId),
            eq(bossWindows.windowId, windowId),
            eq(bossWindows.kind, 'weekly'),
          ),
        )
        .returning();
      if (!row) return null;
      // Reset, not deleted: `last_action_at` stays, so a weekly fight still
      // going at the conversion keeps its idle clock and isn't forfeited.
      await db
        .update(bossEncounters)
        .set({ wonBattleId: null, asks: [] })
        .where(and(eq(bossEncounters.mapId, mapId), eq(bossEncounters.windowId, windowId)));
      return row;
    },

    findChristmasEve: async (mapId, at) => {
      const [row] = await db
        .select()
        .from(bossWindows)
        .where(
          and(
            eq(bossWindows.mapId, mapId),
            eq(bossWindows.kind, 'christmas-eve'),
            lte(bossWindows.opensAt, at),
            gt(bossWindows.endsAt, at),
          ),
        );
      return row ?? null;
    },

    findThankedEve: async (mapId, userId, since) => {
      const [row] = await db
        .select({ window: bossWindows })
        .from(bossWindows)
        .innerJoin(
          bossEncounters,
          and(
            eq(bossEncounters.mapId, bossWindows.mapId),
            eq(bossEncounters.windowId, bossWindows.windowId),
            eq(bossEncounters.userId, userId),
          ),
        )
        .where(
          and(
            eq(bossWindows.mapId, mapId),
            eq(bossWindows.kind, 'christmas-eve'),
            gt(bossEncounters.thankedAt, since),
          ),
        )
        .orderBy(desc(bossWindows.opensAt))
        .limit(1);
      return row?.window ?? null;
    },

    lastFinishedFight: async (mapId, userId, from, until) => {
      const [row] = await db
        .select({ id: battles.id })
        .from(battles)
        .where(
          and(
            eq(battles.mapId, mapId),
            eq(battles.playerUserId, userId),
            eq(battles.kind, 'miniboss'),
            eq(battles.status, 'finished'),
            gte(battles.startedAt, from),
            lt(battles.startedAt, until),
          ),
        )
        .orderBy(desc(battles.endedAt), desc(battles.id))
        .limit(1);
      return row?.id ?? null;
    },

    topPartnerLevel: async (mapId) => {
      const [row] = await db
        .select({ level: max(squishies.level) })
        .from(mapMembers)
        .innerJoin(squishies, eq(squishies.id, mapMembers.starterSquishyId))
        .where(activeMember(mapId));
      return row?.level ?? null;
    },

    groundTiles: async (mapId) => {
      const rows = await db
        .select({ q: tiles.q, r: tiles.r, terrain: tiles.terrain })
        .from(tiles)
        .where(
          and(
            eq(tiles.mapId, mapId),
            isNull(tiles.ownerUserId),
            isNull(tiles.homeSlot),
            isNull(tiles.communityId),
          ),
        );
      return {
        neutral: rows.filter((t) => !NOT_GROUND.includes(t.terrain)),
        gap: rows.filter((t) => t.terrain === GAP_TERRAIN),
      };
    },

    homes: async (mapId) => {
      const rows = await db
        .select({
          ownerUserId: tiles.ownerUserId,
          q: tiles.q,
          r: tiles.r,
          communityId: tiles.communityId,
        })
        .from(tiles)
        .innerJoin(
          mapMembers,
          and(eq(mapMembers.mapId, tiles.mapId), eq(mapMembers.userId, tiles.ownerUserId)),
        )
        .where(and(eq(tiles.mapId, mapId), isNotNull(tiles.homeSlot), activeMember(mapId)));
      const seeds = heartSeeds(
        rows.flatMap((r) => (r.ownerUserId === null ? [] : [{ ...r, ownerUserId: r.ownerUserId }])),
      );
      return [...seeds.values()].filter((h): h is Hex => h !== null);
    },

    triesSince: async (mapId, userId, since) => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(battles)
        .where(
          and(
            eq(battles.mapId, mapId),
            eq(battles.playerUserId, userId),
            eq(battles.kind, 'miniboss'),
            ne(battles.status, 'no-contest'),
            gte(battles.startedAt, since),
          ),
        );
      return row?.n ?? 0;
    },

    wonOtherBetween: async (mapId, userId, from, until, battleId) => {
      const [row] = await db
        .select({ id: battles.id })
        .from(battles)
        .where(
          and(
            eq(battles.mapId, mapId),
            eq(battles.playerUserId, userId),
            eq(battles.kind, 'miniboss'),
            eq(battles.status, 'finished'),
            ne(battles.id, battleId),
            gte(battles.startedAt, from),
            lt(battles.startedAt, until),
            sql`${battles.result}->>'winner' = 'a'`,
          ),
        )
        .limit(1);
      return row !== undefined;
    },

    findEncounter: async (mapId, userId, windowId) => {
      const [row] = await db
        .select()
        .from(bossEncounters)
        .where(
          and(
            eq(bossEncounters.mapId, mapId),
            eq(bossEncounters.userId, userId),
            eq(bossEncounters.windowId, windowId),
          ),
        );
      return row ?? null;
    },

    insertEncounter: async (mapId, userId, windowId, at) => {
      // A later fight in the same visit starts the idle clock again.
      await db
        .insert(bossEncounters)
        .values({ mapId, userId, windowId, createdAt: at, lastActionAt: at })
        .onConflictDoUpdate({
          target: [bossEncounters.mapId, bossEncounters.userId, bossEncounters.windowId],
          set: { lastActionAt: at },
        });
    },

    touch: async (mapId, userId, startedAt, at) => {
      const visit = await visitOf(mapId, startedAt);
      if (!visit) return;
      await db
        .update(bossEncounters)
        .set({ lastActionAt: at })
        .where(
          and(
            eq(bossEncounters.mapId, mapId),
            eq(bossEncounters.userId, userId),
            eq(bossEncounters.windowId, visit.windowId),
          ),
        );
    },

    lastActionAt: async (mapId, userId, startedAt) => {
      const visit = await visitOf(mapId, startedAt);
      if (!visit) return null;
      const [row] = await db
        .select({ lastActionAt: bossEncounters.lastActionAt })
        .from(bossEncounters)
        .where(
          and(
            eq(bossEncounters.mapId, mapId),
            eq(bossEncounters.userId, userId),
            eq(bossEncounters.windowId, visit.windowId),
          ),
        );
      return row?.lastActionAt ?? null;
    },

    markWon: async (mapId, userId, startedAt, battleId) => {
      const visit = await visitOf(mapId, startedAt);
      if (!visit) return;
      await db
        .update(bossEncounters)
        .set({ wonBattleId: battleId })
        .where(
          and(
            eq(bossEncounters.mapId, mapId),
            eq(bossEncounters.userId, userId),
            eq(bossEncounters.windowId, visit.windowId),
            isNull(bossEncounters.wonBattleId),
          ),
        );
    },

    visitOf,

    visitOfBattle: async (battleId, userId) => {
      const [row] = await db
        .select({ mapId: battles.mapId, startedAt: battles.startedAt })
        .from(battles)
        .where(
          and(
            eq(battles.id, battleId),
            eq(battles.playerUserId, userId),
            eq(battles.kind, 'miniboss'),
          ),
        );
      return row ? visitOf(row.mapId, row.startedAt) : null;
    },

    findWonEncounter: async (mapId, userId, battleId) =>
      (await wonEncounter(mapId, userId, battleId))[0] ?? null,

    lockWonEncounter: async (mapId, userId, battleId) =>
      (await wonEncounter(mapId, userId, battleId).for('update'))[0] ?? null,

    setAsks: async (mapId, userId, windowId, asks) => {
      await db
        .update(bossEncounters)
        .set({ asks })
        .where(
          and(
            eq(bossEncounters.mapId, mapId),
            eq(bossEncounters.userId, userId),
            eq(bossEncounters.windowId, windowId),
          ),
        );
    },

    findBond: async (mapId, userId, speciesId) => {
      const [row] = await db
        .select()
        .from(bossBonds)
        .where(bondKey(mapId, userId, speciesId));
      return row ?? null;
    },

    lockBond: async (mapId, userId, speciesId) => {
      await db.insert(bossBonds).values({ mapId, userId, speciesId }).onConflictDoNothing();
      const [row] = await db
        .select()
        .from(bossBonds)
        .where(bondKey(mapId, userId, speciesId))
        .for('update');
      if (!row) throw new Error('lockBond: the bond row is missing after its insert');
      return row;
    },

    addMiss: async (mapId, userId, speciesId) => {
      await db
        .update(bossBonds)
        .set({ misses: sql`${bossBonds.misses} + 1` })
        .where(bondKey(mapId, userId, speciesId));
    },

    befriended: async (mapId, userId, speciesId, squishyId, at) => {
      await db
        .update(bossBonds)
        .set({ squishyId, befriendedAt: at })
        .where(bondKey(mapId, userId, speciesId));
    },

    shareVisitOf: async (mapId, startedAt) => {
      const [visit] = await db
        .select()
        .from(bossWindows)
        .where(and(eq(bossWindows.mapId, mapId), lte(bossWindows.opensAt, startedAt)))
        .orderBy(desc(bossWindows.opensAt))
        .limit(1)
        .for('share');
      return visit ?? null;
    },

    findBar: async (mapId, windowId) => {
      const [row] = await db.select().from(bossBars).where(barKey(mapId, windowId));
      return row ?? null;
    },

    lockBar: async (mapId, windowId) => {
      const [row] = await db.select().from(bossBars).where(barKey(mapId, windowId)).for('update');
      return row ?? null;
    },

    insertBar: async (row) => {
      const [inserted] = await db.insert(bossBars).values(row).onConflictDoNothing().returning();
      return inserted ?? null;
    },

    setBar: async (mapId, windowId, bar) => {
      await db.update(bossBars).set(bar).where(barKey(mapId, windowId));
    },

    insertChip: async (chip) => {
      const inserted = await db
        .insert(bossBarChips)
        .values(chip)
        .onConflictDoNothing({ target: bossBarChips.battleId })
        .returning({ id: bossBarChips.id });
      return inserted.length > 0;
    },

    chippers: async (mapId, windowId) => {
      const [row] = await db
        .select({ n: countDistinct(bossBarChips.userId) })
        .from(bossBarChips)
        .where(and(eq(bossBarChips.mapId, mapId), eq(bossBarChips.windowId, windowId)));
      return row?.n ?? 0;
    },

    chipsBy: async (mapId, windowId, userId, before) => {
      const [row] = await db
        .select({ n: count() })
        .from(bossBarChips)
        .where(
          and(
            eq(bossBarChips.mapId, mapId),
            eq(bossBarChips.windowId, windowId),
            eq(bossBarChips.userId, userId),
            lt(bossBarChips.createdAt, before),
          ),
        );
      return row?.n ?? 0;
    },

    unthanked: async (mapId, windowId, before, minFights) => {
      const rows = await db
        .select({ userId: bossBarChips.userId })
        .from(bossBarChips)
        .innerJoin(
          bossEncounters,
          and(
            eq(bossEncounters.mapId, bossBarChips.mapId),
            eq(bossEncounters.userId, bossBarChips.userId),
            eq(bossEncounters.windowId, bossBarChips.windowId),
          ),
        )
        .where(
          and(
            eq(bossBarChips.mapId, mapId),
            eq(bossBarChips.windowId, windowId),
            lt(bossBarChips.createdAt, before),
            isNull(bossEncounters.thankedAt),
          ),
        )
        .groupBy(bossBarChips.userId)
        .having(sql`count(*) >= ${minFights}`)
        .orderBy(bossBarChips.userId);
      return rows.map((r) => r.userId);
    },

    markThanked: async (mapId, userId, windowId, at) => {
      const rows = await db
        .update(bossEncounters)
        .set({ thankedAt: at })
        .where(
          and(
            eq(bossEncounters.mapId, mapId),
            eq(bossEncounters.userId, userId),
            eq(bossEncounters.windowId, windowId),
            isNull(bossEncounters.thankedAt),
          ),
        )
        .returning({ userId: bossEncounters.userId });
      return rows.length > 0;
    },

    lockEncounter: async (mapId, userId, windowId) => {
      const [row] = await db
        .select()
        .from(bossEncounters)
        .where(
          and(
            eq(bossEncounters.mapId, mapId),
            eq(bossEncounters.userId, userId),
            eq(bossEncounters.windowId, windowId),
          ),
        )
        .for('update');
      return row ?? null;
    },

    barsToSettle: async (at, minFights) => {
      const owed = db
        .select({ one: sql`1` })
        .from(bossBarChips)
        .innerJoin(
          bossEncounters,
          and(
            eq(bossEncounters.mapId, bossBarChips.mapId),
            eq(bossEncounters.userId, bossBarChips.userId),
            eq(bossEncounters.windowId, bossBarChips.windowId),
          ),
        )
        .where(
          and(
            eq(bossBarChips.mapId, bossBars.mapId),
            eq(bossBarChips.windowId, bossBars.windowId),
            lt(bossBarChips.createdAt, bossBars.closesAt),
            isNull(bossEncounters.thankedAt),
          ),
        )
        .groupBy(bossBarChips.userId)
        .having(sql`count(*) >= ${minFights}`);
      return db
        .select()
        .from(bossBars)
        .where(
          or(
            and(eq(bossBars.state, 'open'), lte(bossBars.closesAt, at)),
            and(ne(bossBars.state, 'open'), exists(owed)),
          ),
        )
        .orderBy(bossBars.mapId, bossBars.windowId);
    },

    activeKeepers: async (mapId) => {
      const [row] = await db
        .select({ n: count() })
        .from(mapMembers)
        .innerJoin(users, eq(users.id, mapMembers.userId))
        .where(and(activeMember(mapId), eq(users.kind, 'player')));
      return row?.n ?? 0;
    },

    litLights: async (mapId) => {
      const [row] = await db
        .select({ n: countDistinct(buildings.tileId) })
        .from(buildings)
        .where(and(eq(buildings.mapId, mapId), eq(buildings.kind, LIGHTS)));
      return row?.n ?? 0;
    },

    starLit: async (mapId) => {
      const [row] = await db
        .select({ starLitAt: patchTrees.starLitAt })
        .from(patchTrees)
        .where(eq(patchTrees.mapId, mapId));
      return (row?.starLitAt ?? null) !== null;
    },

    devEveNow: async (row) => {
      const [pinned] = await db
        .insert(bossWindows)
        .values({ ...row, kind: 'christmas-eve' })
        .onConflictDoUpdate({
          target: [bossWindows.mapId, bossWindows.windowId],
          set: {
            kind: 'christmas-eve',
            speciesId: row.speciesId,
            endsAt: row.endsAt,
            opensAt: sql`least(${bossWindows.opensAt}, ${row.opensAt.toISOString()}::timestamptz)`,
          },
        })
        .returning();
      if (!pinned) throw new Error('devEveNow: the visit row is missing after its upsert');
      // The bar goes with its chips (`boss_bar_chips_bar_fk` cascades).
      await db.delete(bossBars).where(barKey(row.mapId, row.windowId));
      await db
        .update(bossEncounters)
        .set({ wonBattleId: null, asks: [], thankedAt: null })
        .where(and(eq(bossEncounters.mapId, row.mapId), eq(bossEncounters.windowId, row.windowId)));
      return pinned;
    },

    hasSeen: async (mapId, userId, speciesId) => {
      const rows = await db
        .select({ speciesId: speciesSeen.speciesId })
        .from(speciesSeen)
        .where(
          and(
            eq(speciesSeen.mapId, mapId),
            eq(speciesSeen.userId, userId),
            eq(speciesSeen.speciesId, speciesId),
          ),
        );
      return rows.length > 0;
    },
  };
}
