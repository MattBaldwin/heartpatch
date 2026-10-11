import {
  CARE_RULES,
  evaluateRequirements,
  GAME_DATA,
  HOUSE_DATA,
  HOUSE_START_LEVEL,
  houseLevelData,
  MILESTONE_TRACKS,
  nextHouseLevel,
  roomsAt,
  type HouseData,
  type HouseView,
  type ItemCounts,
  type PublicUser,
  type RequirementContext,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { gatherProgressFacts } from '../progress/facts.js';
import { HOUSE_OFF, houseOpenFor, type HouseSwitch } from './switch.js';

/*
 * The Keeper's house (#381). PR A is read-only: `GET /house` shows the level
 * (1 for everyone until the house tables land in A2: no row reads as level
 * 1), its rooms, and the next level's requirements and cost, evaluated on
 * the server from the shared requirement evaluator (CLAUDE.md rule 1).
 * Behind the `HP_HOUSE` switch: while it's off for a player, the house
 * doesn't exist for them (NOT_FOUND, the same words as a missing patch so
 * nothing can be probed).
 */

/** Kid-readable (style guide §6). The same words as `requireMember`'s, on purpose. */
const MESSAGES = {
  noHouse: "We couldn't find that patch.",
} as const;

const BUILDING_NAMES = new Map(GAME_DATA.buildings.map((b) => [b.id, b.name]));
const TRACK_NAMES = new Map(MILESTONE_TRACKS.map((t) => [t.id, t.name]));

export interface HouseService {
  /** My house on this patch, and what the next level needs. */
  get: (user: PublicUser, mapId: string) => Promise<HouseView>;
  /** The house switch is on for this player (`HomeResponse.house`). */
  openFor: (user: PublicUser) => boolean;
}

export interface HouseServiceOptions {
  db: Executor;
  clock?: Clock;
  /** `HP_HOUSE`; off when left out. */
  house?: HouseSwitch;
  /** The house table; the shipped data when left out (tests pass their own). */
  data?: HouseData;
}

/** Every resource count the cost names, from the bag (0 when there's none). */
const costCovered = (cost: ItemCounts, items: ItemCounts): boolean =>
  Object.entries(cost).every(([id, n]) => (items[id] ?? 0) >= n);

export function createHouseService(options: HouseServiceOptions): HouseService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const house = options.house ?? HOUSE_OFF;
  const data = options.data ?? HOUSE_DATA;

  const openFor = (user: PublicUser) => houseOpenFor(house, user);

  return {
    openFor,

    get: async (user, mapId) => {
      if (!openFor(user)) throw new AppError('NOT_FOUND', MESSAGES.noHouse);
      // The Tutorial Glade has no house, so Sprout's steps don't change (plan §9).
      const { map } = await requireMember(db, user, mapId, ['multiplayer']);
      const at = now();
      const level = HOUSE_START_LEVEL;
      const current = houseLevelData(data, level);
      const next = nextHouseLevel(data, level);
      const items = await createInventoryRepo(db).list({ mapId, userId: user.id });

      let nextView: HouseView['next'] = null;
      if (next) {
        const [facts, members] = await Promise.all([
          gatherProgressFacts(db, { mapId, userId: user.id, timeZone: map.timeZone, at }),
          createMapsRepo(db).listMembers(mapId),
        ]);
        const context: RequirementContext = {
          care: CARE_RULES,
          buildingName: (id) => BUILDING_NAMES.get(id) ?? id,
          trackName: (id) => TRACK_NAMES.get(id) ?? id,
          solo: members.length <= 1,
        };
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

      const levelOf = new Map(data.levels.map((l) => [l.room.id, l.level]));
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
          residents: [],
        })),
        next: nextView,
        items: Object.fromEntries(Object.keys(next?.cost ?? {}).map((id) => [id, items[id] ?? 0])),
        now: at.toISOString(),
      };
    },
  };
}
