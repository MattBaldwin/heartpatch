import {
  ElementIdSchema,
  FeelingIdSchema,
  type ElementId,
  type FeelingId,
  type OwnedSquishy,
  type TileDefenders,
} from '@heartpatch/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableName,
  gt,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';
import { mapMembers, maps, squishies, tileAttacks, tileDefenders, tiles } from '../../db/schema.js';

/** A tile as territory needs it. `guardianStrength` is secret (tech spec §8). */
export interface TerritoryTileRow {
  id: string;
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
  homeSlot: number | null;
  guardianStrength: number | null;
}

export type TileAttackOutcome = (typeof tileAttacks.$inferSelect)['outcome'];

export interface TileAttackRow {
  id: string;
  mapId: string;
  tileId: string;
  attackerUserId: string;
  defenderUserId: string | null;
  battleId: string;
  outcome: TileAttackOutcome;
  rewardPercent: number;
  startedAt: Date;
  lastActionAt: Date;
}

/** A squishy standing watch, as a battle side needs it. */
export interface DefenderRow {
  id: string;
  speciesId: string;
  level: number;
  element: ElementId;
  feeling: FeelingId;
}

/**
 * Territory storage (#15): tiles, the tile-battle attempt log
 * (`tile_attacks`) and who stands watch (`tile_defenders`). Plain queries;
 * the service decides the rules. The battles service runs tile battles on its
 * own transactions and reaches this repo through `createTerritoryRepo(tx)`.
 */
export interface TerritoryRepo {
  transaction: <T>(fn: (repo: TerritoryTxRepo, tx: Executor) => Promise<T>) => Promise<T>;

  /** The map's secret seed (null on hand-authored maps). Never sent to clients. */
  mapSeed: (mapId: string) => Promise<string | null>;
  /** Every tile, in (q, r) order. */
  listTiles: (mapId: string) => Promise<TerritoryTileRow[]>;
  findTile: (mapId: string, q: number, r: number) => Promise<TerritoryTileRow | null>;
  /** Row-locks the tile until commit: battles for it and captures run one at a time. */
  lockTile: (tileId: string) => Promise<TerritoryTileRow | null>;
  joinedAt: (mapId: string, userId: string) => Promise<Date | null>;

  /** Tile battles the player started on `date` (map-local), not counting no-contests. */
  attemptsOn: (mapId: string, userId: string, date: string, timeZone: string) => Promise<number>;
  /** Tiles the player lost to challenges on `date` (map-local). */
  lossesOn: (mapId: string, userId: string, date: string, timeZone: string) => Promise<number>;
  /** Challenges against the player still going (acted on after `since`). */
  challengesGoing: (mapId: string, userId: string, since: Date) => Promise<number>;
  /** The latest cooldown on the tile, or null if it's never been battled for. */
  cooldownUntil: (tileId: string) => Promise<Date | null>;

  insertAttack: (attack: {
    mapId: string;
    tileId: string;
    attackerUserId: string;
    defenderUserId: string | null;
    battleId: string;
    rewardPercent: number;
    startedAt: Date;
    cooldownUntil: Date;
  }) => Promise<TileAttackRow>;
  findAttack: (battleId: string) => Promise<TileAttackRow | null>;
  touchAttack: (battleId: string, at: Date) => Promise<void>;
  endAttack: (battleId: string, outcome: TileAttackOutcome, at: Date) => Promise<void>;

  setOwner: (tileId: string, userId: string) => Promise<void>;
  /** The owner's squishies on watch on the tile, by slot (active ones only). */
  listDefenders: (tileId: string, ownerUserId: string) => Promise<DefenderRow[]>;
  /** Sends everyone on watch on the tile home; returns their ids. */
  clearDefenders: (tileId: string) => Promise<string[]>;
  /**
   * Puts these squishies on watch on the tile, in slot order, replacing who
   * was there; any of them on watch elsewhere move here.
   */
  replaceDefenders: (
    mapId: string,
    tileId: string,
    squishyIds: readonly string[],
    at: Date,
  ) => Promise<void>;
  /** The tiles these squishies stand watch on now (each tile once). */
  postsOf: (squishyIds: readonly string[]) => Promise<TerritoryTileRow[]>;
  /** The player's tiles with squishies on watch (still theirs, active squishies only). */
  myDefenders: (mapId: string, userId: string) => Promise<TileDefenders[]>;
  /** The player's squishies on the map, strongest first. */
  mySquishies: (mapId: string, userId: string) => Promise<OwnedSquishy[]>;
  /**
   * Row-locks squishies in id order (tech spec §7) until commit, after the
   * tiles, and returns where each lives: housing locks the squishy too, so a
   * squishy can't be housed and posted at once.
   */
  lockSquishies: (
    squishyIds: readonly string[],
  ) => Promise<{ id: string; habitatBuildingId: string | null }[]>;
}

export interface TerritoryTxRepo extends TerritoryRepo {
  /** `appendGameEvent` in this transaction; call it as the last write. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

const tileColumns = {
  id: tiles.id,
  q: tiles.q,
  r: tiles.r,
  terrain: tiles.terrain,
  ownerUserId: tiles.ownerUserId,
  homeSlot: tiles.homeSlot,
  guardianStrength: tiles.guardianStrength,
};

const attackColumns = {
  id: tileAttacks.id,
  mapId: tileAttacks.mapId,
  tileId: tileAttacks.tileId,
  attackerUserId: tileAttacks.attackerUserId,
  defenderUserId: tileAttacks.defenderUserId,
  battleId: tileAttacks.battleId,
  outcome: tileAttacks.outcome,
  rewardPercent: tileAttacks.rewardPercent,
  startedAt: tileAttacks.startedAt,
  lastActionAt: tileAttacks.lastActionAt,
};

/**
 * The one SQL spelling of "on watch" (decision C; shared `isOnWatch` is the
 * same rule for rows already read): the squishy has a post (`tile_defenders`)
 * on a tile its owner still holds. A post on land that changed hands doesn't
 * count (the squishy went home). Housing and care read it, and the map view
 * counts a tile's guards with it, so "housed or on watch, not both"
 * (DECISIONS "Owner rules pass") can't drift between them.
 *
 * `squishy` is a `squishies` row of the outer query (the table itself by
 * default). Its columns are written `"table"."column"`, because a one-table
 * select names its columns without the table, and the post and its tile get
 * their own aliases, so the fragment can sit inside a query over `tiles` or
 * `tile_defenders` too. Not state-aware: callers add `state` where it matters.
 */
export const squishyOnWatch = (
  squishy: { id: AnyPgColumn; ownerUserId: AnyPgColumn } = squishies,
) => {
  const outer = (column: AnyPgColumn) =>
    sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
  const post = (column: AnyPgColumn) => sql`watch_post.${sql.identifier(column.name)}`;
  const tile = (column: AnyPgColumn) => sql`watch_tile.${sql.identifier(column.name)}`;
  return sql<boolean>`exists (
    select 1 from ${tileDefenders} as watch_post
    join ${tiles} as watch_tile on ${tile(tiles.id)} = ${post(tileDefenders.tileId)}
    where ${post(tileDefenders.squishyId)} = ${outer(squishy.id)}
      and ${tile(tiles.ownerUserId)} = ${outer(squishy.ownerUserId)}
  )`;
};

/** `column`'s calendar date in `timeZone` (Postgres' tz data). */
const localDateOf = (column: AnyPgColumn, timeZone: string) =>
  sql`(${column} at time zone ${timeZone})::date`;

export function createTerritoryRepo(db: Executor): TerritoryRepo {
  return queries(db);
}

function createTerritoryTxRepo(tx: Transaction): TerritoryTxRepo {
  return { ...queries(tx), appendEvent: (event) => appendGameEvent(tx, event) };
}

function queries(db: Executor): TerritoryRepo {
  const countOf = async (where: ReturnType<typeof and>): Promise<number> => {
    const [row] = await db.select({ n: count() }).from(tileAttacks).where(where);
    return row?.n ?? 0;
  };

  return {
    transaction: (fn) => withTransaction(db, (tx) => fn(createTerritoryTxRepo(tx), tx)),

    mapSeed: async (mapId) => {
      const [row] = await db.select({ seed: maps.seed }).from(maps).where(eq(maps.id, mapId));
      return row?.seed ?? null;
    },

    listTiles: (mapId) =>
      db
        .select(tileColumns)
        .from(tiles)
        .where(eq(tiles.mapId, mapId))
        .orderBy(asc(tiles.q), asc(tiles.r)),

    findTile: async (mapId, q, r) => {
      const [row] = await db
        .select(tileColumns)
        .from(tiles)
        .where(and(eq(tiles.mapId, mapId), eq(tiles.q, q), eq(tiles.r, r)));
      return row ?? null;
    },

    lockTile: async (tileId) => {
      const [row] = await db
        .select(tileColumns)
        .from(tiles)
        .where(eq(tiles.id, tileId))
        .for('update');
      return row ?? null;
    },

    joinedAt: async (mapId, userId) => {
      const [row] = await db
        .select({ joinedAt: mapMembers.joinedAt })
        .from(mapMembers)
        .where(and(eq(mapMembers.mapId, mapId), eq(mapMembers.userId, userId)));
      return row?.joinedAt ?? null;
    },

    attemptsOn: (mapId, userId, date, timeZone) =>
      countOf(
        and(
          eq(tileAttacks.mapId, mapId),
          eq(tileAttacks.attackerUserId, userId),
          ne(tileAttacks.outcome, 'no-contest'),
          sql`${localDateOf(tileAttacks.startedAt, timeZone)} = ${date}::date`,
        ),
      ),

    lossesOn: (mapId, userId, date, timeZone) =>
      countOf(
        and(
          eq(tileAttacks.mapId, mapId),
          eq(tileAttacks.defenderUserId, userId),
          eq(tileAttacks.outcome, 'captured'),
          isNotNull(tileAttacks.endedAt),
          sql`${localDateOf(tileAttacks.endedAt, timeZone)} = ${date}::date`,
        ),
      ),

    challengesGoing: (mapId, userId, since) =>
      countOf(
        and(
          eq(tileAttacks.mapId, mapId),
          eq(tileAttacks.defenderUserId, userId),
          eq(tileAttacks.outcome, 'active'),
          gt(tileAttacks.lastActionAt, since),
        ),
      ),

    cooldownUntil: async (tileId) => {
      const [row] = await db
        .select({ until: tileAttacks.cooldownUntil })
        .from(tileAttacks)
        .where(eq(tileAttacks.tileId, tileId))
        .orderBy(desc(tileAttacks.cooldownUntil))
        .limit(1);
      return row?.until ?? null;
    },

    insertAttack: async (attack) => {
      const [row] = await db
        .insert(tileAttacks)
        .values({ ...attack, lastActionAt: attack.startedAt })
        .returning(attackColumns);
      if (!row) throw new Error('insertAttack: insert returned no row');
      return row;
    },

    findAttack: async (battleId) => {
      const [row] = await db
        .select(attackColumns)
        .from(tileAttacks)
        .where(eq(tileAttacks.battleId, battleId));
      return row ?? null;
    },

    touchAttack: async (battleId, at) => {
      await db
        .update(tileAttacks)
        .set({ lastActionAt: at })
        .where(eq(tileAttacks.battleId, battleId));
    },

    endAttack: async (battleId, outcome, at) => {
      await db
        .update(tileAttacks)
        .set({ outcome, endedAt: at })
        .where(eq(tileAttacks.battleId, battleId));
    },

    setOwner: async (tileId, userId) => {
      await db.update(tiles).set({ ownerUserId: userId }).where(eq(tiles.id, tileId));
    },

    listDefenders: async (tileId, ownerUserId) => {
      const rows = await db
        .select({
          id: squishies.id,
          speciesId: squishies.speciesId,
          level: squishies.level,
          element: squishies.element,
          feeling: squishies.feeling,
        })
        .from(tileDefenders)
        .innerJoin(squishies, eq(squishies.id, tileDefenders.squishyId))
        .where(
          and(
            eq(tileDefenders.tileId, tileId),
            eq(squishies.ownerUserId, ownerUserId),
            eq(squishies.state, 'active'),
          ),
        )
        .orderBy(asc(tileDefenders.slot));
      // Content ids are plain text in the database; check them on the way out.
      return rows.map((r) => ({
        ...r,
        element: ElementIdSchema.parse(r.element),
        feeling: FeelingIdSchema.parse(r.feeling),
      }));
    },

    clearDefenders: async (tileId) => {
      const rows = await db
        .delete(tileDefenders)
        .where(eq(tileDefenders.tileId, tileId))
        .returning({ squishyId: tileDefenders.squishyId, slot: tileDefenders.slot });
      return rows.sort((a, b) => a.slot - b.slot).map((r) => r.squishyId);
    },

    replaceDefenders: async (mapId, tileId, squishyIds, at) => {
      await db
        .delete(tileDefenders)
        .where(
          squishyIds.length > 0
            ? or(
                eq(tileDefenders.tileId, tileId),
                inArray(tileDefenders.squishyId, [...squishyIds]),
              )
            : eq(tileDefenders.tileId, tileId),
        );
      if (squishyIds.length === 0) return;
      await db
        .insert(tileDefenders)
        .values(
          squishyIds.map((squishyId, slot) => ({ mapId, tileId, slot, squishyId, assignedAt: at })),
        );
    },

    postsOf: async (squishyIds) => {
      if (squishyIds.length === 0) return [];
      return db
        .selectDistinct(tileColumns)
        .from(tileDefenders)
        .innerJoin(tiles, eq(tiles.id, tileDefenders.tileId))
        .where(inArray(tileDefenders.squishyId, [...squishyIds]))
        .orderBy(asc(tiles.id));
    },

    myDefenders: async (mapId, userId) => {
      const rows = await db
        .select({ q: tiles.q, r: tiles.r, squishyId: tileDefenders.squishyId })
        .from(tileDefenders)
        .innerJoin(tiles, eq(tiles.id, tileDefenders.tileId))
        .innerJoin(squishies, eq(squishies.id, tileDefenders.squishyId))
        .where(
          and(
            eq(tileDefenders.mapId, mapId),
            eq(tiles.ownerUserId, userId),
            eq(squishies.ownerUserId, userId),
            eq(squishies.state, 'active'),
          ),
        )
        .orderBy(asc(tiles.q), asc(tiles.r), asc(tileDefenders.slot));
      const byTile = new Map<string, TileDefenders>();
      for (const row of rows) {
        const key = `${String(row.q)},${String(row.r)}`;
        const entry = byTile.get(key) ?? { q: row.q, r: row.r, squishyIds: [] };
        entry.squishyIds.push(row.squishyId);
        byTile.set(key, entry);
      }
      return [...byTile.values()];
    },

    lockSquishies: async (squishyIds) => {
      if (squishyIds.length === 0) return [];
      return db
        .select({ id: squishies.id, habitatBuildingId: squishies.habitatBuildingId })
        .from(squishies)
        .where(inArray(squishies.id, [...squishyIds]))
        .orderBy(asc(squishies.id))
        .for('no key update');
    },

    mySquishies: async (mapId, userId) => {
      const rows = await db
        .select()
        .from(squishies)
        .where(and(eq(squishies.mapId, mapId), eq(squishies.ownerUserId, userId)))
        .orderBy(desc(squishies.level), asc(squishies.createdAt), asc(squishies.id));
      return rows.map((row) => ({
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
      }));
    },
  };
}
