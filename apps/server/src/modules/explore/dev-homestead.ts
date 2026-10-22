import {
  CLEARED_TERRAIN,
  CLEARING_RULES,
  clearToolFor,
  extraNodes,
  GAME_DATA,
  type DevHomesteadRequest,
} from '@heartpatch/shared';

/**
 * Land a building can go on once its spot is gone: what a tool clears, or
 * cleared land. Every land a map scatters clears since #601 (owner decision
 * Q1); never Juniper's Gap or a trading post.
 */
const buildable = (terrain: string): boolean =>
  terrain === CLEARED_TERRAIN || clearToolFor(terrain, CLEARING_RULES) !== null;

/** A free tile the dev homestead route could make into a homestead. */
export interface DevHomesteadCandidate {
  readonly q: number;
  readonly r: number;
  readonly terrain: string;
}

/**
 * Dev only: which of the free tiles `near` (in the order given) the dev
 * homestead route makes into a homestead, and the land it gets. Pure, so it's
 * unit-tested without a database.
 *
 * With no spot asked for, it skips land the extra-node pass (#238,
 * `seedExtraNodes` on the next map read, same `seed`) would plant a spot back
 * on: a Greens spot grows on one forest in four, and a spot there holds every
 * homestead building back behind "Clear this land first" (#566). When all of
 * it would, it clears one, as a finished clear would leave it (cleared land
 * never gets a spot). Asked for its land, it still prefers one that stays
 * spotless, and otherwise takes what was asked for (a lake always has its well).
 *
 * A home among lakes can have nothing two steps out that stays spotless (a
 * lake always grows its well back, #429): then one of them is cleared. Null
 * when there's no such tile.
 */
export function pickDevHomestead<T extends DevHomesteadCandidate>(
  near: readonly T[],
  ask: Pick<DevHomesteadRequest, 'terrain' | 'nodeResource'>,
  seed: string,
): { tile: T; terrain: string } | null {
  const spotless = (tile: T, terrain: string) =>
    ask.nodeResource !== undefined ||
    extraNodes(
      [{ q: tile.q, r: tile.r, terrain, homeSlot: null, nodeResource: null }],
      GAME_DATA.terrains,
      seed,
    ).length === 0;
  if (ask.terrain !== undefined) {
    const terrain = ask.terrain;
    const fits = near.filter((t) => buildable(t.terrain));
    const tile = fits.find((t) => spotless(t, terrain)) ?? fits[0];
    return tile ? { tile, terrain } : null;
  }
  const kept = near.find((t) => buildable(t.terrain) && spotless(t, t.terrain));
  if (kept) return { tile: kept, terrain: kept.terrain };
  const cleared = near.find((t) => buildable(t.terrain));
  return cleared ? { tile: cleared, terrain: CLEARED_TERRAIN } : null;
}
