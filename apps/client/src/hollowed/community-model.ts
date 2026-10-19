import {
  COMMUNITY_RULES,
  hexKey,
  TERRAINS,
  type CommunityKindId,
  type CommunityRules,
  type CommunityView,
  type HexKey,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import type { TileInfo } from '../map/tile-info.js';

// Hollowed Communities on the map (#306), in words and sets (copy follows
// docs/STYLE_GUIDE.md). Pure, so every case is unit-tested. Everything here
// comes from the map view (`MapView.communities`): the server works out
// each village's reach for this player with the shared `communityReach`.
// Nothing secret reaches the client (CLAUDE.md rule 6): no cellar key, no odds.

/** Player-facing words for a Hollowed village. */
export const COMMUNITY_TEXT = {
  /** After the terrain's name in the tile panel's title. */
  tag: ' · Hollowed 🕯️',
  restored: (name: string, restored: number, total: number) =>
    `${name}. ${String(restored)} of ${String(total)} tiles restored.`,
  about: 'Grey, quiet and a little spooky. Rare squishies love quiet places…',
  kind: (emoji: string, kind: string, perk: string) => `${emoji} ${kind} village: ${perk}`,
  touching: '🔗 Your land touches it. Explore by day, restore with Heartdust!',
  away: (n: number) => `🧭 ${tiles(n)} from your land. Claim land toward it to explore!`,
  noLand: '🧭 Claim land toward it to explore!',
  night: 'Open by day only. Too spooky after dark!',
  soon: 'Exploring and restoring open soon! 🕯️',
  explore: 'Explore 🔍',
  restore: 'Restore 🛠️',
  /** The map legend's row for the grey tiles. */
  legend: 'Hollowed village',
} as const;

/** "3 tiles" / "1 tile". */
const tiles = (n: number) => `${String(n)} ${n === 1 ? 'tile' : 'tiles'}`;

/**
 * Drawn grey: the tiles of every village nobody has won yet. A tile restored
 * on its own (later PRs) will draw in colour again; this is where it stops
 * being grey.
 */
export function greyTiles(view: Pick<MapView, 'communities'>): Set<HexKey> {
  const grey = new Set<HexKey>();
  for (const c of view.communities ?? []) {
    if (c.ownerUserId !== null) continue;
    for (const t of c.tiles) grey.add(hexKey(t));
  }
  return grey;
}

/** Each grey village's square and its kind: where its broken building stands. */
export function villageSquares(view: Pick<MapView, 'communities'>): Map<HexKey, CommunityKindId> {
  return new Map(
    (view.communities ?? [])
      .filter((c) => c.ownerUserId === null)
      .map((c) => [hexKey(c.square), c.kind] as const),
  );
}

/** The village a tile belongs to, by its `communityId` (else its place in a village's tiles). */
export function communityOf(
  view: Pick<MapView, 'communities'>,
  tile: Pick<PublicTile, 'q' | 'r' | 'communityId'>,
): CommunityView | null {
  const all = view.communities ?? [];
  if (tile.communityId) return all.find((c) => c.id === tile.communityId) ?? null;
  const key = hexKey(tile);
  return all.find((c) => c.tiles.some((t) => hexKey(t) === key)) ?? null;
}

/**
 * The flag over a village: "🕯️ Bramble Hollow · 1/5 restored" when my land
 * touches it, "🕯️ Bramble Hollow · 3 tiles away" when it doesn't, and just
 * its name when I have no land here.
 */
export function communityFlagLabel(
  c: Pick<CommunityView, 'name' | 'tiles' | 'restored' | 'reach' | 'distance'>,
): string {
  const name = `🕯️ ${c.name}`;
  if (c.reach === 'touching') {
    return `${name} · ${String(c.restored)}/${String(c.tiles.length)} restored`;
  }
  if (c.reach === 'away' && c.distance !== null) return `${name} · ${tiles(c.distance)} away`;
  return name;
}

/** The village kind's line: "🛠️ Workshop village: One more Factory batch slot." */
export function kindLine(kind: CommunityKindId, rules: CommunityRules = COMMUNITY_RULES): string {
  const found = rules.kinds.find((k) => k.id === kind);
  return found ? COMMUNITY_TEXT.kind(found.emoji, found.name, found.perk) : '';
}

/** What a Hollowed tile's panel says and offers (#306). */
export interface CommunityPanel {
  /** "Old Forest · Hollowed 🕯️". */
  readonly title: string;
  /** "Bramble Hollow. 1 of 5 tiles restored." */
  readonly restored: string;
  /** The spooky line, the kind's line and the reach line (which also says why the buttons wait). */
  readonly lines: readonly string[];
  /** Exploring is open now: my land touches it, by day. Restoring follows the same rule. */
  readonly open: boolean;
  /** "Open soon" while it's open but nothing is wired in yet (PR 1). */
  readonly note: string | null;
}

/**
 * The panel for a tile of village `c`. Explore and Restore wait until my
 * land touches it and it's day; at night that's what the reach line says,
 * whatever the reach. `wired` is true once a later PR hooks the buttons up.
 */
export function communityPanel(
  c: CommunityView,
  terrain: string,
  night: boolean,
  wired = false,
  rules: CommunityRules = COMMUNITY_RULES,
): CommunityPanel {
  const name = TERRAINS.find((t) => t.id === terrain)?.name ?? 'Mystery land';
  const reach = night
    ? COMMUNITY_TEXT.night
    : c.reach === 'touching'
      ? COMMUNITY_TEXT.touching
      : c.reach === 'away' && c.distance !== null
        ? COMMUNITY_TEXT.away(c.distance)
        : COMMUNITY_TEXT.noLand;
  const open = !night && c.reach === 'touching';
  return {
    title: `${name}${COMMUNITY_TEXT.tag}`,
    restored: COMMUNITY_TEXT.restored(c.name, c.restored, c.tiles.length),
    lines: [COMMUNITY_TEXT.about, kindLine(c.kind, rules), reach].filter((l) => l !== ''),
    open,
    note: open && !wired ? COMMUNITY_TEXT.soon : null,
  };
}

/**
 * The tile panel's head on a grey village tile: the Hollowed title, and on
 * wild land the village's progress where "Wild land." would be (someone's
 * land keeps saying whose it is; the progress shows in the village's block).
 * Any other tile's info is returned as it is.
 */
export function hollowedTileInfo(info: TileInfo, tile: PublicTile, view: MapView): TileInfo {
  const c = communityOf(view, tile);
  if (!c || c.ownerUserId !== null) return info;
  const words = communityPanel(c, tile.terrain, false);
  return {
    ...info,
    title: words.title,
    owner: tile.ownerUserId === null ? words.restored : info.owner,
  };
}
