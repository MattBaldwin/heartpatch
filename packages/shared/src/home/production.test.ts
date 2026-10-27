import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { HOLLOW_RULES } from '../data/hollow.js';
import { JOB_RULES } from '../data/jobs.js';
import { RESOURCE_BUILDING_RULES } from '../data/resource-buildings.js';
import { RESOURCES } from '../data/resources.js';
import { WEATHER_RULES } from '../data/weather.js';
import type { ResourceBuilding, WorksBuilding } from '../schemas/data/buildings.js';
import type { CoverWindow } from '../weather/plan.js';
import {
  latestMorning,
  planResume,
  planUpkeep,
  productionCycleSeconds,
  productionFullAtMs,
  productionProgress,
  productionSource,
  productionYield,
  resumeSinceMs,
  storageCycles,
  suitsLand,
  tileLand,
  upkeepMornings,
  upkeepOrder,
  warehouseDelivers,
  warehouseWindows,
  deliveredProgress,
  deliveringAt,
  eatenBy,
  eatsCap,
  followsWeather,
  pacedProgress,
  worksPace,
  worksShort,
  worksSource,
  worksWeatherAt,
  type ProductionFacts,
  type UpkeepPlanEntry,
} from './production.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-10-20T12:00:00Z');
const MORNING = HOLLOW_RULES.morningMinute;

const hut = (id: string): ResourceBuilding => {
  const b = BUILDINGS.find((x) => x.id === id);
  if (b?.kind !== 'resource') throw new Error(`no resource building ${id}`);
  return b;
};
const level = (id: string, n: number) => {
  const l = hut(id).levels[n - 1];
  if (!l) throw new Error(`no level ${String(n)}`);
  return l;
};

describe('the land a resource building stands on (#601 Q1, Q2)', () => {
  it('is cleared land as what it was cleared from, else the terrain', () => {
    expect(tileLand({ terrain: 'clearing', clearedFrom: 'old-forest' })).toBe('old-forest');
    expect(tileLand({ terrain: 'clearing', clearedFrom: null })).toBe('clearing');
    expect(tileLand({ terrain: 'meadow' })).toBe('meadow');
    // Only cleared land remembers: a stray `clearedFrom` on other land is ignored.
    expect(tileLand({ terrain: 'meadow', clearedFrom: 'forest' })).toBe('meadow');
  });

  it('suits the building of that land, and no other', () => {
    const woodcutter = hut('woodcutters-hut');
    expect(suitsLand(woodcutter, { terrain: 'forest', clearedFrom: null })).toBe(true);
    expect(suitsLand(woodcutter, { terrain: 'clearing', clearedFrom: 'forest' })).toBe(true);
    expect(suitsLand(woodcutter, { terrain: 'clearing', clearedFrom: 'old-forest' })).toBe(false);
    expect(suitsLand(hut('ember-kiln'), { terrain: 'clearing', clearedFrom: 'old-forest' })).toBe(
      true,
    );
    expect(suitsLand(woodcutter, { terrain: 'clearing', clearedFrom: null })).toBe(false);
    expect(suitsLand(woodcutter, null)).toBe(false);
  });
});

describe('what a resource building works (#601)', () => {
  it("is its terrain's land yield, with the homestead's +1 a cycle", () => {
    expect(productionSource(hut('woodcutters-hut'), JOB_RULES, EXPLORE_RULES)).toEqual({
      resource: 'timber',
      perCycle: 3,
      seconds: 15 * 60,
    });
    expect(productionSource(hut('ember-kiln'), JOB_RULES, EXPLORE_RULES)).toEqual({
      resource: 'emberwood',
      perCycle: 2,
      seconds: 30 * 60,
    });
    expect(productionSource({ terrain: 'juniper-gap' }, JOB_RULES, EXPLORE_RULES)).toBeNull();
  });

  it('runs at its pace of a plain squishy gatherer, and holds its hours of output', () => {
    // A squishy's forest cycle is 15 min × 200 % = 30 min; at 300 % it's 10.
    expect(productionCycleSeconds(15 * 60, level('woodcutters-hut', 1), JOB_RULES)).toBe(600);
    expect(productionCycleSeconds(15 * 60, level('woodcutters-hut', 2), JOB_RULES)).toBe(514);
    expect(productionCycleSeconds(15 * 60, level('woodcutters-hut', 3), JOB_RULES)).toBe(450);
    expect(productionCycleSeconds(1, { pacePercent: 1000 }, JOB_RULES)).toBe(1);
    // 24 hours of 10-minute cycles.
    expect(storageCycles(level('woodcutters-hut', 1), 600)).toBe(144);
    expect(storageCycles({ storageHours: 1 }, 7200)).toBe(1);
  });

  it('every level is faster than a squishy by 3–4× and holds far more than its 4 cycles', () => {
    for (const b of BUILDINGS) {
      if (b.kind !== 'resource') continue;
      for (const l of b.levels) {
        expect(l.pacePercent, b.id).toBeGreaterThanOrEqual(300);
        expect(l.pacePercent, b.id).toBeLessThanOrEqual(400);
        expect(l.storageHours, b.id).toBeGreaterThanOrEqual(24);
      }
    }
  });
});

describe('productionProgress (#601)', () => {
  const base = {
    sinceMs: T0,
    nowMs: T0,
    pausedAtMs: null,
    cycleSeconds: 600,
    maxCycles: 144,
    homesteadPause: null,
  };

  it('counts finished cycles, and a part-done one carries on', () => {
    const p = productionProgress({ ...base, nowMs: T0 + 25 * MIN }, JOB_RULES);
    expect(p).toMatchObject({ cycles: 2, full: false, nextReadyMs: T0 + 30 * MIN });
    expect(p.nextSinceMs).toBe(T0 + 20 * MIN);
    expect(p.finishedMs).toEqual([T0 + 10 * MIN, T0 + 20 * MIN]);
  });

  it('stops when full, and after the settle counts from the settle: time past full never pays', () => {
    const now = T0 + 30 * HOUR;
    const p = productionProgress({ ...base, nowMs: now }, JOB_RULES);
    expect(p).toMatchObject({ cycles: 144, full: true, nextReadyMs: null, nextSinceMs: now });
    expect(productionFullAtMs(base, JOB_RULES)).toBe(T0 + 24 * HOUR);
  });

  it('never fills while the Warehouse delivers for it', () => {
    const p = productionProgress({ ...base, maxCycles: null, nowMs: T0 + 48 * HOUR }, JOB_RULES);
    expect(p).toMatchObject({ cycles: 288, full: false });
    expect(productionFullAtMs({ ...base, maxCycles: null }, JOB_RULES)).toBeNull();
  });

  it('counts only up to an upkeep pause, and nothing more finishes until it wakes', () => {
    const p = productionProgress(
      { ...base, pausedAtMs: T0 + 35 * MIN, nowMs: T0 + 10 * HOUR },
      JOB_RULES,
    );
    expect(p).toMatchObject({ cycles: 3, full: false, nextReadyMs: null });
    // A pause before it started counts nothing.
    expect(
      productionProgress({ ...base, pausedAtMs: T0 - HOUR, nowMs: T0 + HOUR }, JOB_RULES).cycles,
    ).toBe(0);
  });

  it('carries a part-done cycle across an upkeep pause, so nothing is lost', () => {
    const pausedAtMs = T0 + 35 * MIN;
    const banked = productionProgress({ ...base, pausedAtMs, nowMs: T0 + 5 * HOUR }, JOB_RULES);
    expect(banked.nextSinceMs).toBe(T0 + 30 * MIN);
    // Five minutes into its fourth cycle when it paused: five minutes after waking it finishes.
    const wake = T0 + 9 * HOUR;
    const since = resumeSinceMs(banked.nextSinceMs, pausedAtMs, wake, null);
    expect(since).toBe(wake - 5 * MIN);
    expect(
      productionProgress({ ...base, sinceMs: since, nowMs: wake + 5 * MIN }, JOB_RULES).cycles,
    ).toBe(1);
    // A building banked at the pause itself starts afresh.
    expect(resumeSinceMs(pausedAtMs, pausedAtMs, wake, null)).toBe(wake);
  });

  it("never counts a cut-off homestead's stretch inside the part-done cycle", () => {
    // Settled at T0, cut off from 3 minutes in until 5 minutes before the
    // upkeep pause: 8 minutes of work done when it paused.
    const cutOff = { fromMs: T0 + 3 * MIN, toMs: T0 + 20 * HOUR };
    const pausedAtMs = T0 + 20 * HOUR + 5 * MIN;
    const banked = productionProgress(
      { ...base, pausedAtMs, homesteadPause: cutOff, nowMs: T0 + 21 * HOUR },
      JOB_RULES,
    );
    expect(banked).toMatchObject({ cycles: 0, nextSinceMs: T0 });
    const wake = T0 + 22 * HOUR;
    const since = resumeSinceMs(banked.nextSinceMs, pausedAtMs, wake, cutOff);
    expect(since).toBe(wake - 8 * MIN);
    // 30 minutes after waking: 38 minutes of work, three 10-minute cycles.
    expect(
      productionProgress({ ...base, sinceMs: since, nowMs: wake + 30 * MIN }, JOB_RULES).cycles,
    ).toBe(3);
    // A cut-off still going at the pause counts up to the pause only.
    const open = { fromMs: T0 + 3 * MIN, toMs: null };
    expect(resumeSinceMs(T0, T0 + 9 * MIN, wake, open)).toBe(wake - 3 * MIN);
  });

  it("leaves a cut-off homestead's pause out", () => {
    const pause = { fromMs: T0 + 15 * MIN, toMs: T0 + 2 * HOUR + 15 * MIN };
    const p = productionProgress(
      { ...base, homesteadPause: pause, nowMs: T0 + 2 * HOUR + 30 * MIN },
      JOB_RULES,
    );
    // 15 minutes before the pause and 15 after: three cycles.
    expect(p.cycles).toBe(3);
    expect(p.finishedMs).toEqual([
      T0 + 10 * MIN,
      T0 + 2 * HOUR + 20 * MIN,
      T0 + 2 * HOUR + 30 * MIN,
    ]);
  });

  it('judges each cycle by its season: a Pumpkin Barn after Halloween makes nothing', () => {
    const source = productionSource(hut('pumpkin-barn'), JOB_RULES, EXPLORE_RULES);
    if (!source) throw new Error('no pumpkin yield');
    const halloweenEnds = T0 + HOUR;
    const seasonsAt = (ms: number) => new Set(ms < halloweenEnds ? ['halloween'] : []);
    const finished = [T0 + 20 * MIN, T0 + 40 * MIN, T0 + 80 * MIN];
    // Two in season: 2 Pumpkins each (1 + the homestead's 1) and their Witch Dust.
    expect(productionYield(source, finished, RESOURCES, seasonsAt)).toEqual({
      pumpkins: 4,
      'witch-dust': 2,
    });
  });
});

describe('warehouseDelivers (#601)', () => {
  const from = RESOURCE_BUILDING_RULES.warehouseDeliversFromLevel;
  const standing = { paused: false, cutOff: false };

  it('delivers for level 3 and up only, while it stands, is paid and is joined', () => {
    expect(warehouseDelivers(from, standing, RESOURCE_BUILDING_RULES)).toBe(true);
    expect(warehouseDelivers(from + 1, standing, RESOURCE_BUILDING_RULES)).toBe(true);
    expect(warehouseDelivers(from - 1, standing, RESOURCE_BUILDING_RULES)).toBe(false);
    expect(warehouseDelivers(from, null, RESOURCE_BUILDING_RULES)).toBe(false);
    expect(warehouseDelivers(from, { ...standing, paused: true }, RESOURCE_BUILDING_RULES)).toBe(
      false,
    );
    expect(warehouseDelivers(from, { ...standing, cutOff: true }, RESOURCE_BUILDING_RULES)).toBe(
      false,
    );
  });
});

describe('warehouseWindows (#601 PR 8)', () => {
  it('delivers from when it was placed until it paused, less a cut-off homestead', () => {
    const placed = { placedAtMs: T0, pausedAtMs: null, homesteadPause: null };
    expect(warehouseWindows(placed)).toEqual([{ fromMs: T0, toMs: null }]);
    expect(warehouseWindows({ ...placed, pausedAtMs: T0 + HOUR })).toEqual([
      { fromMs: T0, toMs: T0 + HOUR },
    ]);
    // Cut off and joined again: two stretches.
    const cut = { fromMs: T0 + HOUR, toMs: T0 + 3 * HOUR };
    expect(warehouseWindows({ ...placed, homesteadPause: cut })).toEqual([
      { fromMs: T0, toMs: T0 + HOUR },
      { fromMs: T0 + 3 * HOUR, toMs: null },
    ]);
    // Still cut off: only before it.
    expect(warehouseWindows({ ...placed, homesteadPause: { ...cut, toMs: null } })).toEqual([
      { fromMs: T0, toMs: T0 + HOUR },
    ]);
    // A cut-off from before it stood changes nothing; a pause before the cut-off ends it.
    expect(
      warehouseWindows({ ...placed, homesteadPause: { fromMs: T0 - 2 * HOUR, toMs: T0 - HOUR } }),
    ).toEqual([{ fromMs: T0, toMs: null }]);
    expect(warehouseWindows({ ...placed, pausedAtMs: T0 + 30 * MIN, homesteadPause: cut })).toEqual(
      [{ fromMs: T0, toMs: T0 + 30 * MIN }],
    );
    expect(deliveringAt([{ fromMs: T0, toMs: T0 + HOUR }], T0 + HOUR)).toBe(false);
    expect(deliveringAt([{ fromMs: T0, toMs: T0 + HOUR }], T0)).toBe(true);
  });
});

describe('deliveredProgress (#601 PR 8)', () => {
  // 10-minute cycles, 6 of them stored (an hour).
  const base = {
    sinceMs: T0,
    nowMs: T0 + 3 * HOUR,
    pausedAtMs: null,
    cycleSeconds: 600,
    maxCycles: 6,
    homesteadPause: null,
  };

  it('is productionProgress without a Warehouse', () => {
    expect(deliveredProgress(base, [], JOB_RULES)).toEqual(productionProgress(base, JOB_RULES));
  });

  it('never fills while the Warehouse delivers', () => {
    const p = deliveredProgress(base, [{ fromMs: T0 - HOUR, toMs: null }], JOB_RULES);
    expect(p).toMatchObject({ cycles: 18, full: false, nextReadyMs: T0 + 3 * HOUR + 10 * MIN });
  });

  it('caps from the instant it stops delivering, starting empty', () => {
    // Delivered for 1 h 25 min: 8 cycles, the part-done one carried on. Then
    // capped at 6 from there: full long before now, so it waits.
    const stop = T0 + HOUR + 25 * MIN;
    const p = deliveredProgress(base, [{ fromMs: T0 - HOUR, toMs: stop }], JOB_RULES);
    expect(p.cycles).toBe(8 + 6);
    expect(p).toMatchObject({ full: true, nextReadyMs: null, nextSinceMs: base.nowMs });
    expect(p.finishedMs.slice(7, 9)).toEqual([T0 + 80 * MIN, T0 + 90 * MIN]);
  });

  it('uncaps from when it was built: what was full stays, then it all comes', () => {
    // Full (6) an hour in; built at 2 h: time past full never pays, then an hour delivered.
    const p = deliveredProgress(base, [{ fromMs: T0 + 2 * HOUR, toMs: null }], JOB_RULES);
    expect(p).toMatchObject({ cycles: 6 + 6, full: false });
    expect(p.finishedMs.at(-1)).toBe(T0 + 3 * HOUR);
  });

  it('still stops at an upkeep pause of its own', () => {
    const p = deliveredProgress(
      { ...base, pausedAtMs: T0 + 30 * MIN },
      [{ fromMs: T0 - HOUR, toMs: null }],
      JOB_RULES,
    );
    expect(p).toMatchObject({ cycles: 3, nextReadyMs: null });
  });
});

describe('upkeep mornings (#601)', () => {
  const at = (date: string, minute: number) => ({ date, minute });

  it('owes from the first morning after it was placed', () => {
    expect(latestMorning(at('2026-10-20', MORNING), MORNING)).toBe('2026-10-20');
    expect(latestMorning(at('2026-10-20', MORNING - 1), MORNING)).toBe('2026-10-19');
    // Placed at 5 AM: owes 6 AM that day. Placed at noon: the next morning.
    expect(
      upkeepMornings(
        { placed: at('2026-10-20', 5 * 60), settledThrough: null, now: at('2026-10-20', 7 * 60) },
        MORNING,
      ),
    ).toEqual(['2026-10-20']);
    expect(
      upkeepMornings(
        { placed: at('2026-10-20', 12 * 60), settledThrough: null, now: at('2026-10-21', 5 * 60) },
        MORNING,
      ),
    ).toEqual([]);
  });

  it('owes every morning after the last one paid, across a month end and a clock change', () => {
    // US clocks go back on 2026-11-01: map-local dates never skip or repeat a morning.
    expect(
      upkeepMornings(
        {
          placed: at('2026-10-01', 9 * 60),
          settledThrough: '2026-10-30',
          now: at('2026-11-02', 6 * 60),
        },
        MORNING,
      ),
    ).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(
      upkeepMornings(
        {
          placed: at('2026-10-01', 9 * 60),
          settledThrough: '2026-11-02',
          now: at('2026-11-02', 23 * 60),
        },
        MORNING,
      ),
    ).toEqual([]);
  });
});

describe('upkeepOrder (#601, owner decision Q5)', () => {
  const entry = (id: string, level: number, placedAtMs: number, rank: number | null = null) => ({
    id,
    kind: 'resource' as const,
    level,
    upkeep: 6,
    placedAtMs,
    rank,
  });
  const warehouse = { ...entry('w', 1, 0), kind: 'warehouse' as const };

  it('defaults to the highest level, then the oldest, the Warehouse last', () => {
    const order = upkeepOrder([warehouse, entry('a', 1, 1), entry('b', 3, 5), entry('c', 3, 2)]);
    expect(order.map((e) => e.id)).toEqual(['c', 'b', 'a', 'w']);
  });

  it("puts the kid's own order first, then the rest by default", () => {
    const order = upkeepOrder([
      entry('a', 4, 1),
      { ...warehouse, rank: 0 },
      entry('b', 1, 5, 1),
      entry('c', 2, 2),
    ]);
    expect(order.map((e) => e.id)).toEqual(['w', 'b', 'a', 'c']);
  });
});

describe('planUpkeep (#601, owner decisions Q4–Q6)', () => {
  const hutEntry = (
    id: string,
    upkeep: number,
    mornings: string[],
    extra: Partial<UpkeepPlanEntry> = {},
  ): UpkeepPlanEntry => ({
    id,
    kind: 'resource',
    level: 1,
    upkeep,
    placedAtMs: 0,
    rank: null,
    paused: false,
    mornings,
    canWork: () => true,
    ...extra,
  });

  it('pays down the order and pauses the ones the balance can’t cover, with no debt', () => {
    const day = ['2026-10-20'];
    const plan = planUpkeep(10, [
      hutEntry('a', 6, day),
      hutEntry('b', 6, day),
      hutEntry('c', 4, day),
    ]);
    expect(plan.steps).toEqual([
      { kind: 'paid', id: 'a', day: '2026-10-20', coins: 6 },
      { kind: 'paused', id: 'b', day: '2026-10-20' },
      // A later one the balance still covers keeps running.
      { kind: 'paid', id: 'c', day: '2026-10-20', coins: 4 },
    ]);
    expect(plan.balance).toBe(0);
  });

  it('charges missed mornings in date order; a paused one owes nothing after', () => {
    const days = ['2026-10-20', '2026-10-21', '2026-10-22'];
    const plan = planUpkeep(11, [hutEntry('a', 5, days), hutEntry('b', 2, days)]);
    expect(plan.steps.map((s) => `${s.day.slice(8)} ${s.id} ${s.kind}`)).toEqual([
      '20 a paid',
      '20 b paid',
      '21 a paused',
      '21 b paid',
      '22 a skipped',
      '22 b paid',
    ]);
    expect(plan.balance).toBe(0);
  });

  it("skips a building that can't work that morning, or is paused already", () => {
    const day = ['2026-10-20'];
    const plan = planUpkeep(100, [
      hutEntry('napping', 5, day, { canWork: () => false }),
      hutEntry('paused', 5, day, { paused: true }),
    ]);
    expect(plan.steps.map((s) => s.kind)).toEqual(['skipped', 'skipped']);
    expect(plan.balance).toBe(100);
  });

  it('wakes paused buildings for free, in order, while the balance covers each a morning', () => {
    const paused = [
      { id: 'a', upkeep: 6 },
      { id: 'b', upkeep: 6 },
      { id: 'c', upkeep: 3 },
    ];
    expect(planResume(10, paused).map((e) => e.id)).toEqual(['a', 'c']);
    expect(planResume(5, paused).map((e) => e.id)).toEqual(['c']);
    expect(planResume(0, paused)).toEqual([]);
  });
});

describe('Wild Isle works (#621 W1-8)', () => {
  const works = (id: string): WorksBuilding => {
    const b = BUILDINGS.find((x) => x.id === id);
    if (b?.kind !== 'works') throw new Error(`no works ${id}`);
    return b;
  };
  const cover = (
    kind: CoverWindow['kind'],
    fromMs: number,
    toMs: number,
    frontId = `${kind}-1`,
  ): CoverWindow => ({ frontId, kind, fromMs, toMs });
  // A 10-minute cycle at 100 % (the pace windows multiply it).
  const facts = (over: Partial<ProductionFacts> = {}): ProductionFacts => ({
    sinceMs: T0,
    nowMs: T0 + 2 * HOUR,
    pausedAtMs: null,
    cycleSeconds: 600,
    maxCycles: null,
    homesteadPause: null,
    ...over,
  });

  it("makes its own `makes` a cycle, with no homestead +1 (the River Well keeps level with Cozy's well)", () => {
    expect(worksSource(works('watermill'))).toEqual({
      resource: 'flour',
      perCycle: 1,
      seconds: 15 * 60,
    });
    const cozy = productionSource(hut('water-well'), JOB_RULES, EXPLORE_RULES);
    expect(worksSource(works('river-well'))).toEqual(cozy);
  });

  it('is productionProgress itself with no weather to follow', () => {
    const f = facts({ nowMs: T0 + 95 * MIN, maxCycles: 4 });
    expect(pacedProgress(f, { basePercent: 100, windows: [] })).toEqual(
      productionProgress(f, JOB_RULES),
    );
    const paused = facts({ pausedAtMs: T0 + 25 * MIN });
    expect(pacedProgress(paused, { basePercent: 100, windows: [] })).toEqual(
      productionProgress(paused, JOB_RULES),
    );
    const cut = facts({ homesteadPause: { fromMs: T0 + 15 * MIN, toMs: T0 + 45 * MIN } });
    expect(pacedProgress(cut, { basePercent: 100, windows: [] })).toEqual(
      productionProgress(cut, JOB_RULES),
    );
  });

  it('fishes half again as fast while fog covers the pier (the weather’s pierPercent)', () => {
    const pier = works('fishing-pier');
    expect(pier.weather).toEqual(WEATHER_RULES.effects.pierPercent);
    // Fog for the first hour: 150 % there, 100 % after.
    const pace = worksPace(pier, [cover('fog', T0, T0 + HOUR)]);
    expect(pace).toEqual({
      basePercent: 100,
      windows: [{ fromMs: T0, toMs: T0 + HOUR, percent: 150 }],
    });
    const p = pacedProgress(facts(), pace);
    // 9 cycles in the foggy hour (6 × 1.5), then 6 more in the clear one.
    expect(p.cycles).toBe(15);
    expect(p.finishedMs[0]).toBe(T0 + 400_000);
    expect(p.finishedMs[8]).toBe(T0 + HOUR);
    expect(p.finishedMs[9]).toBe(T0 + HOUR + 10 * MIN);
    // Rain doesn't help the pier: only the kinds it lists change its pace.
    expect(worksPace(pier, [cover('rain', T0, T0 + HOUR)]).windows).toEqual([]);
  });

  it('grows a field slower in a dry spell and faster in the rain; a storm over the rain counts as the storm', () => {
    const field = works('irrigated-field');
    const dry = worksPace(field, [cover('drought', T0, T0 + 2 * HOUR)]);
    expect(pacedProgress(facts(), dry).cycles).toBe(6); // 12 at 100 %
    const wet = worksPace(field, [cover('rain', T0, T0 + 2 * HOUR)]);
    expect(pacedProgress(facts(), wet).cycles).toBe(18);
    // Storm over rain for the first hour: the storm sets the pace (100 %), like `weatherAt`.
    const mixed = worksPace(field, [
      cover('rain', T0, T0 + 2 * HOUR),
      cover('storm', T0, T0 + HOUR, 'storm-1'),
    ]);
    expect(mixed.windows).toEqual([{ fromMs: T0 + HOUR, toMs: T0 + 2 * HOUR, percent: 150 }]);
    // A part-done cycle carries across a change of pace: 35 minutes of rain
    // are 5¼ cycles of work, and the rest of the 6th takes 7½ minutes at 100 %.
    const short = worksPace(field, [cover('rain', T0, T0 + 35 * MIN)]);
    const p = pacedProgress(facts({ nowMs: T0 + 40 * MIN }), short);
    expect(p.cycles).toBe(5);
    expect(p.nextSinceMs).toBe(T0 + 2_000_000);
    expect(p.nextReadyMs).toBe(T0 + 35 * MIN + 7.5 * MIN);
  });

  it('fills a rain barrel only while rain covers it, never between', () => {
    const barrel = works('rain-barrel');
    expect(worksPace(barrel, [])).toEqual({ basePercent: 0, windows: [] });
    const none = pacedProgress(facts(), worksPace(barrel, []));
    expect(none).toMatchObject({ cycles: 0, nextReadyMs: null, nextSinceMs: T0 });
    // Fog and drought make no water; 20 minutes of rain make two cycles.
    const pace = worksPace(barrel, [
      cover('fog', T0, T0 + 30 * MIN),
      cover('rain', T0 + HOUR, T0 + HOUR + 20 * MIN),
      cover('drought', T0 + HOUR + 30 * MIN, T0 + 2 * HOUR),
    ]);
    expect(pace.windows).toEqual([{ fromMs: T0 + HOUR, toMs: T0 + HOUR + 20 * MIN, percent: 100 }]);
    const p = pacedProgress(facts(), pace);
    expect(p.finishedMs).toEqual([T0 + HOUR + 10 * MIN, T0 + HOUR + 20 * MIN]);
    expect(p.nextReadyMs).toBeNull(); // no more rain in the plan
  });

  it('ignores the weather when weatherproof', () => {
    const field = { ...works('irrigated-field'), weatherproof: true as const };
    expect(followsWeather(field)).toBe(false);
    expect(worksPace(field, [cover('drought', T0, T0 + 2 * HOUR)])).toEqual({
      basePercent: 100,
      windows: [],
    });
    expect(followsWeather(works('salt-pans'))).toBe(false);
    expect(followsWeather(works('fishing-pier'))).toBe(true);
  });

  it('stops at full storage, at an upkeep pause or a knock, and while cut off, as productionProgress does', () => {
    const pace = worksPace(works('fishing-pier'), [cover('fog', T0, T0 + 2 * HOUR)]);
    const full = pacedProgress(facts({ maxCycles: 4 }), pace);
    expect(full).toMatchObject({
      cycles: 4,
      full: true,
      nextReadyMs: null,
      nextSinceMs: T0 + 2 * HOUR,
    });
    const knocked = pacedProgress(facts({ pausedAtMs: T0 + 30 * MIN }), pace);
    expect(knocked).toMatchObject({ cycles: 4, nextReadyMs: null, nextSinceMs: T0 + 1_600_000 });
    // Cut off for the second hour: only the first hour's 9 count.
    const cut = pacedProgress(facts({ homesteadPause: { fromMs: T0 + HOUR, toMs: null } }), pace);
    expect(cut).toMatchObject({ cycles: 9, nextReadyMs: null });
  });

  it('caps a Watermill at what the bag pays for, and says what that eats', () => {
    const mill = works('watermill');
    expect(eatsCap(mill.eats, { greens: 7 })).toBe(3);
    expect(eatsCap(mill.eats, {})).toBe(0);
    expect(eatsCap(undefined, {})).toBe(Infinity);
    expect(eatsCap({ greens: 2, water: 1 }, { greens: 20, water: 4 })).toBe(4);
    expect(eatenBy(mill.eats, 3)).toEqual({ greens: 6 });
    expect(eatenBy(mill.eats, 0)).toEqual({});
  });

  describe('the works tile card’s weather chip and need line (#621 W1-10c)', () => {
    it('says faster, slower or the same as a clear day, from the pace over its tile now', () => {
      const pier = works('fishing-pier');
      const fog = worksPace(pier, [cover('fog', T0, T0 + HOUR)]);
      expect(worksWeatherAt(pier, fog, T0 + MIN)).toBe('faster');
      expect(worksWeatherAt(pier, fog, T0 + HOUR)).toBe('same');
      const field = works('irrigated-field');
      const dry = worksPace(field, [cover('drought', T0, T0 + HOUR)]);
      expect(worksWeatherAt(field, dry, T0)).toBe('slower');
      expect(worksWeatherAt(field, worksPace(field, []), T0)).toBe('same');
    });

    it('has the Rain Barrel waiting without rain, and nothing for a works the weather never changes', () => {
      const barrel = works('rain-barrel');
      const rain = worksPace(barrel, [cover('rain', T0, T0 + HOUR)]);
      expect(worksWeatherAt(barrel, rain, T0)).toBe('same');
      expect(worksWeatherAt(barrel, rain, T0 + HOUR)).toBe('waiting');
      const pans = works('salt-pans');
      expect(worksWeatherAt(pans, worksPace(pans, []), T0)).toBeNull();
    });

    it('lists what the bag lacks for the next cycle, after the finished ones', () => {
      const mill = works('watermill');
      expect(mill.eats).toEqual({ greens: 2 });
      expect(worksShort(mill.eats, {}, 0)).toEqual({ greens: 2 });
      expect(worksShort(mill.eats, { greens: 1 }, 0)).toEqual({ greens: 1 });
      expect(worksShort(mill.eats, { greens: 2 }, 0)).toEqual({});
      // Three finished cycles eat 6 first; the next needs 2 more.
      expect(worksShort(mill.eats, { greens: 7 }, 3)).toEqual({ greens: 1 });
      expect(worksShort(mill.eats, { greens: 8 }, 3)).toEqual({});
      expect(worksShort(undefined, {}, 0)).toEqual({});
    });
  });
});
