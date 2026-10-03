import { GAME_DATA, GROWTH_RULES, xpForLevel, type ClothingSource } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { uuidV5 } from '../../lib/uuid-v5.js';
import { createWardrobeRepo } from '../wardrobe/repo.js';
import type { PartnerRow } from './repo.js';

// What the tutorial gives (design doc §26, #24): the Partner, the
// account-bound Seedling Scarf, and the first completion that the First
// Patch milestone (#44) reads (`users.tutorial_completed_at`).

/** The scarf from the tutorial's wardrobe step (`data/clothing.ts`). */
export const SEEDLING_SCARF = 'seedling-scarf';
const SCARF_SOURCE: ClothingSource = 'tutorial';
/**
 * Fixed namespace for the scarf's `clothing_owned.ref_id`: uuid v5 of the
 * player's id under it is one ref per player, so the grant is idempotent per
 * account and two players never collide on `(source, ref_id)`. Never change it.
 */
const SCARF_REF_NAMESPACE = '3f6b1c2e-8a4d-4f7e-9b25-6d0c1e7a5b93';

/** The scarf's `ref_id` for a player. */
export const scarfRefId = (userId: string): string => uuidV5(userId, SCARF_REF_NAMESPACE);

/**
 * Gives the player their Seedling Scarf, in the caller's transaction. Once per
 * account however often it's called (a replay, a retried event). True if this
 * call stored it.
 */
export function grantSeedlingScarf(
  tx: Executor,
  userId: string,
  mapId: string,
  at: Date,
): Promise<boolean> {
  return createWardrobeRepo(tx).grant({
    userId,
    itemId: SEEDLING_SCARF,
    source: SCARF_SOURCE,
    refId: scarfRefId(userId),
    mapId,
    at,
  });
}

const speciesById = new Map(GAME_DATA.species.map((s) => [s.id, s]));

/**
 * The stored Partner species and every form it grows into: which squishy on
 * the run is the Partner (`users.partner_species_id`, set by the befriend
 * step), so the one named and evolved is the one the starter pick pre-selects
 * even if the kid befriended another starter earlier. Empty without one.
 */
export function partnerLineOf(speciesId: string | null): string[] {
  const line: string[] = [];
  let id = speciesId ?? undefined;
  while (id !== undefined && !line.includes(id)) {
    line.push(id);
    id = speciesById.get(id)?.evolutions[0]?.into;
  }
  return line;
}

/**
 * Base XP that takes the Partner to its next form's level (design doc §26
 * step 11: "one more battle gives your Partner enough XP to evolve"), or 0
 * if it has no next form. Care's multiplier only adds to it.
 */
export function xpToEvolve(partner: Pick<PartnerRow, 'speciesId' | 'level' | 'xp'>): number {
  const next = speciesById.get(partner.speciesId)?.evolutions[0];
  if (!next) return 0;
  const have = Math.max(partner.xp, xpForLevel(partner.level, GROWTH_RULES));
  return Math.max(0, xpForLevel(next.level, GROWTH_RULES) - have);
}
