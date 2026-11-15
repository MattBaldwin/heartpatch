import { hexDistance, hexKey, hexNeighbors, type Hex, type HexKey } from '../hex/index.js';
import type { Rng } from '../rng/index.js';
import type { ComputerMateRules, ComputerPersonaTuning } from '../schemas/data/computer-mates.js';
import { isTradingPost, isWaterTerrain } from '../territory/reach.js';
import { attackTargetProblem, type TerritoryTile } from '../territory/index.js';

/*
 * What a computer patch-mate does next (#386c, plan §1 C–E). One pure,
 * seeded function: the server builds a plain view of the patch, calls
 * `nextIntent` with `Rng.fromSeed(deriveSeed(mate.seed, step))`, and applies
 * the one intent it returns through the module that owns it. The map-fill
 * sim calls the same function, so the sim and the server can't drift.
 *
 * Tending, fuelling their fires and setting their team's levels aren't
 * intents: every step does them (see the server's `act`).
 */

/** A tile as the policy sees it (`PublicTile` and the sim's tiles fit). */
export interface MateViewTile extends TerritoryTile {
  readonly terrain: string;
}

export interface MateView {
  /** The mate's user id. */
  readonly userId: string;
  /** Every tile on the patch. */
  readonly tiles: readonly MateViewTile[];
  /** Real kids' user ids on the patch, and their Heart Seeds. */
  readonly kids: readonly { readonly userId: string; readonly heartSeed: Hex }[];
  /** The patch's seats (`maps.max_players`): a fair share is claimable tiles ÷ seats. */
  readonly seats: number;
  /** Claims the mate made this patch day. */
  readonly claimsToday: number;
  /** A catch-up step (a kid just came back): claims and tending only. */
  readonly catchUp: boolean;
  /** Tiles that hold one of the mate's Hearthfires. */
  readonly fires: readonly Hex[];
  /** Tiles that hold any building (a fire needs an empty tile). */
  readonly built: readonly Hex[];
  /** Tiles where the mate has a squishy on watch. */
  readonly guarded: readonly Hex[];
  /** The mate's squishies not on watch (a guard needs one). */
  readonly freeSquishies: number;
  /** Tiles someone is battling for right now (an open `tile_attacks` row): never claimed. */
  readonly contested: readonly Hex[];
}

export type MateIntent =
  | { readonly kind: 'claim'; readonly q: number; readonly r: number }
  | { readonly kind: 'fire'; readonly q: number; readonly r: number }
  | { readonly kind: 'guard'; readonly q: number; readonly r: number };

/** Tiles anyone could ever hold outside a home: no home ring, post, water or grey village. */
export function claimableTiles<T extends MateViewTile>(tiles: readonly T[]): T[] {
  return tiles.filter(
    (t) =>
      t.homeSlot === null &&
      !isTradingPost(t) &&
      !isWaterTerrain(t.terrain) &&
      ((t.communityId ?? null) === null || t.restored === true),
  );
}

/** The most land outside its home a mate may hold: `landCapPercent` of a fair share. */
export function mateLandCap(
  tiles: readonly MateViewTile[],
  seats: number,
  rules: ComputerMateRules,
): number {
  const fair = claimableTiles(tiles).length / Math.max(1, seats);
  return Math.floor((fair * rules.landCapPercent) / 100);
}

/** Their team's level: the kid's Partner level plus the persona's offset, at least 1. */
export function mateTeamLevel(partnerLevel: number, persona: ComputerPersonaTuning): number {
  return Math.max(1, partnerLevel + persona.levelOffset);
}

const nearest = (h: Hex, points: readonly Hex[]): number =>
  points.reduce((best, p) => Math.min(best, hexDistance(h, p)), Number.POSITIVE_INFINITY);

const byHex = (a: Hex, b: Hex) => a.q - b.q || a.r - b.r;

/** The mate's outer land (not its home ring). */
function outerLand(view: MateView): MateViewTile[] {
  return view.tiles.filter((t) => t.ownerUserId === view.userId && t.homeSlot === null);
}

/** The mate's own Heart Seed: the middle of its home ring (the tile all ring tiles touch). */
function homeOf(view: MateView): Hex | null {
  const ring = view.tiles.filter((t) => t.ownerUserId === view.userId && t.homeSlot !== null);
  if (ring.length === 0) return null;
  const keys = new Set(ring.map(hexKey));
  return (
    [...ring].sort(byHex).find((t) => hexNeighbors(t).every((n) => keys.has(hexKey(n)))) ??
    [...ring].sort(byHex)[0] ??
    null
  );
}

/**
 * The wild tile to claim next, or null: next to the mate's land, never a
 * home ring, post, water or grey village (`attackTargetProblem` with PvP
 * off, so only wild land), never a tile a kid is battling for, never within `kidHomeBuffer` of a kid's Heart
 * Seed. Nearest its own home first, leaning toward the nearest kid so
 * borders meet; ties by position.
 */
export function claimTarget(view: MateView, rules: ComputerMateRules): Hex | null {
  const home = homeOf(view);
  const seeds = view.kids.map((k) => k.heartSeed);
  const contested = new Set(view.contested.map(hexKey));
  const options = view.tiles.filter(
    (t) =>
      t.ownerUserId === null &&
      !contested.has(hexKey(t)) &&
      attackTargetProblem(t, view.tiles, view.userId, 'off') === null &&
      nearest(t, seeds) > rules.kidHomeBuffer,
  );
  const score = (t: Hex) =>
    (home ? hexDistance(t, home) * 2 : 0) + (seeds.length > 0 ? nearest(t, seeds) : 0);
  const [best] = options.sort((a, b) => score(a) - score(b) || byHex(a, b));
  return best ? { q: best.q, r: best.r } : null;
}

/** Fires the mate's outer land should have: one per `fireEveryTiles`. */
export function firesWanted(view: MateView, rules: ComputerMateRules): number {
  return Math.floor(outerLand(view).length / rules.fireEveryTiles);
}

/** Where the next fire goes: the empty outer tile farthest from its fires (the darkest). */
export function fireSpot(view: MateView): Hex | null {
  const built = new Set(view.built.map(hexKey));
  const options = outerLand(view).filter((t) => !built.has(hexKey(t)));
  if (options.length === 0) return null;
  const fires = view.fires;
  const dark = (t: Hex) => (fires.length === 0 ? 0 : nearest(t, fires));
  const [best] = options.sort((a, b) => dark(b) - dark(a) || byHex(a, b));
  return best ? { q: best.q, r: best.r } : null;
}

/** The mate's border tiles that touch a kid's land, nearest a kid's Heart Seed first. */
export function borderFacingKids(view: MateView): Hex[] {
  const kids = new Set(view.kids.map((k) => k.userId));
  const owner = new Map<HexKey, string | null>(view.tiles.map((t) => [hexKey(t), t.ownerUserId]));
  const seeds = view.kids.map((k) => k.heartSeed);
  return outerLand(view)
    .filter((t) =>
      hexNeighbors(t).some((n) => {
        const o = owner.get(hexKey(n));
        return o !== undefined && o !== null && kids.has(o);
      }),
    )
    .sort((a, b) => nearest(a, seeds) - nearest(b, seeds) || byHex(a, b))
    .map((t) => ({ q: t.q, r: t.r }));
}

/**
 * One intent for this step, or null to only tend. A fire on dark land comes
 * first (outside catch-up); otherwise claim or guard, weighted by the
 * persona, among what's allowed now.
 */
export function nextIntent(
  view: MateView,
  persona: ComputerPersonaTuning,
  rules: ComputerMateRules,
  rng: Rng,
): MateIntent | null {
  if (!view.catchUp && view.fires.length < firesWanted(view, rules)) {
    const spot = fireSpot(view);
    if (spot) return { kind: 'fire', ...spot };
  }
  const options: { weight: number; intent: MateIntent }[] = [];
  if (
    persona.weights.claim > 0 &&
    view.claimsToday < persona.claimsPerDay &&
    outerLand(view).length < mateLandCap(view.tiles, view.seats, rules)
  ) {
    const target = claimTarget(view, rules);
    if (target)
      options.push({ weight: persona.weights.claim, intent: { kind: 'claim', ...target } });
  }
  if (
    !view.catchUp &&
    persona.weights.guard > 0 &&
    view.freeSquishies > 0 &&
    view.guarded.length < rules.guardedTiles
  ) {
    const guarded = new Set(view.guarded.map(hexKey));
    const spot = borderFacingKids(view).find((t) => !guarded.has(hexKey(t)));
    if (spot) options.push({ weight: persona.weights.guard, intent: { kind: 'guard', ...spot } });
  }
  if (options.length === 0) return null;
  return rng.weighted(options).intent;
}
