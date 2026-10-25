import {
  isTradingPost,
  FEELINGS,
  JOB_RULES,
  RESOURCES,
  TERRAINS,
  workSource,
  type GuardianDifficulty,
  type FeelingId,
  type GuardianHint,
  type MapMember,
  type PostReach,
  type PublicTile,
  type Resource,
} from '@heartpatch/shared';
import { itemIcon } from '../inventory/item-icons.js';
import { seedTitle } from '../home/home-name-view.js';
import { postReachLine } from '../trading/post-model.js';
import { isWaterTile } from './map-dressing.js';

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
   * Keeper spot (#238's nesting economy): "Squishies gather 🪵 Timber here."
   */
  readonly gatherer: string | null;
  /**
   * A trading post (#269): how this player reaches it ("🔗 Your land reaches
   * it!", "🧭 3 tiles from your land…") and what's coming there (null on a
   * post a journey away: its journey shows instead, #270). Null elsewhere.
   */
  readonly post: { readonly reach: string | null } | null;
  readonly home: boolean;
}

/**
 * Wild Isle's tile names (#621 plan §8): water and the coast wear an emoji
 * in the panel's title ("Ocean 🌊"). Water is nobody's land and can never be
 * claimed, so its owner line is what it's like (the terrain's description:
 * "Just waves out here. Nothing to claim!"), its details say so, and it
 * offers no actions (`map-screen.ts`).
 */
export const TILE_EMOJI: Readonly<Record<string, string>> = {
  ocean: '🌊',
  river: '💧',
  'wild-lake': '💧',
  coast: '🐚',
};

/** The details line on a water tile (the owner line already says what it's like). */
export const WATER_ABOUT = 'Nobody can claim water. Enjoy the view!';

export function describeTile(
  tile: PublicTile,
  member: (userId: string) => MapMember | undefined,
  me: string | null,
  /** Seasons on for the map: a seasonal home node only shows in its own (owner decision 2026-10-06). */
  seasons: readonly string[] = [],
  /** How this player reaches the tile, when it's a trading post (shared `postReach`). */
  reach: PostReach | null = null,
  /** The home's name when this is a named home's Heart Seed (#306 PR 0, `seedName`). */
  homeName: string | null = null,
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
  const water = isWaterTile(tile);
  const emoji = TILE_EMOJI[tile.terrain];
  let owner: string;
  if (water) {
    // A river with a bridge on it (#621) is no longer too deep to cross.
    owner = tile.buildings.some((b) => b.buildingId === 'bridge')
      ? 'A bridge crosses here. Hop across! 🪵'
      : (terrain?.description ?? 'Just water out here.');
  } else if (post) {
    owner = 'A trading post for every Keeper. Nobody can claim it!';
  } else if (home) {
    if (mine) owner = 'Your home base. Nobody can ever take it!';
    else if (ownerName !== null) owner = `${ownerName}'s home base. Nobody can ever take it!`;
    // An open seat (#318): only a Keeper who joins can have it.
    else owner = 'A cozy home, saved for the next Keeper who joins! ✨';
  } else if (mine) {
    owner = HOMESTEAD_WORDS.owner(tile);
  } else if (ownerName !== null) {
    owner = `${ownerName}'s land.`;
  } else {
    owner = 'Wild land.';
  }

  return {
    title:
      (post ? tile.post?.name : undefined) ??
      (homeName !== null ? seedTitle(homeName) : undefined) ??
      `${terrain?.name ?? 'Mystery land'}${emoji !== undefined ? ` ${emoji}` : ''}${mine && !home ? HOMESTEAD_WORDS.tag(tile) : ''}`,
    about: water ? WATER_ABOUT : (terrain?.description ?? 'Nobody knows much about this spot yet.'),
    owner,
    resource: resource ? `Find ${resource.name} here.` : null,
    guardians: guardianLine(tile.guardianHint),
    gatherer: gathererLine(tile),
    // The panel's actions add the journey (#270, mockup screen b) or "Visit
    // post" (#271) under this line (`trading/journey-screen.ts`).
    post: post ? { reach: postReachLine(reach) } : null,
    home,
  };
}

/**
 * My land's homestead status, in the header (#242, owner request): joined
 * and napping homesteads say so in the title, and explored land that hasn't
 * joined says why, so "Fully explored" never reads as joined.
 */
export const HOMESTEAD_WORDS = {
  tag: (tile: Pick<PublicTile, 'homestead'>): string =>
    tile.homestead === 'joined'
      ? ' · Homestead 🏡'
      : tile.homestead === 'paused'
        ? ' · Homestead (napping zZ)'
        : '',
  owner: (tile: Pick<PublicTile, 'homestead' | 'explored'>): string =>
    tile.homestead
      ? 'Your homestead.'
      : tile.explored
        ? 'Your land, explored ✨. It must touch home to be a homestead.'
        : 'Your land.',
} as const;

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
 * How many squishies and how they feel, in words: "1 Brave squishy", "3 Sleepy
 * squishies", "3 squishies: 2 Sleepy, 1 Joy" (repeats counted, in team order).
 * With no feelings (an older server) just "2 squishies". Wild land's hint and a
 * rival's posted guards (#531) both say it this way.
 */
function whoLine(count: number, feelings: readonly FeelingId[]): string {
  const many = (n: number) => (n === 1 ? 'squishy' : 'squishies');
  const counts = new Map<string, number>();
  for (const id of feelings) {
    const name = FEELING_NAMES.get(id) ?? id;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const n = String(count);
  const [only] = counts.keys();
  if (counts.size === 0) return `${n} ${many(count)}`;
  if (counts.size === 1 && only !== undefined) return `${n} ${only} ${many(count)}`;
  const kinds = [...counts].map(([name, k]) => `${String(k)} ${name}`).join(', ');
  return `${n} squishies: ${kinds}`;
}

/**
 * Who guards wild land, in words (#216): how many, how they feel, and how
 * tough. "Guarded by 1 Brave squishy • easy", "Guarded by 3 Sleepy squishies •
 * tough", "Guarded by 3 squishies: 2 Sleepy, 1 Joy • very tough". An older
 * server sends no feelings: "Guarded by 2 squishies • tough". The server never
 * says which species.
 */
export function guardianLine(hint: GuardianHint | null): string | null {
  if (hint === null) return null;
  return `Guarded by ${whoLine(hint.count, hint.feelings)} • ${DIFFICULTY_WORDS[hint.difficulty]}`;
}

/**
 * Who a rival's posted guards are, in feelings only (#531): "Guarded by 3
 * squishies: 2 Sleepy, 1 Joy". No toughness word: they fight at their Keeper's
 * Partner level, which the challenge sheet says on its own. Null when the
 * server sent no feelings (older server, or nobody posted), so the sheet keeps
 * its "stand watch" count.
 */
export function watchFeelingsLine(feelings: readonly FeelingId[] | undefined): string | null {
  if (!feelings || feelings.length === 0) return null;
  return `Guarded by ${whoLine(feelings.length, feelings)}`;
}
