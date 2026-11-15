import { RaritySchema, type Rarity } from '../../src/schemas/data/common.js';
import type { Species } from '../../src/schemas/data/species.js';
import { evolutionStages } from '../../src/trading/value.js';
import type { ProgressionConfig } from './progression-config.js';
import type { DayRecord } from './progression.js';

/*
 * "Firsts" (#736): the day each new thing first happens to a kid, so the
 * report asks "what new thing happens on day 10?" and not only "does the kid
 * keep up?". The boredom gate holds the gaps between them to a few days in
 * the first month. Only firsts the progression model has state for get a
 * day; the rest say "not modelled" until a model plays them. "Rare
 * befriended" counts a befriend only when it joins the team (the model's
 * befriend), so it's a late bound; "map full" is the shared map's last
 * neutral tile taken.
 */

/** The secret milestone "Big and Bouncy" (a squishy at level 20). */
export const BIG_AND_BOUNCY = 20;
/**
 * A grown-up's stage (`evolutionStages`: 1 = baby, 2 = kid, 3 = teen, 4 =
 * grown-up). Every line in today's data has a kid form; a line that skipped
 * it would reach its grown-up at stage 3 and not count here.
 */
const GROWN_UP_STAGE = 4;

/**
 * What the firsts need to know about species: rarity, evolution stage
 * (`evolutionStages`) and the rarity of its line (its base form's rarity).
 */
export interface FirstsFacts {
  readonly rarity: (speciesId: string) => Rarity | undefined;
  readonly stage: (speciesId: string) => number;
  readonly lineRarity: (speciesId: string) => Rarity | undefined;
}

export function firstsFacts(species: ReadonlyMap<string, Species>): FirstsFacts {
  const stages = evolutionStages([...species.values()]);
  const parent = new Map<string, string>();
  for (const s of species.values()) for (const e of s.evolutions) parent.set(e.into, s.id);
  const baseOf = (id: string): string => {
    let at = id;
    for (const seen = new Set<string>(); parent.has(at) && !seen.has(at);) {
      seen.add(at);
      at = parent.get(at) ?? at;
    }
    return at;
  };
  return {
    rarity: (id) => species.get(id)?.rarity,
    stage: (id) => stages.get(id) ?? 1,
    lineRarity: (id) => species.get(baseOf(id))?.rarity,
  };
}

/** The rarity ladder, lowest first; `secret` is off it (as `rareFindTier`), so it counts as neither rare nor epic. */
const LADDER: readonly Rarity[] = RaritySchema.options.filter((r) => r !== 'secret');
const atLeast = (rarity: Rarity | undefined, floor: Rarity) =>
  rarity !== undefined &&
  LADDER.includes(rarity) &&
  LADDER.indexOf(rarity) >= LADDER.indexOf(floor);

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
  { id: 'map-full', label: 'map full', test: (d) => d.neutralLeft === 0 },
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

/** The rarity lines the per-tier line reports (#732), lowest first. */
export const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Tier = (typeof TIERS)[number];

export interface TierFirst {
  readonly tier: Tier;
  /** null: never within the run. */
  readonly day: number | null;
}

/**
 * #732's per-tier line: the first day a befriended squishy (any team member
 * but the Partner, the two day-1 teammates included) of each rarity line
 * evolves. A line's rarity is its base
 * form's, so a common line's rare grown-up counts as common; that's where
 * this differs from the "rare evolved" and "epic evolved" firsts, which go by
 * the evolving form's own rarity and count the Partner.
 */
export function tierFirstsOf(
  days: readonly Pick<DayRecord, 'day' | 'evolved'>[],
  facts: FirstsFacts,
): TierFirst[] {
  return TIERS.map((tier) => ({
    tier,
    day:
      days.find((d) => d.evolved.some((e) => !e.partner && facts.lineRarity(e.from) === tier))
        ?.day ?? null,
  }));
}

/** "rare day 7, epic never (> day 60), …" */
export function formatTierFirsts(firsts: readonly TierFirst[], runDays: number): string {
  return firsts.map((f) => `${f.tier} ${formatFirst(f.day, runDays)}`).join(', ');
}

export interface TierGateResult {
  readonly rows: readonly {
    readonly tier: Tier;
    readonly day: number | null;
    readonly by: number;
  }[];
  readonly pass: boolean;
}

/** #732's per-tier gate on one kid's per-tier line: each listed tier by its day. */
export function tierGate(
  firsts: readonly TierFirst[],
  byDay: Readonly<Partial<Record<Tier, number>>>,
): TierGateResult {
  const rows = TIERS.flatMap((tier) => {
    const by = byDay[tier];
    if (by === undefined) return [];
    return [{ tier, day: firsts.find((f) => f.tier === tier)?.day ?? null, by }];
  });
  return { rows, pass: rows.every((r) => r.day !== null && r.day <= r.by) };
}

/** `#732 per-tier gate: rare ≤ day 10, epic ≤ day 20 (casual, collector): PASS` (or FAIL with the days). */
export function formatTierGate(result: TierGateResult, kid: string, policy: string): string {
  // TODO(#732 D1): make this a hard gate (fail the script and CI) once bench share lands.
  const rule = result.rows.map((r) => `${r.tier} ≤ day ${String(r.by)}`).join(', ');
  const verdict = result.pass
    ? 'PASS'
    : `FAIL: ${result.rows.map((r) => `${r.tier} ${r.day === null ? 'never' : `day ${String(r.day)}`}`).join(', ')}`;
  return `#732 per-tier gate: ${rule} (${kid}, ${policy}): ${verdict} (soft until #732 D1; does not fail the run)`;
}
