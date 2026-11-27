import { and, desc, eq, gt, gte, isNotNull, isNull, lte, max, ne, sql } from 'drizzle-orm';
import type { Hex } from '@heartpatch/shared';
import type { BossTileCandidate } from '@heartpatch/shared/server';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  battles,
  bossBonds,
  bossEncounters,
  bossWindows,
  mapMembers,
  maps,
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

export type BossWindowRow = typeof bossWindows.$inferSelect;
export type BossEncounterRow = typeof bossEncounters.$inferSelect;
export type BossBondRow = typeof bossBonds.$inferSelect;

/** A patch as the boss schedule reads it: its seed is server-only. */
export interface BossMapRow {
  id: string;
  seed: string;
  timeZone: string;
  longNightWeekday: number | null;
  /** The patch owner's username (the mini-boss switch, #234), or null with no owner. */
  ownerUsername: string | null;
}

export interface BossRepo {
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
   * fights (`visitOf`, by start time) still belong to this row. Its Keepers' goes at the weekly boss are cleared,
   * so everyone meets the Eve visit fresh (a weekly win would read as
   * "beaten"). Only a visit pinned before X1 shipped is ever converted.
   */
  convertToChristmasEve: (
    mapId: string,
    windowId: string,
    visit: Pick<BossWindowRow, 'speciesId' | 'endsAt'>,
  ) => Promise<BossWindowRow | null>;
  /** The patch's Christmas Eve visit out at `at` (`MapView.christmas.eve`), or null. */
  findChristmasEve: (mapId: string, at: Date) => Promise<BossWindowRow | null>;
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
      await db
        .delete(bossEncounters)
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
