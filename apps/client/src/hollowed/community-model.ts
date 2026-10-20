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
  kind: (emoji: string, kind: string, perk: string) => `${emoji} ${kind}: restore it for ${perk}.`,
  touching: '🔗 Your land touches it. Explore by day, restore with Heartdust!',
  away: (n: number) => `🧭 ${tiles(n)} from your land. Claim land toward it to explore!`,
  noLand: '🧭 Claim land toward it to explore!',
  night: 'Open by day only. Too spooky after dark!',
  /** The touching line until later PRs wire Explore and Restore in. */
  soon: '🔗 Your land touches it! Exploring and restoring open soon 🕯️',
  /** Under the buttons once Explore is open and Restore isn't yet (2a until PR 3). */
  restoreSoon: 'Restoring opens soon 🛠️',
  explore: 'Explore 🔍',
  restore: 'Restore 🛠️',
  /** The map legend's row for the grey tiles. */
  legend: 'Hollowed village',
  // A won village (#306 PR 3): a second home with its own Heart Seed.
  /** Its flag: "🏡 Bramble Glen". */
  wonFlag: (name: string) => `🏡 ${name}`,
  /** The square's title: "Bramble Glen · Heart Seed 🌱". */
  seedTitle: (name: string) => `${name} · Heart Seed 🌱`,
  /** A ring tile's title: "Meadow · Bramble Glen 🏡". */
  ringTitle: (terrain: string, name: string) => `${terrain} · ${name} 🏡`,
  mySeed: 'Your second home! Safe at night, and nobody can ever take it.',
  myRing: 'Part of your second home. Safe at night, never fades, never taken!',
  theirs: (who: string) => `${who}'s village. Nobody can ever take it!`,
  /** A restored tile of a village still being restored. */
  tileRestored: '✨ This spot is restored! Restore the rest to win the village.',
  // Contested tiles (PR 4): a restored tile is ordinary land until the village is won.
  /** A restored tile someone else holds. */
  winIt: '✨ Restored. Win it in a battle!',
  /** …with nobody on watch: the tile's own guardians stand in. */
  keepers: '🏮 No guards here. Lantern keepers watch over it.',
  /** A restored tile gone wild again (it faded, or the Hollow Man won it back). */
  claimIt: '✨ Restored, but wild again. Claim it!',
  /** Every tile restored, nobody's yet (split between Keepers, or its winner left). */
  winEvery: '🏆 All restored! Win every tile to make it yours.',
  nameIt: 'Name it ✨',
  /** A won village's perk at work (PR 3b): "🛠️ Workshop: one more Factory batch". */
  perk: (emoji: string, kind: string, perk: string) => `${emoji} ${kind}: ${perk}`,
  /** Its winner's morning gift on the square (the Old Well, the Bakery). */
  giftReady: 'Collect today’s gift 🎁',
  giftTaken: 'Today’s gift is in your bag! More tomorrow morning 🌅',
  giftGot: (items: string) => `Thank you! ${items} 🎁`,
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
    const restored = new Set((c.restoredTiles ?? []).map(hexKey));
    for (const t of c.tiles) if (!restored.has(hexKey(t))) grey.add(hexKey(t));
  }
  return grey;
}

/** Each won village's square: where its own Heart Seed grows (#306 PR 3). */
export function villageSeeds(view: Pick<MapView, 'communities'>): CommunityView[] {
  return (view.communities ?? []).filter((c) => c.ownerUserId !== null);
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
  c: Pick<CommunityView, 'name' | 'tiles' | 'restored' | 'reach' | 'distance'> &
    Partial<Pick<CommunityView, 'ownerUserId'>>,
): string {
  // A won village is someone's home: its name, like a home's flag.
  if ((c.ownerUserId ?? null) !== null) return COMMUNITY_TEXT.wonFlag(c.name);
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

/** A won village's perk line on its square (PR 3b): what it does for its winner. */
export function perkLine(kind: CommunityKindId, rules: CommunityRules = COMMUNITY_RULES): string {
  const found = rules.kinds.find((k) => k.id === kind);
  return found ? COMMUNITY_TEXT.perk(found.emoji, found.name, found.does ?? found.perk) : '';
}

/** What a Hollowed tile's panel says and offers (#306). */
export interface CommunityPanel {
  /** "Old Forest · Hollowed 🕯️". */
  readonly title: string;
  /** "Bramble Hollow. 1 of 5 tiles restored." */
  readonly restored: string;
  /** The reach line first (it says why the buttons wait), then the kind's line and the spooky line. */
  readonly lines: readonly string[];
  /** Exploring is open now: my land touches it, by day. Restoring follows the same rule. */
  readonly open: boolean;
  /** A line under the buttons: Restore opening soon while only Explore is open; else none (the reach line says why they wait). */
  readonly note: string | null;
}

/**
 * The panel for a tile of village `c`. Explore and Restore wait until my
 * land touches it and it's day; at night that's what the reach line says,
 * whatever the reach. `wired` is true once Explore is hooked up (2a), and
 * `restoreWired` once Restore is (PR 3).
 */
export function communityPanel(
  c: CommunityView,
  terrain: string,
  night: boolean,
  wired = false,
  rules: CommunityRules = COMMUNITY_RULES,
  restoreWired = false,
): CommunityPanel {
  const name = TERRAINS.find((t) => t.id === terrain)?.name ?? 'Mystery land';
  const reach = night
    ? COMMUNITY_TEXT.night
    : c.reach === 'touching'
      ? wired
        ? COMMUNITY_TEXT.touching
        : COMMUNITY_TEXT.soon
      : c.reach === 'away' && c.distance !== null
        ? COMMUNITY_TEXT.away(c.distance)
        : COMMUNITY_TEXT.noLand;
  const open = !night && c.reach === 'touching';
  return {
    title: `${name}${COMMUNITY_TEXT.tag}`,
    restored: COMMUNITY_TEXT.restored(c.name, c.restored, c.tiles.length),
    lines: [reach, kindLine(c.kind, rules), COMMUNITY_TEXT.about].filter((l) => l !== ''),
    open,
    note: open && wired && !restoreWired ? COMMUNITY_TEXT.restoreSoon : null,
  };
}

/**
 * The lines under a restored tile's progress while its village has no
 * winner (PR 4): what the kid can do about it. Claim and Challenge are the
 * territory action's own buttons; these say why they're there.
 */
export function restoredTileLines(
  c: Pick<CommunityView, 'restored' | 'tiles'>,
  tile: Pick<PublicTile, 'ownerUserId' | 'defenders'>,
  me: string | null,
): string[] {
  if (tile.ownerUserId === null) return [COMMUNITY_TEXT.claimIt];
  if (tile.ownerUserId !== me) {
    return [COMMUNITY_TEXT.winIt, ...(tile.defenders === 0 ? [COMMUNITY_TEXT.keepers] : [])];
  }
  return [c.restored >= c.tiles.length ? COMMUNITY_TEXT.winEvery : COMMUNITY_TEXT.tileRestored];
}

/**
 * The tile panel's head on a grey village tile: the Hollowed title, and on
 * wild land the village's progress where "Wild land." would be (someone's
 * land keeps saying whose it is; the progress shows in the village's block).
 * Any other tile's info is returned as it is.
 */
export function hollowedTileInfo(
  info: TileInfo,
  tile: PublicTile,
  view: MapView,
  me: string | null = null,
): TileInfo {
  const c = communityOf(view, tile);
  if (!c) return info;
  if (c.ownerUserId !== null) {
    // Its ring (#306 PR 3): home tiles of the winner, the square their second Heart Seed.
    if (tile.homeSlot === null || tile.ownerUserId !== c.ownerUserId) return info;
    const mine = me !== null && c.ownerUserId === me;
    const square = hexKey(tile) === hexKey(c.square);
    const who = view.members.find((m) => m.user.id === c.ownerUserId)?.user.username;
    const terrain = TERRAINS.find((t) => t.id === tile.terrain)?.name ?? 'Mystery land';
    return {
      ...info,
      title: square ? COMMUNITY_TEXT.seedTitle(c.name) : COMMUNITY_TEXT.ringTitle(terrain, c.name),
      owner: mine
        ? square
          ? COMMUNITY_TEXT.mySeed
          : COMMUNITY_TEXT.myRing
        : who !== undefined
          ? COMMUNITY_TEXT.theirs(who)
          : info.owner,
    };
  }
  const words = communityPanel(c, tile.terrain, false);
  return {
    ...info,
    title: words.title,
    owner: tile.ownerUserId === null ? words.restored : info.owner,
  };
}
