import {
  PatchTypeSchema,
  WeatherFrontSchema,
  WeatherKindSchema,
  type LocalDate,
  type PatchType,
  type WeatherDay,
} from '@heartpatch/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { buildings, mapMembers, maps, tiles, weatherDays } from '../../db/schema.js';

/**
 * Wild Isle weather's storage (#621): the stored day plans (`weather_days`,
 * inserted once, never locked, tech spec §7), and the plain reads the
 * weather needs about a map. Building rows and their locks belong to the
 * buildings repo.
 */

/** What the weather needs to know about a map. */
export interface WeatherMapRow {
  id: string;
  /** The generator's seed: server-only (tech spec §8); null for a hand-made map. */
  seed: string | null;
  timeZone: string;
  maxPlayers: number;
  patchType: PatchType;
}

/** A shelter on the map (a Levee, a Seawall): anyone's, while its owner holds its tile. */
export interface ShelterRow {
  buildingId: string;
  q: number;
  r: number;
  placedAt: Date;
}

/** One of my knocked buildings, for the morning card. */
export interface KnockedRow {
  id: string;
  buildingId: string;
  q: number;
  r: number;
  damagedAt: Date;
}

const FrontsSchema = z.array(WeatherFrontSchema);

export interface WeatherRepo {
  /** Runs `fn` in one transaction (the sweep's per-player pass, a dev knock). */
  transaction: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
  map: (mapId: string) => Promise<WeatherMapRow | null>;
  /** Every Wild Isle patch with a seed, in id order (the sweep). */
  wildMaps: () => Promise<string[]>;
  /** The stored plans for these days (missing days left out). */
  days: (mapId: string, days: readonly LocalDate[]) => Promise<Map<LocalDate, WeatherDay>>;
  /** Stores a day's plan unless one is there already (the first one stands). */
  insertDay: (mapId: string, plan: WeatherDay, at: Date) => Promise<void>;
  /** Writes a day's plan over whatever is there (dev only, `dev/weather`). */
  putDay: (mapId: string, plan: WeatherDay, at: Date) => Promise<void>;
  /** Deletes plans for days before `day`, on every map. How many went. */
  deleteBefore: (day: LocalDate) => Promise<number>;
  /** Active members who own a building on the map, in id order (the sweep's owners). */
  buildingOwners: (mapId: string) => Promise<string[]>;
  /** The map's shelters (kind `shelter`) on tiles their owners still hold. */
  shelters: (mapId: string) => Promise<ShelterRow[]>;
  /** The terrains of these tiles (by `q,r`), where they exist. */
  terrainsAt: (
    mapId: string,
    hexes: readonly { q: number; r: number }[],
  ) => Promise<Map<string, string>>;
  /** Does the player own a Weather Vane (kind `vane`) on land they hold? */
  hasVane: (mapId: string, userId: string) => Promise<boolean>;
  /** The player's first home's tiles (to find their Heart Seed). */
  homeTiles: (mapId: string, userId: string) => Promise<{ q: number; r: number }[]>;
  /** The player's buildings knocked about since `since` and not fixed yet, newest first. */
  knockedSince: (mapId: string, userId: string, since: Date) => Promise<KnockedRow[]>;
}

export function createWeatherRepo(db: Executor): WeatherRepo {
  const toDay = (row: { day: string; kind: string; fronts: unknown }): WeatherDay => ({
    day: row.day,
    kind: WeatherKindSchema.parse(row.kind),
    fronts: FrontsSchema.parse(row.fronts),
  });
  const values = (mapId: string, plan: WeatherDay, at: Date) => ({
    mapId,
    day: plan.day,
    kind: plan.kind ?? 'clear',
    fronts: plan.fronts,
    plannedAt: at,
  });

  return {
    transaction: (fn) => withTransaction(db, fn),

    map: async (mapId) => {
      const [row] = await db
        .select({
          id: maps.id,
          seed: maps.seed,
          timeZone: maps.timeZone,
          maxPlayers: maps.maxPlayers,
          patchType: maps.patchType,
        })
        .from(maps)
        .where(eq(maps.id, mapId));
      return row ? { ...row, patchType: PatchTypeSchema.parse(row.patchType) } : null;
    },

    wildMaps: async () =>
      (
        await db
          .select({ id: maps.id })
          .from(maps)
          .where(and(eq(maps.patchType, 'wild-isle'), isNotNull(maps.seed)))
          .orderBy(asc(maps.id))
      ).map((r) => r.id),

    days: async (mapId, days) => {
      if (days.length === 0) return new Map();
      const rows = await db
        .select({ day: weatherDays.day, kind: weatherDays.kind, fronts: weatherDays.fronts })
        .from(weatherDays)
        .where(and(eq(weatherDays.mapId, mapId), inArray(weatherDays.day, [...days])));
      return new Map(rows.map((r) => [r.day, toDay(r)]));
    },

    insertDay: async (mapId, plan, at) => {
      await db
        .insert(weatherDays)
        .values(values(mapId, plan, at))
        .onConflictDoNothing();
    },

    putDay: async (mapId, plan, at) => {
      const row = values(mapId, plan, at);
      await db
        .insert(weatherDays)
        .values(row)
        .onConflictDoUpdate({
          target: [weatherDays.mapId, weatherDays.day],
          set: { kind: row.kind, fronts: row.fronts, plannedAt: at },
        });
    },

    deleteBefore: async (day) => {
      const gone = await db
        .delete(weatherDays)
        .where(lt(weatherDays.day, day))
        .returning({ mapId: weatherDays.mapId });
      return gone.length;
    },

    buildingOwners: async (mapId) =>
      (
        await db
          .selectDistinct({ userId: buildings.ownerUserId })
          .from(buildings)
          .innerJoin(
            mapMembers,
            and(
              eq(mapMembers.mapId, buildings.mapId),
              eq(mapMembers.userId, buildings.ownerUserId),
            ),
          )
          .where(and(eq(buildings.mapId, mapId), eq(mapMembers.status, 'active')))
          .orderBy(asc(buildings.ownerUserId))
      ).map((r) => r.userId),

    shelters: (mapId) =>
      db
        .select({
          buildingId: buildings.buildingId,
          q: tiles.q,
          r: tiles.r,
          placedAt: buildings.placedAt,
        })
        .from(buildings)
        .innerJoin(tiles, eq(tiles.id, buildings.tileId))
        .where(
          and(
            eq(buildings.mapId, mapId),
            eq(buildings.kind, 'shelter'),
            eq(tiles.ownerUserId, buildings.ownerUserId),
          ),
        ),

    terrainsAt: async (mapId, hexes) => {
      if (hexes.length === 0) return new Map();
      const rows = await db
        .select({ q: tiles.q, r: tiles.r, terrain: tiles.terrain })
        .from(tiles)
        .where(
          and(
            eq(tiles.mapId, mapId),
            or(...hexes.map((h) => and(eq(tiles.q, h.q), eq(tiles.r, h.r)))),
          ),
        );
      return new Map(rows.map((r) => [`${String(r.q)},${String(r.r)}`, r.terrain]));
    },

    hasVane: async (mapId, userId) => {
      const [row] = await db
        .select({ id: buildings.id })
        .from(buildings)
        .innerJoin(tiles, eq(tiles.id, buildings.tileId))
        .where(
          and(
            eq(buildings.mapId, mapId),
            eq(buildings.ownerUserId, userId),
            eq(buildings.kind, 'vane'),
            eq(tiles.ownerUserId, userId),
          ),
        )
        .limit(1);
      return row !== undefined;
    },

    homeTiles: (mapId, userId) =>
      db
        .select({ q: tiles.q, r: tiles.r })
        .from(tiles)
        .where(
          and(
            eq(tiles.mapId, mapId),
            eq(tiles.ownerUserId, userId),
            isNotNull(tiles.homeSlot),
            isNull(tiles.communityId),
          ),
        ),

    knockedSince: async (mapId, userId, since) => {
      const rows = await db
        .select({
          id: buildings.id,
          buildingId: buildings.buildingId,
          q: tiles.q,
          r: tiles.r,
          damagedAt: buildings.damagedAt,
        })
        .from(buildings)
        .innerJoin(tiles, eq(tiles.id, buildings.tileId))
        .where(
          and(
            eq(buildings.mapId, mapId),
            eq(buildings.ownerUserId, userId),
            gte(buildings.damagedAt, since),
          ),
        )
        .orderBy(desc(buildings.damagedAt), asc(buildings.id));
      return rows.flatMap((r) => (r.damagedAt ? [{ ...r, damagedAt: r.damagedAt }] : []));
    },
  };
}
