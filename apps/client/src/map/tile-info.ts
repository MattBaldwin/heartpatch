import {
  RESOURCES,
  TERRAINS,
  type GuardianDifficulty,
  type GuardianHint,
  type MapMember,
  type PublicTile,
} from '@heartpatch/shared';

// What the tile info panel says about a tile (copy follows docs/STYLE_GUIDE.md).
// Pure, so every case is unit-tested. Home bases can never be claimed (design
// doc §11), so nothing here ever offers it. (The land is never taken; squishies
// still need a lit Hearthfire at night, §14, so don't promise they're safe.)

export interface TileInfo {
  /** The terrain's name, e.g. "Old Forest". */
  readonly title: string;
  /** The terrain's one-line description. */
  readonly about: string;
  /** Whose land it is. */
  readonly owner: string;
  /** What can be gathered here, if anything. */
  readonly resource: string | null;
  /** Wild land's guardians today: how many and how tough (owner decision 10). */
  readonly guardians: string | null;
  readonly home: boolean;
}

export function describeTile(
  tile: PublicTile,
  member: (userId: string) => MapMember | undefined,
  me: string | null,
): TileInfo {
  const terrain = TERRAINS.find((t) => t.id === tile.terrain);
  const resource = RESOURCES.find((r) => r.id === tile.nodeResource);
  const ownerName =
    tile.ownerUserId === null ? null : (member(tile.ownerUserId)?.user.username ?? null);
  const mine = me !== null && tile.ownerUserId === me;
  const home = tile.homeSlot !== null;

  let owner: string;
  if (home) {
    if (mine) owner = 'Your home base. Nobody can ever take it!';
    else if (ownerName !== null) owner = `${ownerName}'s home base. Nobody can ever take it!`;
    else owner = 'A cozy home spot, waiting for a new Keeper.';
  } else if (mine) {
    owner = 'Your land.';
  } else if (ownerName !== null) {
    owner = `${ownerName}'s land.`;
  } else {
    owner = 'Wild land.';
  }

  return {
    title: terrain?.name ?? 'Mystery land',
    about: terrain?.description ?? 'Nobody knows much about this spot yet.',
    owner,
    resource: resource ? `Find ${resource.name} here.` : null,
    guardians: guardianLine(tile.guardianHint),
    home,
  };
}

const DIFFICULTY_WORDS: Readonly<Record<GuardianDifficulty, string>> = {
  easy: 'easy',
  tough: 'tough',
  'very-tough': 'very tough',
};

/**
 * "Guarded by 3 sleepy squishies • tough": only how many and how tough, so a
 * kid can pick a showdown they can win (the server never says who).
 */
export function guardianLine(hint: GuardianHint | null): string | null {
  if (hint === null) return null;
  const who = hint.count === 1 ? '1 sleepy squishy' : `${String(hint.count)} sleepy squishies`;
  return `Guarded by ${who} • ${DIFFICULTY_WORDS[hint.difficulty]}`;
}
