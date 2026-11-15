import { and, desc, eq, gte, isNotNull, isNull, lte, max, ne, sql } from 'drizzle-orm';
import type { Hex } from '@heartpatch/shared';
import type { BossTileCandidate } from '@heartpatch/shared/server';
import { withTransaction, type Executor } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import {
  battles,
  bossEncounters,
  bossWindows,
  mapMembers,
  maps,
  speciesSeen,
  squishies,
  tiles,
} from '../../db/schema.js';
import { activeMember } from '../maps/repo.js';
import { heartSeeds } from '../territory/supply.js';

/** Juniper's Gap's tiles (`MAP_GEN.gapTerrain`) and trading posts are never a boss's ground. */
const GAP_TERRAIN = 'junipers-gap';
const NOT_GROUND = ['trading-post', GAP_TERRAIN];

export type BossWindowRow = typeof bossWindows.$inferSelect;

/** A patch as the boss schedule reads it: its seed is server-only. */
export interface BossMapRow {
  id: string;
  seed: string;
  timeZone: string;
  longNightWeekday: number | null;
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
  /** Has the Keeper met this species (catalog seen)? */
  hasSeen: (mapId: string, userId: string, speciesId: string) => Promise<boolean>;
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
};

const withSeed = (
  rows: { id: string; seed: string | null; timeZone: string; longNightWeekday: number | null }[],
) => rows.flatMap((r) => (r.seed === null ? [] : [{ ...r, seed: r.seed }]));

export function createBossRepo(db: Executor): BossRepo {
  return {
    transaction: (fn) =>
      withTransaction(db, (tx) =>
        fn({ ...createBossRepo(tx), appendEvent: (event) => appendGameEvent(tx, event) }, tx),
      ),

    findMap: async (mapId) => {
      const rows = await db
        .select(mapColumns)
        .from(maps)
        .where(and(eq(maps.id, mapId), eq(maps.kind, 'multiplayer')));
      return withSeed(rows)[0] ?? null;
    },

    listMaps: async () =>
      withSeed(
        await db
          .select(mapColumns)
          .from(maps)
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
      await db
        .insert(bossEncounters)
        .values({ mapId, userId, windowId, createdAt: at })
        .onConflictDoNothing();
    },

    markWon: async (mapId, userId, startedAt, battleId) => {
      const [visit] = await db
        .select({ windowId: bossWindows.windowId })
        .from(bossWindows)
        .where(and(eq(bossWindows.mapId, mapId), lte(bossWindows.opensAt, startedAt)))
        .orderBy(desc(bossWindows.opensAt))
        .limit(1);
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
