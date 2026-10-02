import {
  addFuel,
  buildCost,
  fuelCost,
  fuelSpace,
  GAME_DATA,
  HOME_BASE_RULES,
  hearthfireState,
  inSeason,
  isBuildable,
  isReservedSpot,
  removeRefund,
  type Building,
  type HomeResponse,
  type ItemCounts,
  type MapLocalTime,
  type MoveBuildingRequest,
  type MyBuilding,
  type PlaceBuildingRequest,
  type PlacedBuilding,
  type PublicBuilding,
  type PublicUser,
  type RemoveBuildingResponse,
} from '@heartpatch/shared';
import { SERVER_GAME_DATA } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems, requireMember, seasonsOn } from '../inventory/service.js';
import { BUILDING_DATA, mapLocalTime, toPublicBuilding } from './hearthfire.js';
import {
  createBuildingsRepo,
  type BuildingRow,
  type BuildingsRepo,
  type BuildingsTxRepo,
  type HomeTileRow,
} from './repo.js';

/*
 * Home base and buildings (#18, design doc §11, §13–14). Players build on
 * the spots of their own home tiles (the Heart Seed and its ring), paying
 * through `consumeItems(…, 'build')` in the same transaction as the row
 * (CLAUDE.md rule 7). Hearthfire fuel is a date (tech spec §7): adding fuel
 * moves `fuelled_through`, and lit / nights left are worked out on read, so
 * nothing ticks (rule 4). Habitats house the player's own active squishies,
 * up to their capacity.
 */

const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));
const PUBLIC_SPECIES = new Set(GAME_DATA.species.map((s) => s.id));
const SECRET_SPECIES = new Map(SERVER_GAME_DATA.secretSpecies.map((s) => [s.id, s]));

// Kid-readable messages (style guide §6).
const MESSAGES = {
  unknown: "We don't know that building.",
  notYet: "That one isn't ready to build yet. Soon!",
  outOfSeason: (name: string, season: string) => `${name} can only be built around ${season}!`,
  notHome: 'You can only build on your home base.',
  spotTaken: 'Something is already there. Try another spot!',
  tooMany: (name: string) => `Your home already has all the ${name} it can hold!`,
  noBuilding: "We couldn't find that building.",
  notAFire: 'Only fires need fuel.',
  full: "It's full! Come back after a night or two.",
  notAHabitat: 'Squishies can only move into a habitat.',
  noSquishy: "We couldn't find that squishy.",
  inHollow: "That squishy is in the Hollow. Rescue them first, then they'll move in!",
  habitatFull: (name: string) => `The ${name} is full! Try another home.`,
} as const;

export interface BuildingsService {
  /** My home tiles, buildings and squishies, and my bag. */
  home: (user: PublicUser, mapId: string) => Promise<HomeResponse>;
  place: (user: PublicUser, mapId: string, request: PlaceBuildingRequest) => Promise<HomeResponse>;
  move: (
    user: PublicUser,
    mapId: string,
    buildingRowId: string,
    request: MoveBuildingRequest,
  ) => Promise<HomeResponse>;
  remove: (
    user: PublicUser,
    mapId: string,
    buildingRowId: string,
  ) => Promise<RemoveBuildingResponse>;
  fuel: (
    user: PublicUser,
    mapId: string,
    buildingRowId: string,
    nights: number,
  ) => Promise<HomeResponse>;
  /** Moves one of my squishies into a habitat, or out (null). */
  house: (
    user: PublicUser,
    mapId: string,
    squishyId: string,
    habitatRowId: string | null,
  ) => Promise<HomeResponse>;
}

export interface BuildingsServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

/** The Heart Seed: the middle of a home base (the mean of its seven tiles). */
function heartSeedOf(home: readonly HomeTileRow[]): { q: number; r: number } | null {
  if (home.length === 0) return null;
  const q = home.reduce((sum, t) => sum + t.q, 0) / home.length;
  const r = home.reduce((sum, t) => sum + t.r, 0) / home.length;
  return { q, r };
}

const isSeed = (tile: HomeTileRow, seed: { q: number; r: number } | null) =>
  seed !== null && tile.q === seed.q && tile.r === seed.r;

const placed = (row: BuildingRow, local: MapLocalTime): PlacedBuilding => ({
  ...toPublicBuilding(row, local),
  q: row.q,
  r: row.r,
});

function toMyBuilding(row: BuildingRow, local: MapLocalTime, residents: number): MyBuilding {
  const building = BUILDING_DATA.get(row.buildingId);
  const fire = building?.kind === 'hearthfire' ? building : null;
  const habitat = building?.kind === 'habitat' ? building : null;
  const level = Math.min(row.level, building?.levels.length ?? 1);
  return {
    ...placed(row, local),
    nightsLeft: fire
      ? hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES).nightsLeft
      : null,
    fuelSpace: fire ? fuelSpace(fire, row.fuelledThrough, local, HOME_BASE_RULES) : null,
    capacity: habitat ? (habitat.levels[level - 1]?.capacity ?? 0) : null,
    residents: habitat ? residents : null,
  };
}

function requireBuildingData(id: string): Building {
  const building = BUILDING_DATA.get(id);
  if (!building) throw new AppError('NOT_FOUND', MESSAGES.unknown);
  return building;
}

export function createBuildingsService(options: BuildingsServiceOptions): BuildingsService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createBuildingsRepo(db);
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  /** Everything the home screen shows, read through `repo` (inside or outside a transaction). */
  async function homeView(
    repo: BuildingsRepo,
    tx: Executor,
    mapId: string,
    userId: string,
    at: Date,
    timeZone: string,
  ): Promise<HomeResponse> {
    const local = mapLocalTime(at, timeZone);
    const [tiles, buildings, squishies, items] = await Promise.all([
      repo.listHomeTiles(mapId, userId),
      repo.listOwned(mapId, userId),
      repo.listSquishies(mapId, userId),
      createInventoryRepo(tx).list({ mapId, userId }),
    ]);
    const seed = heartSeedOf(tiles);
    const active = squishies.filter((s) => s.state === 'active');
    // A secret species the player owns is one they've met (DECISIONS, secret species).
    const speciesDefs = [...new Set(active.map((s) => s.speciesId))].flatMap((id) => {
      const secret = PUBLIC_SPECIES.has(id) ? undefined : SECRET_SPECIES.get(id);
      return secret ? [secret] : [];
    });
    return {
      tiles: tiles.map((t) => ({
        q: t.q,
        r: t.r,
        heartSeed: isSeed(t, seed),
        nodeResource: t.nodeResource,
      })),
      buildings: buildings.map((b) =>
        toMyBuilding(b, local, squishies.filter((s) => s.habitatBuildingId === b.id).length),
      ),
      squishies: active.map((s) => ({
        id: s.id,
        speciesId: s.speciesId,
        element: s.element as HomeResponse['squishies'][number]['element'],
        feeling: s.feeling as HomeResponse['squishies'][number]['feeling'],
        nickname: s.nickname,
        level: s.level,
        habitatId: s.habitatBuildingId,
      })),
      speciesDefs,
      items,
      seasons: seasonsOn(at, timeZone),
      tonight: hearthfireState(null, local, HOME_BASE_RULES).tonight,
      now: at.toISOString(),
    };
  }

  /** The target tile and spot, checked: mine, on my home base, and free. */
  function checkSpot(
    home: readonly HomeTileRow[],
    owned: readonly BuildingRow[],
    target: { q: number; r: number; spot: number },
    moving: string | null = null,
  ): HomeTileRow {
    const tile = home.find((t) => t.q === target.q && t.r === target.r);
    if (!tile) throw new AppError('FORBIDDEN', MESSAGES.notHome);
    if (isReservedSpot({ heartSeed: isSeed(tile, heartSeedOf(home)), ...tile }, target.spot)) {
      throw new AppError('CONFLICT', MESSAGES.spotTaken);
    }
    const taken = owned.some(
      (b) => b.id !== moving && b.tileId === tile.id && b.spot === target.spot,
    );
    if (taken) throw new AppError('CONFLICT', MESSAGES.spotTaken);
    return tile;
  }

  /** Runs a command for one player in one transaction, then publishes. */
  async function command<T>(
    user: PublicUser,
    mapId: string,
    run: (ctx: {
      repo: BuildingsTxRepo;
      tx: Executor;
      at: Date;
      local: MapLocalTime;
      timeZone: string;
      home: HomeTileRow[];
    }) => Promise<T>,
  ): Promise<T> {
    const at = now();
    let result: T;
    try {
      result = await store.transaction(async (repo, tx) => {
        const map = await requireMember(tx, user, mapId);
        // Every building command for this player runs one at a time (repo.ts).
        const home = await repo.lockHomeTiles(mapId, user.id);
        return run({
          repo,
          tx,
          at,
          local: mapLocalTime(at, map.timeZone),
          timeZone: map.timeZone,
          home,
        });
      });
    } catch (err) {
      // Two taps raced for the same spot (the one-building-per-spot key).
      if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.spotTaken);
      throw err;
    }
    published(mapId);
    return result;
  }

  async function lockMine(
    repo: BuildingsRepo,
    mapId: string,
    userId: string,
    buildingRowId: string,
  ): Promise<BuildingRow> {
    const row = await repo.lockBuilding(buildingRowId);
    if (!row || row.mapId !== mapId || row.ownerUserId !== userId) {
      throw new AppError('NOT_FOUND', MESSAGES.noBuilding);
    }
    return row;
  }

  return {
    home: async (user, mapId) => {
      const map = await requireMember(db, user, mapId);
      return homeView(store, db, mapId, user.id, now(), map.timeZone);
    },

    place: (user, mapId, request) => {
      const building = requireBuildingData(request.buildingId);
      if (!isBuildable(HOME_BASE_RULES, building)) throw new AppError('CONFLICT', MESSAGES.notYet);
      return command(user, mapId, async ({ repo, tx, at, local, timeZone, home }) => {
        if (!inSeason(building, new Set(seasonsOn(at, timeZone)))) {
          const season = SEASON_NAMES.get(building.season ?? '') ?? 'its season';
          throw new AppError('CONFLICT', MESSAGES.outOfSeason(building.name, season));
        }
        const owned = await repo.listOwned(mapId, user.id);
        const tile = checkSpot(home, owned, request);
        if (owned.filter((b) => b.buildingId === building.id).length >= building.maxPerHome) {
          throw new AppError('CONFLICT', MESSAGES.tooMany(building.name));
        }
        const row = await repo.insertBuilding({
          mapId,
          ownerUserId: user.id,
          tileId: tile.id,
          buildingId: building.id,
          kind: building.kind,
          spot: request.spot,
          placedAt: at,
        });
        // Short of anything: CONFLICT, and the row rolls back with it.
        const cost = buildCost(building);
        await consumeItems(tx, { mapId, userId: user.id }, cost, 'build', row.id);
        await repo.appendEvent({
          mapId,
          type: 'building.placed',
          actorUserId: user.id,
          payload: { userId: user.id, building: placed(row, local), cost },
        });
        return homeView(repo, tx, mapId, user.id, at, timeZone);
      });
    },

    move: (user, mapId, buildingRowId, request) =>
      command(user, mapId, async ({ repo, tx, at, local, timeZone, home }) => {
        const row = await lockMine(repo, mapId, user.id, buildingRowId);
        const owned = await repo.listOwned(mapId, user.id);
        const tile = checkSpot(home, owned, request, row.id);
        if (tile.id !== row.tileId || request.spot !== row.spot) {
          await repo.moveBuilding(row.id, { tileId: tile.id, spot: request.spot });
          await repo.appendEvent({
            mapId,
            type: 'building.moved',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              from: { q: row.q, r: row.r, spot: row.spot },
              building: placed(
                { ...row, tileId: tile.id, q: tile.q, r: tile.r, spot: request.spot },
                local,
              ),
            },
          });
        }
        return homeView(repo, tx, mapId, user.id, at, timeZone);
      }),

    remove: (user, mapId, buildingRowId) =>
      command(user, mapId, async ({ repo, tx, at, local, timeZone }) => {
        const row = await lockMine(repo, mapId, user.id, buildingRowId);
        const building = BUILDING_DATA.get(row.buildingId);
        const refund: ItemCounts = building
          ? removeRefund(building, row.level, HOME_BASE_RULES)
          : {};
        // Fuel it hasn't burned yet comes back whole.
        if (building?.kind === 'hearthfire') {
          const { nightsLeft } = hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES);
          if (nightsLeft > 0) {
            for (const [id, n] of Object.entries(fuelCost(building, nightsLeft))) {
              refund[id] = (refund[id] ?? 0) + n;
            }
          }
        }
        const movedOut = await repo.moveOutAll(row.id);
        await repo.deleteBuilding(row.id);
        if (Object.keys(refund).length > 0) {
          await grantItems(tx, { mapId, userId: user.id }, refund, 'build-refund', row.id);
        }
        await repo.appendEvent({
          mapId,
          type: 'building.removed',
          actorUserId: user.id,
          payload: {
            userId: user.id,
            buildingRowId: row.id,
            buildingId: row.buildingId,
            q: row.q,
            r: row.r,
            refund,
            movedOut,
          },
        });
        return { refund, home: await homeView(repo, tx, mapId, user.id, at, timeZone) };
      }),

    fuel: (user, mapId, buildingRowId, nights) =>
      command(user, mapId, async ({ repo, tx, at, local, timeZone }) => {
        const row = await lockMine(repo, mapId, user.id, buildingRowId);
        const fire = BUILDING_DATA.get(row.buildingId);
        if (fire?.kind !== 'hearthfire') throw new AppError('CONFLICT', MESSAGES.notAFire);
        const space = fuelSpace(fire, row.fuelledThrough, local, HOME_BASE_RULES);
        if (space === 0) throw new AppError('CONFLICT', MESSAGES.full);
        // More than fits: add what fits, and pay only for that.
        const adding = Math.min(nights, space);
        const fuelledThrough = addFuel(fire, row.fuelledThrough, local, adding, HOME_BASE_RULES);
        await consumeItems(tx, { mapId, userId: user.id }, fuelCost(fire, adding), 'fuel', row.id);
        await repo.setFuel(row.id, fuelledThrough, at);
        await repo.appendEvent({
          mapId,
          type: 'building.fueled',
          actorUserId: user.id,
          payload: {
            userId: user.id,
            building: placed({ ...row, fuelledThrough }, local),
            nights: adding,
            fuelledThrough,
          },
        });
        return homeView(repo, tx, mapId, user.id, at, timeZone);
      }),

    house: (user, mapId, squishyId, habitatRowId) =>
      command(user, mapId, async ({ repo, tx, at, timeZone }) => {
        let habitat: { row: BuildingRow; name: string; capacity: number } | null = null;
        if (habitatRowId !== null) {
          const row = await lockMine(repo, mapId, user.id, habitatRowId);
          const data = BUILDING_DATA.get(row.buildingId);
          if (data?.kind !== 'habitat') throw new AppError('CONFLICT', MESSAGES.notAHabitat);
          const level = data.levels[Math.min(row.level, data.levels.length) - 1];
          habitat = { row, name: data.name, capacity: level?.capacity ?? 0 };
        }
        const squishy = await repo.lockSquishy(squishyId);
        if (!squishy || squishy.mapId !== mapId || squishy.ownerUserId !== user.id) {
          throw new AppError('NOT_FOUND', MESSAGES.noSquishy);
        }
        if (squishy.state !== 'active') throw new AppError('CONFLICT', MESSAGES.inHollow);
        if (squishy.habitatBuildingId !== habitatRowId) {
          if (habitat && (await repo.countResidents(habitat.row.id)) >= habitat.capacity) {
            throw new AppError('CONFLICT', MESSAGES.habitatFull(habitat.name));
          }
          await repo.setHabitat(squishy.id, habitatRowId);
          await repo.appendEvent({
            mapId,
            type: 'squishy.housed',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              squishyId: squishy.id,
              habitatId: habitatRowId,
              fromHabitatId: squishy.habitatBuildingId,
            },
          });
        }
        return homeView(repo, tx, mapId, user.id, at, timeZone);
      }),
  };
}

/**
 * Deletes a departing member's buildings, inside the maps module's leave /
 * remove transaction (decision: a returning player gets a fresh home base).
 * Their squishies move out of the habitats (the foreign key sets null).
 */
export async function removeMemberBuildings(
  tx: Executor,
  mapId: string,
  userId: string,
): Promise<number> {
  return createBuildingsRepo(tx).deleteOwned(mapId, userId);
}

/**
 * Every member-visible building on a map, by tile (`"q,r"`), for the map
 * view (`PublicTile.buildings`). Read through the view's own snapshot `tx`,
 * with `lit` as of `at`.
 */
export async function listPublicBuildings(
  tx: Executor,
  mapId: string,
  at: Date,
  timeZone: string,
): Promise<Map<string, PublicBuilding[]>> {
  const local = mapLocalTime(at, timeZone);
  const byTile = new Map<string, PublicBuilding[]>();
  for (const row of await createBuildingsRepo(tx).listOnMap(mapId)) {
    const key = `${String(row.q)},${String(row.r)}`;
    const list = byTile.get(key) ?? [];
    list.push(toPublicBuilding(row, local));
    byTile.set(key, list);
  }
  return byTile;
}
