import {
  addFuel,
  buildCost,
  buildingPageKey,
  fitsSlot,
  fuelCost,
  fuelSpace,
  GAME_DATA,
  HOME_BASE_RULES,
  hearthfireState,
  inSeason,
  isBuildable,
  isReservedSpot,
  jobOf,
  planFuelAll,
  removeRefund,
  upgradeCost,
  type Building,
  type FuelAllResponse,
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
import type { NewGameEvent } from '../../db/game-events.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import { mapLocalTime, type Clock } from '../../lib/time.js';
import { createInventoryRepo } from '../inventory/repo.js';
import {
  consumeItems,
  grantItems,
  lockGrantRows,
  recipeBookPage,
  requirePageOpen,
  seasonsOn,
} from '../inventory/service.js';
import { landTraining, leaveWork } from '../jobs/service.js';
import type { MapRow } from '../maps/repo.js';
import { requireMember } from '../maps/members.js';
import { BUILDING_DATA, toPublicBuilding } from './hearthfire.js';
import {
  createBuildingsRepo,
  type BuildingRow,
  type BuildingsRepo,
  type BuildingsTxRepo,
  type HomeTileRow,
  type TargetTileRow,
} from './repo.js';

/*
 * Home base and buildings (#18, design doc §11, §13–14). Players build on
 * the spots of their own home tiles (the Heart Seed and its ring), and a
 * building with `placement: 'owned'` (the Hearthfire, #202) on any tile they
 * own, one a tile (`maxPerTile`). Each building takes a spot of its `slot`
 * (#204): a light the middle, a habitat the ring around it. Paying
 * through `consumeItems(…, 'build')` in the same transaction as the row
 * (CLAUDE.md rule 7). Hearthfire fuel is a date (tech spec §7): adding fuel
 * moves `fuelled_through`, and lit / nights left are worked out on read, so
 * nothing ticks (rule 4). Habitats house the player's own active squishies,
 * up to their capacity. Upgrades (owner decision 2026-10-06) pay the next
 * level's cost and raise the level in one transaction; a fire's safe radius
 * follows its level everywhere (`safeRadiusOf`).
 */

const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));
const PUBLIC_SPECIES = new Set(GAME_DATA.species.map((s) => s.id));
const SECRET_SPECIES = new Map(SERVER_GAME_DATA.secretSpecies.map((s) => [s.id, s]));
const SPECIES_NAMES = new Map(
  [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies].map((s) => [s.id, s.name]),
);

// Kid-readable messages (style guide §6).
const MESSAGES = {
  unknown: "We don't know that building.",
  notYet: "That one isn't ready to build yet. Soon!",
  outOfSeason: (name: string, season: string) => `${name} can only be built around ${season}!`,
  notHome: 'You can only build on your home base.',
  notMine: 'You can only build on your own land.',
  spotTaken: 'Something is already there. Try another spot!',
  middleTaken: 'The middle of this tile is taken. A fire next door can reach it!',
  wrongSlot: (building: Building) =>
    building.slot === 'centre'
      ? `${building.name}s go in the middle of a tile!`
      : `The ${building.name} goes around the middle of a tile!`,
  tileHasOne: (name: string) => `This tile already has a ${name}!`,
  staysPut: 'A fire on your land stays where it is. Take it down to build it somewhere else.',
  noFires: 'You have no fires to fuel yet. Build one first!',
  allFull: 'All your fires are full! Come back after a night or two.',
  tooMany: (name: string) => `Your home already has all the ${name} it can hold!`,
  noBuilding: "We couldn't find that building.",
  notAFire: 'Only fires need fuel.',
  full: "It's full! Come back after a night or two.",
  notAHabitat: 'Squishies can only move into a habitat.',
  noSquishy: "We couldn't find that squishy.",
  inHollow: 'That squishy is in the Hollow right now. Rescue them first!',
  habitatFull: (name: string) => `The ${name} is full! Try another home.`,
  onWatch: (name: string) => `Bring ${name} home from watch first!`,
  topLevel: (name: string) => `Your ${name} is as big as it gets!`,
} as const;

/** What to call one of my squishies in a message: its nickname, else its species. */
const squishyName = (s: { nickname: string | null; speciesId: string }): string =>
  s.nickname ?? SPECIES_NAMES.get(s.speciesId) ?? 'your squishy';

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
  /** Tops up all my fires, lowest first, until they're full or my bag runs out (#202). */
  fuelAll: (user: PublicUser, mapId: string) => Promise<FuelAllResponse>;
  /** Raises one of my buildings a level, paying the next level's cost. */
  upgrade: (user: PublicUser, mapId: string, buildingRowId: string) => Promise<HomeResponse>;
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

/**
 * One of my buildings as I see it. `residents`: squishies living in it (a
 * habitat) or practicing at it (Training Grounds).
 */
function toMyBuilding(row: BuildingRow, local: MapLocalTime, residents: number): MyBuilding {
  const building = BUILDING_DATA.get(row.buildingId);
  const fire = building?.kind === 'hearthfire' ? building : null;
  const roomy = building?.kind === 'habitat' || building?.kind === 'training-grounds';
  const level = Math.min(row.level, building?.levels.length ?? 1);
  const step = roomy ? building.levels[level - 1] : undefined;
  return {
    ...placed(row, local),
    nightsLeft: fire
      ? hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES).nightsLeft
      : null,
    fuelSpace: fire ? fuelSpace(fire, row.fuelledThrough, local, HOME_BASE_RULES) : null,
    capacity: roomy ? (step && 'capacity' in step ? step.capacity : 0) : null,
    residents: roomy ? residents : null,
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
        toMyBuilding(
          b,
          local,
          squishies.filter((s) => s.habitatBuildingId === b.id || s.trainingBuildingId === b.id)
            .length,
        ),
      ),
      squishies: active.map((s) => ({
        id: s.id,
        speciesId: s.speciesId,
        element: s.element,
        feeling: s.feeling,
        nickname: s.nickname,
        level: s.level,
        habitatId: s.habitatBuildingId,
        trainingId: s.trainingBuildingId,
        job: jobOf({
          teamSlot: s.teamSlot,
          atWork: s.atWork,
          onWatch: s.onWatch,
          training: s.trainingBuildingId !== null,
        }),
      })),
      speciesDefs,
      items,
      seasons: seasonsOn(at, timeZone),
      tonight: hearthfireState(null, local, HOME_BASE_RULES).tonight,
      now: at.toISOString(),
    };
  }

  /**
   * The target tile and spot, checked for `building`: on my home base (or,
   * for a building that can stand on owned land, any tile I own), its
   * slot's kind of spot (#204), and free.
   */
  function checkSpot(
    userId: string,
    home: readonly HomeTileRow[],
    owned: readonly BuildingRow[],
    building: Building,
    target: { q: number; r: number; spot: number },
    outer: TargetTileRow | null = null,
    moving: string | null = null,
  ): HomeTileRow {
    const homeTile = home.find((t) => t.q === target.q && t.r === target.r);
    if (!homeTile) {
      if (building.placement !== 'owned') throw new AppError('FORBIDDEN', MESSAGES.notHome);
      if (outer?.ownerUserId !== userId) throw new AppError('FORBIDDEN', MESSAGES.notMine);
    }
    const tile = homeTile ?? outer;
    if (!tile) throw new AppError('FORBIDDEN', MESSAGES.notMine);
    if (!fitsSlot(building.slot, target.spot)) {
      throw new AppError('CONFLICT', MESSAGES.wrongSlot(building));
    }
    const seed = homeTile ? isSeed(homeTile, heartSeedOf(home)) : false;
    if (isReservedSpot({ heartSeed: seed, nodeResource: tile.nodeResource }, target.spot)) {
      throw new AppError('CONFLICT', MESSAGES.middleTaken);
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
      mapKind: MapRow['kind'];
      home: HomeTileRow[];
      /** The tile at `target` when one was asked for (locked with the home tiles). */
      outer: TargetTileRow | null;
    }) => Promise<T>,
    target: { q: number; r: number } | null = null,
  ): Promise<T> {
    const at = now();
    let result: T;
    try {
      result = await store.transaction(async (repo, tx) => {
        const { map } = await requireMember(tx, user, mapId);
        // Every building command for this player runs one at a time (repo.ts).
        const { home, target: outer } = target
          ? await repo.lockHomeTilesAnd(mapId, user.id, target)
          : { home: await repo.lockHomeTiles(mapId, user.id), target: null };
        return run({
          repo,
          tx,
          at,
          local: mapLocalTime(at, map.timeZone),
          timeZone: map.timeZone,
          mapKind: map.kind,
          home,
          outer,
        });
      });
    } catch (err) {
      // Two taps raced for the same spot (the one-building-per-spot key, or
      // one fire a tile).
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
      const { map } = await requireMember(db, user, mapId);
      return homeView(store, db, mapId, user.id, now(), map.timeZone);
    },

    place: (user, mapId, request) => {
      const building = requireBuildingData(request.buildingId);
      if (!isBuildable(HOME_BASE_RULES, building)) throw new AppError('CONFLICT', MESSAGES.notYet);
      return command(
        user,
        mapId,
        async ({ repo, tx, at, local, timeZone, home, outer }) => {
          if (!inSeason(building, new Set(seasonsOn(at, timeZone)))) {
            const season = SEASON_NAMES.get(building.season ?? '') ?? 'its season';
            throw new AppError('CONFLICT', MESSAGES.outOfSeason(building.name, season));
          }
          // A sealed recipe book page can't be built (owner decision 2026-10-05).
          // Moves, removals and fuel aren't gated.
          const page = recipeBookPage(buildingPageKey(building.id));
          if (page) await requirePageOpen(tx, user.id, page);
          const owned = await repo.listOwned(mapId, user.id);
          const tile = checkSpot(user.id, home, owned, building, request, outer);
          const same = owned.filter((b) => b.buildingId === building.id);
          const homeIds = new Set(home.map((t) => t.id));
          if (homeIds.has(tile.id)) {
            // The home base keeps its own count (#202: one Hearthfire at home).
            if (same.filter((b) => homeIds.has(b.tileId)).length >= building.maxPerHome) {
              throw new AppError('CONFLICT', MESSAGES.tooMany(building.name));
            }
          } else if (
            same.filter((b) => b.tileId === tile.id).length >= (building.maxPerTile ?? 0)
          ) {
            throw new AppError('CONFLICT', MESSAGES.tileHasOne(building.name));
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
        },
        { q: request.q, r: request.r },
      );
    },

    move: (user, mapId, buildingRowId, request) =>
      command(user, mapId, async ({ repo, tx, at, local, timeZone, home }) => {
        const row = await lockMine(repo, mapId, user.id, buildingRowId);
        // A fire out on my land stays put (#202); home buildings move within home.
        if (!home.some((t) => t.id === row.tileId))
          throw new AppError('CONFLICT', MESSAGES.staysPut);
        const owned = await repo.listOwned(mapId, user.id);
        const building = requireBuildingData(row.buildingId);
        const tile = checkSpot(user.id, home, owned, building, request, null, row.id);
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
        const refund = takeDownRefund(row, local);
        const movedOut = await repo.moveOutAll(row.id);
        const trainees = await repo.lockTrainees(row.id);
        // Inventory rows before `species_seen` (tech spec §7 step 11): the
        // refund first, then trainees land what they earned (an evolution
        // writes `species_seen`) and stop, then the building goes.
        if (Object.keys(refund).length > 0) {
          await grantItems(tx, { mapId, userId: user.id }, refund, 'build-refund', row.id);
        }
        const training =
          trainees.length > 0 ? await landTraining(tx, { id: mapId }, trainees, at, true) : null;
        await repo.deleteBuilding(row.id);
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
            movedOut: [...new Set([...movedOut, ...trainees])].sort(),
          },
        });
        for (const event of training?.events ?? []) await repo.appendEvent(event);
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

    fuelAll: (user, mapId) =>
      command(user, mapId, async ({ repo, tx, at, local, timeZone }) => {
        // My fires (step 8, id order), then the bag's rows (step 11, `consumeItems`).
        const fires = (await repo.lockFires(mapId, user.id)).flatMap((row) => {
          const fire = BUILDING_DATA.get(row.buildingId);
          return fire?.kind === 'hearthfire' ? [{ row, fire }] : [];
        });
        if (fires.length === 0) throw new AppError('CONFLICT', MESSAGES.noFires);
        const items = await createInventoryRepo(tx).list({ mapId, userId: user.id });
        const plan = planFuelAll(
          fires.map(({ row, fire }) => ({
            id: row.id,
            fuelResource: fire.fuelResource,
            fuelPerNight: fire.fuelPerNight,
            nightsLeft: hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES).nightsLeft,
            space: fuelSpace(fire, row.fuelledThrough, local, HOME_BASE_RULES),
          })),
          items,
        );
        const room = fires.some(
          ({ row, fire }) =>
            fuelSpace(fire, row.fuelledThrough, local, HOME_BASE_RULES) > (plan.get(row.id) ?? 0),
        );
        if (plan.size === 0) {
          if (!room) throw new AppError('CONFLICT', MESSAGES.allFull);
          // Room but nothing to burn: the usual "You need 1 more Emberwood first!".
          const first = fires[0];
          if (first)
            await consumeItems(
              tx,
              { mapId, userId: user.id },
              fuelCost(first.fire, 1),
              'fuel',
              first.row.id,
            );
        }
        const total: ItemCounts = {};
        for (const { row, fire } of fires) {
          const nights = plan.get(row.id) ?? 0;
          if (nights === 0) continue;
          for (const [id, n] of Object.entries(fuelCost(fire, nights)))
            total[id] = (total[id] ?? 0) + n;
        }
        // One spend for all of it: the rows lock once, in item-id order.
        await consumeItems(tx, { mapId, userId: user.id }, total, 'fuel', null);
        let nights = 0;
        for (const { row, fire } of fires) {
          const adding = plan.get(row.id) ?? 0;
          if (adding === 0) continue;
          const fuelledThrough = addFuel(fire, row.fuelledThrough, local, adding, HOME_BASE_RULES);
          await repo.setFuel(row.id, fuelledThrough, at);
          nights += adding;
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
        }
        return {
          fires: plan.size,
          nights,
          short: room,
          home: await homeView(repo, tx, mapId, user.id, at, timeZone),
        };
      }),

    upgrade: (user, mapId, buildingRowId) =>
      command(user, mapId, async ({ repo, tx, at, local, timeZone }) => {
        const row = await lockMine(repo, mapId, user.id, buildingRowId);
        const building = requireBuildingData(row.buildingId);
        const cost = upgradeCost(building, row.level);
        if (!cost) throw new AppError('CONFLICT', MESSAGES.topLevel(building.name));
        // Trainees (squishies, step 10) are locked before the cost's inventory
        // rows (step 11).
        const trainees =
          building.kind === 'training-grounds' ? await repo.lockTrainees(row.id) : [];
        // Short of anything: CONFLICT ("You need 2 more Glimmer first!"), nothing changes.
        await consumeItems(tx, { mapId, userId: user.id }, cost, 'upgrade', row.id);
        // Training XP is worked out from the level, so the whole XP earned at
        // the old rate lands before the level changes; only the part of a
        // point still in progress (minutes) carries on at the new rate.
        const training =
          trainees.length > 0 ? await landTraining(tx, { id: mapId }, trainees, at, false) : null;
        const level = row.level + 1;
        await repo.setLevel(row.id, level);
        await repo.appendEvent({
          mapId,
          type: 'building.upgraded',
          actorUserId: user.id,
          payload: {
            userId: user.id,
            building: placed({ ...row, level }, local),
            fromLevel: row.level,
            cost,
          },
        });
        for (const event of training?.events ?? []) await repo.appendEvent(event);
        return homeView(repo, tx, mapId, user.id, at, timeZone);
      }),

    house: (user, mapId, squishyId, habitatRowId) =>
      command(user, mapId, async ({ repo, tx, at, timeZone, mapKind }) => {
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
        // Housed or on watch, not both (owner decision 2026-10-03). Moving out
        // is always fine. Posting it locks the squishy too, so the two can't race.
        if (
          habitatRowId !== null &&
          squishy.habitatBuildingId !== habitatRowId &&
          (await repo.isOnWatch(squishy.id))
        ) {
          throw new AppError('CONFLICT', MESSAGES.onWatch(squishyName(squishy)));
        }
        if (squishy.habitatBuildingId !== habitatRowId) {
          if (habitat && (await repo.countResidents(habitat.row.id)) >= habitat.capacity) {
            throw new AppError('CONFLICT', MESSAGES.habitatFull(habitat.name));
          }
          await repo.setHabitat(squishy.id, habitatRowId);
          // A gatherer moving in stops work (housed or working, not both;
          // owner decisions 2026-10-04); what it had ready goes in the bag.
          const jobEvents =
            habitatRowId === null
              ? []
              : await leaveWork(
                  tx,
                  { id: mapId, kind: mapKind, timeZone },
                  [squishy.id],
                  'resting',
                  at,
                );
          for (const event of jobEvents) await repo.appendEvent(event);
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
 * What taking a building down gives back (design doc §13): its refund share
 * of everything spent on it, plus, for a fire, the fuel it hasn't burned.
 */
export function takeDownRefund(row: BuildingRow, local: MapLocalTime): ItemCounts {
  const building = BUILDING_DATA.get(row.buildingId);
  const refund: ItemCounts = building ? removeRefund(building, row.level, HOME_BASE_RULES) : {};
  if (building?.kind === 'hearthfire') {
    const { nightsLeft } = hearthfireState(row.fuelledThrough, local, HOME_BASE_RULES);
    if (nightsLeft > 0) {
      for (const [id, n] of Object.entries(fuelCost(building, nightsLeft))) {
        refund[id] = (refund[id] ?? 0) + n;
      }
    }
  }
  return refund;
}

/** A building that came down with its land (#202), for the caller to finish. */
export interface LostBuilding {
  readonly ownerUserId: string;
  readonly tileId: string;
  readonly refund: ItemCounts;
  /** `building.removed`, `lost` set: append it with the caller's other events. */
  readonly event: NewGameEvent<'building.removed'>;
}

/**
 * Land changed hands or went wild (#202): its buildings come down in the
 * caller's transaction, after its tile locks. Locks them (tech spec §7 step
 * 8, id order) and deletes them; the caller grants each `refund` to its
 * owner at step 11 (after any squishy locks) and appends the events, so the
 * rival never gets the fire and nothing is lost but the fire itself.
 * Buildings on captured land are fires (placement `owned`): nobody lives
 * in them.
 */
export async function takeDownOnLostLand(
  tx: Executor,
  mapId: string,
  tileIds: readonly string[],
  at: Date,
  timeZone: string,
  lost: 'captured' | 'wild',
): Promise<LostBuilding[]> {
  const repo = createBuildingsRepo(tx);
  const local = mapLocalTime(at, timeZone);
  const down: LostBuilding[] = [];
  for (const row of await repo.lockOnTiles(tileIds)) {
    const refund = takeDownRefund(row, local);
    await repo.deleteBuilding(row.id);
    down.push({
      ownerUserId: row.ownerUserId,
      tileId: row.tileId,
      refund,
      event: {
        mapId,
        type: 'building.removed',
        actorUserId: null,
        payload: {
          userId: row.ownerUserId,
          buildingRowId: row.id,
          buildingId: row.buildingId,
          q: row.q,
          r: row.r,
          refund,
          movedOut: [],
          lost,
        },
      },
    });
  }
  return down;
}

/**
 * Deletes a departing member's buildings, inside the maps module's leave /
 * remove transaction (decision: a returning player gets a fresh home base),
 * after their tiles are released. Their squishies move out of the habitats
 * (the foreign key sets null). A fire out on their captured land gives back
 * what a lost one does (#202: half its cost and its unburned fuel, step 11);
 * home buildings go as before. Returns the `building.removed` events to append.
 */
export async function removeMemberBuildings(
  tx: Executor,
  map: { id: string; timeZone: string },
  userId: string,
  at: Date,
): Promise<NewGameEvent<'building.removed'>[]> {
  const repo = createBuildingsRepo(tx);
  // Read before the delete locks them: every command on these buildings
  // locks their owner's home tiles first, which the caller's release holds.
  const outer = (await repo.listOwned(map.id, userId)).filter((b) => b.homeSlot === null);
  await repo.deleteOwned(map.id, userId);
  const local = mapLocalTime(at, map.timeZone);
  const lost = outer.map((row) => ({ row, refund: takeDownRefund(row, local) }));
  const grants = lost.filter((l) => Object.keys(l.refund).length > 0);
  await lockGrantRows(
    tx,
    map.id,
    grants.map((l) => ({ userId, items: l.refund })),
  );
  for (const { row, refund } of grants) {
    await grantItems(tx, { mapId: map.id, userId }, refund, 'build-refund', row.id);
  }
  return lost.map(({ row, refund }) => ({
    mapId: map.id,
    type: 'building.removed',
    actorUserId: null,
    payload: {
      userId,
      buildingRowId: row.id,
      buildingId: row.buildingId,
      q: row.q,
      r: row.r,
      refund,
      movedOut: [],
      lost: 'left',
    },
  }));
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
