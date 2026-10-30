import type { CareAction } from '../schemas/data/care-actions.js';
import { foodPercentFor, type CareRules, type MoodId } from '../schemas/data/care.js';
import type { ElementId } from '../schemas/data/elements.js';

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
 *
 * `drainPercent` scales the slide: 100 is the normal rate, and a resident of
 * the Keeper's house fades at the house perk's percent (#381,
 * `residentDrainPercent`), so the rate is base × fit × resident. It holds for
 * the whole stretch since the checkpoint: moving in or out writes a new one.
 */
export function contentmentAt(
  state: CareState,
  now: Date,
  rules: Pick<CareRules, 'maxContentment' | 'baselineContentment' | 'hoursFullToBaseline'>,
  holding: readonly HoldSpan[] = [],
  drainPercent = 100,
): number {
  const { contentment, since } = state;
  const floor = Math.min(contentment, rules.baselineContentment);
  if (since === null) return floor;
  const fromMs = since.getTime();
  const nowMs = Math.max(fromMs, now.getTime());
  const driftMs = nowMs - fromMs - heldMs(fromMs, nowMs, holding);
  const range = rules.maxContentment - rules.baselineContentment;
  // Integers only: whole ms × whole points × whole percent stays well inside
  // 2^53 for years of drift, and one floor at the end.
  const drop = Math.floor(
    (driftMs * range * drainPercent) / (rules.hoursFullToBaseline * HOUR_MS * 100),
  );
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

/** A care action paid with a chosen food: what it gives before the day's falloff, and what it costs. */
export interface FedWith {
  /** The action's contentment at this food's percent, before diminishing returns. */
  readonly contentment: number;
  /** The action's cost, paid in this food, one for one. */
  readonly cost: Readonly<Record<string, number>>;
}

/**
 * A care action paid with `itemId` instead of its own food (#621 W1-8b: Pies
 * for a feed): its contentment at the food's `CARE_RULES.foods` percent for a
 * squishy of `element` (#735: Frosty Treats love Frost), floored, and its
 * cost in that food. Null when `itemId` isn't a food or the action isn't paid
 * with exactly one food. Diminishing returns, the debounce and the coin cap
 * then apply as usual (`careGain` on the result).
 */
export function fedWith(
  action: Pick<CareAction, 'contentment' | 'cost'>,
  itemId: string,
  rules: Pick<CareRules, 'foods'>,
  element?: ElementId,
): FedWith | null {
  const foods = rules.foods ?? {};
  const rule = foods[itemId];
  const paid = Object.entries(action.cost ?? {});
  const only = paid.length === 1 ? paid[0] : undefined;
  if (rule === undefined || only === undefined || foods[only[0]] === undefined) return null;
  const percent = foodPercentFor(rule, element);
  return {
    contentment: Math.floor((action.contentment * percent) / 100),
    cost: { [itemId]: only[1] },
  };
}

/** Contentment after a care action at `now` that adds `gain`, capped at full. */
export function contentmentAfterCare(
  state: CareState,
  now: Date,
  gain: number,
  rules: Pick<CareRules, 'maxContentment' | 'baselineContentment' | 'hoursFullToBaseline'>,
  holding: readonly HoldSpan[] = [],
  drainPercent = 100,
): number {
  return Math.min(
    rules.maxContentment,
    contentmentAt(state, now, rules, holding, drainPercent) + gain,
  );
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
