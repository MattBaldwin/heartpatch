import {
  addDays,
  addFuel,
  HOLLOW_RULES,
  latestMorning,
  type UpkeepOrderRequest,
  buildCost,
  buildingPageKey,
  EMPTY_PROGRESS_FACTS,
  fitsSlot,
  fuelCost,
  fuelSpace,
  GAME_DATA,
  heartSeedOf,
  HOME_BASE_RULES,
  houseTile,
  hearthfireState,
  inSeason,
  isBuildable,
  isReservedSpot,
  NAMING_RULES,
  namingGate,
  tileUseRefusal,
  jobOf,
  planFuelAll,
  removeRefund,
  spentOn,
  upgradeCost,
  type Building,
  type FuelAllResponse,
  type HomeNameRequest,
  type HomeNaming,
  type HomeResponse,
  type ItemCounts,
  type MapLocalTime,
  type MoveBuildingRequest,
  type MyBuilding,
  type PlaceBuildingRequest,
  type PlacedBuilding,
  type PublicBuilding,
  HOUSE_START_LEVEL,
  type PublicUser,
  type RemoveBuildingResponse,
} from '@heartpatch/shared';
import { SERVER_GAME_DATA } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import { assertAllowedText } from '../../lib/filter.js';
import { mapLocalTime, type Clock } from '../../lib/time.js';
import { foldHabitatLean } from '../care/evolution.js';
import { createInventoryRepo } from '../inventory/repo.js';
import {
  consumeItems,
  grantItems,
  lockGrantRows,
  recipeBookPage,
  requirePageOpen,
  seasonsOn,
} from '../inventory/service.js';
import { homesteadOf } from '../explore/homesteads.js';
import { clearGoingOn } from '../clearing/repo.js';
import { createExploreRepo } from '../explore/repo.js';
import { createFactoryRepo } from '../factory/repo.js';
import { applyBatchPlans, planGrants, stopPlan, type BatchPlan } from '../factory/service.js';
import { createHouseRepo } from '../house/repo.js';
import { HOUSE_OFF, houseOpenFor, type HouseSwitch } from '../house/switch.js';
import { landTraining, leaveWork } from '../jobs/service.js';
import { createMapsRepo, type MapRow, type MemberNamingRow } from '../maps/repo.js';
import { requireMember } from '../maps/members.js';
import { wornAccessories } from '../wardrobe/accessories.js';
import { seedHomeRingNodes, type HomeRingLog } from './home-ring.js';
import { bankOutput, productionAt, productionView, suitsLand } from './production.js';
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
 * Home base and buildings (#18, design doc §11, §13–14). Players build
 * habitats and the like on the spots of their own home tiles (the Heart
 * Seed and its ring), and Hearthfires (`placement: 'land'`, #202) only out on
 * captured land, one a tile (`maxPerTile`): the Heart Seed keeps home safe
 * (owner decision 2026-10-07). Each building takes a spot of its `slot`
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
const TERRAIN_NAMES = new Map(GAME_DATA.terrains.map((t) => [t.id, t.name.toLowerCase()]));
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
  villageRing: 'Building in your village comes soon! Build at home for now 🏡',
  notHomestead: (name: string) =>
    `${name} go on a homestead 🏡. Explore all of a tile next to home to make one!`,
  homesteadNapping: 'This homestead is napping zZ. Join it back up to home first!',
  notMine: 'You can only build on your own land.',
  fireAtHome: 'Fires go on your land, in the middle of a tile 🔥. Your Heart Seed keeps home safe!',
  spotTaken: 'Something is already there. Try another spot!',
  middleTaken: 'The middle of this tile is taken. A fire next door can reach it!',
  wrongSlot: (building: Building) =>
    building.slot === 'centre'
      ? `${building.name}s go in the middle of a tile!`
      : `The ${building.name} goes around the middle of a tile!`,
  tileHasOne: (name: string) => `This tile already has a ${name}!`,
  staysPut: (name: string) =>
    `Your ${name} stays where it is. Take it down to build it somewhere else.`,
  noFires: 'You have no fires to fuel yet. Build one first!',
  allFull: 'All your fires are full! Come back after a night or two.',
  tooMany: (name: string) => `Your home already has all the ${name} it can hold!`,
  onlyOne: (name: string) => `You already have a ${name}! One is plenty.`,
  noBuilding: "We couldn't find that building.",
  notAFire: 'Only fires need fuel.',
  full: "It's full! Come back after a night or two.",
  notAHabitat: 'Squishies can only move into a habitat.',
  noSquishy: "We couldn't find that squishy.",
  inHollow: 'That squishy is in the Hollow right now. Rescue them first!',
  inTrade: 'That squishy is waiting at a trading post right now. 📬',
  habitatFull: (name: string) => `The ${name} is full! Try another home.`,
  onWatch: (name: string) => `Bring ${name} home from watch first!`,
  topLevel: (name: string) => `Your ${name} is as big as it gets!`,
  fenceOnEdge: 'Fences go on the edges of a tile. Tap 🪵 Fences on your land!',
  tileTaken: 'Only one building fits on a tile! Try another one.',
  houseTile: 'Your house lives on this tile 🏡. Try another one!',
  clearFirst: 'Clear this land first 🌱. Then you can build here!',
  squishyBusy: 'A squishy is gathering here. Ask your squishy to move first!',
  clearing: "You're clearing this land. Let it finish first!",
  wrongLand: (name: string, terrain: string) =>
    `${/^[aeiou]/i.test(name) ? 'An' : 'A'} ${name} goes on ${terrain} land!`,
  namingLocked: `Build one of each and befriend ${String(NAMING_RULES.caughtToName)} squishies first!`,
  seedFirst: 'Your Heart Seed needs to grow first 🌱',
  noPatch: "We couldn't find that patch.",
  noUpkeep: "That building doesn't need Heart Coins.",
} as const;

/**
 * The Heart Seed's level for naming (#306): 1 for everyone until #221 grows
 * it. Not `gatherProgressFacts` (ten queries) on the hot home read.
 */
const heartSeedLevel = (): number => EMPTY_PROGRESS_FACTS.heartSeedLevel;

/** Naming my home as the home view shows it (#306 PR 0). */
const namingOf = (row: MemberNamingRow): HomeNaming => ({
  name: row.homeName,
  ...namingGate(
    { ...row, heartSeedLevel: heartSeedLevel() },
    NAMING_RULES,
    HOME_BASE_RULES.buildableKinds,
  ),
});

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
  /**
   * Names my home (#306 PR 0), once naming is unlocked, and again after each
   * Heart Seed upgrade. Patches only, never the Tutorial Glade.
   */
  name: (user: PublicUser, mapId: string, request: HomeNameRequest) => Promise<HomeResponse>;
  /**
   * Sets the order my upkeep buildings pay their mornings in (#601, owner
   * decision Q5): the listed ones first, in order; the rest by the default.
   */
  upkeepOrder: (
    user: PublicUser,
    mapId: string,
    request: UpkeepOrderRequest,
  ) => Promise<HomeResponse>;
  /** Dev/test only (#601): my resource buildings' storage fills, as if a storage-full had passed. */
  devReady: (user: PublicUser, mapId: string) => Promise<HomeResponse>;
  /** Dev/test only (#601): my upkeep buildings owe `mornings` more mornings. */
  devUpkeepDue: (user: PublicUser, mapId: string, mornings: number) => Promise<HomeResponse>;
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
  /** Where the home-ring top-up reports homes with no room yet (`app.log`). */
  log?: HomeRingLog;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** The Keeper's house switch (`HP_HOUSE`, #381); off when left out. */
  house?: HouseSwitch;
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
function toMyBuilding(
  row: BuildingRow,
  local: MapLocalTime,
  residents: number,
  at: Date,
  timeZone: string,
): MyBuilding {
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
    // Resource buildings (#601): what's waiting for the next settle.
    ...(row.kind === 'resource' ? { production: productionView(row, at, timeZone) } : {}),
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
  const house = options.house ?? HOUSE_OFF;
  const store = createBuildingsRepo(db);
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  /** Whether the Keeper's house (#381) stands at this player's home: patches only, behind its switch. */
  function houseOn(user: PublicUser, kind: MapRow['kind']): boolean {
    return kind === 'multiplayer' && houseOpenFor(house, user);
  }

  /** Everything the home screen shows, read through `repo` (inside or outside a transaction). */
  async function homeView(
    repo: BuildingsRepo,
    tx: Executor,
    mapId: string,
    user: PublicUser,
    at: Date,
    map: Pick<MapRow, 'timeZone' | 'kind'>,
  ): Promise<HomeResponse> {
    const userId = user.id;
    const { timeZone } = map;
    const houseShown = houseOn(user, map.kind);
    const local = mapLocalTime(at, timeZone);
    const [tiles, buildings, squishies, items, naming] = await Promise.all([
      repo.listHomeTiles(mapId, userId),
      repo.listOwned(mapId, userId),
      repo.listSquishies(mapId, userId),
      createInventoryRepo(tx).list({ mapId, userId }),
      // Naming my home (#306): patches only, so the Glade's home stays as it was.
      map.kind === 'multiplayer' ? createMapsRepo(tx).memberNaming(mapId, userId) : null,
    ]);
    const seed = heartSeedOf(tiles);
    const active = squishies.filter((s) => s.state === 'active');
    const worn = await wornAccessories(
      tx,
      userId,
      active.map((s) => s.id),
    );
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
          at,
          timeZone,
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
        accessory: worn.get(s.id) ?? null,
        // Not gated, like the job board and the care sheet: only the
        // switched routes can make a resident, so it's null while it's off.
        houseRoomId: s.houseRoomId,
      })),
      speciesDefs,
      items,
      seasons: seasonsOn(at, timeZone),
      tonight: hearthfireState(null, local, HOME_BASE_RULES).tonight,
      now: at.toISOString(),
      // The Keeper's house (#381): no row reads as level 1. The Tutorial Glade
      // has none, so Sprout's steps don't change.
      ...(houseShown
        ? {
            house: { level: (await createHouseRepo(tx).level(mapId, userId)) ?? HOUSE_START_LEVEL },
          }
        : {}),
      ...(naming ? { naming: namingOf(naming) } : {}),
    };
  }

  /**
   * The target tile and spot, checked for `building`: one of my tiles its
   * `placement` allows, with no other building on it (#295: one building per
   * tile), no resource spot outside home (clear it first, #242), its slot's
   * kind of spot (#204), free, and not the house's tile while the house
   * stands (#604; `houseStands`). `homestead` is the target's homestead state when
   * it's out on my land.
   */
  function checkSpot(
    userId: string,
    home: readonly HomeTileRow[],
    owned: readonly BuildingRow[],
    building: Building,
    target: { q: number; r: number; spot: number },
    outer: TargetTileRow | null = null,
    moving: string | null = null,
    homestead: 'joined' | 'paused' | null = null,
    houseStands = false,
  ): HomeTileRow {
    const homeTile = home.find((t) => t.q === target.q && t.r === target.r);
    // A won village's ring (#306 PR 3): home land, but it takes no buildings yet.
    if (!homeTile && outer?.ownerUserId === userId && outer.homeSlot !== null) {
      throw new AppError('FORBIDDEN', MESSAGES.villageRing);
    }
    const mine = homeTile ?? (outer?.ownerUserId === userId ? outer : null);
    if (!mine) {
      if (building.placement === 'home') throw new AppError('FORBIDDEN', MESSAGES.notHome);
      if (building.placement === 'homestead') {
        throw new AppError('FORBIDDEN', MESSAGES.notHomestead(building.name));
      }
      throw new AppError('FORBIDDEN', MESSAGES.notMine);
    }
    const taken = owned.some((b) => b.id !== moving && b.tileId === mine.id);
    const refusal = tileUseRefusal(
      building,
      {
        id: mine.id,
        q: mine.q,
        r: mine.r,
        homeSlot: homeTile ? 0 : null,
        nodeResource: mine.nodeResource,
        homestead: homeTile ? null : homestead,
      },
      taken,
    );
    switch (refusal) {
      case null:
        break;
      case 'home-only':
        throw new AppError('FORBIDDEN', MESSAGES.notHome);
      case 'not-at-home':
        throw new AppError(
          'FORBIDDEN',
          building.placement === 'homestead'
            ? MESSAGES.notHomestead(building.name)
            : MESSAGES.fireAtHome,
        );
      case 'homestead-only':
        throw new AppError('FORBIDDEN', MESSAGES.notHomestead(building.name));
      case 'napping':
        throw new AppError('CONFLICT', MESSAGES.homesteadNapping);
      case 'taken':
        throw new AppError('CONFLICT', MESSAGES.tileTaken);
      case 'clear-first':
        throw new AppError('CONFLICT', MESSAGES.clearFirst);
    }
    // The house's tile (#604): worked out from the buildings as they stand,
    // as the client draws it. A moving building's own tile counts as built,
    // so it's never the house's, and the house's tile is always refused.
    if (houseStands && homeTile) {
      const at = houseTile(home, owned);
      if (at && at.q === homeTile.q && at.r === homeTile.r) {
        throw new AppError('CONFLICT', MESSAGES.houseTile);
      }
    }
    if (!fitsSlot(building.slot, target.spot)) {
      throw new AppError('CONFLICT', MESSAGES.wrongSlot(building));
    }
    const seed = homeTile ? isSeed(homeTile, heartSeedOf(home)) : false;
    if (isReservedSpot({ heartSeed: seed, nodeResource: mine.nodeResource }, target.spot)) {
      throw new AppError('CONFLICT', MESSAGES.middleTaken);
    }
    return mine;
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

  /**
   * Where one of my buildings stands, read before the command's locks: a
   * building out on my land (Training Grounds on a homestead, #277) has its
   * tile locked with my home tiles, as assigning a trainee there locks it,
   * so the two take turns. Buildings never leave their tile out on land.
   */
  async function tileOf(
    mapId: string,
    userId: string,
    buildingRowId: string,
  ): Promise<{ q: number; r: number } | null> {
    const row = (await store.listOwned(mapId, userId)).find((b) => b.id === buildingRowId);
    return row && row.homeSlot === null ? { q: row.q, r: row.r } : null;
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
      // An older map's home ring gets its seasonal nodes (owner decision 2026-10-06).
      if (await seedHomeRingNodes(db, mapId, now(), options.log)) published(mapId);
      return homeView(store, db, mapId, user, now(), map);
    },

    place: (user, mapId, request) => {
      const building = requireBuildingData(request.buildingId);
      // Fences go on a tile's edges, through the fences module (#203).
      if (building.kind === 'fence') throw new AppError('CONFLICT', MESSAGES.fenceOnEdge);
      if (!isBuildable(HOME_BASE_RULES, building)) throw new AppError('CONFLICT', MESSAGES.notYet);
      return command(
        user,
        mapId,
        async ({ repo, tx, at, local, timeZone, mapKind, home, outer }) => {
          if (!inSeason(building, new Set(seasonsOn(at, timeZone)))) {
            const season = SEASON_NAMES.get(building.season ?? '') ?? 'its season';
            throw new AppError('CONFLICT', MESSAGES.outOfSeason(building.name, season));
          }
          // A sealed recipe book page can't be built (owner decision 2026-10-05).
          // Moves, removals and fuel aren't gated.
          const page = recipeBookPage(buildingPageKey(building.id));
          if (page) await requirePageOpen(tx, user.id, page);
          // A homestead (#199) is its owner's explore row for the tile, read
          // after the tile locks and before the buildings (tech spec §7 step 6).
          const homestead =
            outer && outer.homeSlot === null
              ? homesteadOf(await createExploreRepo(tx).findRow(user.id, outer.id))
              : null;
          const owned = await repo.listOwned(mapId, user.id);
          const tile = checkSpot(
            user.id,
            home,
            owned,
            building,
            request,
            outer,
            null,
            homestead,
            houseOn(user, mapKind),
          );
          const same = owned.filter((b) => b.buildingId === building.id);
          const homeIds = new Set(home.map((t) => t.id));
          if (homeIds.has(tile.id)) {
            // The home base keeps its own count (#202: one Hearthfire at home).
            if (same.filter((b) => homeIds.has(b.tileId)).length >= (building.maxPerHome ?? 0)) {
              throw new AppError('CONFLICT', MESSAGES.tooMany(building.name));
            }
          } else {
            // One a tile (#295), and a building with a per-player cap (the
            // Crafting Factory, once it stands on a homestead) keeps it
            // across home and land.
            if (same.filter((b) => b.tileId === tile.id).length >= (building.maxPerTile ?? 1)) {
              throw new AppError('CONFLICT', MESSAGES.tileHasOne(building.name));
            }
            if (building.maxPerHome !== undefined && same.length >= building.maxPerHome) {
              throw new AppError('CONFLICT', MESSAGES.onlyOne(building.name));
            }
            // A building blocks its tile's land yield (owner decision
            // 2026-10-11, #295): it doesn't go up where a squishy gathers,
            // nor on land being cleared (#242). Both read under the tile lock,
            // which posting a gatherer and starting a clear take too.
            if ((await repo.gatherersOn(tile.id, user.id)) > 0) {
              throw new AppError('CONFLICT', MESSAGES.squishyBusy);
            }
            if (await clearGoingOn(tx, tile.id, user.id)) {
              throw new AppError('CONFLICT', MESSAGES.clearing);
            }
            // A resource building works its own land (#601): that terrain, or
            // land cleared from it (owner decisions Q1, Q2). Read under the tile lock.
            if (building.kind === 'resource') {
              if (!suitsLand(building, await repo.landOf(tile.id))) {
                const terrain = TERRAIN_NAMES.get(building.terrain) ?? building.terrain;
                throw new AppError('CONFLICT', MESSAGES.wrongLand(building.name, terrain));
              }
            }
          }
          const row = await repo.insertBuilding({
            mapId,
            ownerUserId: user.id,
            tileId: tile.id,
            buildingId: building.id,
            kind: building.kind,
            spot: request.spot,
            placedAt: at,
            // A resource building starts making things now (#601).
            producedSince: building.kind === 'resource' ? at : null,
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
          return homeView(repo, tx, mapId, user, at, { timeZone, kind: mapKind });
        },
        { q: request.q, r: request.r },
      );
    },

    move: (user, mapId, buildingRowId, request) =>
      command(user, mapId, async ({ repo, tx, at, local, timeZone, mapKind, home }) => {
        const row = await lockMine(repo, mapId, user.id, buildingRowId);
        // A building out on my land stays put (#202, #277); home ones move within home.
        const building = requireBuildingData(row.buildingId);
        if (!home.some((t) => t.id === row.tileId))
          throw new AppError('CONFLICT', MESSAGES.staysPut(building.name));
        const owned = await repo.listOwned(mapId, user.id);
        const tile = checkSpot(
          user.id,
          home,
          owned,
          building,
          request,
          null,
          row.id,
          null,
          houseOn(user, mapKind),
        );
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
        return homeView(repo, tx, mapId, user, at, { timeZone, kind: mapKind });
      }),

    remove: async (user, mapId, buildingRowId) =>
      command(
        user,
        mapId,
        async ({ repo, tx, at, local, timeZone, mapKind }) => {
          const row = await lockMine(repo, mapId, user.id, buildingRowId);
          const refund = takeDownRefund(row, local);
          // A resource building's stored output lands first (#601).
          const made = productionAt(row, at, timeZone);
          // A Crafting Factory's batches stop (#294): what's made is kept, the
          // rest comes back. Its batches after the building (step 8, id order).
          const batches =
            row.kind === 'factory'
              ? (await createFactoryRepo(tx).lockRunningIn(row.id)).map((b) =>
                  stopPlan(b, at, 'taken-down'),
                )
              : [];
          const movedOut = await repo.moveOutAll(row.id);
          const trainees = await repo.lockTrainees(row.id);
          // Inventory rows before `species_seen` (tech spec §7 step 11): the
          // refund first, then trainees land what they earned (an evolution
          // writes `species_seen`) and stop, then the building goes.
          await lockGrantRows(tx, mapId, [
            { userId: user.id, items: refund },
            ...(made ? [{ userId: user.id, items: made.ready }] : []),
            ...planGrants(batches),
          ]);
          const banked = made ? await bankOutput(tx, row, made) : null;
          if (Object.keys(refund).length > 0) {
            await grantItems(tx, { mapId, userId: user.id }, refund, 'build-refund', row.id);
          }
          const stopped = await applyBatchPlans(tx, batches, at);
          const training =
            trainees.length > 0 ? await landTraining(tx, { id: mapId }, trainees, at, true) : null;
          await repo.deleteBuilding(row.id);
          if (banked) await repo.appendEvent(banked.event);
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
          for (const event of stopped.events) await repo.appendEvent(event);
          return {
            refund,
            home: await homeView(repo, tx, mapId, user, at, { timeZone, kind: mapKind }),
          };
        },
        await tileOf(mapId, user.id, buildingRowId),
      ),

    fuel: (user, mapId, buildingRowId, nights) =>
      command(user, mapId, async ({ repo, tx, at, local, timeZone, mapKind }) => {
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
        return homeView(repo, tx, mapId, user, at, { timeZone, kind: mapKind });
      }),

    fuelAll: (user, mapId) =>
      command(user, mapId, async ({ repo, tx, at, local, timeZone, mapKind }) => {
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
          // Room but nothing to burn: the usual "You need 1 more Emberwood
          // first!", for a fire that has room (so nothing is ever spent).
          const first = fires.find(
            ({ row, fire }) => fuelSpace(fire, row.fuelledThrough, local, HOME_BASE_RULES) > 0,
          );
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
          home: await homeView(repo, tx, mapId, user, at, { timeZone, kind: mapKind }),
        };
      }),

    upgrade: async (user, mapId, buildingRowId) =>
      command(
        user,
        mapId,
        async ({ repo, tx, at, local, timeZone, mapKind }) => {
          const row = await lockMine(repo, mapId, user.id, buildingRowId);
          const building = requireBuildingData(row.buildingId);
          const cost = upgradeCost(building, row.level);
          if (!cost) throw new AppError('CONFLICT', MESSAGES.topLevel(building.name));
          // Trainees (squishies, step 10) are locked before the cost's inventory
          // rows (step 11).
          const trainees =
            building.kind === 'training-grounds' ? await repo.lockTrainees(row.id) : [];
          // A resource building banks what it made at the old pace first
          // (#601); its rows lock with the cost's (step 11, one item-id order).
          const made = productionAt(row, at, timeZone);
          if (made) {
            await lockGrantRows(tx, mapId, [
              { userId: user.id, items: cost },
              { userId: user.id, items: made.ready },
            ]);
          }
          // Short of anything: CONFLICT ("You need 2 more Glimmer first!"), nothing changes.
          await consumeItems(tx, { mapId, userId: user.id }, cost, 'upgrade', row.id);
          const banked = made ? await bankOutput(tx, row, made) : null;
          // Training XP is worked out from the level, so the whole XP earned at
          // the old rate lands before the level changes; only the part of a
          // point still in progress (minutes) carries on at the new rate.
          const training =
            trainees.length > 0 ? await landTraining(tx, { id: mapId }, trainees, at, false) : null;
          const level = row.level + 1;
          await repo.setLevel(row.id, level);
          if (banked) await repo.appendEvent(banked.event);
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
          return homeView(repo, tx, mapId, user, at, { timeZone, kind: mapKind });
        },
        await tileOf(mapId, user.id, buildingRowId),
      ),

    name: async (user, mapId, { name }) => {
      // The text filter before any lock (CLAUDE.md rule 9): VALIDATION_FAILED.
      assertAllowedText(name, 'name');
      const at = now();
      // Its own transaction, not `command`'s (no home tiles to lock). Lock
      // order (tech spec §7): the member row (step 2, one naming at a time
      // per player), then `maps` for `member.named`.
      const result = await store.transaction(async (repo, tx) => {
        const { map } = await requireMember(tx, user, mapId, ['multiplayer']);
        const row = await createMapsRepo(tx).lockMemberNaming(mapId, user.id);
        if (!row) throw new AppError('NOT_FOUND', MESSAGES.noPatch);
        const level = heartSeedLevel();
        const gate = namingOf(row);
        if (!gate.unlocked) throw new AppError('FORBIDDEN', MESSAGES.namingLocked);
        if (!gate.renameOpen) throw new AppError('FORBIDDEN', MESSAGES.seedFirst);
        await createMapsRepo(tx).setHomeName(mapId, user.id, name, level);
        await repo.appendEvent({
          mapId,
          type: 'member.named',
          actorUserId: user.id,
          payload: { userId: user.id, name },
        });
        return homeView(repo, tx, mapId, user, at, map);
      });
      published(mapId);
      return result;
    },

    upkeepOrder: (user, mapId, { buildingIds }) =>
      command(user, mapId, async ({ repo, tx, at, timeZone, mapKind }) => {
        // My upkeep buildings (step 8, id order): only those can be ordered.
        const mine = new Set((await repo.lockUpkeepBuildings(mapId, user.id)).map((r) => r.id));
        if (buildingIds.some((id) => !mine.has(id))) {
          throw new AppError('NOT_FOUND', MESSAGES.noUpkeep);
        }
        await repo.setUpkeepRanks(mapId, user.id, buildingIds);
        return homeView(repo, tx, mapId, user, at, { timeZone, kind: mapKind });
      }),

    devReady: (user, mapId) =>
      command(user, mapId, async ({ repo, tx, at, timeZone, mapKind }) => {
        for (const row of await repo.lockUpkeepBuildings(mapId, user.id)) {
          const made = productionAt(row, at, timeZone);
          if (!made || made.maxCycles === null) continue;
          const back = made.maxCycles * made.cycleSeconds * 1000;
          await repo.setProduction(row.id, { producedSince: new Date(at.getTime() - back) });
        }
        return homeView(repo, tx, mapId, user, at, { timeZone, kind: mapKind });
      }),

    devUpkeepDue: (user, mapId, mornings) =>
      command(user, mapId, async ({ repo, tx, at, local, timeZone, mapKind }) => {
        const today = latestMorning(local, HOLLOW_RULES.morningMinute);
        for (const row of await repo.lockUpkeepBuildings(mapId, user.id)) {
          const from = row.upkeepPaidThrough ?? today;
          await repo.setProduction(row.id, { upkeepPaidThrough: addDays(from, -mornings) });
        }
        return homeView(repo, tx, mapId, user, at, { timeZone, kind: mapKind });
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
        if (squishy.state === 'in-trade') throw new AppError('CONFLICT', MESSAGES.inTrade);
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
          // Its old habitat's share of its feeling lean lands first (#32).
          await foldHabitatLean(tx, squishy.id, at);
          await repo.setHabitat(squishy.id, habitatRowId, at);
          // A gatherer moving in stops work (housed or working, not both;
          // owner decisions 2026-10-04); what it had ready goes in the bag.
          // A trainee sleeps on its homestead (#277), so it stops training
          // too, landing what it earned.
          const jobEvents =
            habitatRowId === null
              ? []
              : [
                  ...(await leaveWork(
                    tx,
                    { id: mapId, kind: mapKind, timeZone },
                    [squishy.id],
                    'resting',
                    at,
                  )),
                  ...(await landTraining(tx, { id: mapId }, [squishy.id], at, true)).events,
                ];
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
        return homeView(repo, tx, mapId, user, at, { timeZone, kind: mapKind });
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

/** Everything a Crafting Factory cost, all levels (#295: lost with its land, it all comes back). */
function lostFactoryRefund(row: BuildingRow): ItemCounts {
  const building = BUILDING_DATA.get(row.buildingId);
  return building ? spentOn(building, row.level) : {};
}

/** A building that came down with its land (#202), for the caller to finish. */
export interface LostBuilding {
  readonly ownerUserId: string;
  readonly tileId: string;
  readonly refund: ItemCounts;
  /** `building.removed`, `lost` set: append it with the caller's other events. */
  readonly event: NewGameEvent<'building.removed'>;
  /**
   * A Training Grounds' trainees (#277; empty for anything else): the caller
   * locks them with its own squishies (step 10), then `finishLostBuildings`
   * lands what they earned and takes the building down.
   */
  readonly trainees: readonly string[];
  /**
   * A Crafting Factory's batches (#295, owner decision 2026-10-11; empty for
   * anything else), locked and planned to stop: the caller locks
   * `planGrants(batches)` with the refunds (step 11), then `applyBatchPlans`
   * banks what they made and gives back the unfinished inputs, with their
   * `factory.*` events.
   */
  readonly batches: readonly BatchPlan[];
  /**
   * A resource building's stored output (#601; empty for anything else): the
   * caller locks it with the refunds (step 11, `lostOutputGrants`), and
   * `finishLostBuildings` banks it to the owner's bag.
   */
  readonly output: ItemCounts;
}

/** What lost resource buildings give their owners, for the caller's inventory lock (#601). */
export function lostOutputGrants(
  lost: readonly LostBuilding[],
): { userId: string; items: ItemCounts }[] {
  return lost.flatMap((l) =>
    Object.keys(l.output).length > 0 ? [{ userId: l.ownerUserId, items: l.output }] : [],
  );
}

/**
 * Land changed hands or went wild (#202): its buildings come down in the
 * caller's transaction, after its tile locks. Locks them (tech spec §7 step
 * 8, id order) and deletes its fires; the caller grants each `refund` to its
 * owner at step 11 (after any squishy locks) and appends the events, so the
 * rival never gets the fire and nothing is lost but the fire itself.
 * Training Grounds on a homestead (#277) stay until `finishLostBuildings`:
 * deleting one now would clear its trainees' rows (the foreign key) before
 * their XP lands, and before the caller has locked them.
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
  const factory = createFactoryRepo(tx);
  for (const row of await repo.lockOnTiles(tileIds)) {
    // A Crafting Factory lost with its land gives everything back (owner
    // decision 2026-10-11): its full cost, and its batches stop (made things
    // kept, unfinished inputs back). Its batches lock after the buildings
    // (step 8, id order), as taking one down does.
    const isFactory = row.kind === 'factory';
    const refund = isFactory ? lostFactoryRefund(row) : takeDownRefund(row, local);
    const batches = isFactory
      ? (await factory.lockRunningIn(row.id)).map((b) => stopPlan(b, at, 'taken-down'))
      : [];
    // Under the tile lock nobody starts training here. One may stop (moving
    // into a habitat locks only the squishy): `landTraining` reads them again
    // after the squishy locks, so nothing lands twice.
    const trainees = row.kind === 'training-grounds' ? await repo.traineesOf(row.id) : [];
    // A resource building's output up to now lands with the refund (#601).
    const output = productionAt(row, at, timeZone)?.ready ?? {};
    if (row.kind !== 'training-grounds') await repo.deleteBuilding(row.id);
    down.push({
      ownerUserId: row.ownerUserId,
      tileId: row.tileId,
      refund,
      trainees,
      batches,
      output,
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
          movedOut: [...trainees],
          lost,
        },
      },
    });
  }
  return down;
}

/**
 * The rest of `takeDownOnLostLand`, after the caller has locked the trainees
 * (step 10) and every inventory row (step 11: the refunds and
 * `planGrants` of the batches) and granted the refunds: a lost Factory's
 * batches bank what they made and give back their unfinished inputs
 * (#295), then Training Grounds' trainees land what they earned and stop
 * (#277; an evolution writes `species_seen`, after the bag's rows), and the
 * Training Grounds go. Returns the events to append after the caller's own.
 */
export async function finishLostBuildings(
  tx: Executor,
  mapId: string,
  lost: readonly LostBuilding[],
  at: Date,
): Promise<NewGameEvent[]> {
  const stopped = await applyBatchPlans(
    tx,
    lost.flatMap((l) => l.batches),
    at,
  );
  // Lost resource buildings' output lands in their owners' bags (#601).
  const produced: NewGameEvent[] = [];
  for (const l of lost) {
    if (Object.keys(l.output).length === 0) continue;
    const { userId, buildingRowId, buildingId, q, r } = l.event.payload;
    await grantItems(tx, { mapId, userId }, l.output, 'produced', buildingRowId);
    produced.push({
      mapId,
      type: 'building.produced',
      actorUserId: null,
      payload: { userId, buildingRowId, buildingId, q, r, items: l.output },
    });
  }
  const grounds = lost.filter(
    (l) => BUILDING_DATA.get(l.event.payload.buildingId)?.kind === 'training-grounds',
  );
  if (grounds.length === 0) return [...produced, ...stopped.events];
  const trainees = grounds.flatMap((l) => l.trainees);
  const events =
    trainees.length > 0 ? (await landTraining(tx, { id: mapId }, trainees, at, true)).events : [];
  const repo = createBuildingsRepo(tx);
  for (const l of grounds) await repo.deleteBuilding(l.event.payload.buildingRowId);
  return [...produced, ...stopped.events, ...events];
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
): Promise<NewGameEvent[]> {
  const repo = createBuildingsRepo(tx);
  // Read before the delete locks them: every command on these buildings
  // locks their owner's home tiles first, which the caller's release holds.
  const outer = (await repo.listOwned(map.id, userId)).filter((b) => b.homeSlot === null);
  await repo.deleteOwned(map.id, userId);
  // Their Crafting Factory's batches stop (#294), after the buildings (step 8,
  // id order): what's made stays in their bag on this patch, the rest comes back.
  const batches = (await createFactoryRepo(tx).lockRunning({ mapId: map.id, userId })).map((b) =>
    stopPlan(b, at, 'left'),
  );
  const local = mapLocalTime(at, map.timeZone);
  const lost = outer.map((row) => ({ row, refund: takeDownRefund(row, local) }));
  const grants = lost.filter((l) => Object.keys(l.refund).length > 0);
  // A resource building's stored output lands in their bag on this patch (#601).
  const outputs = outer.flatMap((row) => {
    const items = productionAt(row, at, map.timeZone)?.ready ?? {};
    return Object.keys(items).length > 0 ? [{ row, items }] : [];
  });
  await lockGrantRows(tx, map.id, [
    ...grants.map((l) => ({ userId, items: l.refund })),
    ...outputs.map((o) => ({ userId, items: o.items })),
    ...planGrants(batches),
  ]);
  for (const { row, refund } of grants) {
    await grantItems(tx, { mapId: map.id, userId }, refund, 'build-refund', row.id);
  }
  const produced: NewGameEvent<'building.produced'>[] = [];
  for (const { row, items } of outputs) {
    await grantItems(tx, { mapId: map.id, userId }, items, 'produced', row.id);
    produced.push({
      mapId: map.id,
      type: 'building.produced',
      actorUserId: null,
      payload: {
        userId,
        buildingRowId: row.id,
        buildingId: row.buildingId,
        q: row.q,
        r: row.r,
        items,
      },
    });
  }
  const stopped = await applyBatchPlans(tx, batches, at);
  const removed: NewGameEvent<'building.removed'>[] = lost.map(({ row, refund }) => ({
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
  return [...produced, ...removed, ...stopped.events];
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
