import type { CareAction } from '../schemas/data/care-actions.js';
import type { CareRules, MoodId } from '../schemas/data/care.js';

// Contentment (design doc §7): stored as a checkpoint, the value at one
// moment plus when that was, and worked out on read from the time since
// (CLAUDE.md rule 4: nothing ticks). It drifts down only while a squishy
// isn't working a job that suits it (owner decision on #376): the server
// passes the stretches it was, and those don't count. Every care action and
// every job change writes a new checkpoint. Integers only, so it's the same
// on every engine.

const HOUR_MS = 60 * 60 * 1000;

/** What a squishy's contentment is stored as (`squishies` checkpoint columns). */
export interface CareState {
  /** Contentment at the checkpoint (0–100). */
  readonly contentment: number;
  /**
   * When the checkpoint was written: the last care action or job change. A
   * new squishy gets its creation time and the care rules'
   * `startContentment`; null (rows from before that): never, and its stored
   * value stays put, below any baseline.
   */
  readonly since: Date | null;
}

/**
 * A stretch of time (epoch ms, from inclusive, to exclusive) a squishy was
 * working a job that suits it, so its contentment held steady. `toMs` null:
 * it still is.
 */
export interface HoldSpan {
  readonly fromMs: number;
  readonly toMs: number | null;
}

/**
 * How much of `fromMs`..`toMs` the spans cover, each moment once (spans may
 * overlap or come in any order). Whole milliseconds in, whole out.
 */
export function heldMs(fromMs: number, toMs: number, spans: readonly HoldSpan[]): number {
  const clipped = spans
    .map((s) => ({ from: Math.max(fromMs, s.fromMs), to: Math.min(toMs, s.toMs ?? toMs) }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  let total = 0;
  let reached = fromMs;
  for (const s of clipped) {
    const from = Math.max(s.from, reached);
    if (s.to > from) {
      total += s.to - from;
      reached = s.to;
    }
  }
  return total;
}

/**
 * Contentment at `now`: the checkpoint's value, sliding down in a straight
 * line to the baseline over `hoursFullToBaseline` hours of time since the
 * checkpoint that the `holding` spans don't cover (a suitable job holds it
 * steady; it never raises it). Never below the baseline (or below what it
 * already was, if that's lower).
 */
export function contentmentAt(
  state: CareState,
  now: Date,
  rules: Pick<CareRules, 'maxContentment' | 'baselineContentment' | 'hoursFullToBaseline'>,
  holding: readonly HoldSpan[] = [],
): number {
  const { contentment, since } = state;
  const floor = Math.min(contentment, rules.baselineContentment);
  if (since === null) return floor;
  const fromMs = since.getTime();
  const nowMs = Math.max(fromMs, now.getTime());
  const driftMs = nowMs - fromMs - heldMs(fromMs, nowMs, holding);
  const range = rules.maxContentment - rules.baselineContentment;
  const drop = Math.floor((driftMs * range) / (rules.hoursFullToBaseline * HOUR_MS));
  return Math.max(floor, contentment - drop);
}

/** The soft word for a contentment value: the first mood it reaches. */
export function moodFor(contentment: number, rules: Pick<CareRules, 'moods'>): MoodId {
  const mood = rules.moods.find((m) => contentment >= m.atLeast) ?? rules.moods.at(-1);
  if (!mood) throw new Error('moodFor: no moods in the care rules');
  return mood.id;
}

/** The player-facing line for a mood. */
export function moodLine(mood: MoodId, rules: Pick<CareRules, 'moods'>): string {
  return rules.moods.find((m) => m.id === mood)?.line ?? '';
}

/** What one care action is worth, given how many this squishy had today. */
export interface CareGain {
  /** Contentment added (before the 100 cap). */
  readonly contentment: number;
  /** Percent of the action's full contentment it gave. */
  readonly percent: number;
  /** Still within the day's full-value actions (decision G). */
  readonly full: boolean;
  /**
   * Counts toward the day's diminishing returns and the care coin cap. False
   * for a rare treat (`outsideDailyCare`, the Heart Snack).
   */
  readonly counts: boolean;
}

/**
 * Diminishing returns (design doc §7, decision G): the first
 * `fullActionsPerDay` care actions on a squishy each day give their full
 * contentment; later ones give `falloffPercents` of it, the last repeating.
 * `actionsToday` counts every counted care action on this squishy earlier
 * today. A rare treat (`outsideDailyCare`) always gives its full contentment
 * and isn't counted.
 */
export function careGain(
  action: Pick<CareAction, 'contentment' | 'outsideDailyCare'>,
  actionsToday: number,
  rules: Pick<CareRules, 'fullActionsPerDay' | 'falloffPercents'>,
): CareGain {
  if (action.outsideDailyCare === true) {
    return { contentment: action.contentment, percent: 100, full: true, counts: false };
  }
  const past = actionsToday - rules.fullActionsPerDay;
  if (past < 0) return { contentment: action.contentment, percent: 100, full: true, counts: true };
  const percent =
    rules.falloffPercents[Math.min(past, rules.falloffPercents.length - 1)] ??
    rules.falloffPercents.at(-1) ??
    0;
  return {
    contentment: Math.floor((action.contentment * percent) / 100),
    percent,
    full: false,
    counts: true,
  };
}

/** Contentment after a care action at `now` that adds `gain`, capped at full. */
export function contentmentAfterCare(
  state: CareState,
  now: Date,
  gain: number,
  rules: Pick<CareRules, 'maxContentment' | 'baselineContentment' | 'hoursFullToBaseline'>,
  holding: readonly HoldSpan[] = [],
): number {
  return Math.min(rules.maxContentment, contentmentAt(state, now, rules, holding) + gain);
}

/**
 * Patch Coins a care action earns: counted full-value actions only (a rare
 * treat earns none), and never past the account's daily cap (`coinsToday` is
 * what care already earned today).
 */
export function careCoins(
  gain: Pick<CareGain, 'full' | 'counts'>,
  coinsToday: number,
  rules: Pick<CareRules, 'coinsPerFullAction' | 'dailyCoinCap'>,
): number {
  if (!gain.full || !gain.counts) return 0;
  return Math.max(0, Math.min(rules.coinsPerFullAction, rules.dailyCoinCap - coinsToday));
}
