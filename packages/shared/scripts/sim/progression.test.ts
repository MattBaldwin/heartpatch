import { describe, expect, it } from 'vitest';
import {
  BASELINE_RULES,
  CAPPED_BEFRIEND_RULES,
  CURRENT_RULES,
  PROGRESSION_CONFIG,
  type ProgressionConfig,
} from './progression-config.js';
import { gapWin, renderProgression, summarise } from './progression-report.js';
import { modelData, runProgression, wildOdds } from './progression.js';

/** A short run: the same model, a few days and a small odds estimate. */
const SMALL: ProgressionConfig = { ...PROGRESSION_CONFIG, days: 6, estimateGames: 4 };
const data = modelData();
const [casual, engaged] = PROGRESSION_CONFIG.kids;

describe('runProgression', () => {
  it('gives the same run for the same config and data', () => {
    const run = () => runProgression(data, SMALL, CURRENT_RULES, engaged!, 4);
    expect(run()).toEqual(run());
  });

  it('never takes a level or a tile away, and shares the land between both kids', () => {
    const run = runProgression(data, SMALL, CURRENT_RULES, engaged!, 2);
    for (const kid of run.kids) {
      kid.days.forEach((day, i) => {
        const before = kid.days[i - 1];
        if (!before) return;
        day.levels.forEach((level, m) => {
          expect(level).toBeGreaterThanOrEqual(before.levels[m]!);
        });
        expect(day.tiles).toBeGreaterThanOrEqual(before.tiles);
      });
    }
    run.kids[0]!.days.forEach((day, i) => {
      const other = run.kids[1]!.days[i]!;
      // Each kid starts with a 7-tile home ring; neutral land is all the rest.
      expect(day.tiles - 7 + (other.tiles - 7) + day.neutralLeft).toBe(run.neutral);
      expect(day.tileBattles).toBeLessThanOrEqual(CURRENT_RULES.attemptsPerDay);
      expect(day.tileBattles + day.wildBattles).toBe(engaged!.battlesPerDay);
    });
  });

  it('uses the attempts each rule set allows', () => {
    const before = runProgression(data, SMALL, BASELINE_RULES, engaged!, 4).kids[0]!.days[0]!;
    const now = runProgression(data, SMALL, CURRENT_RULES, engaged!, 4).kids[0]!.days[0]!;
    expect(before.tileBattles).toBe(BASELINE_RULES.attemptsPerDay);
    expect(now.tileBattles).toBe(CURRENT_RULES.attemptsPerDay);
  });
});

describe('headline numbers (a short run, so data changes show up here)', () => {
  it("pins each kid's Partner level by day under the shipped rules", () => {
    const levels = [casual!, engaged!].map((kid) =>
      runProgression(data, SMALL, CURRENT_RULES, kid, 4).kids[0]!.days.map((d) => d.partnerLevel),
    );
    expect(levels).toEqual([
      [8, 12, 15, 17, 18, 19],
      [22, 26, 30, 33, 34, 36],
    ]);
  });

  it('keeps befriended squishies below their evolution with option (a)', () => {
    const run = runProgression(data, SMALL, CAPPED_BEFRIEND_RULES, engaged!, 4);
    const uncapped = runProgression(data, SMALL, CURRENT_RULES, engaged!, 4);
    const friends = (r: typeof run) => r.kids[0]!.days.at(-1)!.levels.slice(1);
    expect(Math.max(...friends(run))).toBeLessThan(Math.max(...friends(uncapped)));
  });
});

describe('wildOdds', () => {
  it('gives a win rate for every team and offset, the same each time', () => {
    const odds = wildOdds(data, SMALL, [-2, 1], 4);
    expect(odds).toEqual(wildOdds(data, SMALL, [-2, 1], 4));
    expect(odds).toHaveLength(3);
    for (const row of odds) expect(row.odds.map((o) => o.offset)).toEqual([-2, 1]);
  });
});

describe('the progression report', () => {
  it('summarises milestones and renders every table', () => {
    const runs = [casual!, engaged!].map((kid) =>
      runProgression(data, SMALL, CURRENT_RULES, kid, 4),
    );
    const summary = summarise(runs[1]!, SMALL);
    expect(summary).toMatchObject({ rules: 'now', seats: 4, kid: 'engaged' });
    expect(summary.evolves).not.toBeNull();
    const report = renderProgression(runs, { ...SMALL, seats: [4] }, { seconds: 1 });
    expect(report).toContain('## Milestones by day');
    expect(report).toContain('## now: 4-seat map');
  });

  it('works out what a Gap win pays from the curve', () => {
    // 20 XP × 3 guardians × level 16 × 1.5 for a win.
    expect(gapWin(22, 100, CURRENT_RULES)).toMatchObject({ base: 1440, xp: 1440, levels: 0 });
    expect(gapWin(22, 100, BASELINE_RULES).levels).toBeGreaterThan(1);
  });
});
