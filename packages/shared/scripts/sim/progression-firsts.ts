import { RaritySchema, type Rarity } from '../../src/schemas/data/common.js';
import type { ProgressionConfig } from './progression-config.js';
import type { DayRecord } from './progression.js';

/*
 * "Firsts" (#736): the day each new thing first happens to a kid, so the
 * report asks "what new thing happens on day 10?" and not only "does the kid
 * keep up?". The boredom gate holds the gaps between them to a few days in
 * the first month. Only firsts the progression model has state for get a
 * day; the rest say "not modelled" until a model plays them.
 */

/** The secret milestone "Big and Bouncy" (a squishy at level 20). */
export const BIG_AND_BOUNCY = 20;
/** Evolution steps from a base form to a grown-up (baby → kid → teen → grown-up). */
const GROWN_UP_STAGE = 3;

/** What the firsts need to know about species: rarity and growth stage (0 = a base form). */
export interface FirstsFacts {
  readonly rarity: (speciesId: string) => Rarity | undefined;
  readonly stage: (speciesId: string) => number;
}

export function firstsFacts(data: {
  readonly species: ReadonlyMap<string, { readonly rarity: Rarity }>;
  readonly evolutions: readonly { readonly from: string; readonly into: string }[];
}): FirstsFacts {
  const parent = new Map(data.evolutions.map((e) => [e.into, e.from]));
  const stage = (id: string): number => {
    let steps = 0;
    for (let at = parent.get(id); at !== undefined && steps < 10; at = parent.get(at)) steps += 1;
    return steps;
  };
  return { rarity: (id) => data.species.get(id)?.rarity, stage };
}

const RANKS: readonly Rarity[] = RaritySchema.options;
const atLeast = (rarity: Rarity | undefined, floor: Rarity) =>
  rarity !== undefined && RANKS.indexOf(rarity) >= RANKS.indexOf(floor);

type Test = (day: DayRecord, facts: FirstsFacts) => boolean;

/** One first: how the report names it, and its test on a day (none: not modelled). */
export interface FirstDef {
  readonly id: string;
  readonly label: string;
  readonly test: Test | null;
}

/** #736's list, in its order. "Rare evolved" and "epic evolved": a squishy of that rarity (or rarer) evolves. */
export const FIRSTS: readonly FirstDef[] = [
  { id: 'evolve', label: 'evolve', test: (d) => d.evolved.length > 0 },
  { id: 'lv20', label: 'Lv 20', test: (d) => Math.max(...d.levels) >= BIG_AND_BOUNCY },
  {
    id: 'rare-befriended',
    label: 'rare befriended',
    test: (d, f) => d.befriended.some((s) => atLeast(f.rarity(s), 'rare')),
  },
  {
    id: 'rare-evolved',
    label: 'rare evolved',
    test: (d, f) => d.evolved.some((e) => atLeast(f.rarity(e.from), 'rare')),
  },
  { id: 'gap-win', label: 'Gap win', test: (d) => d.gapWins > 0 },
  { id: 'factory-l2', label: 'Factory L2', test: null },
  { id: 'journey-5', label: 'journey > d4', test: null },
  {
    id: 'epic-evolved',
    label: 'epic evolved',
    test: (d, f) => d.evolved.some((e) => atLeast(f.rarity(e.from), 'epic')),
  },
  {
    id: 'grown-up',
    label: 'grown-up',
    test: (d, f) => d.evolved.some((e) => f.stage(e.into) >= GROWN_UP_STAGE),
  },
  { id: 'land-full', label: 'land full', test: (d) => d.neutralLeft === 0 },
];

/** A first's day; null: never within the run; 'not modelled': the model can't tell. */
export type FirstDay = number | null | 'not modelled';

export interface First {
  readonly id: string;
  readonly label: string;
  readonly day: FirstDay;
}

/** The day of each first in a kid's run, in `FIRSTS` order. */
export function firstsOf(days: readonly DayRecord[], facts: FirstsFacts): First[] {
  return FIRSTS.map(({ id, label, test }) => ({
    id,
    label,
    day: test === null ? 'not modelled' : (days.find((d) => test(d, facts))?.day ?? null),
  }));
}

/** "day 7", "never (> day 60)" or "not modelled". */
export function formatFirst(day: FirstDay, runDays: number): string {
  if (day === 'not modelled') return day;
  return day === null ? `never (> day ${String(runDays)})` : `day ${String(day)}`;
}

export interface Gap {
  readonly from: number;
  readonly to: number;
  readonly days: number;
}

export interface FirstsGate {
  /** Every gap in the window, from day 1 to the first first, between firsts, and to the window's end. */
  readonly gaps: readonly Gap[];
  /** The gaps longer than the gate allows. */
  readonly misses: readonly Gap[];
  readonly pass: boolean;
}

/** The boredom gate (#736) on one kid's firsts. */
export function firstsGate(
  firsts: readonly First[],
  gate: ProgressionConfig['firstsGate'],
): FirstsGate {
  const inWindow = firsts
    .map((f) => f.day)
    .filter((d): d is number => typeof d === 'number' && d <= gate.windowDays);
  const marks = [...new Set([1, ...inWindow, gate.windowDays])].sort((a, b) => a - b);
  const gaps = marks.slice(1).map((to, i) => {
    const from = marks[i] ?? 1;
    return { from, to, days: to - from };
  });
  const misses = gaps.filter((g) => g.days > gate.maxGapDays);
  return { gaps, misses, pass: misses.length === 0 };
}

/** One line for the gate: PASS or FAIL with the gaps it misses, always marked soft (#730). */
export function formatFirstsGate(
  result: FirstsGate,
  gate: ProgressionConfig['firstsGate'],
): string {
  // TODO(#730): make this a hard gate (fail the script and CI) once #730 merges.
  const rule = `no gap > ${String(gate.maxGapDays)} days between ${gate.kid} firsts in days 1–${String(gate.windowDays)}`;
  const verdict = result.pass
    ? 'PASS'
    : `FAIL: ${result.misses.map((g) => `day ${String(g.from)} → ${String(g.to)} (${String(g.days)} days)`).join(', ')}`;
  return `firsts gate (soft until #730; does not fail the run): ${rule}: ${verdict}`;
}
