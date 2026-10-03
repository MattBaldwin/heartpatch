import {
  CARE_RULES,
  GAME_DATA,
  isStarterSpecies,
  type OwnedSquishy,
  type PublicUser,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import { requireMember } from '../maps/members.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import { createStartersRepo } from './repo.js';

/*
 * The starter pick (owner decision 2026-10-03, design doc §4 "First
 * squishy"): a player who joins or makes a patch picks 1 of the 3 `STARTERS`
 * and gets a level-1 squishy of it, once per membership. The marker
 * (`map_members.starter_squishy_id`) stays when they leave, so coming back
 * gives no second pick: they still have the squishies they had.
 */

export interface StartersService {
  /** Picks the player's starter on a patch; returns the new squishy. */
  pick: (user: PublicUser, mapId: string, speciesId: string) => Promise<OwnedSquishy>;
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

/** True if the player still needs to pick a starter on this patch (`MapDetail.needsStarter`). */
export function needsStarter(db: Executor, mapId: string, userId: string): Promise<boolean> {
  return createStartersRepo(db).needsStarter(mapId, userId);
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
        await requireMember(tx, user, mapId, ['multiplayer']);
        // Lock order: the member row, then the new squishy and `species_seen`
        // (tech spec §7). No game event: no other member's view changes, and
        // `squishy.captured` belongs to a battle.
        const member = await repo.lockMember(mapId, user.id);
        if (!member) throw new AppError('NOT_FOUND', MESSAGES.notFound);
        if (member.starterSquishyId !== null) {
          throw new AppError('CONFLICT', MESSAGES.alreadyPicked);
        }
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
        // Their own starter is in their catalog as befriended, like a capture.
        await createSpawnsRepo(tx).markCaught(mapId, user.id, species.id, at);
        return squishy;
      });
    },
  };
}
