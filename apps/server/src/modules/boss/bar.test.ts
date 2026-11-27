import { BOSS_EVENTS, type ChristmasEveBarRules } from '@heartpatch/shared/server';
import { describe, expect, it } from 'vitest';
import { barGoal, barHeadStart, barStateAt, chipPoints } from './bar.js';

// The shipped numbers (#37 X2): one win 100, the goal 120 a Keeper in [200, 1200].
const BAR: ChristmasEveBarRules = BOSS_EVENTS.christmasEve!.bar;

describe('the patch bar’s arithmetic (#37 X2)', () => {
  it('normalises a fight across boss energy: a full win is pointsPerWin however big the boss', () => {
    for (const hp of [40, 120, 1_000, 4_320]) {
      expect(chipPoints(BAR, { stats: { hp }, energy: 0 }), String(hp)).toBe(BAR.pointsPerWin);
      expect(chipPoints(BAR, { stats: { hp }, energy: hp }), String(hp)).toBe(0);
      expect(chipPoints(BAR, { stats: { hp }, energy: Math.round(hp / 2) }), String(hp)).toBe(
        Math.round(BAR.pointsPerWin / 2),
      );
    }
    // A bigger boss taken down by the same share gives the same points.
    expect(chipPoints(BAR, { stats: { hp: 400 }, energy: 100 })).toBe(
      chipPoints(BAR, { stats: { hp: 4_000 }, energy: 1_000 }),
    );
    // Out-of-range energy is clamped, never negative or over a win.
    expect(chipPoints(BAR, { stats: { hp: 100 }, energy: 150 })).toBe(0);
    expect(chipPoints(BAR, { stats: { hp: 100 }, energy: -5 })).toBe(BAR.pointsPerWin);
    expect(chipPoints(BAR, { stats: { hp: 0 }, energy: 0 })).toBe(0);
  });

  it('scales the goal with active Keepers between its floor and ceiling', () => {
    expect(barGoal(BAR, 0)).toBe(BAR.minGoal);
    expect(barGoal(BAR, 1)).toBe(BAR.minGoal);
    expect(barGoal(BAR, 3)).toBe(3 * BAR.goalPerKeeper);
    expect(barGoal(BAR, 6)).toBe(6 * BAR.goalPerKeeper);
    expect(barGoal(BAR, 50)).toBe(BAR.maxGoal);
  });

  it('caps the head start: lights at their max, plus the star, never the whole goal', () => {
    const goal = 600;
    expect(barHeadStart(BAR, goal, 0, false)).toBe(0);
    // 2 % a lit tile…
    expect(barHeadStart(BAR, goal, 3, false)).toBe((goal * 3 * BAR.headStartPerLightPercent) / 100);
    // …at most 20 % from lights however many…
    const lightsMax = (goal * BAR.headStartLightsMaxPercent) / 100;
    expect(barHeadStart(BAR, goal, 10, false)).toBe(lightsMax);
    expect(barHeadStart(BAR, goal, 500, false)).toBe(lightsMax);
    // …plus 10 % for the star.
    const star = (goal * BAR.headStartStarPercent) / 100;
    expect(barHeadStart(BAR, goal, 0, true)).toBe(star);
    expect(barHeadStart(BAR, goal, 500, true)).toBe(lightsMax + star);
    // Rules that would give it all still leave a fight to fill it.
    const generous = { ...BAR, headStartLightsMaxPercent: 100, headStartStarPercent: 100 };
    expect(barHeadStart(generous, goal, 500, true)).toBe(goal - 1);
  });

  it('reads an open bar past its close as dozed off', () => {
    const closesAt = new Date('2026-12-25T17:00:00Z');
    const before = new Date(closesAt.getTime() - 1);
    expect(barStateAt({ state: 'open', closesAt }, before)).toBe('open');
    expect(barStateAt({ state: 'open', closesAt }, closesAt)).toBe('dozed');
    expect(barStateAt({ state: 'fell', closesAt }, closesAt)).toBe('fell');
    expect(barStateAt({ state: 'dozed', closesAt }, before)).toBe('dozed');
  });
});
