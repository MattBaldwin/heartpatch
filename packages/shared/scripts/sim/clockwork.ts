import { BUILDINGS } from '../../src/data/buildings.js';
import { JOB_RULES } from '../../src/data/jobs.js';
import { POWER_RULES } from '../../src/data/power.js';
import { RAIL_RULES } from '../../src/data/rails.js';
import { RESEARCH_TREE } from '../../src/data/research.js';
import { RESOURCES } from '../../src/data/resources.js';
import { GLIMMER_SWAP, SELL_RULES } from '../../src/data/trading.js';
import {
  eatenBy,
  eatsCap,
  pacedProgress,
  productionCycleSeconds,
  productionYield,
  storageCycles,
  worksSource,
  type WorksPace,
} from '../../src/home/production.js';
import type { Building, WorksBuilding } from '../../src/schemas/data/buildings.js';
import type { ResearchNode } from '../../src/schemas/data/research.js';
import type { ClockworkConfig, ClockworkKid, ClockworkStep } from './clockwork-config.js';
import { PATCH_ECONOMY_CONFIG } from './patch-economy-config.js';
import { buildIncome } from './patch-economy.js';
import type { ProgressionConfig } from './progression-config.js';

/*
 * The Clockwork Isle economy (#874 Wave 1, lane C6): the patch economy's
 * casual and engaged kids on a Clockwork Isle homestead for two weeks of
 * December. Each kid works down a build plan (`clockwork-config.ts`): a
 * Windmill makes Spark Jars at its tile's wind (`POWER_RULES.windPace`
 * through the works pace, `pacedProgress`); squishies on Scrap Heaps gather
 * Parts (the gatherer's cycle and its four waiting gathers, or the Rail
 * Depot's `waitingCycles` and the rail's speed once joined by rail); the
 * Research Bench runs one node at a time and grants Blueprints; the Sorter
 * and the Gift Wrapper eat from the bag at each settle (makers first). Each
 * session settles everything, collects the gatherers (Parts, and Greens
 * from owned meadow for the Sorter), banks finished research, adds the
 * day's build income (first session) and buys the next step the bag covers,
 * wires and rails included, swapping everyday resources for a missing
 * Glimmer at the trading post (`GLIMMER_SWAP`, its daily cap) as a kid would. Every number is read from
 * the data; each run is made twice, with the research tree as the data has
 * it and with the owner's Blueprint ruling (`grantsOverride`).
 */

/** What the model leaves out, for the report. */
export const CLOCKWORK_LIMITS = [
  "build income (Timber, Stone, Greens) is the Cozy patch economy's (the fuel model's spare share on a 4-seat Cozy map), on top of the Scrap Heap gatherers: a Clockwork Isle's own land income is a later lane's",
  'every build stands on a free homestead next to home; wires and rails are laid at the tile counts the plan gives, each machine powered as soon as its wires are down',
  'gatherers get no match bonus and the Keeper never gathers Parts by hand; a rail-joined gatherer is always within the rail’s reach of the Depot; the Greens gatherer works owned meadow from day 1',
  'a missing Glimmer (the Beacon) is swapped for at the trading post (`GLIMMER_SWAP`) the session the rest of the cost is covered; exploring finds none',
  'no upkeep (Wave 1 has none); nothing is sold, so Heart Coins are not modelled; a run that ends short of its plan is shown, not padded',
  'one Windmill each; its tile’s wind is the plan’s, all fortnight (Wave 1 has no wind fronts)',
  'the Sorter always settles before the Gift Wrapper (`SETTLE_ORDER`); the server puts eaters last and keeps row order between two eaters, so the Wrapper may find a few more Treats here than there',
] as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NO_SEASONS: ReadonlySet<string> = new Set();
const CHRISTMAS: ReadonlySet<string> = new Set(['christmas']);

export type Counts = Record<string, number>;

function add(into: Counts, items: Readonly<Counts>, times = 1): Counts {
  for (const [id, n] of Object.entries(items)) into[id] = (into[id] ?? 0) + n * times;
  return into;
}
const covers = (bag: Readonly<Counts>, cost: Readonly<Counts>): boolean =>
  Object.entries(cost).every(([id, n]) => (bag[id] ?? 0) >= n);

/** What items are worth at sell price, part lots included (a price, not a sale). */
export function worth(items: Readonly<Counts>): number {
  let coins = 0;
  for (const [id, n] of Object.entries(items)) {
    const item = SELL_RULES.items[id];
    if (item) coins += (n * item.coins) / item.lot;
  }
  return coins;
}

function building(id: string): Building {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) throw new Error(`no building "${id}"`);
  return b;
}
function works(id: string): WorksBuilding {
  const b = building(id);
  if (b.kind !== 'works') throw new Error(`"${id}" is not a works`);
  return b;
}
type BuildingLevel = Building['levels'][number];
type WorksLevel = WorksBuilding['levels'][number];

function levelOf(b: Building, level: number): BuildingLevel {
  const row: BuildingLevel | undefined = b.levels[level - 1];
  if (row === undefined) throw new Error(`${b.id} has no level ${String(level)}`);
  return row;
}
function worksLevel(b: WorksBuilding, level: number): WorksLevel {
  const row = b.levels[level - 1];
  if (row === undefined) throw new Error(`${b.id} has no level ${String(level)}`);
  return row;
}
/** A level's optional field, on the kinds that have it. */
const pacePercentOf = (row: BuildingLevel) => ('pacePercent' in row ? row.pacePercent : undefined);
const waitingCyclesOf = (row: BuildingLevel) =>
  'waitingCycles' in row ? row.waitingCycles : undefined;
const levelResearchOf = (row: BuildingLevel) =>
  'requiresResearch' in row ? row.requiresResearch : undefined;
/** `POWER_RULES.windPace` at a tile's wind. */
const windPaceAt = (wind: 1 | 2 | 3): number => POWER_RULES.windPace[`${wind}`];
const requiresOf = (b: Building): string | undefined =>
  'requiresResearch' in b ? b.requiresResearch : undefined;

/** The research tree with the ruling's grants, or as the data has it. */
export function researchNodes(config: ClockworkConfig, ruling: boolean): ResearchNode[] {
  return RESEARCH_TREE.nodes.map((n) => {
    const grants = ruling ? config.grantsOverride[n.id] : undefined;
    return grants ? { ...n, grants: { ...grants } } : n;
  });
}

/** Blueprints the tier-1 nodes grant in all. */
export const tier1Blueprints = (nodes: readonly ResearchNode[]): number =>
  nodes.filter((n) => n.tier === 1).reduce((sum, n) => sum + (n.grants['blueprints'] ?? 0), 0);

/** Every Blueprint a Wave 1 build costs, level by level (each built once). */
export function blueprintSinks(): { building: string; level: number; blueprints: number }[] {
  return BUILDINGS.filter((b) => b.patchTypes?.includes('clockwork-isle')).flatMap((b) =>
    [...b.levels].flatMap((row: BuildingLevel, i) =>
      (row.cost['blueprints'] ?? 0) > 0
        ? [{ building: b.id, level: i + 1, blueprints: row.cost['blueprints'] ?? 0 }]
        : [],
    ),
  );
}

/** What a step costs: the building level (plus its wires), the research node, or the rail tiles. */
export function stepCost(step: ClockworkStep, nodes: readonly ResearchNode[]): Counts {
  switch (step.kind) {
    case 'build': {
      const wires = step.wires ?? 0;
      if (wires > POWER_RULES.wire.maxRun) throw new Error(`${step.building}: wires past maxRun`);
      return add(
        { ...levelOf(building(step.building), step.level).cost },
        POWER_RULES.wire.cost,
        wires,
      );
    }
    case 'research': {
      const node = nodes.find((n) => n.id === step.node);
      if (!node) throw new Error(`no research node "${step.node}"`);
      return { ...node.cost };
    }
    case 'rail': {
      const rail = RAIL_RULES.levels[0];
      if (!rail) throw new Error('no rail level 1');
      return add({}, rail.cost, step.tiles);
    }
  }
}

export const stepName = (step: ClockworkStep): string =>
  step.kind === 'build'
    ? `${step.building} L${String(step.level)}`
    : step.kind === 'research'
      ? `research ${step.node}`
      : `rail to heap ${String(step.gatherer + 1)}`;

/** A Windmill's Spark Jars a day at a level and wind (no eaters, never full between settles). */
export function windmillPerDay(level: number, wind: 1 | 2 | 3): number {
  const mill = works('windmill');
  const source = worksSource(mill);
  const cycle = productionCycleSeconds(source.seconds, worksLevel(mill, level), JOB_RULES);
  const pace = windPaceAt(wind);
  return (source.perCycle * 86_400 * pace) / (cycle * 100);
}

/** One day of one run, at the end of the day. */
export interface ClockworkDay {
  readonly day: number;
  readonly bag: Readonly<Counts>;
  readonly built: readonly string[];
  readonly partsIn: number;
  readonly partsSpent: number;
  readonly sparkMade: number;
  readonly sparkUsed: number;
  readonly presentsMade: number;
  /** The least Spark Jars the bag held at any point that day. */
  readonly minSpark: number;
}

export interface ClockworkRun {
  readonly kid: string;
  /** The owner's Blueprint ruling applied (`grantsOverride`), or the data as it is. */
  readonly ruling: boolean;
  /** The day each step was bought (by `stepName`). */
  readonly stepDay: Readonly<Record<string, number>>;
  /** The step the run stopped short of, and what the bag lacked, or null if the plan finished. */
  readonly stuck: { readonly step: string; readonly short: Readonly<Counts> } | null;
  readonly blueprintsGranted: number;
  readonly blueprintsSpent: number;
  readonly days: readonly ClockworkDay[];
}

interface Machine {
  readonly id: string;
  level: number;
  sinceMs: number;
  readonly pace: WorksPace;
}
interface Gatherer {
  readonly resource: string;
  readonly quantity: number;
  /** A Keeper's gather time; a squishy takes `JOB_RULES.work.cyclePercent` of it. */
  readonly seconds: number;
  sinceMs: number;
  /** Joined by rail to the Depot (Scrap Heap gatherers only). */
  railed: boolean;
}

/** Makers before eaters, the Sorter's Treats before the Wrapper eats them. */
const SETTLE_ORDER = ['windmill', 'sorter', 'gift-wrapper'];

interface RunInput {
  readonly kid: ClockworkKid;
  readonly config: ClockworkConfig;
  readonly income: readonly Counts[];
  readonly ruling: boolean;
}

/** One kid on a Clockwork Isle homestead for `config.days` days. */
export function runClockworkKid(input: RunInput): ClockworkRun {
  const { kid, config } = input;
  const nodes = researchNodes(config, input.ruling);
  const bag: Counts = {};
  const levels = new Map<string, number>();
  const machines: Machine[] = [];
  const known = new Set<string>();
  const parts = RESOURCES.find((r) => r.id === 'parts')?.gather;
  if (!parts) throw new Error('parts has no gather');
  const greens = JOB_RULES.terrainYields.find((y) => y.terrain === 'meadow');
  if (greens?.resource !== 'greens') throw new Error('meadow yields no greens');
  // The patch starts at the first session: gatherers set to work then.
  const startMs = (kid.sessions[0] ?? 0) * HOUR_MS;
  // Scrap Heap gatherers first, so a rail step's index names one.
  const gatherers: Gatherer[] = [
    ...Array.from({ length: kid.partsGatherers }, () => ({
      resource: 'parts',
      quantity: parts.quantity,
      seconds: parts.seconds,
      sinceMs: startMs,
      railed: false,
    })),
    ...Array.from({ length: kid.greensGatherers }, () => ({
      resource: 'greens',
      quantity: greens.quantity,
      seconds: greens.seconds,
      sinceMs: startMs,
      railed: false,
    })),
  ];
  let swappedOn = 0;
  let swapped = 0;
  let research = null as { node: ResearchNode; doneMs: number } | null;
  let next = 0;
  let granted = 0;
  let spentBlueprints = 0;
  const stepDay: Record<string, number> = {};
  const days: ClockworkDay[] = [];
  let windmillWind: 1 | 2 | 3 = 2;

  const day = {
    built: [] as string[],
    partsIn: 0,
    partsSpent: 0,
    sparkMade: 0,
    sparkUsed: 0,
    presentsMade: 0,
    minSpark: 0,
  };
  const noteSpark = () => {
    day.minSpark = Math.min(day.minSpark, bag['spark'] ?? 0);
  };

  const settle = (atMs: number) => {
    const order = [...machines].sort(
      (a, b) => SETTLE_ORDER.indexOf(a.id) - SETTLE_ORDER.indexOf(b.id),
    );
    for (const m of order) {
      const data = works(m.id);
      const source = worksSource(data);
      const row = worksLevel(data, m.level);
      const cycleSeconds = productionCycleSeconds(source.seconds, row, JOB_RULES);
      const progress = pacedProgress(
        {
          sinceMs: m.sinceMs,
          nowMs: atMs,
          pausedAtMs: null,
          cycleSeconds,
          maxCycles: storageCycles(row, cycleSeconds),
          homesteadPause: null,
        },
        m.pace,
      );
      const paid = Math.min(progress.cycles, eatsCap(data.eats, bag));
      const eaten = eatenBy(data.eats, paid);
      add(bag, eaten, -1);
      day.sparkUsed += eaten['spark'] ?? 0;
      day.partsSpent += eaten['parts'] ?? 0;
      noteSpark();
      const seasons = data.season === 'christmas' ? () => CHRISTMAS : () => NO_SEASONS;
      const items = productionYield(source, progress.finishedMs.slice(0, paid), RESOURCES, seasons);
      add(bag, items);
      day.sparkMade += items['spark'] ?? 0;
      day.presentsMade += items['presents'] ?? 0;
      m.sinceMs = progress.nextSinceMs;
    }
  };

  const collect = (atMs: number) => {
    const depot = levels.get('rail-depot');
    const rail = RAIL_RULES.levels[0];
    for (const g of gatherers) {
      const joined = g.railed && depot !== undefined;
      const speed = joined && rail ? rail.speedPercent : 100;
      const cycleMs = Math.floor((g.seconds * JOB_RULES.work.cyclePercent * 1000) / speed);
      const cap = joined
        ? (waitingCyclesOf(levelOf(building('rail-depot'), depot)) ??
          JOB_RULES.work.maxStoredCycles)
        : JOB_RULES.work.maxStoredCycles;
      const cycles = Math.min(cap, Math.floor((atMs - g.sinceMs) / cycleMs));
      add(bag, { [g.resource]: cycles * g.quantity });
      if (g.resource === 'parts') day.partsIn += cycles * g.quantity;
      g.sinceMs = cycles >= cap ? atMs : g.sinceMs + cycles * cycleMs;
    }
  };

  /** Why a step can't be bought yet, beyond the bag: null when nothing else stands in the way. */
  const blockedBy = (step: ClockworkStep): string | null => {
    switch (step.kind) {
      case 'build': {
        const b = building(step.building);
        const need = requiresOf(b) ?? levelResearchOf(levelOf(b, step.level));
        if (need && !known.has(need)) return `waits for ${need}`;
        if (step.level > 1 && levels.get(step.building) !== step.level - 1) return 'level order';
        if (b.kind === 'works' && b.needsPower && !levels.has('windmill')) return 'no Windmill';
        return null;
      }
      case 'research':
        if (!levels.has('research-bench')) return 'no Research Bench';
        return research ? 'bench busy' : null;
      case 'rail':
        return levels.has('rail-depot') ? null : 'no Rail Depot';
    }
  };

  const buy = (step: ClockworkStep, atMs: number, dayNo: number) => {
    const cost = stepCost(step, nodes);
    add(bag, cost, -1);
    day.partsSpent += cost['parts'] ?? 0;
    day.sparkUsed += cost['spark'] ?? 0;
    spentBlueprints += cost['blueprints'] ?? 0;
    noteSpark();
    stepDay[stepName(step)] = dayNo;
    day.built.push(stepName(step));
    switch (step.kind) {
      case 'build': {
        levels.set(step.building, step.level);
        const b = building(step.building);
        if (b.kind !== 'works') return;
        const placed = machines.find((m) => m.id === step.building);
        if (placed) {
          placed.level = step.level;
          placed.sinceMs = atMs; // a part-done cycle starts over at the new pace
          return;
        }
        if (step.building === 'windmill' && step.wind) windmillWind = step.wind;
        const basePercent = b.wind === true ? windPaceAt(windmillWind) : 100;
        machines.push({
          id: b.id,
          level: step.level,
          sinceMs: atMs,
          pace: { basePercent, windows: [] },
        });
        return;
      }
      case 'research': {
        const node = nodes.find((n) => n.id === step.node);
        const benchLevel = levels.get('research-bench');
        if (!node || benchLevel === undefined) throw new Error(`can't research ${step.node}`);
        const bench = levelOf(building('research-bench'), benchLevel);
        const pace = pacePercentOf(bench) ?? 100;
        research = { node, doneMs: atMs + Math.ceil((node.seconds * 1000 * 100) / pace) };
        return;
      }
      case 'rail': {
        const g = gatherers[step.gatherer];
        if (!g) throw new Error(`no gatherer ${String(step.gatherer)}`);
        collect(atMs); // what it held lands first, then it delivers by rail
        g.railed = true;
        return;
      }
    }
  };

  for (let d = 1; d <= config.days; d++) {
    const dayMs = (d - 1) * DAY_MS;
    Object.assign(day, {
      built: [],
      partsIn: 0,
      partsSpent: 0,
      sparkMade: 0,
      sparkUsed: 0,
      presentsMade: 0,
      minSpark: bag['spark'] ?? 0,
    });
    for (const [i, hour] of kid.sessions.entries()) {
      const atMs = dayMs + hour * HOUR_MS;
      settle(atMs);
      collect(atMs);
      if (research && research.doneMs <= atMs) {
        known.add(research.node.id);
        add(bag, research.node.grants);
        granted += research.node.grants['blueprints'] ?? 0;
        research = null;
      }
      if (i === 0) add(bag, input.income[d - 1] ?? {});
      for (;;) {
        const step = kid.plan[next];
        if (!step || blockedBy(step) !== null) break;
        const cost = stepCost(step, nodes);
        // A missing Glimmer: swap the most plentiful everyday resource for it, under the cap.
        while ((bag['glimmer'] ?? 0) < (cost['glimmer'] ?? 0)) {
          if (swappedOn !== d) [swappedOn, swapped] = [d, 0];
          const give = [...GLIMMER_SWAP.accepts]
            .filter((id) => (bag[id] ?? 0) - (cost[id] ?? 0) >= GLIMMER_SWAP.give)
            .sort((a, b) => (bag[b] ?? 0) - (bag[a] ?? 0))[0];
          if (give === undefined || swapped >= GLIMMER_SWAP.dailyCap) break;
          add(bag, { [give]: -GLIMMER_SWAP.give, glimmer: GLIMMER_SWAP.get });
          swapped += GLIMMER_SWAP.get;
        }
        if (!covers(bag, cost)) break;
        buy(step, atMs, d);
        next += 1;
      }
    }
    days.push({ day: d, bag: { ...bag }, ...day, built: [...day.built] });
  }

  const step = kid.plan[next];
  const stuck = step
    ? {
        step: stepName(step),
        short: Object.fromEntries(
          Object.entries(stepCost(step, nodes)).flatMap(([id, n]) =>
            (bag[id] ?? 0) < n ? [[id, n - (bag[id] ?? 0)]] : [],
          ),
        ),
      }
    : null;
  return {
    kid: kid.id,
    ruling: input.ruling,
    stepDay,
    stuck,
    blueprintsGranted: granted,
    blueprintsSpent: spentBlueprints,
    days,
  };
}

/** Each kid's build income a day (4 seats), for the run's length. */
export function clockworkIncome(
  config: ClockworkConfig,
  progression: ProgressionConfig,
): Map<string, Counts[]> {
  const economy = { ...PATCH_ECONOMY_CONFIG, days: config.days, seats: [4] };
  const income = buildIncome(economy, progression);
  return new Map(config.kids.map((k) => [k.id, income.get(`4/${k.id}`) ?? []]));
}

/** Every run: each kid with the data's research grants and with the owner's ruling. */
export function runClockwork(
  config: ClockworkConfig,
  progression: ProgressionConfig,
  income: Map<string, Counts[]> = clockworkIncome(config, progression),
): ClockworkRun[] {
  return config.kids.flatMap((kid) =>
    [false, true].map((ruling) =>
      runClockworkKid({ kid, config, income: income.get(kid.id) ?? [], ruling }),
    ),
  );
}

const sum = (run: ClockworkRun, pick: (d: ClockworkDay) => number) =>
  run.days.reduce((a, d) => a + pick(d), 0);

/** The guards' numbers for one run. */
export function runFacts(run: ClockworkRun) {
  return {
    windmillDay: run.stepDay['windmill L1'] ?? null,
    sorterDay: run.stepDay['sorter L1'] ?? null,
    beaconDay: run.stepDay['clockwork-beacon L1'] ?? null,
    wrapperDay: run.stepDay['gift-wrapper L1'] ?? null,
    minSpark: Math.min(...run.days.map((d) => d.minSpark)),
    partsIn: sum(run, (d) => d.partsIn),
    partsSpent: sum(run, (d) => d.partsSpent),
    sparkMade: sum(run, (d) => d.sparkMade),
    sparkUsed: sum(run, (d) => d.sparkUsed),
    maxPresentsPerDay: Math.max(0, ...run.days.map((d) => d.presentsMade)),
    presents: sum(run, (d) => d.presentsMade),
  };
}

/** A works level's day of output at sell price, and the upkeep the owner's share would set. */
export interface UpkeepRow {
  readonly building: string;
  readonly level: number;
  readonly perDay: string;
  /** Null when its output has no sell price (presents are given and opened, never sold). */
  readonly worth: number | null;
  readonly upkeep: readonly [number, number] | null;
}

/** Proposed upkeep for each Clockwork works level (Wave 1 sets none), at wind 2 for a Windmill. */
export function upkeepRows(config: ClockworkConfig): UpkeepRow[] {
  return BUILDINGS.filter(
    (b): b is WorksBuilding =>
      b.kind === 'works' && b.patchTypes?.includes('clockwork-isle') === true,
  ).flatMap((b) =>
    b.levels.map((row, i) => {
      const source = worksSource(b);
      const cycle = productionCycleSeconds(source.seconds, row, JOB_RULES);
      const cycles = (86_400 * (b.wind ? windPaceAt(2) : 100)) / (cycle * 100);
      const made = { [source.resource]: cycles * source.perCycle };
      const eaten = eatenBy(b.eats, 1);
      const net =
        worth(made) -
        worth(Object.fromEntries(Object.entries(eaten).map(([k, n]) => [k, n * cycles])));
      const value = Math.max(0, net);
      const perDay = `${(cycles * source.perCycle).toFixed(1)} ${source.resource}`;
      if (SELL_RULES.items[source.resource] === undefined) {
        return { building: b.id, level: i + 1, perDay, worth: null, upkeep: null };
      }
      return {
        building: b.id,
        level: i + 1,
        perDay,
        worth: Math.round(value * 10) / 10,
        upkeep: [
          Math.round((value * config.upkeepShare.min) / 100),
          Math.round((value * config.upkeepShare.max) / 100),
        ] as const,
      };
    }),
  );
}

/** One guard's verdict, for the report and `clockwork.test.ts`. */
export interface Guard {
  readonly name: string;
  readonly value: string;
  readonly pass: boolean;
}

/** The plan's guards (row C6, R1.3), on the runs with the owner's Blueprint ruling. */
export function clockworkGuards(runs: readonly ClockworkRun[], config: ClockworkConfig): Guard[] {
  const of = (kid: string) => {
    const run = runs.find((r) => r.kid === kid && r.ruling);
    if (!run) throw new Error(`no ruling run for "${kid}"`);
    return runFacts(run);
  };
  const casual = of('casual');
  const engaged = of('engaged');
  const within = (day: number | null, by: number) => day !== null && day <= by;
  const shown = (day: number | null) => (day === null ? 'never' : `day ${String(day)}`);
  return [
    {
      name: `casual kid builds a Windmill by day ${String(config.casualWindmillByDay)}`,
      value: shown(casual.windmillDay),
      pass: within(casual.windmillDay, config.casualWindmillByDay),
    },
    {
      name: `casual kid builds a Sorter by day ${String(config.casualSorterByDay)}`,
      value: shown(casual.sorterDay),
      pass: within(casual.sorterDay, config.casualSorterByDay),
    },
    {
      name: 'Spark Jars never run negative (every run)',
      value: `least ${String(Math.min(...runs.map((r) => runFacts(r).minSpark)))}`,
      pass: runs.every((r) => runFacts(r).minSpark >= 0),
    },
    ...config.kids.map((k) => {
      const f = of(k.id);
      return {
        name: `${k.id} kid: Parts income ≥ Parts spend over ${String(config.days)} days`,
        value: `${String(f.partsIn)} in, ${String(f.partsSpent)} spent`,
        pass: f.partsIn >= f.partsSpent,
      };
    }),
    {
      name: `engaged kid's Beacon by day ${String(config.engagedBeaconByDay)}`,
      value: shown(engaged.beaconDay),
      pass: within(engaged.beaconDay, config.engagedBeaconByDay),
    },
    {
      name: `engaged kid wraps at most ${String(config.maxPresentsPerDay)} presents a day`,
      value: `most ${String(engaged.maxPresentsPerDay)} a day`,
      pass: engaged.maxPresentsPerDay <= config.maxPresentsPerDay,
    },
  ];
}

const counts = (items: Readonly<Counts>) =>
  Object.entries(items)
    .filter(([, n]) => n !== 0)
    .map(([id, n]) => `${String(n)} ${id}`)
    .join(', ') || '—';

/** The Markdown report (`pnpm sim:clockwork`). */
export function renderClockwork(
  runs: readonly ClockworkRun[],
  config: ClockworkConfig,
  meta: { readonly seconds: number },
): string {
  const dataNodes = researchNodes(config, false);
  const rulingNodes = researchNodes(config, true);
  const sinks = blueprintSinks();
  const needed = sinks.reduce((a, s) => a + s.blueprints, 0);
  const guards = clockworkGuards(runs, config);
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);
  const day = (n: number | null) => (n === null ? '—' : String(n));

  push(
    '# Clockwork Isle balance (`pnpm sim:clockwork`)',
    '',
    `#874 Wave 1, lane C6. ${String(config.days)} days from ${config.firstDay}, a casual and an engaged kid on one Clockwork Isle homestead, every number read from the data (\`BUILDINGS\`, \`POWER_RULES\`, \`RAIL_RULES\`, \`RESEARCH_TREE\`, \`RESOURCES\`, \`JOB_RULES\`, \`GLIMMER_SWAP\`). Each kid runs twice: with the research tree as the data has it, and with the owner's Blueprint ruling (supervisor 58, 2026-11-28: tier 1 grants ${String(config.tier1Blueprints)}). ${String(runs.length)} runs in ${meta.seconds.toFixed(1)} s.`,
    '',
    '## Guards (with the ruling)',
    '',
    '| guard | result | |',
    '|---|---|---|',
    ...guards.map((g) => `| ${g.name} | ${g.value} | ${g.pass ? '✅' : '❌'} |`),
    '',
    '## Summary',
    '',
    '| kid | Blueprints | Windmill | Sorter | Beacon | Wrapper | plan | Blueprints granted / spent | Parts in / spent | Spark made / used | presents (most a day) |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...runs.map((r) => {
      const f = runFacts(r);
      const plan = r.stuck ? `stuck on ${r.stuck.step} (short ${counts(r.stuck.short)})` : 'done';
      return `| ${r.kid} | ${r.ruling ? `ruling (${String(tier1Blueprints(rulingNodes))})` : `data (${String(tier1Blueprints(dataNodes))})`} | ${day(f.windmillDay)} | ${day(f.sorterDay)} | ${day(f.beaconDay)} | ${day(f.wrapperDay)} | ${plan} | ${String(r.blueprintsGranted)} / ${String(r.blueprintsSpent)} | ${String(f.partsIn)} / ${String(f.partsSpent)} | ${String(f.sparkMade)} / ${String(f.sparkUsed)} | ${String(f.presents)} (${String(f.maxPresentsPerDay)}) |`;
    }),
    '',
    '## Blueprint balance',
    '',
    `Every Wave 1 build that costs Blueprints, each level built once, needs **${String(needed)}**. Tier 1 research grants **${String(tier1Blueprints(dataNodes))}** as the data has it, and **${String(tier1Blueprints(rulingNodes))}** with the ruling (one time: research is never repeated).`,
    '',
    '| build | level | Blueprints |',
    '|---|---|---|',
    ...sinks.map((s) => `| ${s.building} | ${String(s.level)} | ${String(s.blueprints)} |`),
    '',
    '| node | grants (data) | grants (ruling, modelled) |',
    '|---|---|---|',
    ...dataNodes
      .filter((n) => n.tier === 1)
      .map(
        (n) =>
          `| ${n.id} | ${String(n.grants['blueprints'] ?? 0)} | ${String(rulingNodes.find((x) => x.id === n.id)?.grants['blueprints'] ?? 0)} |`,
      ),
    '',
    `How C3 splits the extra two is C3's call; the sim's split (\`grantsOverride\` in \`clockwork-config.ts\`) only needs the total. Once C3's data says ${String(config.tier1Blueprints)}, \`grantsOverride\` empties and both rows read the same.`,
    '',
    '## Windmill Spark Jars a day',
    '',
    '| level | wind 1 | wind 2 | wind 3 |',
    '|---|---|---|---|',
    ...works('windmill').levels.map(
      (_, i) =>
        `| ${String(i + 1)} | ${String(windmillPerDay(i + 1, 1))} | ${String(windmillPerDay(i + 1, 2))} | ${String(windmillPerDay(i + 1, 3))} |`,
    ),
    '',
    `A works cycle runs at \`JOB_RULES.work.cyclePercent\` (${String(JOB_RULES.work.cyclePercent)} %) like every works building, so a level-1 Windmill at wind 2 makes ${String(windmillPerDay(1, 2) / 24)} an hour, not the 4 the row's comment says.`,
    '',
    '## Proposed upkeep (Wave 1 sets none)',
    '',
    `A day's output at sell price, less what it eats (fed every cycle), at wind 2; upkeep at ${String(config.upkeepShare.min)}–${String(config.upkeepShare.max)} % of it (owner decision 2026-10-22). Proposals only; no data changed.`,
    '',
    '| works | level | a day | net worth 💛 | upkeep 💛 |',
    '|---|---|---|---|---|',
    ...upkeepRows(config).map(
      (u) =>
        `| ${u.building} | ${String(u.level)} | ${u.perDay} | ${u.worth === null ? 'not sold' : String(u.worth)} | ${u.upkeep === null ? '— (pick by hand)' : `${String(u.upkeep[0])}–${String(u.upkeep[1])}`} |`,
    ),
    '',
  );

  for (const run of runs.filter((r) => r.ruling)) {
    push(
      `## ${run.kid} kid, day by day (ruling)`,
      '',
      '| day | bought | Spark | Parts | Blueprints | Greens | Treats | presents |',
      '|---|---|---|---|---|---|---|---|',
      ...run.days.map(
        (d) =>
          `| ${String(d.day)} | ${d.built.join(', ') || '—'} | ${String(d.bag['spark'] ?? 0)} | ${String(d.bag['parts'] ?? 0)} | ${String(d.bag['blueprints'] ?? 0)} | ${String(d.bag['greens'] ?? 0)} | ${String(d.bag['treats'] ?? 0)} | ${String(d.bag['presents'] ?? 0)} |`,
      ),
      '',
    );
  }

  push('## What the model leaves out', '', ...CLOCKWORK_LIMITS.map((l) => `- ${l}`), '');
  return lines.join('\n');
}
