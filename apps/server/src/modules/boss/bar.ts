import type { BossBarState } from '@heartpatch/shared';
import type { ChristmasEveBarRules } from '@heartpatch/shared/server';

/*
 * The Christmas Eve patch bar's arithmetic (#37 X2; addendum "The patch
 * bar"). Pure and server-only (CLAUDE.md rule 6): the goal's formula, the
 * head start's rule and a fight's points never reach a client. The client
 * sees the bar's `goal`, `chipped` and `state` (#889 verdict).
 */

/**
 * The bar's goal: `goalPerKeeper` per active Keeper, clamped to
 * `[minGoal, maxGoal]`, so a patch that all tried once about fills it.
 */
export function barGoal(rules: ChristmasEveBarRules, activeKeepers: number): number {
  const goal = rules.goalPerKeeper * Math.max(0, activeKeepers);
  return Math.min(rules.maxGoal, Math.max(rules.minGoal, goal));
}

/**
 * What the lit lights and the star give the bar at open, in points:
 * `headStartPerLightPercent` of the goal per lit Twinkle Lights tile, at
 * most `headStartLightsMaxPercent`, plus `headStartStarPercent` for a lit
 * Patch Tree star. Never the whole goal: a fight always fills it, so the
 * fall always has someone to cheer.
 */
export function barHeadStart(
  rules: ChristmasEveBarRules,
  goal: number,
  litLights: number,
  starLit: boolean,
): number {
  const lightsPercent = Math.min(
    rules.headStartLightsMaxPercent,
    rules.headStartPerLightPercent * Math.max(0, litLights),
  );
  const percent = lightsPercent + (starLit ? rules.headStartStarPercent : 0);
  return Math.max(0, Math.min(goal - 1, Math.round((goal * percent) / 100)));
}

/**
 * One finished fight's points: `pointsPerWin × energy taken ÷ full energy`
 * of the Keeper's own boss, so a full win is `pointsPerWin` however strong
 * their boss was (its level follows their Partner's). A boss that got some
 * back counts what it ended down.
 */
export function chipPoints(
  rules: ChristmasEveBarRules,
  boss: { stats: { hp: number }; energy: number },
): number {
  const full = boss.stats.hp;
  if (full <= 0) return 0;
  const taken = Math.max(0, Math.min(full, full - boss.energy));
  return Math.round((rules.pointsPerWin * taken) / full);
}

/** A bar's state as of `at`: an open bar past its close has dozed off (the sweep writes it). */
export function barStateAt(bar: { state: string; closesAt: Date }, at: Date): BossBarState {
  if (bar.state === 'fell' || bar.state === 'dozed') return bar.state;
  return at >= bar.closesAt ? 'dozed' : 'open';
}
