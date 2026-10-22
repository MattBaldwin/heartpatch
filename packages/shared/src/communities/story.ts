import type { Hex } from '../hex/index.js';
import { Rng, deriveSeed, type Seed } from '../rng/index.js';
import type { StoryMoment, StoryRules } from '../schemas/data/memory-puzzles.js';
import type { StoryDeal } from '../schemas/explore.js';

// "The forgotten story" (#306, the owner's approved mockup): a Hollow's heart
// tile holds the town's last day, torn into pages hidden one a tile. Each
// page holds a clue; together they pin the day down to exactly one order.
// Pure and seeded: the server deals a try from its seed, keeps the order and
// checks the kid's (CLAUDE.md rule 1). A failed try reshuffles to the next
// try's seed: a new day of the same size, new clues on the same pages.

/** Tries at one seed before giving up (a few dozen at most in practice). */
const TRIES = 2000;
/** TUNE: tries that insist every clue is needed before any one-answer day will do. */
const STRICT_TRIES = 300;

/** One clue about the day, by moment index into the day's moments. */
export type StoryClue =
  | { readonly kind: 'first' | 'last' | 'notEnds'; readonly a: number }
  | { readonly kind: 'before' | 'right' | 'notNext'; readonly a: number; readonly b: number }
  | { readonly kind: 'gap'; readonly a: number; readonly b: number; readonly between: number };

/** One try's day: its moments, the true order (indexes into `moments`), the clues and the cards as dealt. */
export interface StoryDay {
  readonly moments: readonly StoryMoment[];
  /** First to last: the answer. Server-only. */
  readonly order: readonly number[];
  /** One a torn page, page 1 first. */
  readonly clues: readonly StoryClue[];
  /** The cards as dealt to the kid (indexes into `moments`), never in order. */
  readonly dealt: readonly number[];
}

/** A try's seed: every try (and so every reshuffle) is its own day, the same on a rebuild. */
export function storySeed(hollowSeed: Seed, tile: Hex, userId: string, attempt: number): Seed {
  return deriveSeed(hollowSeed, 'story', tile.q, tile.r, userId, attempt);
}

/** How many moments a day holds for a Hollow of `tiles` tiles. */
export function storyMoments(tiles: number, rules: StoryRules): number {
  let moments = rules.sizes[0]?.moments ?? 5;
  for (const size of rules.sizes) if (tiles >= size.tiles) moments = size.moments;
  return moments;
}

/** Does a clue hold when moment `i` sits at place `pos[i]` of `n`? */
export function clueHolds(clue: StoryClue, pos: readonly number[], n: number): boolean {
  const a = pos[clue.a] ?? -1;
  switch (clue.kind) {
    case 'first':
      return a === 0;
    case 'last':
      return a === n - 1;
    case 'notEnds':
      return a !== 0 && a !== n - 1;
    case 'before':
      return a < (pos[clue.b] ?? -1);
    case 'right':
      return (pos[clue.b] ?? -1) === a + 1;
    case 'notNext':
      return Math.abs(a - (pos[clue.b] ?? -1)) !== 1;
    case 'gap':
      return Math.abs(a - (pos[clue.b] ?? -1)) === clue.between + 1;
  }
}

const cap = (s: string) => (s ? (s[0] as string).toUpperCase() + s.slice(1) : s);
const COUNTS = ['nothing', 'one thing', 'two things', 'three things', 'four things'];

/** A clue as its torn page reads (style guide: short, kid-readable). */
export function clueText(clue: StoryClue, moments: readonly StoryMoment[]): string {
  const a = moments[clue.a] as StoryMoment;
  switch (clue.kind) {
    case 'first':
      return `${cap(a.act)} before anything else happened.`;
    case 'last':
      return `${cap(a.act)}, and then the lanterns went out.`;
    case 'notEnds':
      return `${cap(a.act)}, but not first and not last.`;
    case 'before':
      return `${cap(a.act)} sometime before ${(moments[clue.b] as StoryMoment).act}.`;
    case 'right':
      return `Right after ${a.act}, ${(moments[clue.b] as StoryMoment).act}.`;
    case 'notNext':
      return `${cap(a.ing)} and ${(moments[clue.b] as StoryMoment).ing} were not one after the other.`;
    case 'gap':
      return `Between ${a.ing} and ${(moments[clue.b] as StoryMoment).ing}, exactly ${COUNTS[clue.between] ?? `${clue.between} things`} happened.`;
  }
}

/** Every order of 0…n-1, made once a size (at most 720). */
const ORDERS = new Map<number, readonly (readonly number[])[]>();
function ordersOf(n: number): readonly (readonly number[])[] {
  const known = ORDERS.get(n);
  if (known) return known;
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) out.push(prefix);
    rest.forEach((x, i) => {
      walk([...prefix, x], [...rest.slice(0, i), ...rest.slice(i + 1)]);
    });
  };
  walk(
    [],
    Array.from({ length: n }, (_, i) => i),
  );
  ORDERS.set(n, out);
  return out;
}

/** How many orders fit every clue, stopping at `cap`. */
export function storyFits(clues: readonly StoryClue[], n: number, cap = Infinity): number {
  let fits = 0;
  const pos = new Array<number>(n);
  for (const order of ordersOf(n)) {
    order.forEach((m, place) => {
      pos[m] = place;
    });
    if (clues.every((c) => clueHolds(c, pos, n)) && ++fits >= cap) break;
  }
  return fits;
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const swap = out[i] as T;
    out[i] = out[j] as T;
    out[j] = swap;
  }
  return out;
}

/** Every true clue about a day whose moment `i` sits at place `pos[i]`. */
function truePool(pos: readonly number[]): StoryClue[] {
  const n = pos.length;
  const pool: StoryClue[] = [];
  for (let a = 0; a < n; a++) {
    const pa = pos[a] as number;
    if (pa === 0) pool.push({ kind: 'first', a });
    if (pa === n - 1) pool.push({ kind: 'last', a });
    if (pa !== 0 && pa !== n - 1) pool.push({ kind: 'notEnds', a });
    for (let b = 0; b < n; b++) {
      const pb = pos[b] as number;
      if (a === b || pa > pb) continue;
      pool.push({ kind: 'before', a, b });
      if (pb === pa + 1) pool.push({ kind: 'right', a, b });
      else pool.push({ kind: 'notNext', a, b });
      const between = pb - pa - 1;
      if (between >= 1 && between <= 3) pool.push({ kind: 'gap', a, b, between });
    }
  }
  return pool;
}

const givesPlace = (c: StoryClue) => c.kind === 'first' || c.kind === 'last';

/**
 * One try's day from a seed, for a Hollow of `tiles` tiles: `tiles` clues,
 * one a torn page, that fit exactly one order of the day's moments (every
 * order is checked), preferring days where none could be left out, with at most
 * `maxPlaceClues` giving a place away outright. The cards are dealt in any
 * order but the answer.
 */
export function makeStory(seed: Seed, tiles: number, rules: StoryRules): StoryDay {
  const n = storyMoments(tiles, rules);
  const count = Math.max(1, tiles);
  for (let tryNo = 0; tryNo < TRIES; tryNo++) {
    const rng = Rng.fromSeed(deriveSeed(seed, tryNo));
    const moments = shuffled(rng, rules.moments).slice(0, n);
    // The day's order: moment `order[k]` happened at place k.
    const order = shuffled(
      rng,
      moments.map((_, i) => i),
    );
    const pos = new Array<number>(n);
    order.forEach((m, place) => {
      pos[m] = place;
    });
    const clues = shuffled(rng, truePool(pos)).slice(0, count);
    if (clues.length < count || clues.filter(givesPlace).length > rules.maxPlaceClues) continue;
    if (storyFits(clues, n, 2) !== 1) continue;
    // Prefer no spare clue: drop any one page and the day no longer has one
    // answer, so every page has to be read (owner decision: no easy way). A
    // big Hollow (more pages than a small day needs) rarely has such a day,
    // so after a while any one-answer day will do.
    if (
      tryNo < STRICT_TRIES &&
      clues.some(
        (_, k) =>
          storyFits(
            clues.filter((__, j) => j !== k),
            n,
            2,
          ) === 1,
      )
    ) {
      continue;
    }
    let dealt = shuffled(rng, order);
    // Never dealt already in order: rotate it one place.
    if (dealt.every((m, k) => m === order[k])) dealt = [...dealt.slice(1), dealt[0] as number];
    return { moments, order, clues, dealt };
  }
  throw new Error('makeStory: no story at this seed');
}

/** The day as the kid sees it: the cards as dealt and the pages' clues, never the order. */
export function storyDeal(day: StoryDay): StoryDeal {
  return {
    moments: day.dealt.map((i) => {
      const m = day.moments[i] as StoryMoment;
      return { id: m.id, emoji: m.emoji, text: m.did };
    }),
    clues: day.clues.map((c) => clueText(c, day.moments)),
  };
}

/** The day's order as moment ids, first to last. */
export function storyAnswer(day: StoryDay): string[] {
  return day.order.map((i) => (day.moments[i] as StoryMoment).id);
}

export type StoryCheck =
  | { readonly kind: 'not-the-moments' }
  | {
      readonly kind: 'checked';
      readonly ok: boolean;
      readonly right: number;
      readonly marks: readonly boolean[];
    };

/**
 * What the server does with a told order: every one of the day's moments
 * once, and place by place, was it right?
 */
export function checkStory(day: StoryDay, order: readonly string[]): StoryCheck {
  const answer = storyAnswer(day);
  const ids = new Set(order);
  if (
    order.length !== answer.length ||
    ids.size !== order.length ||
    answer.some((id) => !ids.has(id))
  ) {
    return { kind: 'not-the-moments' };
  }
  const marks = order.map((id, k) => answer[k] === id);
  const right = marks.filter((m) => m).length;
  return { kind: 'checked', ok: right === answer.length, right, marks };
}
