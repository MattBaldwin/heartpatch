import { describe, expect, it } from 'vitest';
import { PATCH_ECONOMY_CONFIG as CONFIG, shopWeek } from './patch-economy-config.js';
import { HEART_COIN_RULES } from '../../src/data/heart-coins.js';
import { POST_SHOP } from '../../src/data/post-shop.js';
import { COMPUTER_MATES } from '../../src/data/server/computer-mates.js';
import { TRADE_VALUES } from '../../src/data/trading.js';
import {
  awayWindow,
  buildIncome,
  buildPlan,
  formatLuresAffordable,
  formatWhatPays,
  levelDays,
  lureSlots,
  luresAffordable,
  pausedWhilePlaying,
  FRIENDLY_WIN_UNTIL_728B,
  PAID_FRIENDLY_WINS_PER_PAIR,
  playCoins,
  renderPatchEconomy,
  runKid,
  runPatchEconomy,
  soloGates,
  soloKid,
  mateGiftsOn,
  mateGiftStack,
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
    const flood = { wild: 999, tile: 999, defence: 999, friendly: 999 };
    expect(playCoins({ ...kid('engaged'), wins: flood })).toBeLessThanOrEqual(
      playCoins(kid('engaged')) + 20,
    );
  });

  it('pays defences and friendlies under the battle cap (#728)', () => {
    const none = { wild: 0, tile: 0, defence: 0, friendly: 0 };
    const only = (wins: Partial<typeof none>) =>
      playCoins({ ...kid('casual'), wins: { ...none, ...wins } }) -
      playCoins({ ...kid('casual'), wins: none });
    expect(only({ defence: 1 })).toBe(HEART_COIN_RULES.defenseWin['rival-tile']);
    expect(only({ friendly: 1 })).toBe(FRIENDLY_WIN_UNTIL_728B);
    // At most three paid friendly wins over one patch-mate a day.
    expect(only({ friendly: 10 })).toBe(PAID_FRIENDLY_WINS_PER_PAIR * FRIENDLY_WIN_UNTIL_728B);
    expect(only({ defence: 99 })).toBe(HEART_COIN_RULES.dailyCaps.battle);
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

  it('a solo kid with computer mates ends day 30 within the gate of their 4-seat row (#386d)', () => {
    const gates = soloGates(runs, CONFIG);
    expect(gates.map((g) => g.kid)).toEqual(CONFIG.kids.map((k) => k.id));
    for (const g of gates) {
      expect(g.pass, `${g.kid}: ${String(g.percent)} %`).toBe(true);
      // Mates lift a solo kid, never past the gate.
      expect(g.mates).toBeGreaterThanOrEqual(g.solo);
    }
    expect(renderPatchEconomy(runs, CONFIG, { seconds: 0 })).toContain('solo + computer mates');
  });

  it('solo rows: no friendlies or defences alone; with mates, capped friendlies, defences and gifts', () => {
    const engaged = CONFIG.kids.find((k) => k.id === 'engaged')!;
    expect(soloKid(engaged, 'plain', 1).wins).toMatchObject({ friendly: 0, defence: 0 });
    const week = [1, 2, 3, 4, 5, 6, 7];
    const defences = week.reduce((a, d) => a + soloKid(engaged, 'mates', d).wins.defence, 0);
    expect(defences).toBeLessThanOrEqual(COMPUTER_MATES.rules.challengesPerPatchWeek.on);
    expect(week.reduce((a, d) => a + mateGiftsOn(d), 0)).toBe(
      COMPUTER_MATES.rules.giftsPerPatchWeek,
    );
    const gift = mateGiftStack();
    expect((TRADE_VALUES.items[gift.itemId] ?? 0) * gift.quantity).toBeLessThanOrEqual(
      COMPUTER_MATES.rules.giftMaxValue,
    );
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

  it('reads the Post shop at its caps: a day cap is 7 a week, a week cap its count (#729)', () => {
    expect(CONFIG.whatPays.weekDays).toBe(7);
    expect(CONFIG.whatPays.shop).toEqual(shopWeek(POST_SHOP, 7));
    for (const item of POST_SHOP) {
      const row = CONFIG.whatPays.shop.find((r) => r.id === item.id);
      expect(row?.price).toBe(item.price);
      expect(row?.perWeek).toBe(item.cap.per === 'day' ? item.cap.count * 7 : item.cap.count);
    }
  });

  it("is a hard gate: the casual kid can spend half a week's earnings at the shop (#729)", () => {
    const result = whatPays(run, CONFIG);
    expect(result.buyable).toBe(
      POST_SHOP.reduce((a, i) => a + i.price * (i.cap.per === 'day' ? 7 : 1) * i.cap.count, 0),
    );
    expect(result.pass).toBe(true);
    const line = formatWhatPays(result, run, CONFIG);
    expect(line).toContain(': PASS');
    expect(line).not.toContain('soft');
  });

  it('names the data lever when it fails', () => {
    const empty = shop([]);
    const result = whatPays(run, empty);
    expect(result).toMatchObject({ buyable: 0, canSpend: 0, percent: 0, pass: false });
    expect(formatWhatPays(result, run, empty)).toContain('FAIL (lever: Post shop prices and caps');
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

describe('lures affordable (#729 plan §8)', () => {
  const income = buildIncome(CONFIG, PROGRESSION_CONFIG);
  const lures = luresAffordable(CONFIG, income);

  it('counts rolling-week slots, one a day', () => {
    // Days 10–30 at 2 in any 7: 10, 11, 17, 18, 24, 25.
    expect(lureSlots(10, 30, 2, 7)).toBe(6);
    expect(lureSlots(10, 30, 1, 7)).toBe(3);
    expect(lureSlots(1, 7, 7, 7)).toBe(7);
  });

  it('the casual kid buys two a week and the engaged kid one, with no paused morning', () => {
    expect(lures.map((l) => [l.result.kid, l.result.perWeek])).toEqual([
      ['casual', 2],
      ['engaged', 1],
    ]);
    for (const { result } of lures) {
      expect(result.bought).toBe(result.wanted);
      expect(result.paused).toBe(0);
      expect(result.pass).toBe(true);
      expect(formatLuresAffordable(result, CONFIG)).toContain(': PASS');
    }
  });

  it('spends the Lure price from the balance and nothing before day 10', () => {
    const lure = POST_SHOP.find((i) => i.id === 'rare-lure')!;
    const plain = runPatchEconomy(CONFIG, PROGRESSION_CONFIG, income);
    for (const { result, run } of lures) {
      const base = plain.find(
        (r) => r.kid === result.kid && r.seats === CONFIG.seats[0] && r.away.length === 0,
      )!;
      expect(result.spent).toBe(result.bought * lure.price);
      expect(run.days.filter((d) => d.day < 10).every((d) => d.shop === 0)).toBe(true);
      expect(run.days.every((d) => d.shop === 0 || d.shop === lure.price)).toBe(true);
      // Nothing else changes, so day 30 is the plain run less what the Lures cost.
      expect(result.balance).toBe(base.days.at(-1)!.balance - result.spent);
    }
  });

  it('reports both lines under "what pays today"', () => {
    const md = renderPatchEconomy([], CONFIG, { seconds: 0, lures: lures.map((l) => l.result) });
    expect(md).toContain('rare-lure ×2 a week (4 seats casual, from day 10)');
    expect(md).toContain('rare-lure ×1 a week (4 seats engaged, from day 10)');
  });

  it('fails, naming the lever, when the Lure costs more than the kid can keep up with', () => {
    const pricey = {
      ...CONFIG,
      whatPays: {
        ...CONFIG.whatPays,
        shop: CONFIG.whatPays.shop.map((i) => (i.id === 'rare-lure' ? { ...i, price: 1000 } : i)),
      },
    };
    const casual = luresAffordable(pricey, income).find((l) => l.result.kid === 'casual')!;
    expect(casual.result.pass).toBe(false);
    expect(formatLuresAffordable(casual.result, pricey)).toContain('FAIL (lever:');
  });
});
