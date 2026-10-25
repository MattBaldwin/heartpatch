import { HEX_DIRECTIONS, hex, hexDistance, hexLine, hexRing, type Hex } from '../hex/index.js';
import { Rng, type Seed } from '../rng/index.js';
import type { WeatherKind, WeatherRules } from '../schemas/data/weather.js';
import type { LocalDate } from '../schemas/time.js';
import type { WeatherDay, WeatherFront } from '../schemas/weather.js';

// Wild Isle weather (#621, plan §4 "Weather plan"): each map-local day's
// fronts are a pure function of a seed, planned once and stored (rule 4:
// timestamps, nothing ticks). Weather at a tile is a pure function of the
// stored fronts and the time, so the client and the server always agree.
// Integer maths on epoch milliseconds only; the server picks the seed
// (secret) and the day's real start and end (daylight saving included).

/** The island a plan is drawn over: centred on (0, 0). */
export interface Island {
  /** Rings of the map, the sea included. */
  readonly radius: number;
  /** Outer rings that are open sea. */
  readonly oceanRings: number;
}

/** One map-local day as instants: `[startMs, endMs)`, 23 or 25 hours on a daylight-saving day. */
export interface DayWindow {
  readonly day: LocalDate;
  readonly startMs: number;
  readonly endMs: number;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const ORIGIN = hex(0, 0);

/** Which front's kind wins where two cover one tile (a storm is what counts). */
const KIND_ORDER: readonly WeatherKind[] = ['storm', 'rain', 'fog', 'drought'];

/** The table of day kinds for a day: the first running season's own, else the everyday one. */
function dayTable(rules: WeatherRules, seasonIds: readonly string[]) {
  return rules.seasons.find((s) => seasonIds.includes(s.season))?.days ?? rules.days;
}

/**
 * One map-local day's plan from `seed` (the server's
 * `deriveSeed(mapSeed, 'weather', day)`, never revealed): the kind of day
 * and its fronts. A front comes in from the open sea, crosses the island in
 * a straight line and leaves it on the far side, wholly inside the day
 * (`window`), so `weatherAt` only ever needs one day's row and nothing is
 * split at midnight. `seasonIds` are the seasons running that day.
 */
export function planWeatherDay(
  seed: Seed,
  rules: WeatherRules,
  seasonIds: readonly string[],
  window: DayWindow,
  island: Island,
): WeatherDay {
  const rng = Rng.fromSeed(seed);
  const kind = rng.weighted(dayTable(rules, seasonIds)).kind;
  if (kind === 'clear') return { day: window.day, kind, fronts: [] };
  const count = rng.int(rules.fronts.perDay.min, rules.fronts.perDay.max);
  const span = window.endMs - window.startMs;
  const land = island.radius - island.oceanRings;
  const fronts: WeatherFront[] = [];
  for (let i = 0; i < count; i++) {
    const radius = rng.int(rules.fronts.radius.min, rules.fronts.radius.max);
    const tilesPerHour = rng.int(rules.fronts.tilesPerHour.min, rules.fronts.tilesPerHour.max);
    // Far enough out that nothing it covers is land, at either end.
    const ring = hexRing(ORIGIN, land + radius + 1);
    const enter = rng.int(0, ring.length - 1);
    const wobble = Math.floor(ring.length / 12);
    const leave = enter + Math.floor(ring.length / 2) + rng.int(-wobble, wobble);
    const from = ring[enter] as Hex;
    const to = ring[(leave + ring.length) % ring.length] as Hex;
    const steps = hexDistance(from, to) + 1;
    // Each hex of its path for one step; a day too short for the pace speeds it up.
    const stepMs = Math.min(Math.ceil(HOUR_MS / tilesPerHour), Math.floor(span / steps));
    const lasts = steps * stepMs;
    const startMs = window.startMs + rng.int(0, Math.floor((span - lasts) / MINUTE_MS)) * MINUTE_MS;
    fronts.push({
      id: `${window.day}-${String(i)}`,
      kind,
      from,
      to,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(startMs + lasts).toISOString(),
      radius,
    });
  }
  return { day: window.day, kind, fronts };
}

/** A front's path: the hexes its centre steps over, in order (shared `hexLine`). */
export function frontPath(front: Pick<WeatherFront, 'from' | 'to'>): Hex[] {
  return hexLine(front.from, front.to);
}

interface Timing {
  readonly startMs: number;
  readonly endMs: number;
  readonly steps: number;
}

function timingOf(front: WeatherFront, path: readonly Hex[]): Timing {
  return {
    startMs: Date.parse(front.startAt),
    endMs: Date.parse(front.endAt),
    steps: path.length,
  };
}

/**
 * The step index at `t` (startMs ≤ t < endMs): `floor((t − start) × steps
 * / span)`. Whole milliseconds, and every product is below 2^53, so the
 * division is exact enough that no engine rounds across a step.
 */
function stepAt(t: Timing, instantMs: number): number {
  return Math.floor(((instantMs - t.startMs) * t.steps) / (t.endMs - t.startMs));
}

/** When step `i` starts: the first whole millisecond `stepAt` gives `i` (or the end, for `steps`). */
function stepStartMs(t: Timing, i: number): number {
  return t.startMs + Math.ceil((i * (t.endMs - t.startMs)) / t.steps);
}

/** Where a front's centre is at an instant, or null before it starts and from when it ends. */
export function frontCentreAt(front: WeatherFront, instantMs: number): Hex | null {
  const path = frontPath(front);
  const t = timingOf(front, path);
  if (instantMs < t.startMs || instantMs >= t.endMs || t.endMs <= t.startMs) return null;
  return path[stepAt(t, instantMs)] ?? null;
}

/**
 * The stretches a front covers `tile` (within its radius of the centre), as
 * `[fromMs, toMs)` pairs in order, touching steps merged.
 */
export function frontCover(front: WeatherFront, tile: Hex): [number, number][] {
  const path = frontPath(front);
  const t = timingOf(front, path);
  if (t.endMs <= t.startMs) return [];
  const out: [number, number][] = [];
  path.forEach((centre, i) => {
    if (hexDistance(centre, tile) > front.radius) return;
    const from = stepStartMs(t, i);
    const to = stepStartMs(t, i + 1);
    if (to <= from) return;
    const last = out[out.length - 1];
    if (last && last[1] === from) last[1] = to;
    else out.push([from, to]);
  });
  return out;
}

/** The weather on `tile` at an instant: the covering front's kind (a storm first), else clear. */
export function weatherAt(
  fronts: readonly WeatherFront[],
  tile: Hex,
  instantMs: number,
): WeatherKind {
  let best: WeatherKind = 'clear';
  for (const front of fronts) {
    const centre = frontCentreAt(front, instantMs);
    if (centre === null || hexDistance(centre, tile) > front.radius) continue;
    if (best === 'clear' || KIND_ORDER.indexOf(front.kind) < KIND_ORDER.indexOf(best)) {
      best = front.kind;
    }
  }
  return best;
}

/** One stretch of weather over a tile, clipped to a window. */
export interface CoverWindow {
  readonly frontId: string;
  readonly kind: Exclude<WeatherKind, 'clear'>;
  readonly fromMs: number;
  readonly toMs: number;
}

/** Each front's stretches over `tile` inside `[fromMs, toMs)`, by front then time. */
export function coverWindows(
  fronts: readonly WeatherFront[],
  tile: Hex,
  fromMs: number,
  toMs: number,
): CoverWindow[] {
  return fronts.flatMap((front) =>
    frontCover(front, tile).flatMap(([a, b]) => {
      const lo = Math.max(a, fromMs);
      const hi = Math.min(b, toMs);
      return hi > lo ? [{ frontId: front.id, kind: front.kind, fromMs: lo, toMs: hi }] : [];
    }),
  );
}

/**
 * Whole minutes each kind of weather covered `tile` in `[fromMs, toMs)`
 * (fronts of one kind overlapping count once); kinds that never did are left
 * out. What effects integrate over (plan §4 "Effects").
 */
export function coveredMinutes(
  fronts: readonly WeatherFront[],
  tile: Hex,
  fromMs: number,
  toMs: number,
): Partial<Record<WeatherKind, number>> {
  const byKind = new Map<WeatherKind, [number, number][]>();
  for (const w of coverWindows(fronts, tile, fromMs, toMs)) {
    byKind.set(w.kind, [...(byKind.get(w.kind) ?? []), [w.fromMs, w.toMs]]);
  }
  const out: Partial<Record<WeatherKind, number>> = {};
  for (const [kind, spans] of byKind) {
    spans.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let end = -Infinity;
    for (const [a, b] of spans) {
      const lo = Math.max(a, end);
      if (b > lo) total += b - lo;
      end = Math.max(end, b);
    }
    out[kind] = Math.floor(total / MINUTE_MS);
  }
  return out;
}

/**
 * A compass point a front comes in from: the six ways a pointy-top hex faces
 * (`HEX_DIRECTIONS` order), north being up on the map.
 */
export type Compass = 'east' | 'north-east' | 'north-west' | 'west' | 'south-west' | 'south-east';

const COMPASS: readonly Compass[] = [
  'east',
  'north-east',
  'north-west',
  'west',
  'south-west',
  'south-east',
];

/**
 * The compass point a hex lies towards from the centre: the hex direction
 * with the largest cube dot product (integers only, so every engine agrees;
 * a tie goes to the first in `HEX_DIRECTIONS` order).
 */
export function compassOf(h: Hex): Compass {
  const s = -h.q - h.r;
  let best = 0;
  let bestDot = -Infinity;
  HEX_DIRECTIONS.forEach((d, i) => {
    const dot = h.q * d.q + h.r * d.r + s * (-d.q - d.r);
    if (dot > bestDot) {
      best = i;
      bestDot = dot;
    }
  });
  return COMPASS[best] as Compass;
}

/** A part of the day, by map-local hour. */
export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** The parts of a forecast line for one front: its kind, where it comes in from, and when. */
export interface FrontSummary {
  readonly kind: Exclude<WeatherKind, 'clear'>;
  readonly from: Compass;
  readonly when: PartOfDay;
}

/**
 * What a kid is told about a front (plan §4 `frontSummary`): its kind, the
 * compass point it comes in from (north is up on the map) and the part of
 * the day it's over the island (its middle, by hours since `dayStartMs`).
 */
export function frontSummary(front: WeatherFront, dayStartMs: number): FrontSummary {
  const from = compassOf(front.from);
  // Hours since the day began, not the wall clock: on the two daylight-saving
  // days a year the line can be an hour out, which a forecast can live with.
  const mid = (Date.parse(front.startAt) + Date.parse(front.endAt)) / 2;
  const hour = Math.floor((mid - dayStartMs) / HOUR_MS);
  return { kind: front.kind, from, when: partOfDay(hour) };
}

/**
 * Tomorrow's one-line forecast for everyone (`WeatherView.tomorrow.summary`,
 * style guide: short and cozy). A Weather Vane shows the fronts themselves.
 */
export function forecastLine(day: WeatherDay, dayStartMs: number): string {
  if (day.kind === 'drought') return 'Dry spell tomorrow: fields are thirsty 🌵';
  const first = day.fronts[0];
  if (!first) return 'Sunny tomorrow ☀️';
  const { kind, from, when } = frontSummary(first, dayStartMs);
  switch (kind) {
    case 'storm':
      return `A storm rolls in from the ${from} tomorrow ${when} ⛈️ Tuck your buildings in!`;
    case 'rain':
      return `Rain from the ${from} tomorrow ${when} ☔`;
    case 'fog':
      return `Fog rolls in from the ${from} tomorrow ${when} 🌫️`;
    case 'drought':
      return 'Dry spell tomorrow: fields are thirsty 🌵';
  }
}
