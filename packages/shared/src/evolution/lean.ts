import type { FeelingId } from '../schemas/data/elements.js';
import type { EvolutionRules } from '../schemas/data/evolution-odds.js';

/**
 * How a squishy has been feeling lately (#32, design doc §8): points per
 * feeling that halve every `halfLifeHours`. Stored as the points at `at`
 * and worked out on read (CLAUDE.md rule 4), so an idle squishy costs
 * nothing.
 */
export interface FeelingLean {
  readonly points: Readonly<Partial<Record<FeelingId, number>>>;
  /** When `points` were last brought up to date; null for a squishy that has none yet. */
  readonly at: Date | null;
}

const ROUND = 1000;
const LN2 = 0.6931471805599453;

/**
 * 2^−t for t ≥ 0 with only + − × ÷, so every JS engine agrees (tech spec §8):
 * whole halvings, then e^(−f·ln 2) for the fraction by its Taylor series.
 */
function halvings(t: number): number {
  if (!(t > 0)) return 1;
  if (t >= 64) return 0;
  const whole = Math.floor(t);
  let factor = 1;
  for (let i = 0; i < whole; i++) factor /= 2;
  const x = -(t - whole) * LN2;
  let term = 1;
  let sum = 1;
  for (let k = 1; k <= 20; k++) {
    term = (term * x) / k;
    sum += term;
  }
  return factor * sum;
}

const tidy = (n: number) => Math.round(n * ROUND) / ROUND;

/** The lean decayed to `now`. Time running backwards (a clock step) decays nothing. */
export function leanAt(
  lean: FeelingLean,
  now: Date,
  rules: Pick<EvolutionRules, 'lean'>,
): FeelingLean {
  if (!lean.at) return { points: lean.points, at: now };
  const hours = Math.max(0, (now.getTime() - lean.at.getTime()) / 3_600_000);
  const factor = halvings(hours / rules.lean.halfLifeHours);
  const points: Partial<Record<FeelingId, number>> = {};
  for (const [feeling, value] of Object.entries(lean.points) as [FeelingId, number][]) {
    const next = tidy(value * factor);
    if (next > 0) points[feeling] = next;
  }
  return { points, at: now };
}

/** A new squishy's lean: its own feeling gets the head start. */
export function startingLean(
  feeling: FeelingId,
  at: Date,
  rules: Pick<EvolutionRules, 'lean'>,
): FeelingLean {
  return { points: { [feeling]: rules.lean.headStart }, at };
}

/** Adds points to one feeling, decaying the rest to `now` first. */
export function addLean(
  lean: FeelingLean,
  feeling: FeelingId,
  points: number,
  now: Date,
  rules: Pick<EvolutionRules, 'lean'>,
): FeelingLean {
  const current = leanAt(lean, now, rules);
  if (points <= 0) return current;
  return {
    at: now,
    points: { ...current.points, [feeling]: tidy((current.points[feeling] ?? 0) + points) },
  };
}

/**
 * The feeling with the most points; a tie (or no points at all) goes to the
 * squishy's own feeling, then to the first in `order`.
 */
export function dominantFeeling(
  lean: FeelingLean,
  own: FeelingId,
  order: readonly FeelingId[],
): FeelingId {
  let best = own;
  let bestPoints = lean.points[own] ?? 0;
  for (const feeling of order) {
    const points = lean.points[feeling] ?? 0;
    if (points > bestPoints) {
      best = feeling;
      bestPoints = points;
    }
  }
  return best;
}

/**
 * Habitat points for the last `hours` housed in a habitat tagged with a
 * feeling, as of now. They trickle in (`points` every `hours`) and fade like
 * every other point while they wait, so it's the decayed integral
 * rate · H/ln 2 · (1 − 2^(−h/H)): how often the lean is written in between
 * never changes the total.
 */
export function habitatLeanPoints(hours: number, rules: Pick<EvolutionRules, 'lean'>): number {
  if (!(hours > 0)) return 0;
  const { halfLifeHours } = rules.lean;
  const rate = rules.lean.habitat.points / rules.lean.habitat.hours;
  return tidy(((rate * halfLifeHours) / LN2) * (1 - halvings(hours / halfLifeHours)));
}

/** A care-history score from 0 to 1: the average contentment (0–100) over its care samples. */
export function careScore(careSum: number, careSamples: number): number {
  if (careSamples <= 0) return 0;
  return Math.max(0, Math.min(1, careSum / careSamples / 100));
}
