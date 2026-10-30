import { describe, expect, it } from 'vitest';
import { PATCH_ECONOMY_CONFIG as CONFIG } from './patch-economy-config.js';
import {
  awayWindow,
  buildIncome,
  buildPlan,
  formatWhatPays,
  levelDays,
  pausedWhilePlaying,
  playCoins,
  renderPatchEconomy,
  runKid,
  runPatchEconomy,
  upkeepPercent,
  warehouseTrip,
  warehouseTripRuns,
  whatPays,
  type PatchEconomyRun,
} from './patch-economy.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

const kid = (id: string) => {
  const k = CONFIG.kids.find((x) => x.id === id);
  if (!k) throw new Error(`no kid "${id}"`);
  return k;
};

describe('the patch economy model (#601)', () => {
  it("keeps every level's upkeep at about a fifth of its day's output sold (owner decision)", () => {
    const rows = levelDays();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.upkeepPercent, `${row.building} ${String(row.level)}`).toBeGreaterThanOrEqual(
        CONFIG.upkeepShare.min,
      );
      expect(row.upkeepPercent, `${row.building} ${String(row.level)}`).toBeLessThanOrEqual(
        CONFIG.upkeepShare.max,
      );
    }
  });

  it('builds every hut, raises them a level at a time, and saves for the Warehouse after level 3', () => {
    const plan = buildPlan(kid('engaged')).map((s) => `${s.building} ${String(s.level)}`);
    expect(plan.slice(0, 4)).toEqual([
      'woodcutters-hut 1',
      'stone-quarry 1',
      'greenhouse 1',
      'water-well 1',
    ]);
    expect(plan.indexOf('warehouse 1')).toBe(plan.indexOf('water-well 3') + 1);
    expect(buildPlan(kid('casual')).some((s) => s.building === 'warehouse')).toBe(false);
  });

  it('earns play Heart Coins under each daily cap', () => {
    expect(playCoins(kid('casual'))).toBeGreaterThan(0);
    expect(playCoins({ ...kid('engaged'), wins: { wild: 999, tile: 999 } })).toBeLessThanOrEqual(
      playCoins(kid('engaged')) + 20,
    );
  });
});

describe('runPatchEconomy guards (#601)', () => {
  const runs = runPatchEconomy(CONFIG, PROGRESSION_CONFIG);
  const daily = (id: string) => runs.filter((r) => r.kid === id && r.away.length === 0);
  const away = (r: PatchEconomyRun, days: readonly number[]) =>
    r.away.length === days.length && r.away.every((d, i) => d === days[i]);

  it('runs every kid on every map size, daily and away', () => {
    for (const seats of CONFIG.seats) {
      for (const k of CONFIG.kids) {
        expect(runs.some((r) => r.seats === seats && r.kid === k.id && r.away.length === 0)).toBe(
          true,
        );
      }
    }
    expect(renderPatchEconomy(runs, CONFIG, { seconds: 0 })).toContain('| 2 | casual |');
  });

  it('builds a first hut in time', () => {
    for (const run of runs) {
      expect(run.firstHutDay, `${String(run.seats)} ${run.kid}`).not.toBeNull();
      expect(run.firstHutDay).toBeLessThanOrEqual(CONFIG.firstHutByDay[run.kid] ?? 0);
    }
  });

  it('never lets a balance go negative', () => {
    for (const run of runs) for (const d of run.days) expect(d.balance).toBeGreaterThanOrEqual(0);
  });

  it('keeps a casual kid playing daily running, at no more than 60 % of their Heart Coins', () => {
    for (const run of daily('casual')) {
      expect(run.allHutsDay).not.toBeNull();
      expect(pausedWhilePlaying(run)).toBe(0);
      expect(upkeepPercent(run, run.allHutsDay ?? 0)).toBeLessThanOrEqual(
        CONFIG.casualUpkeepMaxPercent,
      );
    }
  });

  it('keeps an engaged kid running every hut and the Warehouse once they stand', () => {
    for (const run of daily('engaged')) {
      expect(run.warehouseDay).not.toBeNull();
      expect(pausedWhilePlaying(run, run.warehouseDay ?? 0)).toBe(0);
      expect(run.days.at(-1)?.pausedNow).toBe(0);
      expect(upkeepPercent(run, run.warehouseDay ?? 0)).toBeLessThanOrEqual(
        CONFIG.engagedUpkeepMaxPercent,
      );
    }
  });

  it('away three days: output waits in storage, no debt, and everything runs again on the way back', () => {
    for (const run of runs.filter((r) => away(r, CONFIG.awayDays))) {
      const home = runs.find(
        (r) => r.seats === run.seats && r.kid === run.kid && r.away.length === 0,
      );
      if (!home) throw new Error('no daily run');
      const window = awayWindow(run);
      const sum = (days: readonly { output: number }[]) => days.reduce((a, d) => a + d.output, 0);
      const same = home.days.filter((d) => window.some((w) => w.day === d.day));
      expect(sum(window)).toBeLessThan(sum(same));
      expect(window.at(-1)?.pausedNow).toBe(0);
    }
  });

  it('the Warehouse keeps level 3+ buildings delivering on a long trip', () => {
    for (const seats of CONFIG.seats) {
      const found = warehouseTripRuns(runs, CONFIG, seats);
      if (!found) throw new Error('no Warehouse runs');
      const { withIt, without } = found;
      const out = (r: PatchEconomyRun) => awayWindow(r).reduce((a, d) => a + d.output, 0);
      expect(out(withIt)).toBeGreaterThan(out(without));
    }
  });

  it("saves a month of the Warehouse's upkeep's worth of output, at sell price, on one long trip", () => {
    for (const seats of CONFIG.seats) {
      const found = warehouseTripRuns(runs, CONFIG, seats);
      if (!found) throw new Error('no Warehouse runs');
      const t = warehouseTrip(found.withIt, found.without, found.kid, CONFIG.days);
      expect(t.extraWorth, `${String(seats)} seats`).toBeGreaterThanOrEqual(t.upkeep);
    }
  });
});

describe('a kid who never sells (#601: pause and wake)', () => {
  // Play alone (no sales) can't pay for two huts every morning, so this run
  // must pause buildings and wake them again as play coins come in.
  const casual = kid('casual');
  const neverSell = [...casual.neverSell, ...['timber', 'stone', 'greens', 'water']];
  const income = buildIncome(CONFIG, PROGRESSION_CONFIG).get(`4/casual`) ?? [];
  const run = runKid({
    kid: { ...casual, neverSell, maxLevel: 1 },
    seats: 4,
    income,
    away: [],
    days: 20,
    useWarehouse: true,
  });

  it('pauses when short, never goes into debt, and wakes once the balance covers a morning', () => {
    const paused = run.days.reduce((a, d) => a + d.pausedMornings, 0);
    expect(paused).toBeGreaterThan(0);
    for (const d of run.days) expect(d.balance).toBeGreaterThanOrEqual(0);
    // Some day ends with fewer buildings asleep than the day before: one woke.
    const woke = run.days.some((d, i) => i > 0 && d.pausedNow < (run.days[i - 1]?.pausedNow ?? 0));
    expect(woke).toBe(true);
    // It still makes things between pauses.
    expect(run.days.slice(-5).some((d) => d.output > 0)).toBe(true);
  });
});

describe('what pays today (#736)', () => {
  const run = runPatchEconomy(CONFIG, PROGRESSION_CONFIG).find(
    (r) => r.kid === CONFIG.whatPays.kid && r.away.length === 0 && r.warehouse,
  )!;
  const shop = (items: { id: string; price: number; perWeek: number }[]) => ({
    ...CONFIG,
    whatPays: { ...CONFIG.whatPays, shop: items },
  });

  it('sums the last week against the day-30 balance', () => {
    const result = whatPays(run, CONFIG);
    const week = run.days.slice(-CONFIG.whatPays.weekDays);
    expect(result.day).toBe(CONFIG.days);
    expect(result.balance).toBe(run.days.at(-1)!.balance);
    expect(result.earned).toBe(week.reduce((a, d) => a + d.played + d.sold, 0));
    expect(result.upkeep).toBe(week.reduce((a, d) => a + d.upkeep, 0));
  });

  it('fails (softly) while upkeep is the only thing Heart Coins buy', () => {
    const result = whatPays(run, CONFIG);
    expect(result).toMatchObject({ buyable: 0, canSpend: 0, percent: 0, pass: false });
    expect(formatWhatPays(result, run, CONFIG)).toContain('soft until #729');
  });

  it('passes once the week offers enough to buy, up to the balance', () => {
    const rich = whatPays(
      run,
      shop([
        { id: 'lure', price: 120, perWeek: 2 },
        { id: 'kit', price: 50, perWeek: 7 },
      ]),
    );
    expect(rich.buyable).toBe(590);
    expect(rich.canSpend).toBe(Math.min(590, rich.balance));
    expect(rich.pass).toBe(rich.percent >= CONFIG.whatPays.minSpendPercent);
    const cheap = whatPays(run, shop([{ id: 'pack', price: 1, perWeek: 1 }]));
    expect(cheap).toMatchObject({ buyable: 1, canSpend: 1, pass: false });
  });
});
