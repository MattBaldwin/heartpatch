import {
  CARE_RULES,
  evaluateRequirements,
  GAME_DATA,
  HOUSE_DATA,
  HOUSE_START_LEVEL,
  houseLevelData,
  MILESTONE_TRACKS,
  nextHouseLevel,
  requirementsMet,
  roomsAt,
  type HouseData,
  type HouseView,
  type ItemCounts,
  type PublicUser,
  type RequirementContext,
  type ResidentAway,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo, type MapRow } from '../maps/repo.js';
import { gatherProgressFacts } from '../progress/facts.js';
import { createHouseRepo, type ResidentRow } from './repo.js';
import { HOUSE_OFF, houseOpenFor, type HouseSwitch } from './switch.js';

/*
 * The Keeper's house (#381). `GET /house` shows the level (no row reads as
 * level 1), its rooms and residents, and the next level's requirements and
 * cost, evaluated on the server with the shared requirement evaluator
 * (CLAUDE.md rule 1). `POST /house/build` is "unlock, then build": inside one
 * transaction it re-reads every fact under the house lock, so a build can't
 * pass on a stale screen, then spends the cost and raises the level. Behind
 * the `HP_HOUSE` switch: while it's off for a player, the house doesn't exist
 * for them (NOT_FOUND, the same words as a missing patch, so nothing can be
 * probed).
 */

/** Kid-readable (style guide §6). `noHouse` is `requireMember`'s words, on purpose. */
export const HOUSE_MESSAGES = {
  noHouse: "We couldn't find that patch.",
  notNext: "That's not the next level. Check Grow the house again!",
  allGrown: 'Your house is all grown! ✨',
  notYet: 'Not quite yet! Check what the house needs.',
  seedFirst: 'Your Heart Seed needs to grow first 🌱',
} as const;

const BUILDING_NAMES = new Map(GAME_DATA.buildings.map((b) => [b.id, b.name]));
const TRACK_NAMES = new Map(MILESTONE_TRACKS.map((t) => [t.id, t.name]));

export interface HouseService {
  /** My house on this patch, and what the next level needs. */
  get: (user: PublicUser, mapId: string) => Promise<HouseView>;
  /** Builds my house's next level (`toLevel` must be the next one). */
  build: (user: PublicUser, mapId: string, toLevel: number) => Promise<HouseView>;
}

export interface HouseServiceOptions {
  db: Executor;
  clock?: Clock;
  /** `HP_HOUSE`; off when left out. */
  house?: HouseSwitch;
  /** The house table; the shipped data when left out (tests pass their own). */
  data?: HouseData;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

/** Every resource count the cost names, from the bag (0 when there's none). */
const costCovered = (cost: ItemCounts, items: ItemCounts): boolean =>
  Object.entries(cost).every(([id, n]) => (items[id] ?? 0) >= n);

/** Why a resident isn't in its room right now (`HouseResident.away`). */
function awayOf(row: ResidentRow): ResidentAway | null {
  if (row.state === 'hollowed') return 'hollow';
  if (row.state === 'in-trade') return 'in-trade';
  return null;
}

export function createHouseService(options: HouseServiceOptions): HouseService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const house = options.house ?? HOUSE_OFF;
  const data = options.data ?? HOUSE_DATA;
  const levelOf = new Map(data.levels.map((l) => [l.room.id, l.level]));

  /** The switch and the patch: NOT_FOUND unless both let this player in. */
  async function requireHouse(executor: Executor, user: PublicUser, mapId: string) {
    if (!houseOpenFor(house, user)) throw new AppError('NOT_FOUND', HOUSE_MESSAGES.noHouse);
    // The Tutorial Glade has no house, so Sprout's steps don't change (plan §9).
    return (await requireMember(executor, user, mapId, ['multiplayer'])).map;
  }

  /** The requirement lines' names and the solo hint. */
  async function contextFor(executor: Executor, mapId: string): Promise<RequirementContext> {
    const members = await createMapsRepo(executor).activeHomeSlots(mapId);
    return {
      care: CARE_RULES,
      buildingName: (id) => BUILDING_NAMES.get(id) ?? id,
      trackName: (id) => TRACK_NAMES.get(id) ?? id,
      solo: members.count <= 1,
    };
  }

  /** Everything the house screen shows, read through `executor`. */
  async function view(
    executor: Executor,
    map: MapRow,
    userId: string,
    at: Date,
  ): Promise<HouseView> {
    const repo = createHouseRepo(executor);
    const [built, residents, items] = await Promise.all([
      repo.level(map.id, userId),
      repo.residents(map.id, userId),
      createInventoryRepo(executor).list({ mapId: map.id, userId }),
    ]);
    const level = built ?? HOUSE_START_LEVEL;
    const current = houseLevelData(data, level);
    const next = nextHouseLevel(data, level);

    let nextView: HouseView['next'] = null;
    if (next) {
      const [facts, context] = await Promise.all([
        gatherProgressFacts(executor, { mapId: map.id, userId, timeZone: map.timeZone, at }),
        contextFor(executor, map.id),
      ]);
      const requirements = evaluateRequirements(next.requirements, facts, context);
      nextView = {
        level: next.level,
        name: next.name,
        room: { id: next.room.id, name: next.room.name, beds: next.room.beds },
        final: next.final === true,
        requirements,
        cost: next.cost,
        unlocked: requirements.every((r) => r.done),
        affordable: costCovered(next.cost, items),
      };
    }

    return {
      level: current.level,
      levelName: current.name,
      exterior: current.exterior,
      final: current.final === true,
      rooms: roomsAt(data, level).map((room) => ({
        id: room.id,
        name: room.name,
        description: room.description,
        beds: room.beds,
        look: room.look,
        layout: room.layout,
        level: levelOf.get(room.id) ?? HOUSE_START_LEVEL,
        residents: residents
          .filter((r) => r.roomId === room.id)
          .map((r) => ({
            squishyId: r.squishyId,
            since: r.movedInAt.toISOString(),
            away: awayOf(r),
          })),
      })),
      next: nextView,
      items: Object.fromEntries(Object.keys(next?.cost ?? {}).map((id) => [id, items[id] ?? 0])),
      now: at.toISOString(),
    };
  }

  return {
    get: async (user, mapId) => {
      const map = await requireHouse(db, user, mapId);
      return view(db, map, user.id, now());
    },

    build: async (user, mapId, toLevel) => {
      const at = now();
      const result = await createHouseRepo(db).transaction(async (repo, tx) => {
        const map = await requireHouse(tx, user, mapId);
        // Lock order (tech spec §7): the member row (step 2: one house
        // command at a time per player), the house (8c), then the facts
        // (plain reads), every inventory row the cost spends (11), `maps` (13).
        if (!(await createMapsRepo(tx).lockMember(mapId, user.id))) {
          throw new AppError('NOT_FOUND', HOUSE_MESSAGES.noHouse);
        }
        const level = await repo.lockHouse(mapId, user.id, HOUSE_START_LEVEL, at);
        const next = nextHouseLevel(data, level);
        if (!next) throw new AppError('CONFLICT', HOUSE_MESSAGES.allGrown);
        if (toLevel !== next.level) throw new AppError('CONFLICT', HOUSE_MESSAGES.notNext);
        // Never the GET it sent: every requirement is read again here, under
        // the house lock. The Seed cap first, so it gets its own words.
        const facts = await gatherProgressFacts(tx, {
          mapId,
          userId: user.id,
          timeZone: map.timeZone,
          at,
        });
        const seedCap = next.requirements.filter((r) => r.kind === 'heartSeedLevel');
        if (!requirementsMet(seedCap, facts, CARE_RULES)) {
          throw new AppError('CONFLICT', HOUSE_MESSAGES.seedFirst);
        }
        if (!requirementsMet(next.requirements, facts, CARE_RULES)) {
          throw new AppError('CONFLICT', HOUSE_MESSAGES.notYet);
        }
        // Short of anything: CONFLICT ("You need 12 more Timber first!"), nothing spent.
        await consumeItems(tx, { mapId, userId: user.id }, next.cost, 'house-build');
        await repo.setLevel(mapId, user.id, next.level, at);
        await repo.appendEvent({
          mapId,
          type: 'house.built',
          actorUserId: user.id,
          payload: { userId: user.id, level: next.level, cost: next.cost },
        });
        return view(tx, map, user.id, at);
      });
      void options.publish?.(mapId);
      return result;
    },
  };
}
