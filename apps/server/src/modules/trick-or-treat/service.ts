import {
  CLOTHING,
  deriveSeed,
  TRICK_OR_TREAT,
  type ClothingItem,
  type ItemCounts,
  type PublicUser,
  type TrickOrTreatRequest,
  type TrickOrTreatRules,
  type TrickOrTreatView,
  type TrickOrTreatVisitResponse,
} from '@heartpatch/shared';
import {
  rollTrickOrTreat,
  TRICK_OR_TREAT_PRIZES,
  type TrickOrTreatPrizes,
} from '@heartpatch/shared/server';
import { uuidv7 } from 'uuidv7';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { localDate, nextLocalMidnight, type Clock } from '../../lib/time.js';
import { fireStateAt } from '../buildings/hearthfire.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { grantItems, lockGrantRows, seasonsOn } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { grantClothing } from '../wardrobe/service.js';
import { createWardrobeRepo } from '../wardrobe/repo.js';
import { createTrickOrTreatRepo } from './repo.js';

/*
 * Trick-or-treat (#515, owner answers 2026-10-18, the approved plan): in the
 * Halloween season (the map's local date) a Keeper knocks on a patch-mate's
 * Heart Seed home for a treat: Heartdust, a Keeper costume or a squishy
 * costume. Once per home per patch day; the host needn't be online, and PvP
 * mode doesn't matter. A host with a lit Jack-o'-Lantern Hearthfire tonight
 * gives from the better table. The host gets a small Heartdust thank-you.
 *
 * Server-authoritative and atomic (CLAUDE.md rules 1, 6 and 7): the treat is
 * rolled here from the secret table, seeded by the map seed, both Keepers and
 * the day (so a retry rolls the same treat), and one transaction records the
 * visit (its unique key is the once-a-day rule), grants the treat and the
 * thank-you, and appends `trick.visited`. Lock order (tech spec §7): the
 * visitor's member row (step 2), their account's `users` row (step 4: one
 * knock at a time on every patch, since clothing is the account's, so the
 * owned-costume check holds; a piece held in an open trade offer doesn't
 * count as owned and can come up again, which is harmless), the new
 * costume's `clothing_owned` row (an insert, no lock), both players'
 * inventory rows (step 11, one `lockGrantRows`), then `maps` (13).
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  ownHome: "That's your own home! Knock on a friend's door. 🎃",
  noHome: "That home isn't on this patch.",
  noPatch: "We couldn't find that patch.",
  closed: 'Trick-or-treat is for Halloween. See you next October! 🎃',
  twice: 'You already got a treat here today. Come back tomorrow! 🎃',
} as const;

export interface TrickOrTreatService {
  /** Whether it's on today, and every patch-mate's door: lit, and visited today. */
  view: (user: PublicUser, mapId: string) => Promise<TrickOrTreatView>;
  /** Knocks on a patch-mate's door: today's treat from that home. */
  visit: (
    user: PublicUser,
    mapId: string,
    request: TrickOrTreatRequest,
  ) => Promise<TrickOrTreatVisitResponse>;
}

export interface TrickOrTreatServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** Tests pass other rules, prizes or catalog; the game uses the shipped ones. */
  rules?: TrickOrTreatRules;
  prizes?: TrickOrTreatPrizes;
  catalog?: readonly ClothingItem[];
}

export function createTrickOrTreatService(
  options: TrickOrTreatServiceOptions,
): TrickOrTreatService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const rules = options.rules ?? TRICK_OR_TREAT;
  const prizes = options.prizes ?? TRICK_OR_TREAT_PRIZES;
  const catalog = options.catalog ?? CLOTHING;

  /** Keepers with a lit lantern Hearthfire tonight on this patch (on land they still own). */
  async function litHosts(exec: Executor, mapId: string, at: Date, timeZone: string) {
    const lit = new Set<string>();
    for (const b of await createBuildingsRepo(exec).listOnMap(mapId)) {
      if (b.buildingId !== rules.lanternBuildingId) continue;
      if (fireStateAt(b.fuelledThrough, at, timeZone).lit) lit.add(b.ownerUserId);
    }
    return lit;
  }

  /** What the map shows at `at`, read through `exec` (inside or outside a transaction). */
  async function viewOf(
    exec: Executor,
    userId: string,
    map: { id: string; timeZone: string },
    at: Date,
  ): Promise<TrickOrTreatView> {
    const day = localDate(at, map.timeZone);
    const repo = createTrickOrTreatRepo(exec);
    const [hosts, visited, lit] = await Promise.all([
      repo.hostsOf(map.id, userId),
      repo.visitedOn(map.id, userId, day),
      litHosts(exec, map.id, at, map.timeZone),
    ]);
    return {
      open: seasonsOn(at, map.timeZone).includes(rules.season),
      day,
      resetsAt: nextLocalMidnight(at, map.timeZone).toISOString(),
      hosts: hosts.map((id) => ({ userId: id, lit: lit.has(id), visited: visited.includes(id) })),
    };
  }

  return {
    view: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId, ['multiplayer']);
      return viewOf(db, user.id, map, now());
    },

    visit: async (user, mapId, request) => {
      const { hostUserId } = request;
      if (hostUserId === user.id) throw new AppError('VALIDATION_FAILED', MESSAGES.ownHome);
      // A plain check first, so a non-member opens no transaction; it's
      // checked again under the member lock below.
      await requireMember(db, user, mapId, ['multiplayer']);
      const result = await createTrickOrTreatRepo(db).transaction(async (repo, tx) => {
        const at = now();
        const { map } = await requireMember(tx, user, mapId, ['multiplayer']);
        // 1. My member row (step 2): gone if I left the patch meanwhile.
        if (!(await createMapsRepo(tx).lockMember(mapId, user.id))) {
          throw new AppError('NOT_FOUND', MESSAGES.noPatch);
        }
        // 2. My account's `users` row (step 4): one knock at a time on every
        // patch, so the costumes I own can't change under the roll.
        await repo.lockAccount(user.id);
        if (!seasonsOn(at, map.timeZone).includes(rules.season)) {
          throw new AppError('CONFLICT', MESSAGES.closed);
        }
        // 3. A patch-mate with a home here (plain reads).
        if (!(await repo.hostsOf(mapId, user.id)).includes(hostUserId)) {
          throw new AppError('NOT_FOUND', MESSAGES.noHome);
        }
        const day = localDate(at, map.timeZone);
        const [lit, owned, mapSeed] = await Promise.all([
          litHosts(tx, mapId, at, map.timeZone),
          createWardrobeRepo(tx).countOwned(user.id),
          createTerritoryRepo(tx).mapSeed(mapId),
        ]);
        const lantern = lit.has(hostUserId);
        // 4. The treat: seeded, so the same visit always rolls the same.
        const { trick, prize } = rollTrickOrTreat(
          {
            mapSeed: mapSeed ?? deriveSeed('hand-authored-map', mapId),
            visitorUserId: user.id,
            hostUserId,
            day,
            lantern,
            owned: new Set(owned.keys()),
          },
          prizes,
          catalog,
        );
        // 5. The visit row: its unique key is the once-a-day rule.
        const visitId = uuidv7();
        const hostHeartdust = rules.hostThanks;
        const stored = await repo.insertVisit({
          id: visitId,
          mapId,
          visitorUserId: user.id,
          hostUserId,
          day,
          lantern,
          trick,
          prizeKind: prize.kind,
          prizeItemId: prize.itemId,
          prizeCount: prize.count,
          hostHeartdust,
          createdAt: at,
        });
        if (!stored) throw new AppError('CONFLICT', MESSAGES.twice);
        // 6. The treat and the thank-you: both bags' rows in one lock (step 11).
        const visitorItems: ItemCounts =
          prize.kind === 'heartdust' ? { heartdust: prize.count } : {};
        await lockGrantRows(tx, mapId, [
          { userId: user.id, items: visitorItems },
          { userId: hostUserId, items: { heartdust: hostHeartdust } },
        ]);
        if (prize.kind === 'heartdust') {
          await grantItems(
            tx,
            { mapId, userId: user.id },
            visitorItems,
            'trick-or-treat',
            visitId,
            at,
          );
        } else {
          // One piece per (source, visit): the visit id is new, so it always stores.
          await grantClothing(tx, {
            userId: user.id,
            itemId: prize.itemId,
            source: 'trick-or-treat',
            refId: visitId,
            mapId,
            at,
          });
        }
        await grantItems(
          tx,
          { mapId, userId: hostUserId },
          { heartdust: hostHeartdust },
          'trick-or-treat-thanks',
          visitId,
          at,
        );
        // 7. The event, last (`maps`, step 13).
        await repo.appendEvent({
          mapId,
          type: 'trick.visited',
          actorUserId: user.id,
          payload: {
            visitId,
            visitorUserId: user.id,
            hostUserId,
            day,
            lantern,
            trick,
            prize,
            hostHeartdust,
          },
        });
        return {
          visit: { visitId, hostUserId, lantern, trick, prize },
          trickOrTreat: await viewOf(tx, user.id, map, at),
        };
      });
      void options.publish?.(mapId);
      return result;
    },
  };
}
