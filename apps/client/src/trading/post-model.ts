import {
  isTradingPost,
  postReach,
  type HexKey,
  type MapView,
  type PostReach,
  type PublicTile,
} from '@heartpatch/shared';

// Trading posts on the map (#269), in words (copy follows docs/STYLE_GUIDE.md).
// Pure, so every case is unit-tested. Reach is the shared rule (`postReach`),
// the one the server uses for journeys (#270), worked out from the map view.

/** One post's flag over the map: where, what it's called, and how this player reaches it. */
export interface PostFlag {
  readonly tile: PublicTile;
  readonly name: string;
  /** Null for someone with no land here (a viewer between patches). */
  readonly reach: PostReach | null;
}

/**
 * Every trading post on the map, in index order, as this player reaches it.
 * `supplied` is my supply line on a Wild Isle (#863): land a road, bridge or
 * ferry joins to home reaches a post too, as the server counts it.
 */
export function postFlags(
  view: Pick<MapView, 'tiles'>,
  me: string | null,
  supplied?: ReadonlySet<HexKey> | null,
): PostFlag[] {
  return view.tiles
    .filter(isTradingPost)
    .map((tile) => ({
      tile,
      name: tile.post?.name ?? 'Trading Post',
      reach: me === null ? null : postReach(tile, view.tiles, me, supplied),
    }))
    .sort((a, b) => (a.tile.post?.index ?? 0) - (b.tile.post?.index ?? 0));
}

/** "3 tiles" / "1 tile". */
const tiles = (n: number) => `${String(n)} ${n === 1 ? 'tile' : 'tiles'}`;

/** The flag's words: "🔗 Acorn Crossing", or "🏮 Lantern Post · 3 tiles". */
export function postFlagLabel(flag: PostFlag): string {
  if (flag.reach?.kind === 'connected') return `🔗 ${flag.name}`;
  if (flag.reach?.kind === 'journey') return `🏮 ${flag.name} · ${tiles(flag.reach.distance)}`;
  return `🏮 ${flag.name}`;
}

/** The reach line when my land next to the post is cut off from home (#863). */
export const POST_CUT_OFF = '🧭 Your nearby land is cut off. Join it up or journey!';

/** The tile panel's line about reaching it. */
export function postReachLine(reach: PostReach | null): string | null {
  if (reach === null) return null;
  if (reach.kind === 'connected') return '🔗 Your land reaches it!';
  // A journey at 1 tile: my land next to it is cut off from home (#863).
  if (reach.distance === 1) return POST_CUT_OFF;
  return `🧭 ${tiles(reach.distance)} from your land. Claim land toward it to get closer!`;
}

/** The tile panel's button into the post's screen (#271), when my land reaches it or I hold a pass. */
export const VISIT_POST = 'Visit post';
