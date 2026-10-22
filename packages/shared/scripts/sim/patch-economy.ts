import { BUILDINGS } from '../../src/data/buildings.js';
import { EXPLORE_RULES } from '../../src/data/explore.js';
import { HEART_COIN_RULES } from '../../src/data/heart-coins.js';
import { HOLLOW_RULES } from '../../src/data/hollow.js';
import { GAME_DATA } from '../../src/data/index.js';
import { JOB_RULES } from '../../src/data/jobs.js';
import { RESOURCE_BUILDING_RULES } from '../../src/data/resource-buildings.js';
import { RESOURCES } from '../../src/data/resources.js';
import { SELL_RULES } from '../../src/data/trading.js';
import { hexKey, type HexKey } from '../../src/hex/index.js';
import {
  planResume,
  planUpkeep,
  productionCycleSeconds,
  productionProgress,
  productionSource,
  productionYield,
  resumeSinceMs,
  storageCycles,
  upkeepOrder,
  warehouseDelivers,
  type ProductionSource,
} from '../../src/home/production.js';
import { generateMap, type MapTile } from '../../src/mapgen/index.js';
import type {
  ResourceBuilding,
  UpkeepBuilding,
  WarehouseBuilding,
} from '../../src/schemas/data/buildings.js';
import { buildBudget } from './fuel-cover.js';
import { FUEL_CONFIG } from './fuel-config.js';
import type { PatchEconomyConfig, PatchEconomyKid } from './patch-economy-config.js';
import { CURRENT_RULES, type ProgressionConfig } from './progression-config.js';
import { modelData, runProgression } from './progression.js';

/*
 * The patch economy (#601): a casual and an engaged kid build resource
 * buildings and the Warehouse, sell the surplus for Heart Coins and pay each
 * morning's upkeep, with the real production and upkeep maths
 * (`home/production.ts`). Each day: the morning charges in charge order on
 * the real balance; each session settles (output lands), earns the day's
 * play Heart Coins under the caps, sells extras up to the sell cap, wakes
 * paused buildings, and builds or upgrades the next thing in the kid's plan.
 */

/** What the model leaves out, for the report. */
export const PATCH_ECONOMY_LIMITS = [
  "build income before the first hut is the fuel model's (#277), the share not kept for fires",
  'the kid always has a homestead of the right land free (clearing, #242, is not modelled)',
  'battles, captures and care earn the same each day; nothing else spends Heart Coins',
  'matches, fences, the Factory, trades and captures between kids',
  'the kid sells everything over what their next build needs, up to the daily cap',
  "seasons (the Pumpkin Barn) and cut-off homesteads: the maths handles both, the kids' plans use neither",
] as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MORNING_MS = HOLLOW_RULES.morningMinute * 60_000;
const NO_SEASONS: ReadonlySet<string> = new Set();

type Counts = Record<string, number>;

function add(into: Counts, items: Readonly<Counts>, times = 1): Counts {
  for (const [id, n] of Object.entries(items)) into[id] = (into[id] ?? 0) + n * times;
  return into;
}
const covers = (bag: Readonly<Counts>, cost: Readonly<Counts>): boolean =>
  Object.entries(cost).every(([id, n]) => (bag[id] ?? 0) >= n);

function warehouseData(): WarehouseBuilding {
  const b = BUILDINGS.find((x) => x.kind === 'warehouse');
  if (b?.kind !== 'warehouse') throw new Error('no Warehouse in the building data');
  return b;
}
function sourceOf(b: ResourceBuilding): ProductionSource {
  const source = productionSource(b, JOB_RULES, EXPLORE_RULES);
  if (!source) throw new Error(`"${b.id}" has no land yield`);
  return source;
}
function levelOf<T>(levels: readonly T[], level: number): T {
  const row = levels[level - 1];
  if (row === undefined) throw new Error(`no level ${String(level)}`);
  return row;
}

/** Heart Coins a resource's surplus sells for (whole lots). */
function sellValue(resource: string, quantity: number): number {
  const item = SELL_RULES.items[resource];
  return item ? Math.floor(quantity / item.lot) * item.coins : 0;
}

/** One building level's day: what it makes on a joined homestead, and its upkeep against that sold. */
export interface LevelDay {
  readonly building: string;
  readonly level: number;
  readonly resource: string;
  readonly perDay: number;
  /** Cycles its storage holds, and how many hours that is. */
  readonly storageHours: number;
  readonly soldFor: number;
  readonly upkeep: number;
  /** Upkeep as a whole percent of the day's output sold. */
  readonly upkeepPercent: number;
}

/** Every resource building at every level: output a day, its sale value and its upkeep's share. */
export function levelDays(): LevelDay[] {
  return BUILDINGS.flatMap((b) => {
    if (b.kind !== 'resource') return [];
    const source = sourceOf(b);
    return b.levels.map((l, i) => {
      const cycle = productionCycleSeconds(source.seconds, l, JOB_RULES);
      const perDay = Math.floor(86_400 / cycle) * source.perCycle;
      const soldFor = sellValue(source.resource, perDay);
      return {
        building: b.id,
        level: i + 1,
        resource: source.resource,
        perDay,
        storageHours: l.storageHours,
        soldFor,
        upkeep: l.upkeep,
        upkeepPercent: soldFor === 0 ? Infinity : Math.round((l.upkeep * 100) / soldFor),
      };
    });
  });
}

/** One of the kid's buildings as the model tracks it. */
interface Placed {
  readonly rowId: string;
  readonly data: UpkeepBuilding;
  level: number;
  readonly placedAtMs: number;
  sinceMs: number;
  pausedAtMs: number | null;
}

/** A plan step: build a building or raise it to a level. */
interface Step {
  readonly building: string;
  readonly level: number;
}

/** The kid's build plan: every hut at level 1, then each level up in turn; the Warehouse after level 3. */
export function buildPlan(kid: PatchEconomyKid): Step[] {
  const steps: Step[] = [];
  const from = RESOURCE_BUILDING_RULES.warehouseDeliversFromLevel;
  for (let level = 1; level <= kid.maxLevel; level++) {
    for (const hut of kid.huts) steps.push({ building: hut, level });
    if (kid.warehouse && level === from) steps.push({ building: warehouseData().id, level: 1 });
  }
  return steps;
}

function stepCost(step: Step): Counts {
  const b = BUILDINGS.find((x) => x.id === step.building);
  if (!b) throw new Error(`no building "${step.building}"`);
  const levels: readonly { cost: Counts }[] = b.levels;
  return { ...levelOf(levels, step.level).cost };
}

/** One day of one run, at the end of the day. */
export interface DayRecord {
  readonly day: number;
  readonly balance: number;
  /** Heart Coins earned that day, by playing and by selling. */
  readonly played: number;
  readonly sold: number;
  readonly upkeep: number;
  /** Buildings paused at a morning that day. */
  readonly pausedMornings: number;
  /** Paused at the end of the day. */
  readonly pausedNow: number;
  /** "woodcutters-hut 2" for each building standing. */
  readonly buildings: readonly string[];
  /** Output landed that day, all resources. */
  readonly output: number;
}

export interface PatchEconomyRun {
  readonly seats: number;
  readonly kid: string;
  /** Days with no session (empty: plays every day). */
  readonly away: readonly number[];
  /** Does the Warehouse count (off: the same run without its delivery, for the away report)? */
  readonly warehouse: boolean;
  readonly firstHutDay: number | null;
  /** The first day the kid's last hut stood, and the Warehouse. */
  readonly allHutsDay: number | null;
  readonly warehouseDay: number | null;
  /** The first day every hut stood at each level (index 0 = level 1). */
  readonly levelDays: readonly (number | null)[];
  readonly days: readonly DayRecord[];
}

/** The kid's daily play earnings, each source under its cap. */
export function playCoins(kid: PatchEconomyKid): number {
  const r = HEART_COIN_RULES;
  const battle = Math.min(
    r.dailyCaps.battle,
    kid.wins.wild * r.battleWin.wild + kid.wins.tile * r.battleWin.tile,
  );
  const capture = Math.min(
    r.dailyCaps.capture,
    kid.captures.wild * r.capture.wild + kid.captures.tile * r.capture.tile,
  );
  const care = Math.min(r.dailyCaps.care, kid.fullCareActions * r.care.perFullAction);
  return battle + capture + care;
}

interface RunInput {
  readonly kid: PatchEconomyKid;
  readonly seats: number;
  /** Build income each day (index 0 = day 1), the fuel model's spare share. */
  readonly income: readonly Counts[];
  readonly away: readonly number[];
  readonly days: number;
  readonly useWarehouse: boolean;
}

/** One kid on one map for `days` days. */
export function runKid(input: RunInput): PatchEconomyRun {
  const { kid } = input;
  const plan = buildPlan(kid).filter((s) => input.useWarehouse || s.building !== 'warehouse');
  const placed: Placed[] = [];
  const bag: Counts = {};
  let balance = 0;
  let next = 0;
  let rows = 0;
  let firstHutDay: number | null = null;
  let allHutsDay: number | null = null;
  let warehouseDay: number | null = null;
  const levelDays: (number | null)[] = Array.from({ length: kid.maxLevel }, () => null);
  const days: DayRecord[] = [];

  const huts = () => placed.filter((p) => p.data.kind === 'resource');
  const warehouse = () => placed.find((p) => p.data.kind === 'warehouse') ?? null;
  const delivers = (p: Placed) => {
    const w = warehouse();
    return warehouseDelivers(
      p.level,
      w && { paused: w.pausedAtMs !== null, cutOff: false },
      RESOURCE_BUILDING_RULES,
    );
  };

  /** Lands each hut's finished cycles at `atMs` (a settle). Returns the items landed. */
  const settle = (atMs: number): number => {
    let landed = 0;
    for (const p of huts()) {
      if (p.data.kind !== 'resource') continue;
      const source = sourceOf(p.data);
      const row = levelOf(p.data.levels, p.level);
      const cycleSeconds = productionCycleSeconds(source.seconds, row, JOB_RULES);
      const progress = productionProgress(
        {
          sinceMs: p.sinceMs,
          nowMs: atMs,
          pausedAtMs: p.pausedAtMs,
          cycleSeconds,
          maxCycles: delivers(p) ? null : storageCycles(row, cycleSeconds),
          homesteadPause: null,
        },
        JOB_RULES,
      );
      const items = productionYield(source, progress.finishedMs, RESOURCES, () => NO_SEASONS);
      add(bag, items);
      landed += Object.values(items).reduce((a, n) => a + n, 0);
      p.sinceMs = progress.nextSinceMs;
    }
    return landed;
  };

  for (let day = 1; day <= input.days; day++) {
    const dayMs = (day - 1) * DAY_MS;
    const playing = !input.away.includes(day);
    let played = 0;
    let sold = 0;
    let output = 0;

    // The morning: each building placed before it owes one, in charge order.
    const morningMs = dayMs + MORNING_MS;
    const owing = upkeepOrder(
      placed
        .filter((p) => p.placedAtMs < morningMs)
        .map((p) => ({
          id: p.rowId,
          kind: p.data.kind,
          level: p.level,
          upkeep: levelOf(p.data.levels, p.level).upkeep,
          placedAtMs: p.placedAtMs,
          rank: null,
          paused: p.pausedAtMs !== null,
          mornings: [String(day)],
          canWork: () => true,
        })),
    );
    const plan1 = planUpkeep(balance, owing);
    const pausing = plan1.steps.filter((s) => s.kind === 'paused');
    // A Warehouse pausing first banks its L3+ buildings to the morning (plan §6).
    if (pausing.some((s) => s.id === warehouse()?.rowId)) output += settle(morningMs);
    for (const s of pausing) {
      const p = placed.find((x) => x.rowId === s.id);
      if (p) p.pausedAtMs = morningMs;
    }
    const upkeep = balance - plan1.balance;
    balance = plan1.balance;
    const pausedMornings = pausing.length;

    for (const [i, hour] of (playing ? kid.sessions : []).entries()) {
      const atMs = dayMs + hour * HOUR_MS;
      output += settle(atMs);
      if (i === 0) {
        add(bag, input.income[day - 1] ?? {});
        played = playCoins(kid);
        balance += played;
      }

      // Sell the surplus over the next step's cost, up to the day's cap.
      const keep = next < plan.length ? stepCost(plan[next] as Step) : {};
      for (const [resource, item] of Object.entries(SELL_RULES.items)) {
        if (kid.neverSell.includes(resource)) continue;
        const room = HEART_COIN_RULES.dailyCaps.sell - sold;
        const spare = (bag[resource] ?? 0) - (keep[resource] ?? 0);
        const lots = Math.min(Math.floor(spare / item.lot), Math.floor(room / item.coins));
        if (lots <= 0) continue;
        bag[resource] = (bag[resource] ?? 0) - lots * item.lot;
        sold += lots * item.coins;
        balance += lots * item.coins;
      }

      // Wake paused buildings the balance covers, in charge order.
      const asleep = upkeepOrder(
        placed
          .filter((p) => p.pausedAtMs !== null)
          .map((p) => ({
            id: p.rowId,
            kind: p.data.kind,
            level: p.level,
            upkeep: levelOf(p.data.levels, p.level).upkeep,
            placedAtMs: p.placedAtMs,
            rank: null,
          })),
      );
      const woken = planResume(balance, asleep);
      if (woken.some((w) => w.id === warehouse()?.rowId)) output += settle(atMs);
      for (const w of woken) {
        const p = placed.find((x) => x.rowId === w.id);
        if (p) {
          // The settle above banked it to its pause: a part-done cycle carries on.
          p.sinceMs = resumeSinceMs(p.sinceMs, p.pausedAtMs ?? atMs, atMs, null);
          p.pausedAtMs = null;
        }
      }

      // Build or upgrade, in plan order, while the next step is affordable.
      while (next < plan.length) {
        const step = plan[next] as Step;
        const cost = stepCost(step);
        if (!covers(bag, cost)) break;
        add(bag, cost, -1);
        const standing = placed.find((p) => p.data.id === step.building);
        if (standing) {
          output += settle(atMs); // an upgrade raises the pace from now
          standing.level = step.level;
        } else {
          const data = BUILDINGS.find((b) => b.id === step.building);
          if (!data || (data.kind !== 'resource' && data.kind !== 'warehouse')) {
            throw new Error(`"${step.building}" is not an economy building`);
          }
          if (data.kind === 'warehouse') output += settle(atMs);
          placed.push({
            rowId: `row-${String((rows += 1))}`,
            data,
            level: 1,
            placedAtMs: atMs,
            sinceMs: atMs,
            pausedAtMs: null,
          });
          if (data.kind === 'resource') firstHutDay ??= day;
          if (data.kind === 'warehouse') warehouseDay ??= day;
          if (kid.huts.every((h) => placed.some((p) => p.data.id === h))) allHutsDay ??= day;
        }
        next += 1;
      }
    }

    levelDays.forEach((d, i) => {
      const all = kid.huts.every((h) => placed.some((p) => p.data.id === h && p.level > i));
      if (d === null && all) levelDays[i] = day;
    });
    days.push({
      day,
      balance,
      played,
      sold,
      upkeep,
      pausedMornings,
      pausedNow: placed.filter((p) => p.pausedAtMs !== null).length,
      buildings: placed.map((p) => `${p.data.id} ${String(p.level)}`),
      output,
    });
  }
  return {
    seats: input.seats,
    kid: kid.id,
    away: input.away,
    warehouse: input.useWarehouse,
    firstHutDay,
    allHutsDay,
    warehouseDay,
    levelDays,
    days,
  };
}

/** Each kid's build income a day on each map size (the fuel model's spare share). */
export function buildIncome(
  config: PatchEconomyConfig,
  progression: ProgressionConfig,
): Map<string, Counts[]> {
  const short: ProgressionConfig = { ...progression, days: config.days };
  const data = modelData();
  const out = new Map<string, Counts[]>();
  for (const seats of config.seats) {
    const map = generateMap(GAME_DATA, { seed: progression.mapSeed, playerCount: seats });
    const tiles = new Map<HexKey, MapTile>(map.tiles.map((t) => [hexKey(t), t]));
    for (const kid of config.kids) {
      const profile = FUEL_CONFIG.profiles.find((p) => p.id === kid.id);
      const progressionKid = progression.kids.find((k) => k.id === kid.id);
      if (!profile || !progressionKid) throw new Error(`no fuel or progression kid "${kid.id}"`);
      const record = runProgression(data, short, CURRENT_RULES, progressionKid, seats).kids[0];
      const spare = { ...profile, buildShare: 100 - profile.buildShare };
      const daily: Counts[] = [];
      let before: Counts = {};
      for (let day = 1; day <= config.days; day++) {
        const owned = (record?.days[day - 1]?.land ?? []).flatMap((k) => {
          const t = tiles.get(k);
          return t ? [t] : [];
        });
        const budget = buildBudget(spare, day, owned);
        const today: Counts = {};
        for (const [id, n] of Object.entries(budget))
          today[id] = Math.max(0, n - (before[id] ?? 0));
        daily.push(today);
        before = budget;
      }
      out.set(`${String(seats)}/${kid.id}`, daily);
    }
  }
  return out;
}

/** Every run: each kid on each map size, playing daily and away; the engaged away again without the Warehouse. */
export function runPatchEconomy(
  config: PatchEconomyConfig,
  progression: ProgressionConfig,
): PatchEconomyRun[] {
  const income = buildIncome(config, progression);
  const runs: PatchEconomyRun[] = [];
  for (const seats of config.seats) {
    for (const kid of config.kids) {
      const daily = income.get(`${String(seats)}/${kid.id}`) ?? [];
      const base = { kid, seats, income: daily, days: config.days };
      runs.push(runKid({ ...base, away: [], useWarehouse: true }));
      runs.push(runKid({ ...base, away: config.awayDays, useWarehouse: true }));
      if (kid.warehouse) {
        const away = config.warehouseAwayDays;
        runs.push(runKid({ ...base, away, useWarehouse: true }));
        runs.push(runKid({ ...base, away, useWarehouse: false }));
      }
    }
  }
  return runs;
}

/** What upkeep takes of a run's Heart Coins, as a whole percent, from `fromDay` on. */
export function upkeepPercent(run: PatchEconomyRun, fromDay: number): number {
  const window = run.days.filter((d) => d.day >= fromDay);
  const earned = window.reduce((a, d) => a + d.played + d.sold, 0);
  const paid = window.reduce((a, d) => a + d.upkeep, 0);
  return earned === 0 ? 0 : Math.round((paid * 100) / earned);
}

/**
 * Mornings any building paused on while the kid plays every day: not on an
 * away day, nor the morning of the first day back (from `fromDay`).
 */
export function pausedWhilePlaying(run: PatchEconomyRun, fromDay = 1): number {
  const away = run.away;
  return run.days
    .filter((d) => d.day >= fromDay && !away.includes(d.day) && !away.includes(d.day - 1))
    .reduce((a, d) => a + d.pausedMornings, 0);
}

/** A run's away window: its away days and the first day back. */
export function awayWindow(run: PatchEconomyRun): DayRecord[] {
  const first = run.away[0];
  const last = run.away.at(-1);
  if (first === undefined || last === undefined) return [];
  return run.days.filter((d) => d.day >= first && d.day <= last + 1);
}

/** The report's Markdown. */
export function renderPatchEconomy(
  runs: readonly PatchEconomyRun[],
  config: PatchEconomyConfig,
  meta: { seconds: number },
): string {
  const levels = levelDays();
  const warehouse = warehouseData();
  const label = (r: PatchEconomyRun) =>
    `${r.kid}${r.away.length > 0 ? ` (away ${String(r.away[0])}–${String(r.away.at(-1))})` : ''}${r.warehouse ? '' : ', no Warehouse'}`;
  const day = (d: number | null) => (d === null ? '-' : String(d));
  const daily = runs.filter((r) => r.away.length === 0);
  const at = (r: PatchEconomyRun, d: number) => r.days[d - 1];
  const awayOutput = (r: PatchEconomyRun) => awayWindow(r).reduce((a, d) => a + d.output, 0);
  const back = (r: PatchEconomyRun) => awayWindow(r).at(-1);

  const lines = [
    '# Patch economy report (#601)',
    '',
    `Resource buildings, the Warehouse and Heart Coins over ${String(config.days)} days. ${String(runs.length)} runs in ${meta.seconds.toFixed(1)} s. Sell cap ${String(HEART_COIN_RULES.dailyCaps.sell)} 💛 a day; Warehouse ${Object.entries(
      levelOf(warehouse.levels, 1).cost,
    )
      .map(([id, n]) => `${String(n)} ${id}`)
      .join(', ')}, ${String(levelOf(warehouse.levels, 1).upkeep)} 💛 a morning.`,
    '',
    '## Each building level, a day on a joined homestead',
    '',
    `Owner: upkeep is about a fifth of what a day's output sells for (guard ${String(config.upkeepShare.min)}–${String(config.upkeepShare.max)} %).`,
    '',
    '| Building | Level | Makes a day | Holds (h) | Sells for 💛 | Upkeep 💛 | Upkeep % |',
    '|---|---|---|---|---|---|---|',
    ...levels.map(
      (l) =>
        `| ${l.building} | ${String(l.level)} | ${String(l.perDay)} ${l.resource} | ${String(l.storageHours)} | ${String(l.soldFor)} | ${String(l.upkeep)} | ${String(l.upkeepPercent)} |`,
    ),
    '',
    '## Each kid',
    '',
    `| Seats | Kid | First hut | All huts | Huts at L2 / L3 / L4 | Warehouse | Upkeep % of 💛 | Paused mornings (playing) | ${config.reportDays.map((d) => `💛 day ${String(d)}`).join(' | ')} | Buildings day ${String(config.days)} |`,
    `|---|---|---|---|---|---|---|---|${config.reportDays.map(() => '---').join('|')}|---|`,
    ...runs.map((r) => {
      const last = at(r, config.days);
      return `| ${String(r.seats)} | ${label(r)} | ${day(r.firstHutDay)} | ${day(r.allHutsDay)} | ${r.levelDays.slice(1).map(day).join(' / ')} | ${day(r.warehouseDay)} | ${String(upkeepPercent(r, r.allHutsDay ?? config.days + 1))} | ${String(pausedWhilePlaying(r))} | ${config.reportDays.map((d) => String(at(r, d)?.balance ?? '-')).join(' | ')} | ${(last?.buildings ?? []).join(', ')} |`;
    }),
    '',
    '## Away',
    '',
    'A trip with no session: buildings fill and wait (level 3+ ones keep delivering with a paid Warehouse); mornings still charge while they can work. Output counts the away days and the first day back.',
    '',
    '| Seats | Kid | Output, away and back | Paused at the end of the first day back | 💛 then |',
    '|---|---|---|---|---|',
    ...runs
      .filter((r) => r.away.length > 0)
      .map(
        (r) =>
          `| ${String(r.seats)} | ${label(r)} | ${String(awayOutput(r))} | ${String(back(r)?.pausedNow ?? '-')} | ${String(back(r)?.balance ?? '-')} |`,
      ),
    '',
    `Daily runs: ${String(daily.length)}. Guards: upkeep ${String(config.upkeepShare.min)}–${String(config.upkeepShare.max)} % of a day's output sold at every level; the casual kid never pauses a morning while playing and pays at most ${String(config.casualUpkeepMaxPercent)} % of their Heart Coins in upkeep; the engaged kid runs every hut and the Warehouse with no paused morning; a first hut by day ${Object.entries(
      config.firstHutByDay,
    )
      .map(([k, d]) => `${String(d)} (${k})`)
      .join(', ')}; away three days, everything runs again by the end of the first day back.`,
    '',
    '## Not modelled',
    '',
    ...PATCH_ECONOMY_LIMITS.map((l) => `- ${l}`),
    '',
  ];
  return lines.join('\n');
}
