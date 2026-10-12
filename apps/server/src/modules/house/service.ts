import {
  CARE_RULES,
  evaluateRequirements,
  GAME_DATA,
  HOUSE_DATA,
  HOUSE_NOTES,
  houseGiftNote,
  HOUSE_START_LEVEL,
  houseLevelData,
  jobOf,
  MILESTONE_TRACKS,
  moveInProblem,
  nextHouseLevel,
  renderHouseNote,
  requirementsMet,
  residentAwayOf,
  rollHouseGift,
  roomsAt,
  type HouseData,
  type HouseGift,
  type HouseNote,
  type HouseResident,
  type HouseView,
  type ItemCounts,
  type MoveInProblem,
  type PublicUser,
  type RequirementContext,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { localDate, type Clock } from '../../lib/time.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems } from '../inventory/service.js';
import { checkpointContentment } from '../jobs/contentment.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { squishyName } from '../jobs/work.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo, type MapRow } from '../maps/repo.js';
import { gatherProgressFacts } from '../progress/facts.js';
import { createHouseRepo, type GiftRow, type ResidentRow } from './repo.js';
import { HOUSE_OFF, houseOpenFor, type HouseSwitch } from './switch.js';

/*
 * The Keeper's house (#381). `GET /house` shows the level (no row reads as
 * level 1), its rooms and residents, and the next level's requirements and
 * cost, evaluated on the server with the shared requirement evaluator
 * (CLAUDE.md rule 1). `POST /house/build` is "unlock, then build": inside one
 * transaction it re-reads every fact under the house lock, so a build can't
 * pass on a stale screen, then spends the cost and raises the level.
 * `POST /house/residents` moves one of my squishies into a room, into
 * another, or out; a resident's happiness fades slower (the perk rides
 * #376's contentment checkpoint, so every move writes one first). Behind
 * the `HP_HOUSE` switch: while it's off for a player, the house doesn't exist
 * for them (NOT_FOUND, the same words as a missing patch, so nothing can be
 * probed).
 *
 * The daily gift (PR H): the first `GET /house` of the patch day rolls
 * today's gift (seeded, `rollHouseGift`) when a resident is home, and
 * `POST /house/gift/claim` opens it once, paying the Keeper.
 */

/** Kid-readable (style guide §6). `noHouse` is `requireMember`'s words, on purpose. */
export const HOUSE_MESSAGES = {
  noHouse: "We couldn't find that patch.",
  notNext: "That's not the next level. Check Grow the house again!",
  allGrown: 'Your house is all grown! ✨',
  notYet: 'Not quite yet! Check what the house needs.',
  seedFirst: 'Your Heart Seed needs to grow first 🌱',
  noSquishy: "We couldn't find that squishy.",
  noGift: 'No gift yet today. Check back soon! 🎁',
  giftOpened: 'Already opened! Come back tomorrow 🎁',
  /** The giver's name on a note when the giver is gone from the patch. */
  someone: 'A little friend',
  move: {
    'in-trade': () => 'That squishy is waiting at a trading post right now. 📬',
    hollowed: () => 'That squishy is in the Hollow right now. Rescue them first!',
    'no-room': () => "That room isn't built yet. Grow the house first! 🌱",
    cooldown: (name: string) => `${name} just moved out. Let them stretch their legs first!`,
    full: (_name: string, room: string) => `${room} is full! Pick another room.`,
  } satisfies Record<MoveInProblem, (name: string, room: string) => string>,
} as const;

const BUILDING_NAMES = new Map(GAME_DATA.buildings.map((b) => [b.id, b.name]));
const TRACK_NAMES = new Map(MILESTONE_TRACKS.map((t) => [t.id, t.name]));

export interface HouseService {
  /** My house on this patch, and what the next level needs. */
  get: (user: PublicUser, mapId: string) => Promise<HouseView>;
  /** Builds my house's next level (`toLevel` must be the next one). */
  build: (user: PublicUser, mapId: string, toLevel: number) => Promise<HouseView>;
  /** Moves my squishy into a room of my house, into another room, or out (`roomId` null). */
  moveResident: (
    user: PublicUser,
    mapId: string,
    squishyId: string,
    roomId: string | null,
  ) => Promise<HouseView>;
  /** Opens today's gift from a resident, once: its items go in my bag. */
  claimGift: (user: PublicUser, mapId: string) => Promise<HouseView>;
}

export interface HouseServiceOptions {
  db: Executor;
  clock?: Clock;
  /** `HP_HOUSE`; off when left out. */
  house?: HouseSwitch;
  /** The house table; the shipped data when left out (tests pass their own). */
  data?: HouseData;
  /** The gift notes; the shipped ones when left out. */
  notes?: readonly HouseNote[];
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

/** Every resource count the cost names, from the bag (0 when there's none). */
const costCovered = (cost: ItemCounts, items: ItemCounts): boolean =>
  Object.entries(cost).every(([id, n]) => (items[id] ?? 0) >= n);

/**
 * Ends these squishies' residency (#381), inside the caller's transaction
 * and right after its squishy locks (step 10), before any inventory row
 * (11): every residency writer holds the squishy, so this never waits on a
 * lock out of order. Each one living in its owner's house gets its
 * contentment checkpoint first (`checkpointContentment`: the time so far
 * counts at the perk's rate, the time after at the normal one).
 *
 * `rehomed`: the squishies are changing hands (a trade's yes, a gift's
 * pickup), so their rows go entirely: the new Keeper starts fresh, and the
 * old one's leave or cooldown never touches them. Otherwise they move out
 * of their room and the move-back-in cooldown starts.
 */
export async function leaveHouse(
  tx: Executor,
  options: { mapId: string; squishyIds: readonly string[]; at: Date; rehomed: boolean },
): Promise<string[]> {
  const { mapId, squishyIds, at, rehomed } = options;
  if (squishyIds.length === 0) return [];
  const repo = createHouseRepo(tx);
  const living = await repo.livingIn(squishyIds);
  await checkpointContentment(tx, mapId, living, at);
  if (rehomed) await repo.deleteResidents(squishyIds);
  else await repo.moveOut(living, at);
  return living;
}

export function createHouseService(options: HouseServiceOptions): HouseService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const house = options.house ?? HOUSE_OFF;
  const data = options.data ?? HOUSE_DATA;
  const notes = options.notes ?? HOUSE_NOTES;
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

  /** The Keeper's residents now, each with why it's away (null: at home). */
  async function residentsOf(
    executor: Executor,
    mapId: string,
    userId: string,
  ): Promise<(ResidentRow & Pick<HouseResident, 'away'>)[]> {
    const residents = await createHouseRepo(executor).residents(mapId, userId);
    // A resident keeps its job: its bed says where it went (plan Q5).
    const jobs = new Map(
      (await createSquishyJobsRepo(executor).listByIds(residents.map((r) => r.squishyId))).map(
        (row) => [
          row.squishy.id,
          jobOf({
            teamSlot: row.teamSlot,
            atWork: row.atWork,
            onWatch: row.onWatch,
            training: row.training !== null,
          }),
        ],
      ),
    );
    return residents.map((r) => ({
      ...r,
      away: residentAwayOf(r.state, jobs.get(r.squishyId) ?? 'resting'),
    }));
  }

  /** Residents at home now (not away): who can leave today's gift. */
  async function giversOf(executor: Executor, mapId: string, userId: string) {
    return (await residentsOf(executor, mapId, userId))
      .filter((r) => r.away === null)
      .map((r) => ({ squishyId: r.squishyId, feeling: r.feeling }));
  }

  /** A gift row as the house screen shows it: the note rendered with the giver's name. */
  function giftView(row: GiftRow, mapId: string, userId: string): HouseGift {
    const { giver } = row;
    // A giver gone from the patch leaves a note from the ones for anyone.
    const note = houseGiftNote(notes, {
      userId,
      mapId,
      day: row.day,
      squishyId: row.giverSquishyId ?? '',
      feeling: giver?.feeling ?? null,
    });
    return {
      day: row.day,
      giverSquishyId: row.giverSquishyId,
      itemId: row.itemId,
      count: row.count,
      note: renderHouseNote(note, giver ? squishyName(giver) : HOUSE_MESSAGES.someone),
      claimed: row.claimedAt !== null,
    };
  }

  /**
   * Rolls today's gift if there's none yet and a resident is home (the lazy
   * roll on `GET /house`). Plain reads first, so a read with today's row, or
   * with nobody home, opens no transaction. The roll takes the member row
   * (step 2: a leave deletes the house under it, so no house row comes back
   * for someone who just left) and the house row (8c, inserted at level 1
   * when missing: the gift's foreign key needs it), reads the residents
   * plainly under it (every move holds the house lock), then writes the row
   * ON CONFLICT DO NOTHING, so two first reads racing write one.
   */
  async function rollTodaysGift(map: MapRow, userId: string, at: Date): Promise<void> {
    const day = localDate(at, map.timeZone);
    const repo = createHouseRepo(db);
    if (await repo.gift(map.id, userId, day)) return;
    if ((await giversOf(db, map.id, userId)).length === 0) return;
    await repo.transaction(async (txRepo, tx) => {
      if (!(await createMapsRepo(tx).lockMember(map.id, userId))) return;
      const level = await txRepo.lockHouse(map.id, userId, HOUSE_START_LEVEL, at);
      const givers = await giversOf(tx, map.id, userId);
      const roll = rollHouseGift(
        { userId, mapId: map.id, day, level, givers },
        data.rules.gifts,
        notes,
      );
      if (!roll) return;
      await txRepo.insertGift({
        mapId: map.id,
        userId,
        day,
        giverSquishyId: roll.giverSquishyId,
        itemId: roll.itemId,
        count: roll.count,
        at,
      });
    });
  }

  /** Everything the house screen shows, read through `executor`. */
  async function view(
    executor: Executor,
    map: MapRow,
    userId: string,
    at: Date,
  ): Promise<HouseView> {
    const repo = createHouseRepo(executor);
    const [built, residents, items, gift] = await Promise.all([
      repo.level(map.id, userId),
      residentsOf(executor, map.id, userId),
      createInventoryRepo(executor).list({ mapId: map.id, userId }),
      repo.gift(map.id, userId, localDate(at, map.timeZone)),
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
            away: r.away,
          })),
      })),
      next: nextView,
      items: Object.fromEntries(Object.keys(next?.cost ?? {}).map((id) => [id, items[id] ?? 0])),
      gift: gift ? giftView(gift, map.id, userId) : null,
      now: at.toISOString(),
    };
  }

  return {
    get: async (user, mapId) => {
      const at = now();
      const map = await requireHouse(db, user, mapId);
      await rollTodaysGift(map, user.id, at);
      return view(db, map, user.id, at);
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

    moveResident: async (user, mapId, squishyId, roomId) => {
      const at = now();
      const { view: result, moved } = await createHouseRepo(db).transaction(async (repo, tx) => {
        const map = await requireHouse(tx, user, mapId);
        // Lock order (tech spec §7): the member row (step 2: one house
        // command at a time per player), the house (8c: serialises the bed
        // count, and a build), the squishy (10) with its residency row and
        // its contentment checkpoint, then `maps` (13).
        if (!(await createMapsRepo(tx).lockMember(mapId, user.id))) {
          throw new AppError('NOT_FOUND', HOUSE_MESSAGES.noHouse);
        }
        const level = await repo.lockHouse(mapId, user.id, HOUSE_START_LEVEL, at);
        const squishy = await repo.lockSquishy(squishyId);
        if (squishy?.mapId !== mapId || squishy.ownerUserId !== user.id) {
          throw new AppError('NOT_FOUND', HOUSE_MESSAGES.noSquishy);
        }
        const row = await repo.residency(squishyId);
        // A row from a Keeper who owned it before is no move of mine.
        const mine = row?.userId === user.id && row.mapId === mapId ? row : null;
        const fromRoomId = mine?.roomId ?? null;
        if (roomId === fromRoomId) return { view: await view(tx, map, user.id, at), moved: false };

        if (roomId === null) {
          // Moving out is free; the bed frees at once.
          await leaveHouse(tx, { mapId, squishyIds: [squishyId], at, rehomed: false });
        } else {
          const room = roomsAt(data, level).find((r) => r.id === roomId) ?? null;
          const problem = moveInProblem(
            {
              state: squishy.state,
              room,
              inRoom: room ? await repo.countInRoom(mapId, user.id, roomId) : 0,
              movingRooms: fromRoomId !== null,
              movedOutAt: fromRoomId === null ? (mine?.movedOutAt ?? null) : null,
              now: at,
            },
            data.rules,
          );
          if (problem) {
            const message = HOUSE_MESSAGES.move[problem](squishyName(squishy), room?.name ?? '');
            throw new AppError('CONFLICT', message);
          }
          // The checkpoint first: the time so far counts at the old rate.
          await checkpointContentment(tx, mapId, [squishyId], at);
          await repo.moveIn({
            squishyId,
            mapId,
            userId: user.id,
            roomId,
            // A move between rooms keeps when it first moved in.
            movedInAt: (fromRoomId !== null ? mine?.movedInAt : null) ?? at,
          });
        }
        await repo.appendEvent({
          mapId,
          type: 'resident.moved',
          actorUserId: user.id,
          payload: { userId: user.id, squishyId, roomId, fromRoomId },
        });
        return { view: await view(tx, map, user.id, at), moved: true };
      });
      if (moved) void options.publish?.(mapId);
      return result;
    },

    claimGift: async (user, mapId) => {
      const at = now();
      const result = await createHouseRepo(db).transaction(async (repo, tx) => {
        const map = await requireHouse(tx, user, mapId);
        // Lock order (tech spec §7): the member row (step 2: one house
        // command at a time per player), the house (8c), today's gift row
        // under it (8c), the inventory row it fills (11), then `maps` (13).
        // The giver is read, never locked: one traded away or gone since
        // still leaves the gift, which is the Keeper's once rolled.
        if (!(await createMapsRepo(tx).lockMember(mapId, user.id))) {
          throw new AppError('NOT_FOUND', HOUSE_MESSAGES.noHouse);
        }
        await repo.lockHouse(mapId, user.id, HOUSE_START_LEVEL, at);
        const day = localDate(at, map.timeZone);
        const gift = await repo.lockUnclaimedGift(mapId, user.id, day);
        if (!gift) {
          const opened = await repo.gift(mapId, user.id, day);
          throw new AppError(
            'CONFLICT',
            opened ? HOUSE_MESSAGES.giftOpened : HOUSE_MESSAGES.noGift,
          );
        }
        await grantItems(
          tx,
          { mapId, userId: user.id },
          { [gift.itemId]: gift.count },
          'house-gift',
          gift.id,
        );
        await repo.markGiftClaimed(gift.id, at);
        await repo.appendEvent({
          mapId,
          type: 'house.gift',
          actorUserId: user.id,
          payload: {
            userId: user.id,
            giftId: gift.id,
            day,
            giverSquishyId: gift.giverSquishyId,
            itemId: gift.itemId,
            count: gift.count,
          },
        });
        return view(tx, map, user.id, at);
      });
      void options.publish?.(mapId);
      return result;
    },
  };
}
