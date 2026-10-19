import {
  hexBfs,
  hexDistance,
  hexKey,
  hexNeighbors,
  isTradingPost,
  type Hex,
  type HexKey,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import { findHomeBases } from '../map/map-layout.js';

/*
 * Hollowed Communities, PROTOTYPE ONLY (#306 plan). A dev query flag
 * (`?hollowed=grey|restored&show=…`) paints clusters of wild tiles as
 * Hollowed Communities on the client, so the mockup captures come from the
 * real map and explore views. Nothing here talks to the server, and none of
 * it ships: the plan's PRs replace it with server data (`tiles.community_id`,
 * `MapView.communities`).
 */

export type HollowedMode = 'grey' | 'restored';
export type HollowedShow =
  | 'sparks'
  | 'echo'
  | 'puzzle'
  | 'cellar'
  | 'rename'
  | 'restore'
  | 'keymap'
  | 'homename'
  | 'homename-locked'
  | null;

export interface HollowedPreview {
  readonly mode: HollowedMode;
  show: HollowedShow;
}

export interface HollowedCluster {
  readonly id: 'near' | 'far';
  readonly name: string;
  readonly restoredName: string;
  /** The village's tiles: its seed tile plus 3–6 of the seed's neighbours (owner decision 2026-10-19). */
  readonly tiles: readonly Hex[];
  /** The village seed tile (the square). */
  readonly centre: Hex;
  /**
   * The home ring the winner gets at full restoration (owner decision
   * 2026-10-19): the seed and its 6 neighbours. `grounds` are the ring tiles
   * that aren't village tiles; wild land until then.
   */
  readonly ring: readonly Hex[];
  readonly grounds: readonly Hex[];
  /** Tiles restored so far, of `tiles.length`. */
  readonly restored: number;
  /** My connected land touches it (the trading-post reach rule), else the steps from my nearest land. */
  readonly reach: { readonly kind: 'touching' } | { readonly kind: 'away'; readonly distance: number };
  /** Drawn restored and joined to my land (`restored` mode). */
  readonly joined: boolean;
  /** Owner decision (Q5): the cellar key is hidden on a tile outside the village; the key map points here. */
  readonly keyTile: Hex | null;
}

const SHOWS: readonly string[] = ['sparks', 'echo', 'puzzle', 'cellar', 'rename', 'restore', 'keymap', 'homename', 'homename-locked'];

export function readHollowedPreview(params: URLSearchParams): HollowedPreview | null {
  const mode = params.get('hollowed');
  if (mode !== 'grey' && mode !== 'restored') return null;
  const show = params.get('show');
  return { mode, show: show !== null && SHOWS.includes(show) ? (show as HollowedShow) : null };
}

let preview: HollowedPreview | null = null;
export function setHollowedPreview(next: HollowedPreview | null): void {
  preview = next;
  cache = null;
}
export function hollowedPreview(): HollowedPreview | null {
  return preview;
}

/** The two communities of the mockup. TUNE: the plan's generator picks about one per 2 members. */
const NEAR = { name: 'Bramblewick Hollow', restoredName: 'Bramblewick Glen', size: 5, restored: 1 };
const FAR = { name: 'Thistledown Hollow', restoredName: 'Thistledown Glen', size: 6, restored: 0 };

let cache: { mapId: string; me: string | null; clusters: HollowedCluster[]; byKey: Map<HexKey, HollowedCluster> } | null =
  null;

const wild = (t: PublicTile): boolean =>
  t.ownerUserId === null &&
  t.homeSlot === null &&
  t.terrain !== 'junipers-gap' &&
  t.terrain !== 'clearing' &&
  !isTradingPost(t);

/** A village seed candidate: wild, with all 6 neighbours on the map and wild (a whole ring fits). */
function ringFits(seed: Hex, tiles: Map<HexKey, PublicTile>): boolean {
  return hexNeighbors(seed).every((n) => {
    const t = tiles.get(hexKey(n));
    return t !== undefined && wild(t);
  });
}

/**
 * A village on `seed`: the seed plus `size - 1` of its neighbours, nearest
 * `anchor` first (so the near village's tiles face my home and touch my
 * land, the reach rule the grey captures show).
 */
function village(seed: Hex, size: number, anchor: Hex): { tiles: Hex[]; ring: Hex[]; grounds: Hex[] } {
  const ring = [seed, ...hexNeighbors(seed)];
  const picked = hexNeighbors(seed)
    .sort((a, b) => hexDistance(a, anchor) - hexDistance(b, anchor) || a.q - b.q || a.r - b.r)
    .slice(0, Math.max(0, Math.min(6, size - 1)));
  const tiles = [seed, ...picked];
  const have = new Set(tiles.map(hexKey));
  return { tiles, ring, grounds: ring.filter((h) => !have.has(hexKey(h))) };
}

function compute(view: MapView, me: string | null): HollowedCluster[] {
  const tiles = new Map(view.tiles.map((t) => [hexKey(t), t] as const));
  const seed = me === null ? null : (findHomeBases(view.tiles).find((h) => h.seed.ownerUserId === me)?.seed ?? null);
  if (!seed) return [];
  // My land joined to home (the trading-post reach rule, shared/territory/reach.ts).
  const mine = new Set(view.tiles.filter((t) => t.ownerUserId === me).map(hexKey));
  const home = view.tiles.filter((t) => t.ownerUserId === me && t.homeSlot !== null);
  const connected = hexBfs(home, (h) => mine.has(hexKey(h)));
  const touches = (h: Hex) => hexNeighbors(h).some((n) => connected.has(hexKey(n)));
  const distanceFromLand = (h: Hex) =>
    Math.min(...view.tiles.filter((t) => t.ownerUserId === me).map((t) => hexDistance(t, h)));
  const wildAround = (h: Hex) =>
    hexNeighbors(h).filter((n) => {
      const t = tiles.get(hexKey(n));
      return t !== undefined && wild(t);
    }).length;

  // Near: a village seed 3 steps from my Heart Seed (its ring never shares a tile
  // with mine, and its tiles nearest home touch my home ring), whole ring wild.
  const nearSeed = view.tiles
    .filter((t) => wild(t) && hexDistance(t, seed) === 3 && ringFits(t, tiles))
    .sort((a, b) => wildAround(b) - wildAround(a) || a.q - b.q || a.r - b.r)[0];
  const clusters: HollowedCluster[] = [];
  const joined = preview?.mode === 'restored';
  let nearTiles: Hex[] = [];
  if (nearSeed) {
    const v = village(nearSeed, NEAR.size, seed);
    nearTiles = v.tiles;
    // The key tile: wild, outside the ring, 2 steps from the village's edge, furthest from home.
    const inRing = new Set(v.ring.map(hexKey));
    const keyTile =
      view.tiles
        .filter((t) => wild(t) && !inRing.has(hexKey(t)))
        .filter((t) => Math.min(...nearTiles.map((x) => hexDistance(x, t))) === 2)
        .sort((a, b) => hexDistance(b, seed) - hexDistance(a, seed) || a.q - b.q || a.r - b.r)[0] ?? null;
    clusters.push({
      keyTile: keyTile ? { q: keyTile.q, r: keyTile.r } : null,
      id: 'near',
      name: NEAR.name,
      restoredName: NEAR.restoredName,
      tiles: nearTiles,
      centre: nearSeed,
      ring: v.ring,
      grounds: v.grounds,
      restored: joined ? NEAR.size : NEAR.restored,
      reach: nearTiles.some(touches) ? { kind: 'touching' } : { kind: 'away', distance: Math.min(...nearTiles.map(distanceFromLand)) },
      joined,
    });
  }
  // Far: a village seed about 6 steps out, furthest from the near village, whole ring wild.
  const nearCentre = nearSeed ?? seed;
  const farSeed = view.tiles
    .filter((t) => wild(t) && hexDistance(t, seed) === 6 && hexDistance(t, { q: 0, r: 0 }) > 2 && ringFits(t, tiles))
    .sort((a, b) => hexDistance(b, nearCentre) - hexDistance(a, nearCentre) || a.q - b.q || a.r - b.r)[0];
  if (farSeed) {
    const v = village(farSeed, FAR.size, seed);
    clusters.push({
      keyTile: null,
      id: 'far',
      name: FAR.name,
      restoredName: FAR.restoredName,
      tiles: v.tiles,
      centre: farSeed,
      ring: v.ring,
      grounds: v.grounds,
      restored: FAR.restored,
      reach: v.tiles.some(touches) ? { kind: 'touching' } : { kind: 'away', distance: Math.min(...v.tiles.map(distanceFromLand)) },
      joined: false,
    });
  }
  return clusters;
}

/** The mockup's clusters on this map (cached per map and viewer), or none without the flag. */
export function hollowedClusters(view: MapView, me: string | null): HollowedCluster[] {
  if (!preview) return [];
  if (cache && cache.mapId === view.map.id && cache.me === me) return cache.clusters;
  const clusters = compute(view, me);
  const byKey = new Map<HexKey, HollowedCluster>();
  for (const c of clusters) for (const t of c.tiles) byKey.set(hexKey(t), c);
  cache = { mapId: view.map.id, me, clusters, byKey };
  return clusters;
}

/** The cluster a tile belongs to, from the last `hollowedClusters` call. */
export function hollowedAt(key: HexKey): HollowedCluster | undefined {
  return cache?.byKey.get(key);
}

/** Drawn grey: in a community that hasn't been fully restored. */
export function hollowedGrey(key: HexKey): boolean {
  const c = cache?.byKey.get(key);
  return c !== undefined && !c.joined;
}

/**
 * The map view as the mockup draws it: in `restored` mode the near community
 * is mine, fully explored and joined to home, so the border ribbon, the
 * homestead glow and the explored sparkle draw themselves.
 */
export function previewView(view: MapView, me: string | null): MapView {
  if (!preview) return view;
  const clusters = hollowedClusters(view, me);
  const won = clusters.filter((c) => c.joined);
  if (won.length === 0 || me === null) return view;
  const slot = view.members.find((m) => m.user.id === me)?.homeSlot ?? null;
  if (slot === null) return view;
  const villages = new Set(won.flatMap((c) => c.tiles.map(hexKey)));
  const ring = new Set(won.flatMap((c) => c.ring.map(hexKey)));
  // Owner decision 2026-10-19: the seed and its 6 neighbours are the winner's
  // home tiles (`home_slot`), so the map draws them as home land itself and
  // finds the village seed the way it finds the first one.
  return {
    ...view,
    tiles: view.tiles.map((t) => {
      const key = hexKey(t);
      if (!ring.has(key)) return t;
      return {
        ...t,
        ownerUserId: me,
        homeSlot: slot,
        guardianHint: null,
        explored: villages.has(key) ? true : t.explored,
        homestead: null,
      };
    }),
  };
}

/** "1 of 5 tiles restored". */
export const restoredLine = (c: HollowedCluster): string =>
  `${String(c.restored)} of ${String(c.tiles.length)} tiles restored`;

/** The flag's words. */
export function hollowedFlagLabel(c: HollowedCluster): string {
  if (c.joined) return `🏡 ${c.restoredName} · joined!`;
  if (c.reach.kind === 'touching') return `🕯️ ${c.name} · ${String(c.restored)}/${String(c.tiles.length)} restored`;
  return `🕯️ ${c.name} · ${String(c.reach.distance)} tiles away`;
}

/** The tile panel's lines for a Hollowed tile. */
export function hollowedPanel(c: HollowedCluster, terrainName: string, at?: Hex): {
  title: string;
  owner: string;
  about: string;
  reach: string;
} {
  if (c.joined && at && at.q === c.centre.q && at.r === c.centre.r) {
    // Owner decisions (Q3, 2026-10-18/19): the won village gets its own Heart Seed and a home ring.
    return {
      title: `${c.restoredName} · Heart Seed 🌱`,
      owner: 'Your second home! Safe at night, and nobody can ever take it.',
      about: 'The village seed. It and the 6 tiles around it are yours for keeps.',
      reach: '🏡 Linked to home: your land joins up through here too.',
    };
  }
  if (c.joined) {
    return {
      title: `${terrainName} · ${c.restoredName} 🏡`,
      owner: 'Your home ring here. Safe at night, never fades, never taken!',
      about: 'Part of your second home.',
      reach: '🔗 Joined to your land.',
    };
  }
  return {
    title: `${terrainName} · Hollowed 🕯️`,
    owner: `${c.name}. ${restoredLine(c)}.`,
    about: 'Grey, quiet and a little spooky. Rare squishies love quiet places…',
    reach:
      c.reach.kind === 'touching'
        ? '🔗 Your land touches it. Explore by day, restore with Heartdust!'
        : `🧭 ${String(c.reach.distance)} tiles from your land. Claim land toward it to explore!`,
  };
}
