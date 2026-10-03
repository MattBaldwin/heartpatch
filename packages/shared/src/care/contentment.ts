import type { CareAction } from '../schemas/data/care-actions.js';
import type { CareRules, MoodId } from '../schemas/data/care.js';

// Contentment (design doc §7): stored as the value at the last care action
// plus when that was, and worked out on read from the time since (CLAUDE.md
// rule 4: nothing ticks). Integers only, so it's the same on every engine.

const HOUR_MS = 60 * 60 * 1000;

/** What a squishy's contentment is stored as (`squishies` columns). */
export interface CareState {
  /** Contentment right after the last care action (0–100). */
  readonly contentment: number;
  /**
   * When it was last cared for. A new squishy gets its creation time and the
   * care rules' `startContentment`; null (rows from before that): never, and
   * its stored value stays put, below any baseline.
   */
  readonly lastCaredAt: Date | null;
}

/**
 * Contentment at `now`: the stored value, sliding down in a straight line to
 * the baseline over `hoursFullToBaseline` hours since the last care action.
 * Never below the baseline (or below what it already was, if that's lower).
 */
export function contentmentAt(
  state: CareState,
  now: Date,
  rules: Pick<CareRules, 'maxContentment' | 'baselineContentment' | 'hoursFullToBaseline'>,
): number {
  const { contentment, lastCaredAt } = state;
  const floor = Math.min(contentment, rules.baselineContentment);
  if (lastCaredAt === null) return floor;
  const elapsedMs = Math.max(0, now.getTime() - lastCaredAt.getTime());
  const range = rules.maxContentment - rules.baselineContentment;
  const drop = Math.floor((elapsedMs * range) / (rules.hoursFullToBaseline * HOUR_MS));
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
}

/**
 * Diminishing returns (design doc §7, decision G): the first
 * `fullActionsPerDay` care actions on a squishy each day give their full
 * contentment; later ones give `falloffPercents` of it, the last repeating.
 * `actionsToday` counts every care action on this squishy earlier today.
 */
export function careGain(
  action: Pick<CareAction, 'contentment'>,
  actionsToday: number,
  rules: Pick<CareRules, 'fullActionsPerDay' | 'falloffPercents'>,
): CareGain {
  const past = actionsToday - rules.fullActionsPerDay;
  if (past < 0) return { contentment: action.contentment, percent: 100, full: true };
  const percent =
    rules.falloffPercents[Math.min(past, rules.falloffPercents.length - 1)] ??
    rules.falloffPercents.at(-1) ??
    0;
  return { contentment: Math.floor((action.contentment * percent) / 100), percent, full: false };
}

/** Contentment after a care action at `now` that adds `gain`, capped at full. */
export function contentmentAfterCare(
  state: CareState,
  now: Date,
  gain: number,
  rules: Pick<CareRules, 'maxContentment' | 'baselineContentment' | 'hoursFullToBaseline'>,
): number {
  return Math.min(rules.maxContentment, contentmentAt(state, now, rules) + gain);
}

/**
 * Patch Coins a care action earns: full-value actions only, and never past
 * the account's daily cap (`coinsToday` is what care already earned today).
 */
export function careCoins(
  gain: Pick<CareGain, 'full'>,
  coinsToday: number,
  rules: Pick<CareRules, 'coinsPerFullAction' | 'dailyCoinCap'>,
): number {
  if (!gain.full) return 0;
  return Math.max(0, Math.min(rules.coinsPerFullAction, rules.dailyCoinCap - coinsToday));
}
