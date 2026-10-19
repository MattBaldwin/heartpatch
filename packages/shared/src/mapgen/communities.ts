import { hexDistance, hexKey, hexRing, hexSpiral, type Hex, type HexKey } from '../hex/index.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import {
  CommunityKindIdSchema,
  type CommunityKindId,
  type CommunityPlacementRules,
} from '../schemas/data/communities.js';
import { isTradingPost } from '../territory/reach.js';

// Hollowed Communities (#306, plan v3 Q3/Q6): grey villages in wild land,
// placed fairly like the trading posts. The same rule places them on a new
// map (`generateMap`'s last pass) and on an older map (the server's boot
// pass, over its stored tiles). A village is its square plus 3–6 of the
// square's neighbours, so it always fits inside the 7-tile ring its winner
// earns; the ring's other tiles are its grounds. Pure and deterministic:
// integer maths, fixed iteration order, and ties broken by a seed.

/** What placement needs to know about a tile. */
export interface CommunityPlacementTile extends Hex {
  readonly terrain: string;
  readonly homeSlot: number | null;
  /** Null/absent on wild land. The server passes 'busy' for tiles with a building, guard, gatherer or battle. */
  readonly ownerUserId?: string | null;
}

/** A village already on the map (the boot pass's back-fill). */
export interface ExistingCommunity {
  readonly square: Hex;
  readonly tiles: readonly Hex[];
  readonly kind: CommunityKindId;
  readonly name: string;
  readonly keyTile: Hex;
}

export interface CommunityPlacementInput {
  /** Every tile on the map, in any order: they're sorted by (q, r) first, and the seed breaks ties. */
  readonly tiles: readonly CommunityPlacementTile[];
  /** Every home slot's Heart Seed, taken or not. */
  readonly homes: readonly Hex[];
  /** Juniper's Gap's terrain: no village ring covers it. */
  readonly gapTerrain: string;
  readonly rules: CommunityPlacementRules;
  /** The map's seed (secret, server-side). Only ties and the dice after the layout use it. */
  readonly seed: Seed;
  /** Back-fill: villages already on the map. They count toward the map's total. */
  readonly existing?: readonly ExistingCommunity[];
  /** The boot pass's relaxed try (`rules.relaxedMaxFromSeed`) instead of `rules.maxFromSeed`. */
  readonly maxFromSeed?: number;
  /** Boot pass last resort: place as many as fit, without covering every home. */
  readonly partial?: boolean;
}

/** One new village. */
export interface PlacedCommunity {
  readonly name: string;
  readonly kind: CommunityKindId;
  readonly square: Hex;
  /** Every village tile: the square first, then the neighbours in (q, r) order. */
  readonly tiles: readonly Hex[];
  /** Where the cellar key hides: outside the village (owner decision 5). Secret. */
  readonly keyTile: Hex;
}

/**
 * How many villages a map of `seats` gets: its `countBySeats` entry, else one
 * per `seatsPerCommunity`, rounded up, at least `minPerMap`.
 */
export function communityCount(seats: number, rules: CommunityPlacementRules): number {
  const fixed = rules.countBySeats[String(seats)];
  if (fixed !== undefined) return fixed;
  return Math.max(rules.minPerMap, Math.ceil(seats / rules.seatsPerCommunity));
}

/** A square that can seed a village, and what's around it. */
interface Candidate extends Hex {
  /** Its free neighbours, nearest its nearest home first, then (q, r). */
  readonly free: readonly Hex[];
  /** Steps to each home, by slot. */
  readonly toHomes: readonly number[];
}

const byQr = (a: Hex, b: Hex) => a.q - b.q || a.r - b.r;
const isFree = (t: CommunityPlacementTile) => (t.ownerUserId ?? null) === null;

/** Fisher–Yates with the placement's own rng. */
function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Smallest pairwise distance between squares (Infinity for fewer than two). */
function spreadOf(squares: readonly Hex[]): number {
  let apart = Infinity;
  for (const [i, a] of squares.entries()) {
    for (const b of squares.slice(i + 1)) apart = Math.min(apart, hexDistance(a, b));
  }
  return apart;
}

/**
 * The map's new villages (`communityCount(homes) − existing`), in their
 * squares' (q, r) order, or null when no layout fits (`partial`: only when
 * not one fits). Empty when the existing villages already make the count.
 *
 * Hard rules: a square's whole ring is on the map, clear of the Gap,
 * `excludedTerrains`, trading posts, home tiles, other villages' rings and
 * their cellar keys; rings sit `ringsApart` from each other and
 * `ringFromPost` from every post; the square is `minFromSeed`..`maxFromSeed`
 * from its nearest Heart Seed; village tiles are free wild land (owned
 * grounds stay their owner's, untouched).
 *
 * Fair, like the posts: every home's nearest village square (existing ones
 * included) is `d` steps away, or `d` to `d + 1` when that's all the land
 * allows, for the smallest `d` that fits (`fairWindows`: homes too far
 * apart to share at `maxFromSeed` get the least unfair wider window instead).
 * A backtracking cover search picks
 * the lowest uncovered home and tries each square that covers it, so
 * neighbouring homes share a village when there are fewer than homes.
 * Among fitting layouts the most spread out wins (the seed picks between
 * ties). Villages left over once every home is covered go one at a time
 * furthest from the others, never nearer any home than `d`.
 */
export function placeCommunities(input: CommunityPlacementInput): PlacedCommunity[] | null {
  const { rules, homes } = input;
  const existing = input.existing ?? [];
  const count = communityCount(homes.length, rules) - existing.length;
  if (count <= 0) return [];
  if (homes.length === 0) return null;
  const maxFromSeed = input.maxFromSeed ?? rules.maxFromSeed;
  // (q, r) order, so mapgen's spiral and the server's stored rows give the
  // same villages: the input order never decides anything.
  const tiles = [...input.tiles].sort(byQr);
  const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
  const posts = tiles.filter(isTradingPost);
  const squareApart = rules.ringsApart + 2; // ring tile to ring tile, so square to square + 2
  const existingRings = new Set(existing.flatMap((c) => hexSpiral(c.square, 1).map(hexKey)));
  const existingKeys = new Set(existing.map((c) => hexKey(c.keyTile)));
  const blocked = (t: CommunityPlacementTile | undefined): boolean =>
    t === undefined ||
    t.terrain === input.gapTerrain ||
    rules.excludedTerrains.includes(t.terrain) ||
    isTradingPost(t) ||
    t.homeSlot !== null;
  // Can the cellar key hide near this square? One tile `min + 1`..`max`
  // steps out is `min`..`max` from whichever tiles the village takes.
  const hasKeySpot = (square: Hex): boolean => {
    for (let steps = rules.keyFromVillage.min + 1; steps <= rules.keyFromVillage.max; steps++) {
      for (const h of hexRing(square, steps)) {
        const key = hexKey(h);
        if (!blocked(byKey.get(key)) && !existingRings.has(key) && !existingKeys.has(key)) {
          return true;
        }
      }
    }
    return false;
  };

  const candidates: Candidate[] = [];
  for (const t of tiles) {
    const toHomes = homes.map((h) => hexDistance(h, t));
    const nearest = Math.min(...toHomes);
    if (nearest < rules.minFromSeed || nearest > maxFromSeed || !isFree(t)) continue;
    if (posts.some((p) => hexDistance(p, t) <= rules.ringFromPost)) continue;
    if (existing.some((c) => hexDistance(c.square, t) < squareApart)) continue;
    const ring = hexSpiral(t, 1);
    if (ring.some((h) => blocked(byKey.get(hexKey(h))) || existingKeys.has(hexKey(h)))) continue;
    // Free neighbours, nearest the square's nearest home first, so the
    // village touches that kid's land first.
    const home = homes[toHomes.indexOf(nearest)] as Hex;
    const free = hexRing(t, 1)
      .filter((h) => isFree(byKey.get(hexKey(h)) as CommunityPlacementTile))
      .sort((a, b) => hexDistance(home, a) - hexDistance(home, b) || byQr(a, b));
    if (free.length < rules.size.min - 1 || !hasKeySpot(t)) continue;
    candidates.push({ q: t.q, r: t.r, free, toHomes });
  }
  if (candidates.length === 0) return null;

  const rng = Rng.fromSeed(deriveSeed(input.seed, 'communities'));
  const squares = input.partial
    ? partialLayout(candidates, existing, count, squareApart)
    : fairLayout(
        candidates,
        existing,
        homes,
        count,
        squareApart,
        rules.minFromSeed,
        maxFromSeed,
        rng,
      );
  if (squares === null || squares.length === 0) return null;
  return dress(squares.sort(byQr), input, tiles, existing, rng);
}

/**
 * The windows `[d, d + slack]` the homes' nearest squares may land in,
 * fairest first: slack 0 then 1, inside `maxFromSeed`. Then, only when none
 * of those fits, wider ones whose far end may pass `maxFromSeed` (the
 * squares themselves never do): homes too far apart to share a village at
 * `maxFromSeed`, like a 3-seat map's (11–13 steps) with its 2 villages,
 * share the one that's least unfair.
 */
function* fairWindows(minFromSeed: number, maxFromSeed: number): Generator<[number, number]> {
  for (const slack of [0, 1]) {
    for (let d = minFromSeed; d + slack <= maxFromSeed; d++) yield [d, slack];
  }
  for (let slack = 1; slack <= maxFromSeed; slack++) {
    for (let d = Math.max(minFromSeed, maxFromSeed - slack + 1); d <= maxFromSeed; d++) {
      yield [d, slack];
    }
  }
}

/** The fair layout's squares (see `placeCommunities`), or null. */
function fairLayout(
  candidates: readonly Candidate[],
  existing: readonly ExistingCommunity[],
  homes: readonly Hex[],
  count: number,
  apart: number,
  minFromSeed: number,
  maxFromSeed: number,
  rng: Rng,
): Candidate[] | null {
  const olds = existing.map((c) => c.square);
  const oldNearest = homes.map((h) => Math.min(...olds.map((s) => hexDistance(h, s))));
  for (const [d, slack] of fairWindows(minFromSeed, maxFromSeed)) {
    // An older village nearer a home than d rules d out; no new one may be.
    if (oldNearest.some((n) => n < d)) continue;
    const usable = candidates.filter((c) => c.toHomes.every((s) => s >= d));
    const covers = (c: Candidate, home: number) => (c.toHomes[home] as number) <= d + slack;
    let bestApart = -1;
    // Keyed by the layout's squares, so a set found in two orders counts once.
    let best = new Map<string, Candidate[]>();
    const picked: Candidate[] = [];
    const covered = homes.map((_, i) => (oldNearest[i] as number) <= d + slack);
    const visit = (gap: number): void => {
      const home = covered.indexOf(false);
      if (home === -1) {
        const layout = fillRest(usable, olds, picked, count, apart);
        if (layout === null) return;
        const spread = Math.min(gap, spreadOf([...olds, ...layout]));
        if (spread < bestApart) return;
        if (spread > bestApart) {
          bestApart = spread;
          best = new Map();
        }
        const sorted = [...layout].sort(byQr);
        best.set(sorted.map(hexKey).join(' '), sorted);
        return;
      }
      if (picked.length === count) return;
      for (const c of usable) {
        if (!covers(c, home)) continue;
        let next = gap;
        for (const p of [...olds, ...picked]) next = Math.min(next, hexDistance(c, p));
        // Spread only shrinks as villages are added, so a worse branch can't win.
        if (next < apart || next < bestApart) continue;
        const was = [...covered];
        homes.forEach((_, i) => {
          if (covers(c, i)) covered[i] = true;
        });
        picked.push(c);
        visit(next);
        picked.pop();
        was.forEach((v, i) => (covered[i] = v));
      }
    };
    visit(Infinity);
    // Map order is insertion order: the search's own fixed order.
    if (best.size > 0) return [...rng.pick([...best.values()])];
  }
  return null;
}

/**
 * Tops `picked` up to `count`, one at a time where it's furthest from every
 * other square (ties: the first in (q, r) order). Only `usable` squares,
 * which are never nearer any home than `d`. Null when one doesn't fit.
 */
function fillRest(
  usable: readonly Candidate[],
  olds: readonly Hex[],
  picked: readonly Candidate[],
  count: number,
  apart: number,
): Candidate[] | null {
  const chosen = [...picked];
  while (chosen.length < count) {
    const others = [...olds, ...chosen];
    let pick: Candidate | null = null;
    let pickApart = -1;
    for (const c of usable) {
      const gap = Math.min(...others.map((p) => hexDistance(c, p)));
      if (gap < apart || gap <= pickApart) continue;
      pick = c;
      pickApart = gap;
    }
    if (pick === null) return null;
    chosen.push(pick);
  }
  return chosen;
}

/** `partial`: as many as fit, up to `count`, each furthest from the others (the first goes first in (q, r) order). */
function partialLayout(
  candidates: readonly Candidate[],
  existing: readonly ExistingCommunity[],
  count: number,
  apart: number,
): Candidate[] {
  const olds = existing.map((c) => c.square);
  const chosen: Candidate[] = [];
  while (chosen.length < count) {
    const others = [...olds, ...chosen];
    let pick: Candidate | null = null;
    let pickApart = -1;
    for (const c of candidates) {
      const gap =
        others.length === 0 ? Infinity : Math.min(...others.map((p) => hexDistance(c, p)));
      if (gap < apart || gap <= pickApart) continue;
      pick = c;
      pickApart = gap;
      if (gap === Infinity) break;
    }
    if (pick === null) break;
    chosen.push(pick);
  }
  return chosen;
}

/**
 * Sizes, kinds, names and cellar keys for the chosen squares (in (q, r)
 * order), all drawn after the layout and in a fixed order: sizes, kinds,
 * names, then keys. Null if a key has nowhere to hide.
 */
function dress(
  squares: readonly Candidate[],
  input: CommunityPlacementInput,
  tiles: readonly CommunityPlacementTile[],
  existing: readonly ExistingCommunity[],
  rng: Rng,
): PlacedCommunity[] | null {
  const { rules } = input;
  const villages = squares.map((s) => {
    const size = Math.min(rng.int(rules.size.min, rules.size.max), 1 + s.free.length);
    const square = { q: s.q, r: s.r };
    return { square, tiles: [square, ...s.free.slice(0, size - 1).sort(byQr)] };
  });

  // Kinds: the required one if the map lacks it, then kinds the map doesn't
  // have yet, then the rest, each group shuffled; dealt out in a shuffle.
  const have = new Set(existing.map((c) => c.kind));
  const options = shuffle(rng, CommunityKindIdSchema.options);
  const order = [
    ...(have.has(rules.requiredKind) ? [] : [rules.requiredKind]),
    ...options.filter((k) => !have.has(k) && k !== rules.requiredKind),
    ...options.filter((k) => have.has(k)),
  ];
  const kinds = shuffle(
    rng,
    villages.map((_, i) => order[i % order.length] as CommunityKindId),
  );

  // Names: stems no village on the map has yet, shuffled.
  const taken = new Set(existing.map((c) => c.name));
  const stems = shuffle(
    rng,
    rules.nameStems.filter((s) => !taken.has(`${s} ${rules.nameSuffix}`)),
  );
  // TUNE: more villages than stems would repeat names; 16 stems cover 6 seats' 3.
  const names = villages.map(
    (_, i) => `${stems[i % Math.max(1, stems.length)] ?? rules.nameStems[0]} ${rules.nameSuffix}`,
  );

  // Cellar keys: outside every ring, distinct, `keyFromVillage` from their own village.
  const rings = new Set<HexKey>([
    ...existing.flatMap((c) => hexSpiral(c.square, 1).map(hexKey)),
    ...villages.flatMap((v) => hexSpiral(v.square, 1).map(hexKey)),
  ]);
  const keys = new Set<HexKey>(existing.map((c) => hexKey(c.keyTile)));
  const spots = tiles.filter(
    (t) =>
      t.terrain !== input.gapTerrain &&
      !rules.excludedTerrains.includes(t.terrain) &&
      !isTradingPost(t) &&
      t.homeSlot === null &&
      !rings.has(hexKey(t)),
  );
  const placed: PlacedCommunity[] = [];
  for (const [i, v] of villages.entries()) {
    const fits = spots.filter((t) => {
      if (keys.has(hexKey(t))) return false;
      const steps = Math.min(...v.tiles.map((h) => hexDistance(h, t)));
      return steps >= rules.keyFromVillage.min && steps <= rules.keyFromVillage.max;
    });
    if (fits.length === 0) return null;
    const spot = rng.pick(fits);
    keys.add(hexKey(spot));
    placed.push({
      name: names[i] as string,
      kind: kinds[i] as CommunityKindId,
      square: v.square,
      tiles: v.tiles,
      keyTile: { q: spot.q, r: spot.r },
    });
  }
  return placed;
}
