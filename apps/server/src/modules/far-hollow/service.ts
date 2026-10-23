import {
  allBits,
  BATTLE_RULES,
  COMMUNITY_RULES,
  CROOKED_HOUSE,
  deriveSeed,
  doorBetween,
  doorOpen,
  echoCatch,
  EXPLORE_RULES,
  farHollowSeed,
  GAME_DATA,
  GROWTH_RULES,
  hasBit,
  HOLLOW_RULES,
  HOME_BASE_RULES,
  hollowedOpenAt,
  houseReach,
  JOURNEY_RULES,
  journeyFor,
  latestSeasonRun,
  nextSeasonRun,
  doorLeadsTo,
  Rng,
  withBit,
  type DevFarHollowRequest,
  type ExploreNotable,
  type FarHollowView,
  type CrookedChestRequest,
  type CrookedChestResponse,
  type CrookedEnterRequest,
  type CrookedEnterResponse,
  type CrookedFind,
  type CrookedFixRequest,
  type CrookedFixResponse,
  type CrookedPowerRequest,
  type CrookedRoom,
  type CrookedUnlockRequest,
  type CrookedHouseView,
  type CrookedViewResponse,
  type ItemCounts,
  type PublicUser,
  type SeasonRun,
} from '@heartpatch/shared';
import {
  CROOKED_HOUSE_SECRETS,
  crookedHouseSecrets,
  FAR_HOLLOW_FINDS,
  FAR_HOLLOW_SECRETS,
  LORE_PAGES,
  NOTHING_FOUND,
  rollExploreFind,
  withFoundItems,
  type CrookedHouseSeason,
  type FoundSetRoll,
} from '@heartpatch/shared/server';
import { uuidv7 } from 'uuidv7';
import type { Database, Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { newSeed } from '../../lib/rng.js';
import { localDate, mapLocalTime, type Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import type { BattlesService } from '../battles/service.js';
import { applyXp, growthEvents, type Growth } from '../care/service.js';
import { grantKeepsake } from '../communities/cellar.js';
import { grantItems, lockGrantRows } from '../inventory/service.js';
import { createLoreRepo } from '../lore/repo.js';
import { requireMember } from '../maps/members.js';
import { grantRekindledPiece, rekindledDrop } from '../wardrobe/rekindled.js';
import {
  createFarHollowRepo,
  farHollowTransaction,
  type FarHollowKey,
  type FarHollowRoomRow,
  type FarHollowStateRow,
  type FarHollowStatePatch,
  type FarHollowTxRepo,
} from './repo.js';

/*
 * The far Hollow (#306 PR 6, plan Q7, owner decision 7): each kid's own
 * place, fresh every season, reached by winning the far road from any
 * trading post (`modules/journeys`). Halloween 2026's is the Crooked House
 * (#306 6b): fixed rooms and doors (`CROOKED_HOUSE`), shuffled by the
 * season's seed (`crookedHouseSecrets`, rule 6). The server is the authority
 * (rule 1): it owns where I stand, so a fix, an unlock, a power and a chest
 * happen only in the room I'm in, and I only get there through open doors
 * past the echoes, checked on its own clock. Only progress is stored. A new
 * season is a new seed, so last season's rows stop matching on their own.
 *
 * Lock order (tech spec §7): the state row, then room rows in room id order
 * (step 6); a bloom or a chest then the team's squishies (10) and the bag
 * (11); `maps` last (events).
 */

// Kid-readable messages (style guide §6).
export const FAR_HOLLOW_MESSAGES = {
  notArrived: 'Take the far road from a trading post first! 🧭',
  night: 'Too spooky after dark! Come back in the morning 🌙',
  noMap: "We couldn't find that patch.",
  noRoom: "We couldn't find that room.",
  noThing: "We couldn't find that.",
  noDoor: "We couldn't find that door.",
  notHere: 'Walk into that room first! 🕯️',
  noWay: 'No door from here goes there!',
  locked: 'That door is locked tight! 🔒',
  fixed: "That's already put right! ✨",
  puzzle: 'This one is a puzzle! It wakes up very soon 🧩',
  notKeyDoor: "That door doesn't need a key.",
  noKey: (name: string) => `Locked tight! The ${name} is somewhere in this house… 🗝️`,
  notPowerDoor: "That door doesn't need a squishy's help.",
  notTeam: 'Only a squishy on your battle team can help! 🐾',
  wrongPower: (element: string) => `A ${element} friend could help here!`,
  noChest: "There's no chest in here.",
  opened: 'You already opened that chest!',
  notAllRight: (left: number) =>
    `The page is too faint to read! Put ${left} more ${left === 1 ? 'room' : 'rooms'} right first 🕯️`,
  battling: 'Finish your battle first! ⚔️',
  noTeam: 'Bring a squishy friend on your team to open it! 🐾',
} as const;

const RULES = COMMUNITY_RULES.farHollow;
const HOUSE = CROOKED_HOUSE;
const ROOMS = new Map(HOUSE.rooms.map((r) => [r.id, r]));
/** The rooms that bloom: every main room with something to put right. */
const BLOOMING = HOUSE.rooms.filter((r) => r.kind === 'main' && r.things.length > 0);
const LORE_TITLES = new Map(LORE_PAGES.map((p) => [p.id, p.title]));
const ELEMENT_NAMES = new Map(GAME_DATA.elements.map((e) => [e.id, e.name]));
const index = (list: readonly { id: string }[], id: string) => list.findIndex((x) => x.id === id);

/** My progress through the house, as stored. */
interface HouseRows {
  state: FarHollowStateRow;
  rooms: ReadonlyMap<string, FarHollowRoomRow>;
}

/** Where I stand: the start until I've stepped anywhere. */
const roomOf = (state: FarHollowStateRow) => state.currentRoom ?? HOUSE.start;
const lastLitOf = (state: FarHollowStateRow) => state.lastLitRoom ?? HOUSE.start;
const doorsOpen = (state: FarHollowStateRow) => ({
  unlocked: state.unlocked,
  bonusOpen: state.bonusOpen,
});

/**
 * The lit rooms: the start, every room that bloomed, and the bonus rooms
 * and the attic (in colour once their door opens). Echoes never catch in one,
 * and the dollhouse map walks straight to one.
 */
function litRooms(rooms: ReadonlyMap<string, FarHollowRoomRow>): Set<string> {
  const lit = new Set([HOUSE.start]);
  for (const room of HOUSE.rooms) {
    if (room.kind !== 'main' || rooms.get(room.id)?.bloomedAt) lit.add(room.id);
  }
  return lit;
}

/** My house as the client sees it: never where a key still hides, never a chest's odds. */
function houseViewOf(rows: HouseRows, season: CrookedHouseSeason, at: Date): CrookedHouseView {
  const { state, rooms } = rows;
  const ids = (list: readonly { id: string }[], mask: number) =>
    list.filter((_, i) => hasBit(mask, i)).map((x) => x.id);
  return {
    room: roomOf(state),
    lastLitRoom: lastLitOf(state),
    keys: ids(HOUSE.keys, state.keys),
    unlocked: ids(HOUSE.doors, state.unlocked),
    bonusOpen: ids(HOUSE.doors, state.bonusOpen),
    chestsOpened: ids(HOUSE.rooms, state.chestsOpened),
    rooms: HOUSE.rooms
      .filter((r) => r.kind === 'main')
      .map((r) => {
        const row = rooms.get(r.id);
        return {
          id: r.id,
          fixed: ids(r.things, row?.fixed ?? 0),
          bloomed: r.id === HOUSE.start || (row?.bloomedAt ?? null) !== null,
        };
      }),
    echoes: HOUSE.echoLoops.flatMap((loop) => {
      const phase = season.echoes[loop.id];
      return phase ? [{ loop: loop.id, ...phase }] : [];
    }),
    serverTime: at.toISOString(),
  };
}

/** A room of the house, or a kid-readable 404. */
function roomNamed(id: string): CrookedRoom {
  const room = ROOMS.get(id);
  if (!room) throw new AppError('NOT_FOUND', FAR_HOLLOW_MESSAGES.noRoom);
  return room;
}

/** The find worth telling the patch about, as explore tells it. */
function notableOf(items: ItemCounts, lore: string | null, clothing: string | null) {
  const notable: ExploreNotable | null = lore
    ? 'lore'
    : clothing
      ? 'cosmetic'
      : (items[COMMUNITY_RULES.joyResource] ?? 0) > 0
        ? 'heartdust'
        : null;
  return notable;
}

/** This season's far Hollow on a map, as the server works it out (its seed never leaves). */
export interface FarHollowSeason {
  readonly run: SeasonRun;
  readonly seed: string;
  readonly timeZone: string;
}

/**
 * The season's far Hollow on the map at `at`: the season whose window
 * started last (`latestSeasonRun`) and its seed.
 */
export async function farHollowSeasonAt(
  tx: Executor,
  mapId: string,
  at: Date,
): Promise<FarHollowSeason> {
  const map = await createFarHollowRepo(tx).findMap(mapId);
  if (!map) throw new AppError('NOT_FOUND', FAR_HOLLOW_MESSAGES.noMap);
  const run = latestSeasonRun(GAME_DATA.seasons, localDate(at, map.timeZone));
  if (!run) throw new Error('farHollowSeasonAt: no seasons in the data');
  // A hand-authored map has no seed: derive one, as territory does.
  const mapSeed = map.seed ?? deriveSeed('hand-authored-map', mapId);
  return { run, seed: farHollowSeed(mapSeed, run), timeZone: map.timeZone };
}

/** The far road's trail (`journeyFor` at the far Hollow's distance). */
export function farRoad(): FarHollowView['road'] {
  const { level, teamSize } = journeyFor(RULES.distance, JOURNEY_RULES, GROWTH_RULES.maxLevel);
  return { distance: RULES.distance, level, teamSize };
}

/** Is it day on the map, so the far road is open (the Hollowed places' hours)? */
export function farHollowOpen(at: Date, timeZone: string): boolean {
  return hollowedOpenAt(mapLocalTime(at, timeZone), { ...HOME_BASE_RULES, ...HOLLOW_RULES });
}

export interface FarHollowServiceOptions {
  db: Database;
  /** A bonus chest's rare friend starts a wild battle (owner decision 6). */
  battles: Pick<BattlesService, 'current' | 'startAgainst'>;
  clock?: Clock;
  /** Live sync (`wsHub.publish`) after a commit. */
  publish?: (mapId: string) => Promise<void> | void;
  /** Tests swap the find roll. */
  rng?: () => Rng;
  /** Where a failed friend battle is logged (never thrown: the chest is already open). */
  log?: (message: string, error: unknown) => void;
}

export interface FarHollowService {
  /** My far Hollow this season: arrived or not, my house, and whether I've brought it all back. */
  view: (user: PublicUser, mapId: string) => Promise<FarHollowView>;
  /** Put a crooked thing right in the room I'm in; the room's last one blooms it. */
  fix: (user: PublicUser, mapId: string, request: CrookedFixRequest) => Promise<CrookedFixResponse>;
  /** Step into a room (echoes checked on the server's clock). */
  enter: (
    user: PublicUser,
    mapId: string,
    request: CrookedEnterRequest,
  ) => Promise<CrookedEnterResponse>;
  /** Turn a found key in a door of the room I'm in. */
  unlock: (
    user: PublicUser,
    mapId: string,
    request: CrookedUnlockRequest,
  ) => Promise<CrookedViewResponse>;
  /** A team squishy of the right element opens a power door of the room I'm in. */
  power: (
    user: PublicUser,
    mapId: string,
    request: CrookedPowerRequest,
  ) => Promise<CrookedViewResponse>;
  /** Open the chest of the bonus room or attic I'm in. */
  chest: (
    user: PublicUser,
    mapId: string,
    request: CrookedChestRequest,
  ) => Promise<CrookedChestResponse>;
  /**
   * Dev and e2e only (`HP_DEV_SQUISHY_GRANTS`): arrive without the far road,
   * then jump to a room or put the house nearly right.
   */
  devArrive: (
    user: PublicUser,
    mapId: string,
    request?: DevFarHollowRequest,
  ) => Promise<FarHollowView>;
}

export function createFarHollowService(options: FarHollowServiceOptions): FarHollowService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const rngFor = options.rng ?? (() => Rng.fromSeed(newSeed()));
  const published = (mapId: string) => {
    void Promise.resolve(options.publish?.(mapId)).catch(() => undefined);
  };

  /** The view, from the rows already read. */
  const viewOf = (season: FarHollowSeason, rows: HouseRows | null, at: Date): FarHollowView => {
    const next = nextSeasonRun(GAME_DATA.seasons, localDate(at, season.timeZone));
    return {
      name: RULES.name,
      season: { id: season.run.id, name: season.run.name },
      arrived: rows !== null,
      completedAt: rows?.state.completedAt?.toISOString() ?? null,
      nextSeason: next ? { id: next.id, name: next.name, startsOn: next.startsOn } : null,
      road: farRoad(),
      house: rows ? houseViewOf(rows, crookedHouseSecrets(season.seed), at) : null,
    };
  };

  /** This season's far Hollow and the key of my rows in it. */
  const mine = async (tx: Executor, userId: string, mapId: string, at: Date) => {
    const season = await farHollowSeasonAt(tx, mapId, at);
    const key: FarHollowKey = { userId, mapId, seasonSeed: season.seed };
    return { season, key };
  };

  /** My rows, read (no locks). */
  const readRows = async (tx: Executor, key: FarHollowKey): Promise<HouseRows | null> => {
    const repo = createFarHollowRepo(tx);
    const state = await repo.findState(key);
    if (!state) return null;
    return { state, rooms: new Map((await repo.listRooms(key)).map((r) => [r.roomId, r])) };
  };

  /**
   * A house command's start: I'm a member, I've arrived this season (any
   * hour once I have, owner decision 1), and my state row is locked (step 6).
   */
  const openHouse = async (
    repo: FarHollowTxRepo,
    tx: Executor,
    user: PublicUser,
    mapId: string,
    at: Date,
  ) => {
    await requireMember(tx, user, mapId, ['multiplayer']);
    const { season, key } = await mine(tx, user.id, mapId, at);
    const state = await repo.lockState(key);
    if (!state) throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.notArrived);
    return { season, key, state, secrets: crookedHouseSecrets(season.seed) };
  };

  /** The room I'm in must be `room`, and still reachable from the start. */
  const requireIn = (state: FarHollowStateRow, room: string) => {
    if (roomOf(state) !== room) throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.notHere);
    if (!houseReach(HOUSE, doorsOpen(state)).has(room)) {
      throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.locked);
    }
  };

  /** A door of the room I'm in, or a kid-readable error. */
  const doorHere = (state: FarHollowStateRow, id: string) => {
    const door = HOUSE.doors.find((d) => d.id === id);
    if (!door) throw new AppError('NOT_FOUND', FAR_HOLLOW_MESSAGES.noDoor);
    const here = roomOf(state);
    requireIn(state, here);
    if (doorLeadsTo(door, here) === null)
      throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.notHere);
    return door;
  };

  /**
   * A bloom or a chest: a search in the house (owner decision: blooms roll
   * `FAR_HOLLOW_FINDS`; chests give their pile). The team's XP (step 10),
   * the bag (11), any clothing, and its `explore.searched` at the far road's
   * post, so the lore pages and the Seeker track count it.
   */
  const search = async (
    tx: Executor,
    repo: FarHollowTxRepo,
    input: {
      mapId: string;
      userId: string;
      room: CrookedRoom;
      items: ItemCounts;
      lore: string | null;
      rekindled: FoundSetRoll;
      keepsake: string | null;
      spot: { kind: string; terrain: string };
      at: Date;
    },
  ): Promise<{ find: CrookedFind; events: NewGameEvent[] }> => {
    const { mapId, userId, at } = input;
    const found = withFoundItems(input.items, input.rekindled);

    const team = await createBattlesRepo(tx).listTeam(mapId, userId, BATTLE_RULES.teamSize);
    const growths: Growth[] = [];
    for (const squishyId of team.map((s) => s.id).sort()) {
      const growth = await applyXp(tx, squishyId, EXPLORE_RULES.xpPerSquishy, at, { plain: true });
      if (growth) growths.push(growth);
    }

    const searchId = uuidv7();
    if (Object.keys(found).length > 0) {
      await lockGrantRows(tx, mapId, [{ userId, items: found }]);
      await grantItems(tx, { mapId, userId }, found, 'explore', searchId);
    }
    // Found clothing appends its own event first; ours stay the last writes.
    const drop = { source: 'explore' as const, refId: searchId, userId, mapId, at };
    const clothing = input.keepsake
      ? await grantKeepsake(tx, drop, input.keepsake)
      : await grantRekindledPiece(tx, drop, input.rekindled);
    const notable = notableOf(found, input.lore, clothing);
    // Dev arrivals have no road behind them: the patch's middle stands in.
    const post = (await repo.roadPost(mapId, userId)) ?? { q: 0, r: 0 };
    const events: NewGameEvent[] = [
      {
        mapId,
        type: 'explore.searched',
        actorUserId: userId,
        payload: {
          userId,
          q: post.q,
          r: post.r,
          terrain: input.spot.terrain,
          searchId,
          spot: index(HOUSE.rooms, input.room.id),
          kind: input.spot.kind,
          tool: null,
          items: found,
          lorePage: input.lore,
          notable,
          house: { room: input.room.id },
        },
      },
      ...growthEvents(growths),
    ];
    return {
      find: {
        found,
        lore: input.lore ? { id: input.lore, title: LORE_TITLES.get(input.lore) ?? '' } : null,
        clothing,
        notable,
        xp: growths.map((g) => ({ squishyId: g.squishyId, xp: g.xp })),
      },
      events,
    };
  };

  /** The view inside a command's transaction, after its writes. */
  const afterWrites = async (tx: Executor, season: FarHollowSeason, key: FarHollowKey, at: Date) =>
    viewOf(season, await readRows(tx, key), at);

  return {
    view: async (user, mapId) => {
      await requireMember(db, user, mapId, ['multiplayer']);
      const at = now();
      const { season, key } = await mine(db, user.id, mapId, at);
      return viewOf(season, await readRows(db, key), at);
    },

    fix: async (user, mapId, request) => {
      const at = now();
      const result = await farHollowTransaction(db, async (repo, tx) => {
        const { season, key, state, secrets } = await openHouse(repo, tx, user, mapId, at);
        const room = roomNamed(request.room);
        const bit = index(room.things, request.thing);
        const thing = room.things[bit];
        if (!thing) throw new AppError('NOT_FOUND', FAR_HOLLOW_MESSAGES.noThing);
        requireIn(state, room.id);
        // The Relight boards are #306 6f's.
        if (thing.kind === 'relight') throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.puzzle);
        const [row] = await repo.lockRooms(key, [room.id]);
        if (!row) throw new Error('fix: the room row was not made');
        if (hasBit(row.fixed, bit)) throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.fixed);

        const fixed = withBit(row.fixed, bit);
        const patch: FarHollowStatePatch = {};
        // A key pops out only of the thing the season hid it in (rule 1).
        const hidden = HOUSE.keys.find((k) => {
          const spot = secrets.keys[k.id];
          return spot?.room === room.id && spot.thing === thing.id;
        });
        if (hidden) patch.keys = withBit(state.keys, index(HOUSE.keys, hidden.id));
        const blooms = fixed === allBits(room.things.length);
        if (blooms) patch.lastLitRoom = room.id;
        await repo.setRoom(key, { roomId: room.id, fixed, bloomedAt: blooms ? at : row.bloomedAt });
        await repo.setState(key, patch);

        let bloom: CrookedFind | null = null;
        if (blooms) {
          const spot = CROOKED_HOUSE_SECRETS.blooms[room.id];
          if (!spot) throw new Error(`fix: no bloom table for ${room.id}`);
          const foundLore = new Set(
            (await createLoreRepo(tx).listFound(user.id)).map((f) => f.pageId),
          );
          const roll = rollExploreFind(FAR_HOLLOW_FINDS, spot, rngFor(), foundLore);
          // Reads only, so the lock order holds.
          const rekindled = await rekindledDrop(
            tx,
            { place: 'far-hollow', userId: user.id, mapId, at },
            { rng: rngFor() },
          );
          const done = await search(tx, repo, {
            mapId,
            userId: user.id,
            room,
            items: roll.items,
            lore: roll.lore,
            rekindled,
            keepsake: null,
            spot,
            at,
          });
          for (const event of done.events) await repo.appendEvent(event);
          bloom = done.find;
        }
        return {
          view: await afterWrites(tx, season, key, at),
          key: hidden ? { id: hidden.id, name: hidden.name } : null,
          bloom,
        } satisfies CrookedFixResponse;
      });
      published(mapId);
      return result;
    },

    enter: async (user, mapId, request) =>
      farHollowTransaction(db, async (repo, tx) => {
        const at = now();
        const { season, key, state, secrets } = await openHouse(repo, tx, user, mapId, at);
        const room = roomNamed(request.room);
        const here = roomOf(state);
        const reach = houseReach(HOUSE, doorsOpen(state));
        if (!reach.has(room.id)) throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.locked);
        const rooms = new Map((await repo.listRooms(key)).map((r) => [r.roomId, r]));
        const lit = litRooms(rooms);
        let caught: CrookedEnterResponse['caught'] = null;
        if (room.id === here) {
          // Already here: nothing moves.
        } else if (lit.has(room.id)) {
          // A lit room I can reach: walk straight there (the dollhouse map), no echo in it.
          await repo.setState(key, { currentRoom: room.id, lastLitRoom: room.id });
        } else {
          // A dark room only through an open door of the room I'm in, past the echoes.
          const door = doorBetween(HOUSE, here, room.id);
          if (!door) throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.noWay);
          if (!doorOpen(HOUSE, door, doorsOpen(state))) {
            throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.locked);
          }
          const echo = echoCatch(HOUSE, secrets.echoes, {
            room: room.id,
            atMs: at.getTime(),
            tiptoe: request.tiptoe,
            lit,
          });
          // Peekaboo! Back to the last lit room, with everything I had.
          const to = echo ? lastLitOf(state) : room.id;
          if (echo) caught = { echo: echo.id, backTo: to };
          await repo.setState(key, { currentRoom: to });
        }
        return { view: await afterWrites(tx, season, key, at), caught };
      }),

    unlock: async (user, mapId, request) =>
      farHollowTransaction(db, async (repo, tx) => {
        const at = now();
        const { season, key, state } = await openHouse(repo, tx, user, mapId, at);
        const door = doorHere(state, request.door);
        if (door.key === undefined) throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.notKeyDoor);
        const keyBit = index(HOUSE.keys, door.key);
        const houseKey = HOUSE.keys[keyBit];
        if (!houseKey) throw new Error(`unlock: no key ${door.key}`);
        if (!hasBit(state.keys, keyBit)) {
          throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.noKey(houseKey.name));
        }
        // Turning a key twice is harmless: the door is already open.
        const unlocked = withBit(state.unlocked, index(HOUSE.doors, door.id));
        if (unlocked !== state.unlocked) await repo.setState(key, { unlocked });
        return { view: await afterWrites(tx, season, key, at) };
      }),

    power: async (user, mapId, request) =>
      farHollowTransaction(db, async (repo, tx) => {
        const at = now();
        const { season, key, state } = await openHouse(repo, tx, user, mapId, at);
        const door = doorHere(state, request.door);
        if (door.power === undefined) {
          throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.notPowerDoor);
        }
        // Owner decision 7: any squishy of the element on my battle team, any level, free.
        const team = await createBattlesRepo(tx).listTeam(mapId, user.id, BATTLE_RULES.teamSize);
        const helper = team.find((s) => s.id === request.squishyId);
        if (!helper) throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.notTeam);
        if (helper.element !== door.power) {
          const element = ELEMENT_NAMES.get(door.power) ?? door.power;
          throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.wrongPower(element));
        }
        // Every time: helping with a door already open is harmless.
        const bonusOpen = withBit(state.bonusOpen, index(HOUSE.doors, door.id));
        if (bonusOpen !== state.bonusOpen) await repo.setState(key, { bonusOpen });
        return { view: await afterWrites(tx, season, key, at) };
      }),

    chest: async (user, mapId, request) => {
      const at = now();
      const room = roomNamed(request.room);
      if (room.kind === 'main') throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.noChest);
      if (room.kind === 'bonus') {
        // A bonus chest may hold a rare friend, who needs a free team to meet:
        // checked for every chest, so a refusal never tells which hold one.
        await requireMember(db, user, mapId, ['multiplayer']);
        if (await options.battles.current(user, mapId)) {
          throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.battling);
        }
        const team = await createBattlesRepo(db).listTeam(mapId, user.id, BATTLE_RULES.teamSize);
        if (team.length === 0) throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.noTeam);
      }
      const opened = await farHollowTransaction(db, async (repo, tx) => {
        const { season, key, state, secrets } = await openHouse(repo, tx, user, mapId, at);
        requireIn(state, room.id);
        const bit = index(HOUSE.rooms, room.id);
        if (hasBit(state.chestsOpened, bit)) {
          throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.opened);
        }
        const patch: FarHollowStatePatch = { chestsOpened: withBit(state.chestsOpened, bit) };
        let items: ItemCounts;
        let lore: string | null = null;
        let keepsake: string | null = null;
        let friend: CrookedHouseSeason['chests'][string]['friend'] = null;
        let rekindled: FoundSetRoll = NOTHING_FOUND;
        const completes = room.kind === 'attic';
        if (completes) {
          // The page needs every room put right (the twelve story scraps).
          const rooms = await repo.listRooms(key);
          const bloomed = new Set(rooms.filter((r) => r.bloomedAt).map((r) => r.roomId));
          const left = BLOOMING.filter((r) => !bloomed.has(r.id)).length;
          if (left > 0) throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.notAllRight(left));
          // Owner decision 4: the season's page, the cloak, the pile and the completion gift.
          const found = new Set((await createLoreRepo(tx).listFound(user.id)).map((f) => f.pageId));
          lore = FAR_HOLLOW_SECRETS.lorePages.find((p) => !found.has(p)) ?? null;
          keepsake = CROOKED_HOUSE_SECRETS.attic.keepsake;
          items = { ...CROOKED_HOUSE_SECRETS.attic.items };
          for (const [id, n] of Object.entries(FAR_HOLLOW_SECRETS.completionGift)) {
            items[id] = (items[id] ?? 0) + n;
          }
          patch.atticOpenedAt = at;
          patch.completedAt = at;
        } else {
          const chest = secrets.chests[room.id];
          if (!chest) throw new Error(`chest: no chest for ${room.id}`);
          items = { ...chest.items };
          friend = chest.friend;
          rekindled = await rekindledDrop(
            tx,
            { place: 'far-hollow', userId: user.id, mapId, at },
            { rng: rngFor() },
          );
        }
        await repo.setState(key, patch);

        const done = await search(tx, repo, {
          mapId,
          userId: user.id,
          room,
          items,
          lore,
          rekindled,
          keepsake,
          spot: { kind: 'chest', terrain: 'crooked-house' },
          at,
        });
        for (const event of done.events) await repo.appendEvent(event);
        // Once a season (the next season's house is a new seed, a new state row).
        if (completes && !(await repo.completedBefore(key, season.run))) {
          await repo.appendEvent({
            mapId,
            type: 'journey.completed',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              season: season.run.id,
              year: season.run.year,
              lorePage: lore,
            },
          });
        }
        return { season, key, find: done.find, friend, completes };
      });
      published(mapId);

      // The rare friend (owner decision 6): a wild battle where a Heart Charm
      // works, started after the chest's commit. If it can't start now (a
      // battle slipped in), the chest stays opened and its loot given.
      let friend: CrookedChestResponse['friend'] = null;
      if (opened.friend) {
        try {
          const started = await options.battles.startAgainst(user, mapId, {
            squishies: [{ id: 'wild-1', ...opened.friend }],
          });
          if (started.created) {
            friend = { speciesId: opened.friend.speciesId, battleId: started.battle.id };
          }
        } catch (error) {
          options.log?.('far-hollow: a chest friend could not start its battle', error);
        }
      }
      const later = now();
      return {
        view: viewOf(opened.season, await readRows(db, opened.key), later),
        find: opened.find,
        friend,
        completed: opened.completes,
      };
    },

    devArrive: async (user, mapId, request = {}) => {
      const at = now();
      const result = await farHollowTransaction(db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        const { season, key } = await mine(tx, user.id, mapId, at);
        await repo.arrive(key, at);
        if (request.room === undefined && !request.nearlyDone) {
          return afterWrites(tx, season, key, at);
        }
        const state = await repo.lockState(key);
        if (!state) throw new Error('devArrive: no state row');
        const target = request.room === undefined ? null : roomNamed(request.room);
        // Every key found and turned, so any room is reachable; power doors stay shut.
        const keys = allBits(HOUSE.keys.length);
        let unlocked = state.unlocked;
        HOUSE.doors.forEach((d, i) => {
          if (d.key !== undefined) unlocked = withBit(unlocked, i);
        });
        if (target && !houseReach(HOUSE, { unlocked, bonusOpen: state.bonusOpen }).has(target.id)) {
          throw new AppError('CONFLICT', FAR_HOLLOW_MESSAGES.locked);
        }
        const patch: FarHollowStatePatch = { keys, unlocked };
        if (request.nearlyDone) {
          // Every room right but the last thing of one (the target, or the last to bloom).
          const fallback = BLOOMING.at(-1);
          if (!fallback) throw new Error('devArrive: no room blooms');
          const last =
            target && target.kind === 'main' && target.things.length > 0 ? target : fallback;
          const rows = await repo.lockRooms(
            key,
            BLOOMING.map((r) => r.id),
          );
          for (const row of rows) {
            const room = ROOMS.get(row.roomId);
            if (!room) continue;
            if (room.id !== last.id) {
              await repo.setRoom(key, {
                roomId: room.id,
                fixed: allBits(room.things.length),
                bloomedAt: row.bloomedAt ?? at,
              });
              continue;
            }
            // Its last thing that isn't a puzzle stays to put right.
            const leave = room.things.findLastIndex((t) => t.kind !== 'relight');
            const fixed = allBits(room.things.length) & ~(1 << leave);
            await repo.setRoom(key, { roomId: room.id, fixed, bloomedAt: null });
          }
          patch.currentRoom = target?.id ?? last.id;
        } else if (target) {
          patch.currentRoom = target.id;
        }
        await repo.setState(key, patch);
        return afterWrites(tx, season, key, at);
      });
      published(mapId);
      return result;
    },
  };
}

/**
 * The far road's finish (`modules/journeys`, tech spec §7 step 5b, after the
 * battle and its `journeys` row): a win is an arrival in this season's far
 * Hollow. Returns its event, or none when I'd already arrived this season.
 */
export async function arriveInFarHollow(
  tx: Executor,
  input: { mapId: string; userId: string; journeyId: string; at: Date },
): Promise<NewGameEvent[]> {
  const season = await farHollowSeasonAt(tx, input.mapId, input.at);
  const key = { userId: input.userId, mapId: input.mapId, seasonSeed: season.seed };
  if (!(await createFarHollowRepo(tx).arrive(key, input.at))) return [];
  return [
    {
      mapId: input.mapId,
      type: 'journey.arrived',
      actorUserId: input.userId,
      payload: {
        userId: input.userId,
        journeyId: input.journeyId,
        season: season.run.id,
        year: season.run.year,
      },
    },
  ];
}
