import {
  CARE_RULES,
  GAME_DATA,
  isStarterSpecies,
  STARTERS,
  type PickStarterResponse,
  type PublicUser,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import { grantItems } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import { createStartersRepo } from './repo.js';

/*
 * The starter pick (owner decision 2026-10-03, design doc §4 "First
 * squishy"): a player who joins or makes a patch picks 1 of the 3 `STARTERS`
 * and gets a level-1 squishy of it, once per membership. The marker
 * (`map_members.starter_squishy_id`) stays when they leave, so coming back
 * gives no second pick: they still have the squishies they had.
 *
 * The account's very first pick also brings Sprout's gift
 * (`STARTERS.firstPickGift`, 3 Heart Charms; owner decision 2026-10-04) into
 * that patch's bag, so a new player can befriend a squishy on day one. "First"
 * is read from the markers themselves: no other membership has one.
 */

export interface StartersService {
  /** Picks the player's starter on a patch; returns the new squishy and any gift. */
  pick: (user: PublicUser, mapId: string, speciesId: string) => Promise<PickStarterResponse>;
}

export interface StartersServiceOptions {
  db: Executor;
  clock?: Clock;
}

// Kid-readable messages (style guide §6).
const MESSAGES = {
  notStarter: 'Pick one of the three friends!',
  alreadyPicked: 'You already picked your first friend here!',
  notFound: "We couldn't find that patch.",
} as const;

const speciesById = new Map(GAME_DATA.species.map((s) => [s.id, s]));

/**
 * Whether the player still needs to pick a starter on this patch
 * (`MapDetail.needsStarter`), and the one the pick pre-selects: their
 * tutorial Partner's species (#24), if it's still a starter.
 */
export async function starterPick(
  db: Executor,
  mapId: string,
  userId: string,
): Promise<{ needsStarter: boolean; preselectSpeciesId: string | null }> {
  const repo = createStartersRepo(db);
  if (!(await repo.needsStarter(mapId, userId))) {
    return { needsStarter: false, preselectSpeciesId: null };
  }
  const partner = await repo.partnerSpecies(userId);
  return {
    needsStarter: true,
    preselectSpeciesId: partner !== null && isStarterSpecies(partner) ? partner : null,
  };
}

export function createStartersService(options: StartersServiceOptions): StartersService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createStartersRepo(db);

  return {
    pick: async (user, mapId, speciesId) => {
      const species = isStarterSpecies(speciesId) ? speciesById.get(speciesId) : undefined;
      if (!species) throw new AppError('VALIDATION_FAILED', MESSAGES.notStarter);
      const at = now();
      return store.transaction(async (repo, tx) => {
        // Patches only: the Tutorial Glade has its own Partner (#24).
        const { role } = await requireMember(tx, user, mapId, ['multiplayer']);
        // Lock order: the account, then the member row (as joining and
        // leaving do), then the new squishy, the gift's inventory rows and
        // `species_seen` (tech spec §7). The account lock makes "first pick"
        // one at a time across all their patches. An owner's member row is
        // the seats row, so they take it first, before the account, as
        // approving a join does. No game event: no other member's view
        // changes, and `squishy.captured` belongs to a battle.
        const maps = createMapsRepo(tx);
        if (role === 'owner') await maps.lockSeats(mapId);
        await maps.lockUser(user.id);
        const member = await maps.lockMember(mapId, user.id);
        if (!member) throw new AppError('NOT_FOUND', MESSAGES.notFound);
        if (member.starterSquishyId !== null) {
          throw new AppError('CONFLICT', MESSAGES.alreadyPicked);
        }
        const first = !(await repo.pickedBefore(user.id));
        const squishy = await createBattlesRepo(tx).insertSquishy({
          mapId,
          ownerUserId: user.id,
          speciesId: species.id,
          element: species.element,
          feeling: species.feeling,
          level: 1,
          contentment: CARE_RULES.startContentment,
          at,
        });
        await repo.setStarter(mapId, user.id, squishy.id);
        const gift = first ? { ...STARTERS.firstPickGift } : {};
        // Ledgered like Sprout's little bag in the tutorial, pointing at the starter.
        if (first) await grantItems(tx, { mapId, userId: user.id }, gift, 'starter', squishy.id);
        // Their own starter is in their catalog as befriended, like a capture.
        await createSpawnsRepo(tx).markCaught(mapId, user.id, species.id, at);
        return { squishy, gift };
      });
    },
  };
}
