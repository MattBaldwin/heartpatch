import { describe, expect, it } from 'vitest';
import { WEATHER_RULES } from '../../src/data/weather.js';
import { PROGRESSION_CONFIG } from './progression-config.js';
import { WILD_ISLE_CONFIG as CONFIG } from './wild-isle-config.js';
import {
  renderWildIsle,
  runWildIsle,
  stormCostPercent,
  stormPair,
  wildIsland,
  wildPlan,
  worksLevelDays,
  worksUpkeepPercent,
} from './wild-isle.js';

const kid = (id: string) => {
  const k = CONFIG.kids.find((x) => x.id === id);
  if (!k) throw new Error(`no kid "${id}"`);
  return k;
};

describe('the Wild Isle economy model (#621 W1-8)', () => {
  const island = wildIsland(CONFIG);

  it('finds every works a homestead with its water, and plans a month of weather', () => {
    for (const id of CONFIG.kids.flatMap((k) => k.works))
      expect(island.sites.has(id), id).toBe(true);
    expect(island.fronts.length).toBeGreaterThan(0);
    // Lakes give no flood bonus: only the sea and rivers flood a storm.
    expect(WEATHER_RULES.effects.storm.nearWater).not.toContain('lake');
  });

  it("keeps every works level's upkeep at about a fifth of its day's output sold", () => {
    const rows = worksLevelDays(island, CONFIG.days);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const at = `${row.building} ${String(row.level)}`;
      expect(row.upkeepPercent, at).toBeGreaterThanOrEqual(CONFIG.upkeepShare.min);
      expect(row.upkeepPercent, at).toBeLessThanOrEqual(CONFIG.upkeepShare.max);
    }
  });

  it('builds each works, then raises them a level at a time', () => {
    const plan = wildPlan(kid('engaged')).map((s) => `${s.building} ${String(s.level)}`);
    expect(plan.slice(0, 2)).toEqual(['river-well 1', 'fishing-pier 1']);
    expect(plan.at(-1)).toBe('salt-pans 4');
  });
});

describe('runWildIsle guards (#621 W1-8)', () => {
  const runs = runWildIsle(CONFIG, PROGRESSION_CONFIG);
  const daily = (id: string) => runs.filter((r) => r.kid === id && r.away.length === 0);

  it('runs every kid daily and away, with storms and without', () => {
    for (const k of CONFIG.kids) {
      for (const storms of [true, false]) {
        expect(runs.filter((r) => r.kid === k.id && r.storms === storms)).toHaveLength(2);
      }
    }
    expect(renderWildIsle(runs, CONFIG, { seconds: 0 })).toContain('| casual |');
  });

  it("builds a casual kid's first Fishing Pier in time", () => {
    for (const run of daily('casual')) {
      expect(run.builtDay['fishing-pier'] ?? Infinity).toBeLessThanOrEqual(CONFIG.firstPierByDay);
    }
  });

  it("builds an engaged kid's River Well in time", () => {
    for (const run of daily('engaged')) {
      expect(run.builtDay['river-well'] ?? Infinity).toBeLessThanOrEqual(CONFIG.riverWellByDay);
    }
  });

  it('keeps works upkeep at 15–25 % of what the output sells for, playing daily', () => {
    for (const run of runs.filter((r) => r.away.length === 0)) {
      const percent = worksUpkeepPercent(run);
      expect(percent, `${run.kid} ${String(run.storms)}`).toBeGreaterThanOrEqual(
        CONFIG.upkeepShare.min,
      );
      expect(percent, `${run.kid} ${String(run.storms)}`).toBeLessThanOrEqual(
        CONFIG.upkeepShare.max,
      );
    }
  });

  it('never lets a balance go negative', () => {
    for (const run of runs) for (const d of run.days) expect(d.balance).toBeGreaterThanOrEqual(0);
  });

  it("lets storms cost an engaged kid at most a tenth of a week's output", () => {
    for (const away of [false, true]) {
      const { stormy, calm } = stormPair(runs, 'engaged', away);
      expect(stormy.days.reduce((a, d) => a + d.knocks, 0)).toBeGreaterThan(0);
      expect(stormCostPercent(stormy, calm)).toBeLessThanOrEqual(CONFIG.stormMaxPercent);
    }
  });
});
