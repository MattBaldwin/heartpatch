import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../data/buildings.js';
import { EXPLORE_RULES } from '../data/explore.js';
import { HOLLOW_RULES } from '../data/hollow.js';
import { JOB_RULES } from '../data/jobs.js';
import { RESOURCE_BUILDING_RULES } from '../data/resource-buildings.js';
import { RESOURCES } from '../data/resources.js';
import type { ResourceBuilding } from '../schemas/data/buildings.js';
import {
  latestMorning,
  planResume,
  planUpkeep,
  productionCycleSeconds,
  productionFullAtMs,
  productionProgress,
  productionSource,
  productionYield,
  storageCycles,
  upkeepMornings,
  upkeepOrder,
  warehouseDelivers,
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

describe('upkeep mornings (#601)', () => {
  const at = (date: string, minute: number) => ({ date, minute });

  it('owes from the first morning after it was placed', () => {
    expect(latestMorning(at('2026-10-20', MORNING), MORNING)).toBe('2026-10-20');
    expect(latestMorning(at('2026-10-20', MORNING - 1), MORNING)).toBe('2026-10-19');
    // Placed at 5 AM: owes 6 AM that day. Placed at noon: the next morning.
    expect(
      upkeepMornings(
        { placed: at('2026-10-20', 5 * 60), paidThrough: null, now: at('2026-10-20', 7 * 60) },
        MORNING,
      ),
    ).toEqual(['2026-10-20']);
    expect(
      upkeepMornings(
        { placed: at('2026-10-20', 12 * 60), paidThrough: null, now: at('2026-10-21', 5 * 60) },
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
          paidThrough: '2026-10-30',
          now: at('2026-11-02', 6 * 60),
        },
        MORNING,
      ),
    ).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(
      upkeepMornings(
        {
          placed: at('2026-10-01', 9 * 60),
          paidThrough: '2026-11-02',
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
