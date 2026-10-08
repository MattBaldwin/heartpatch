import {
  isTradingPost,
  FEELINGS,
  JOB_RULES,
  RESOURCES,
  TERRAINS,
  workSource,
  type GuardianDifficulty,
  type GuardianHint,
  type MapMember,
  type PostReach,
  type PublicTile,
  type Resource,
} from '@heartpatch/shared';
import { itemIcon } from '../inventory/item-icons.js';
import { POST_SOON, postReachLine } from '../trading/post-model.js';

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
  /**
   * What a squishy gatherer picks on this land, whether or not it has a
   * Keeper spot (#238's nesting economy): "Squishies gather 🌲 Timber here."
   */
  readonly gatherer: string | null;
  /**
   * A trading post (#269): how this player reaches it ("🔗 Your land reaches
   * it!", "🧭 3 tiles from your land…") and what's coming there. Null elsewhere.
   */
  readonly post: { readonly reach: string | null; readonly soon: string } | null;
  readonly home: boolean;
}

export function describeTile(
  tile: PublicTile,
  member: (userId: string) => MapMember | undefined,
  me: string | null,
  /** Seasons on for the map: a seasonal home node only shows in its own (owner decision 2026-10-06). */
  seasons: readonly string[] = [],
  /** How this player reaches the tile, when it's a trading post (shared `postReach`). */
  reach: PostReach | null = null,
): TileInfo {
  const terrain = TERRAINS.find((t) => t.id === tile.terrain);
  const found = RESOURCES.find((r) => r.id === tile.nodeResource);
  const resource =
    found && tile.homeSlot !== null && found.season && !seasons.includes(found.season)
      ? undefined
      : found;
  const ownerName =
    tile.ownerUserId === null ? null : (member(tile.ownerUserId)?.user.username ?? null);
  const mine = me !== null && tile.ownerUserId === me;
  const home = tile.homeSlot !== null;

  const post = isTradingPost(tile);
  let owner: string;
  if (post) {
    owner = 'A trading post for every Keeper. Nobody can claim it!';
  } else if (home) {
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
    title: (post ? tile.post?.name : undefined) ?? terrain?.name ?? 'Mystery land',
    about: terrain?.description ?? 'Nobody knows much about this spot yet.',
    owner,
    resource: resource ? `Find ${resource.name} here.` : null,
    guardians: guardianLine(tile.guardianHint),
    gatherer: gathererLine(tile),
    post: post ? { reach: postReachLine(reach), soon: POST_SOON } : null,
    home,
  };
}

/**
 * What a squishy gatherer picks on this tile, from the shared gather rule
 * (`workSource`, owner decision on #238): out on the land its terrain's main
 * resource, whatever spot it has; in the home ring, its spot. The icon is the
 * gather match's (`JOB_RULES.affinities`), else the item's own.
 */
export function gathererLine(
  tile: Pick<PublicTile, 'terrain' | 'homeSlot' | 'nodeResource'>,
  resources: readonly Resource[] = RESOURCES,
  rules: Pick<typeof JOB_RULES, 'terrainYields' | 'affinities'> = JOB_RULES,
): string | null {
  const source = workSource(tile, resources, rules);
  if (!source) return null;
  const name = resources.find((r) => r.id === source.resource)?.name ?? source.resource;
  const icon =
    rules.affinities.find((a) => a.resource === source.resource)?.icon ?? itemIcon(source.resource);
  return `Squishies gather ${icon} ${name} here.`;
}

const DIFFICULTY_WORDS: Readonly<Record<GuardianDifficulty, string>> = {
  easy: 'easy',
  tough: 'tough',
  'very-tough': 'very tough',
};

const FEELING_NAMES = new Map(FEELINGS.map((f) => [f.id, f.name]));

/**
 * Who guards wild land, in words (#216): how many, how they feel, and how
 * tough. "Guarded by 1 Brave squishy • easy", "Guarded by 3 Sleepy squishies •
 * tough", "Guarded by 3 squishies: 2 Sleepy, 1 Joy • very tough" (repeats
 * counted, in team order). An older server sends no feelings: "Guarded by 2
 * squishies • tough". The server never says which species.
 */
export function guardianLine(hint: GuardianHint | null): string | null {
  if (hint === null) return null;
  const tough = DIFFICULTY_WORDS[hint.difficulty];
  const many = (n: number) => (n === 1 ? 'squishy' : 'squishies');
  const counts = new Map<string, number>();
  for (const id of hint.feelings) {
    const name = FEELING_NAMES.get(id) ?? id;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const n = String(hint.count);
  const [only] = counts.keys();
  let who: string;
  if (counts.size === 0) who = `${n} ${many(hint.count)}`;
  else if (counts.size === 1 && only !== undefined) who = `${n} ${only} ${many(hint.count)}`;
  else {
    const kinds = [...counts].map(([name, k]) => `${String(k)} ${name}`).join(', ');
    who = `${n} squishies: ${kinds}`;
  }
  return `Guarded by ${who} • ${tough}`;
}
