import { randomUUID } from 'node:crypto';
import {
  activeSeasons,
  adventClaimProblem,
  adventDaysOf,
  adventNumber,
  isCatchUp,
  type AdventClaimProblem,
  type AdventDayView,
  type AdventResult,
  type AdventView,
  type ClaimAdventResponse,
  type OpenPresentResponse,
  GAME_DATA,
  type PublicUser,
} from '@heartpatch/shared';
import {
  ADVENT_PRESENTS,
  adventContents,
  adventSeed,
  presentContents,
  PRESENT_ITEM,
  rollAdventPresent,
  rollPresentOpening,
  type AdventPresents,
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import { localDate, type Clock } from '../../lib/time.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo, type MapRow } from '../maps/repo.js';
import { createAdventRepo } from './repo.js';

/*
 * Advent presents (#37 1c, owner answer 3). 25 presents, December 1–25, one
 * a day per Keeper at account level (so extra patches aren't a farm), plus
 * one missed day opened late a day. `GET /advent` draws the calendar;
 * `POST /advent/claim { day }` opens a day's present into this patch's bag;
 * `POST /presents/open` opens a wrapped present from the bag (a spare from
 * the calendar, or one a patch-mate gifted).
 *
 * A day's present is rolled lazily, on the claim, from a seed of the Keeper
 * and the day alone (`adventSeed`, server-only), so it's the same from any
 * patch and a retry can't reroll it; the claim row stores the seed and what
 * it held. The days are the claiming patch's local days: a Keeper on patches
 * in two zones can open a day a few hours sooner on the eastern one, never
 * twice (the `(user_id, day)` key is account level).
 */

/** Kid-readable (style guide §6). */
export const ADVENT_MESSAGES = {
  noPatch: "We couldn't find that patch.",
  problem: {
    'not-advent': 'Presents come December 1 to 25! 🎄',
    'not-yet': "Not yet! That one's still wrapped up tight 🎁",
    over: 'The advent calendar is all done. See you next December! ❄️',
    claimed: 'Already opened! 🎁',
    'catch-up-used':
      'You opened a missed present today already. Come back tomorrow for another! ❄️',
  } satisfies Record<AdventClaimProblem, string>,
  noPresent: 'No wrapped presents in your bag right now 🎁',
} as const;

export interface AdventService {
  /** This year's calendar, as my patch's day sees it. */
  view: (user: PublicUser, mapId: string) => Promise<AdventView>;
  /** Opens `day`'s present (today's, or one missed day a day) into this patch's bag. */
  claim: (user: PublicUser, mapId: string, day: string) => Promise<ClaimAdventResponse>;
  /** Opens one wrapped present from my bag on this patch. */
  openPresent: (user: PublicUser, mapId: string) => Promise<OpenPresentResponse>;
}

export interface AdventServiceOptions {
  db: Executor;
  clock?: Clock;
  /** The secret table; the shipped one when left out (tests pass their own). */
  presents?: AdventPresents;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

/** Advent is a patch thing: multiplayer patches only, like the house. */
const KINDS = ['multiplayer'] as const satisfies readonly MapRow['kind'][];

/** The Christmas season (`christmas` window, December) is on for this patch's day. */
export const christmasOn = (at: Date, timeZone: string): boolean =>
  activeSeasons(GAME_DATA.seasons, localDate(at, timeZone)).some((s) => s.id === 'christmas');

/**
 * Whether today's advent present waits for this Keeper on this patch's day
 * (`MapView.christmas.presentWaiting`): today is December 1–25 and its
 * present isn't opened yet, from any patch. A plain read.
 */
export async function presentWaitingOn(
  db: Executor,
  map: Pick<MapRow, 'timeZone'>,
  userId: string,
  at: Date,
): Promise<boolean> {
  const today = localDate(at, map.timeZone);
  if (adventNumber(today) === null) return false;
  return !(await createAdventRepo(db).claimed(userId, today));
}

export function createAdventService(options: AdventServiceOptions): AdventService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const table = options.presents ?? ADVENT_PRESENTS;

  /** The Keeper's opened days of `today`'s year, and whether today's catch-up is used. */
  async function claimsFor(executor: Executor, userId: string, today: string) {
    const year = today.slice(0, 4);
    const days = adventDaysOf(Number(year));
    const claims = await createAdventRepo(executor).claims(
      userId,
      `${year}-12-01`,
      `${year}-12-25`,
    );
    return {
      days,
      opened: new Map(claims.map((c) => [c.day, c])),
      catchUpTaken: claims.some((c) => c.catchUp && c.claimedOn === today),
    };
  }

  /** The calendar for `today`, from the Keeper's claims of its year. */
  async function calendar(executor: Executor, userId: string, today: string): Promise<AdventView> {
    const { days, opened, catchUpTaken } = await claimsFor(executor, userId, today);
    const live = adventNumber(today) !== null;
    const catchUpLeft = live && !catchUpTaken;
    const stateOf = (day: string): AdventDayView['state'] => {
      if (day > today) return 'locked';
      // Today equals an advent day only while the calendar is live.
      if (day === today) return 'today';
      return catchUpLeft ? 'catch-up' : 'missed';
    };
    return {
      today,
      catchUpLeft,
      presentContents: presentContents(table),
      days: days.map((day): AdventDayView => {
        const contents = adventContents(table, day);
        const claim = opened.get(day);
        return claim
          ? { day, state: 'opened', items: claim.items, contents }
          : { day, state: stateOf(day), contents };
      }),
    };
  }

  /** What blocks `day`'s claim on `today`, or null. */
  async function problemOf(
    executor: Executor,
    userId: string,
    today: string,
    day: string,
  ): Promise<AdventClaimProblem | null> {
    const { opened, catchUpTaken } = await claimsFor(executor, userId, today);
    return adventClaimProblem({
      today,
      day,
      claimed: opened.has(day),
      catchUpTakenToday: catchUpTaken,
    });
  }

  return {
    view: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId, KINDS);
      return calendar(db, user.id, localDate(now(), map.timeZone));
    },

    claim: async (user, mapId, day) => {
      const at = now();
      let result: { items: AdventResult; catchUp: boolean; today: string };
      try {
        result = await createAdventRepo(db).transaction(async (repo, tx) => {
          const { map } = await requireMember(tx, user, mapId, KINDS);
          const today = localDate(at, map.timeZone);
          // Lock order (tech spec §7): the member row (step 2: one advent
          // command at a time per Keeper on this patch), then the bag (11).
          // A claim from another patch at the same moment takes a different
          // member row; the account-level unique keys refuse the second.
          if (!(await createMapsRepo(tx).lockMember(mapId, user.id))) {
            throw new AppError('NOT_FOUND', ADVENT_MESSAGES.noPatch);
          }
          const problem = await problemOf(tx, user.id, today, day);
          if (problem) throw new AppError('CONFLICT', ADVENT_MESSAGES.problem[problem]);
          const catchUp = isCatchUp(today, day);
          const items = rollAdventPresent(table, user.id, day);
          const claimId = randomUUID();
          // The claim row first: a racing second claim fails here, before any item moves.
          await repo.insert({
            id: claimId,
            userId: user.id,
            day,
            mapId,
            seed: adventSeed(table, user.id, day),
            result: items,
            catchUp,
            claimedOn: today,
            claimedAt: at,
          });
          const owner = { mapId, userId: user.id };
          const inventory = createInventoryRepo(tx);
          await inventory.createAndLockItems(owner, Object.keys(items).sort());
          await grantItems(tx, owner, items, 'advent', claimId, at);
          await repo.appendEvent({
            mapId,
            type: 'advent.claimed',
            actorUserId: user.id,
            payload: { userId: user.id, claimId, day, catchUp, items },
          });
          return { items, catchUp, today };
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Another patch's claim won the race: say why, as a plain read.
        const { map } = await requireMember(db, user, mapId, KINDS);
        const problem = await problemOf(db, user.id, localDate(at, map.timeZone), day);
        throw new AppError('CONFLICT', ADVENT_MESSAGES.problem[problem ?? 'claimed']);
      }
      void options.publish?.(mapId);
      return {
        opened: { day, catchUp: result.catchUp, items: result.items },
        advent: await calendar(db, user.id, result.today),
      };
    },

    openPresent: async (user, mapId) => {
      const at = now();
      const result = await createAdventRepo(db).transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId, KINDS);
        // Lock order (tech spec §7): the member row (step 2), then the bag
        // rows this opening touches, all at once in item-id order (step 11).
        if (!(await createMapsRepo(tx).lockMember(mapId, user.id))) {
          throw new AppError('NOT_FOUND', ADVENT_MESSAGES.noPatch);
        }
        // No row of its own: the ledger rows (the present spent and what was
        // in it, both `present-open`) and `present.opened` share this id.
        const openingId = randomUUID();
        const items = rollPresentOpening(table, user.id, openingId);
        const owner = { mapId, userId: user.id };
        const inventory = createInventoryRepo(tx);
        const ids = [...new Set([PRESENT_ITEM, ...Object.keys(items)])].sort();
        const have = await inventory.createAndLockItems(owner, ids);
        const wrapped = have[PRESENT_ITEM] ?? 0;
        if (wrapped < 1) throw new AppError('CONFLICT', ADVENT_MESSAGES.noPresent);
        await consumeItems(tx, owner, { [PRESENT_ITEM]: 1 }, 'present-open', openingId, at);
        await grantItems(tx, owner, items, 'present-open', openingId, at);
        await repo.appendEvent({
          mapId,
          type: 'present.opened',
          actorUserId: user.id,
          payload: { userId: user.id, openingId, items },
        });
        return { items, presentsLeft: wrapped - 1 };
      });
      void options.publish?.(mapId);
      return result;
    },
  };
}
