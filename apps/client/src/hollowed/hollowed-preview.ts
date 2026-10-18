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
export type HollowedShow = 'sparks' | 'echo' | 'puzzle' | 'cellar' | 'rename' | 'restore' | null;

export interface HollowedPreview {
  readonly mode: HollowedMode;
  show: HollowedShow;
}

export interface HollowedCluster {
  readonly id: 'near' | 'far';
  readonly name: string;
  readonly restoredName: string;
  readonly tiles: readonly Hex[];
  readonly centre: Hex;
  /** Tiles restored so far, of `tiles.length`. */
  readonly restored: number;
  /** My connected land touches it (the trading-post reach rule), else the steps from my nearest land. */
  readonly reach: { readonly kind: 'touching' } | { readonly kind: 'away'; readonly distance: number };
  /** Drawn restored and joined to my land (`restored` mode). */
  readonly joined: boolean;
}

const SHOWS: readonly string[] = ['sparks', 'echo', 'puzzle', 'cellar', 'rename', 'restore'];

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

/** Grows a cluster of `size` wild tiles from `start`, nearest `anchor` first. */
function grow(start: Hex, size: number, tiles: Map<HexKey, PublicTile>, anchor: Hex): Hex[] {
  const picked: Hex[] = [start];
  const have = new Set([hexKey(start)]);
  while (picked.length < size) {
    const options: Hex[] = [];
    for (const p of picked) {
      for (const n of hexNeighbors(p)) {
        const key = hexKey(n);
        const t = tiles.get(key);
        if (!t || have.has(key) || !wild(t)) continue;
        options.push(n);
      }
    }
    if (options.length === 0) break;
    // Compact: the option touching the most picked tiles, then nearest the anchor.
    options.sort((a, b) => {
      const ta = hexNeighbors(a).filter((n) => have.has(hexKey(n))).length;
      const tb = hexNeighbors(b).filter((n) => have.has(hexKey(n))).length;
      return tb - ta || hexDistance(a, anchor) - hexDistance(b, anchor) || a.q - b.q || a.r - b.r;
    });
    const next = options[0] as Hex;
    picked.push(next);
    have.add(hexKey(next));
  }
  return picked;
}

function centreOf(tiles: readonly Hex[]): Hex {
  // The tile nearest the mean.
  const mq = tiles.reduce((s, t) => s + t.q, 0) / tiles.length;
  const mr = tiles.reduce((s, t) => s + t.r, 0) / tiles.length;
  return [...tiles].sort(
    (a, b) => Math.hypot(a.q - mq, a.r - mr) - Math.hypot(b.q - mq, b.r - mr),
  )[0] as Hex;
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

  // Near: a wild tile touching my home ring with the most wild neighbours.
  const doorsteps = view.tiles
    .filter((t) => wild(t) && hexDistance(t, seed) === 2)
    .sort((a, b) => {
      const wa = hexNeighbors(a).filter((n) => tiles.get(hexKey(n)) && wild(tiles.get(hexKey(n)) as PublicTile)).length;
      const wb = hexNeighbors(b).filter((n) => tiles.get(hexKey(n)) && wild(tiles.get(hexKey(n)) as PublicTile)).length;
      return wb - wa || a.q - b.q || a.r - b.r;
    });
  const clusters: HollowedCluster[] = [];
  const nearStart = doorsteps[0];
  const joined = preview?.mode === 'restored';
  let nearTiles: Hex[] = [];
  if (nearStart) {
    nearTiles = grow(nearStart, NEAR.size, tiles, seed);
    clusters.push({
      id: 'near',
      name: NEAR.name,
      restoredName: NEAR.restoredName,
      tiles: nearTiles,
      centre: centreOf(nearTiles),
      restored: joined ? NEAR.size : NEAR.restored,
      reach: nearTiles.some(touches) ? { kind: 'touching' } : { kind: 'away', distance: Math.min(...nearTiles.map(distanceFromLand)) },
      joined,
    });
  }
  // Far: a wild tile about 6 steps out, furthest from the near cluster.
  const nearCentre = nearTiles.length > 0 ? centreOf(nearTiles) : seed;
  const farStart = view.tiles
    .filter((t) => wild(t) && hexDistance(t, seed) === 6 && hexDistance(t, { q: 0, r: 0 }) > 2)
    .sort((a, b) => hexDistance(b, nearCentre) - hexDistance(a, nearCentre) || a.q - b.q || a.r - b.r)[0];
  if (farStart) {
    const farTiles = grow(farStart, FAR.size, tiles, seed);
    clusters.push({
      id: 'far',
      name: FAR.name,
      restoredName: FAR.restoredName,
      tiles: farTiles,
      centre: centreOf(farTiles),
      restored: FAR.restored,
      reach: farTiles.some(touches) ? { kind: 'touching' } : { kind: 'away', distance: Math.min(...farTiles.map(distanceFromLand)) },
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
  const joined = new Set(clusters.filter((c) => c.joined).flatMap((c) => c.tiles.map(hexKey)));
  if (joined.size === 0 || me === null) return view;
  return {
    ...view,
    tiles: view.tiles.map((t) =>
      joined.has(hexKey(t))
        ? { ...t, ownerUserId: me, guardianHint: null, explored: true, homestead: 'joined' as const }
        : t,
    ),
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
export function hollowedPanel(c: HollowedCluster, terrainName: string): {
  title: string;
  owner: string;
  about: string;
  reach: string;
} {
  if (c.joined) {
    return {
      title: `${terrainName} · ${c.restoredName} 🏡`,
      owner: 'Your land. Part of a village you brought back!',
      about: 'A second community, joined to your home. It needs fire light at night like any land.',
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
