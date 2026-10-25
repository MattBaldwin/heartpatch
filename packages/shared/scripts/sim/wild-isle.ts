import { BUILDINGS } from '../../src/data/buildings.js';
import { GAME_DATA } from '../../src/data/index.js';
import { HEART_COIN_RULES } from '../../src/data/heart-coins.js';
import { HOLLOW_RULES } from '../../src/data/hollow.js';
import { JOB_RULES } from '../../src/data/jobs.js';
import { MAP_GEN } from '../../src/data/map-gen.js';
import { RESOURCES } from '../../src/data/resources.js';
import { SELL_RULES } from '../../src/data/trading.js';
import { WEATHER_RULES } from '../../src/data/weather.js';
import { hexDistance, hexKey, hexNeighbors, type Hex } from '../../src/hex/index.js';
import { addDays } from '../../src/home/local-date.js';
import {
  eatenBy,
  eatsCap,
  followsWeather,
  pacedProgress,
  planResume,
  planUpkeep,
  productionCycleSeconds,
  productionYield,
  resumeSinceMs,
  storageCycles,
  upkeepOrder,
  worksPace,
  worksSource,
  type WorksPace,
} from '../../src/home/production.js';
import { hasWaterNextDoor, waterKindOf } from '../../src/home/water-works.js';
import { generateMap, type MapTile } from '../../src/mapgen/index.js';
import { wildIsleLayout } from '../../src/mapgen/wild-isle.js';
import { deriveSeed, Rng } from '../../src/rng/index.js';
import type { WorksBuilding } from '../../src/schemas/data/buildings.js';
import type { WeatherFront } from '../../src/schemas/weather.js';
import { repairCost } from '../../src/weather/knocks.js';
import { coverWindows, frontCover, planWeatherDay } from '../../src/weather/plan.js';
import { PATCH_ECONOMY_CONFIG } from './patch-economy-config.js';
import { buildIncome, playCoins } from './patch-economy.js';
import type { ProgressionConfig } from './progression-config.js';
import type { WildIsleConfig, WildIsleKid } from './wild-isle-config.js';

/*
 * The Wild Isle economy (#621 W1-8): the patch economy's casual and engaged
 * kids on a generated Wild Isle, building water works on the homesteads
 * nearest home with the water each needs, under the real weather plan
 * (`planWeatherDay`, a front's pace through `worksPace`/`pacedProgress`) and
 * the real storm rolls (the server's seeded knock: `knockPercent`, plus
 * `floodBonusPercent` next to `nearWater` water, which is the sea and rivers,
 * never a lake). Each day: the morning charges upkeep in charge order; each
 * session settles (output lands, a Watermill eats its Greens), rolls the
 * storms that passed, fixes what they knocked (`repairCost`), earns the
 * day's play Heart Coins, sells the surplus up to the cap, wakes paused
 * works and builds the next step. Every run is made twice, with and without
 * storms, so what storms cost is measured, not guessed.
 */

/** What the model leaves out, for the report. */
export const WILD_ISLE_LIMITS = [
  "build income is the Cozy patch economy's (the fuel model's spare share on a 4-seat Cozy map): a Wild Isle's own land income is a later lane's",
  'every works stands on the nearest free tile with its water next door, joined and cleared; roads, bridges and supply are not modelled',
  'no shelters (Levee, Seawall): every storm rolls at its plain odds, with the flood bonus by the sea or a river',
  'one island and one month of weather on the everyday table (no season)',
  'the kid fixes a knocked building at their next session once the bag covers it, before buying anything else',
  'Fish, Salt and Flour are only sold: Pies (W1-8 part B) are not in this model',
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
const total = (items: Readonly<Counts>) => Object.values(items).reduce((a, n) => a + n, 0);

/** Heart Coins a resource's surplus sells for (whole lots). */
function sellValue(resource: string, quantity: number): number {
  const item = SELL_RULES.items[resource];
  return item ? Math.floor(quantity / item.lot) * item.coins : 0;
}

/** What items are worth at sell price, part lots included (a price, not a sale). */
export function worth(items: Readonly<Counts>): number {
  let coins = 0;
  for (const [id, n] of Object.entries(items)) {
    const item = SELL_RULES.items[id];
    if (item) coins += (n * item.coins) / item.lot;
  }
  return coins;
}

function worksData(id: string): WorksBuilding {
  const b = BUILDINGS.find((x) => x.id === id);
  if (b?.kind !== 'works') throw new Error(`"${id}" is not a works`);
  return b;
}
function levelOf<T>(levels: readonly T[], level: number): T {
  const row = levels[level - 1];
  if (row === undefined) throw new Error(`no level ${String(level)}`);
  return row;
}

/** The island, its weather and where each works stands, shared by every run. */
export interface WildIsland {
  readonly tiles: readonly MapTile[];
  readonly home: Hex;
  readonly fronts: readonly WeatherFront[];
  /** Each works id's tile: the nearest free land past the home ring with its water next door. */
  readonly sites: ReadonlyMap<string, Hex>;
  readonly endMs: number;
}

/** Generates the island, plans its month of weather and picks a homestead for each works. */
export function wildIsland(config: WildIsleConfig): WildIsland {
  const map = generateMap(GAME_DATA, {
    seed: config.mapSeed,
    playerCount: 6,
    patchType: 'wild-isle',
  });
  const rules = MAP_GEN.wildIsle;
  if (!rules) throw new Error('no Wild Isle settings');
  const layout = wildIsleLayout(rules, 6);
  const island = { radius: layout.radius, oceanRings: layout.oceanRings };
  const fronts = Array.from({ length: config.days }, (_, d) => {
    const day = addDays(config.firstDay, d);
    return planWeatherDay(
      deriveSeed(config.mapSeed, 'weather', day),
      WEATHER_RULES,
      [],
      { day, startMs: d * DAY_MS, endMs: (d + 1) * DAY_MS },
      island,
    ).fronts;
  }).flat();
  const home = map.homes[0];
  if (!home) throw new Error('no home on the island');
  const free = map.tiles
    .filter(
      (t) =>
        t.homeSlot === null &&
        waterKindOf(t.terrain) === null &&
        t.terrain !== 'trading-post' &&
        hexDistance(t, home) >= 2,
    )
    .sort((a, b) => hexDistance(a, home) - hexDistance(b, home) || a.q - b.q || a.r - b.r);
  const taken = new Set<string>();
  const sites = new Map<string, Hex>();
  const ids = [...new Set(config.kids.flatMap((k) => k.works))];
  for (const id of ids) {
    const data = worksData(id);
    const site = free.find(
      (t) => !taken.has(hexKey(t)) && hasWaterNextDoor(t, map.tiles, [], data.needsWater, 0),
    );
    if (!site) throw new Error(`no site for "${id}" on the island`);
    taken.add(hexKey(site));
    sites.set(id, { q: site.q, r: site.r });
  }
  return { tiles: map.tiles, home, fronts, sites, endMs: config.days * DAY_MS };
}

/** A works' pace on its site over the whole run (clear skies for one that ignores the weather). */
function paceAt(data: WorksBuilding, site: Hex, island: WildIsland): WorksPace {
  return worksPace(data, coverWindows(island.fronts, site, 0, island.endMs));
}

/** One works level's day: what it makes on its site, on average over the month's weather, and its upkeep. */
export interface WorksLevelDay {
  readonly building: string;
  readonly level: number;
  readonly resource: string;
  readonly perDay: number;
  readonly soldFor: number;
  readonly upkeep: number;
  readonly upkeepPercent: number;
}

/** Every works at every level: a day's output (weather averaged), its sale value and its upkeep's share. */
export function worksLevelDays(island: WildIsland, days: number): WorksLevelDay[] {
  return BUILDINGS.flatMap((b) => {
    if (b.kind !== 'works') return [];
    const site = island.sites.get(b.id) ?? island.home;
    const source = worksSource(b);
    const pace = paceAt(b, site, island);
    return b.levels.map((l, i) => {
      const cycleSeconds = productionCycleSeconds(source.seconds, l, JOB_RULES);
      const cycles = followsWeather(b)
        ? pacedProgress(
            {
              sinceMs: 0,
              nowMs: days * DAY_MS,
              pausedAtMs: null,
              cycleSeconds,
              maxCycles: null,
              homesteadPause: null,
            },
            pace,
          ).cycles / days
        : 86_400 / cycleSeconds;
      const perDay = Math.floor(cycles) * source.perCycle;
      const soldFor = sellValue(source.resource, perDay);
      return {
        building: b.id,
        level: i + 1,
        resource: source.resource,
        perDay,
        soldFor,
        upkeep: l.upkeep,
        upkeepPercent: soldFor === 0 ? Infinity : Math.round((l.upkeep * 100) / soldFor),
      };
    });
  });
}

/** One of the kid's works as the model tracks it. */
interface Placed {
  readonly rowId: string;
  readonly data: WorksBuilding;
  readonly site: Hex;
  readonly pace: WorksPace;
  /** Next to the sea or a river: the storm's flood bonus. */
  readonly nearWater: boolean;
  level: number;
  readonly placedAtMs: number;
  sinceMs: number;
  pausedAtMs: number | null;
  knockedAtMs: number | null;
  checkedMs: number;
}

interface Step {
  readonly building: string;
  readonly level: number;
}

/** The kid's build plan: every works at level 1 in order, then each level up in turn. */
export function wildPlan(kid: WildIsleKid): Step[] {
  const steps: Step[] = [];
  for (let level = 1; level <= kid.maxLevel; level++) {
    for (const id of kid.works) steps.push({ building: id, level });
  }
  return steps;
}

const stepCost = (step: Step): Counts => ({
  ...levelOf(worksData(step.building).levels, step.level).cost,
});

/** One day of one run, at the end of the day. */
export interface WildDay {
  readonly day: number;
  readonly balance: number;
  readonly played: number;
  readonly sold: number;
  readonly upkeep: number;
  readonly pausedMornings: number;
  /** Output landed that day, and its worth at sell price. */
  readonly output: number;
  readonly outputWorth: number;
  /** Buildings a storm knocked about that day, and what fixing them cost (worth at sell price). */
  readonly knocks: number;
  readonly repairWorth: number;
  readonly buildings: readonly string[];
}

export interface WildIsleRun {
  readonly kid: string;
  readonly away: readonly number[];
  readonly storms: boolean;
  /** The first day each works stood (by id). */
  readonly builtDay: Readonly<Record<string, number>>;
  readonly days: readonly WildDay[];
}

interface RunInput {
  readonly kid: WildIsleKid;
  readonly island: WildIsland;
  readonly income: readonly Counts[];
  readonly sessions: readonly number[];
  readonly played: number;
  readonly away: readonly number[];
  readonly storms: boolean;
  readonly mapSeed: string;
  readonly days: number;
}

/** When each storm front left `tile` after `fromMs`, by `nowMs` (the server's `frontsToRoll`). */
function stormsToRoll(fronts: readonly WeatherFront[], tile: Hex, fromMs: number, nowMs: number) {
  return fronts
    .filter((f) => f.kind === 'storm')
    .flatMap((front) => {
      const end = frontCover(front, tile).find(([, b]) => b > fromMs)?.[1];
      return end !== undefined && end <= nowMs ? [{ front, atMs: end }] : [];
    })
    .sort((a, b) => a.atMs - b.atMs || (a.front.id < b.front.id ? -1 : 1));
}

/** One kid on the island for `days` days. */
export function runWildKid(input: RunInput): WildIsleRun {
  const { kid, island } = input;
  const plan = wildPlan(kid);
  const placed: Placed[] = [];
  const bag: Counts = {};
  const terrain = new Map(island.tiles.map((t) => [hexKey(t), t.terrain]));
  const storm = WEATHER_RULES.effects.storm;
  let balance = 0;
  let next = 0;
  let rows = 0;
  const builtDay: Record<string, number> = {};
  const days: WildDay[] = [];

  /** Lands each works' finished cycles at `atMs` (eaters last). Returns what landed. */
  const settle = (atMs: number): Counts => {
    const landed: Counts = {};
    const order = [...placed].sort((a, b) => Number(!!a.data.eats) - Number(!!b.data.eats));
    for (const p of order) {
      const source = worksSource(p.data);
      const row = levelOf(p.data.levels, p.level);
      const cycleSeconds = productionCycleSeconds(source.seconds, row, JOB_RULES);
      const stops = [p.pausedAtMs, p.knockedAtMs].filter((ms): ms is number => ms !== null);
      const progress = pacedProgress(
        {
          sinceMs: p.sinceMs,
          nowMs: atMs,
          pausedAtMs: stops.length > 0 ? Math.min(...stops) : null,
          cycleSeconds,
          maxCycles: storageCycles(row, cycleSeconds),
          homesteadPause: null,
        },
        p.pace,
      );
      const paid = Math.min(progress.cycles, eatsCap(p.data.eats, bag));
      add(bag, eatenBy(p.data.eats, paid), -1);
      const items = productionYield(
        source,
        progress.finishedMs.slice(0, paid),
        RESOURCES,
        () => NO_SEASONS,
      );
      add(bag, items);
      add(landed, items);
      p.sinceMs = progress.nextSinceMs;
    }
    return landed;
  };

  /** Rolls the storms that left each works' tile by `atMs`. Returns how many it knocked. */
  const rollStorms = (atMs: number): number => {
    let knocked = 0;
    for (const p of placed) {
      if (p.knockedAtMs !== null) continue;
      for (const { front, atMs: end } of stormsToRoll(island.fronts, p.site, p.checkedMs, atMs)) {
        const percent = Math.min(
          100,
          storm.knockPercent + (p.nearWater ? storm.floodBonusPercent : 0),
        );
        if (Rng.fromSeed(deriveSeed(input.mapSeed, 'knock', front.id, p.rowId)).chance(percent)) {
          p.knockedAtMs = end;
          knocked += 1;
          break;
        }
      }
      p.checkedMs = atMs;
    }
    return knocked;
  };

  for (let day = 1; day <= input.days; day++) {
    const dayMs = (day - 1) * DAY_MS;
    const playing = !input.away.includes(day);
    let played = 0;
    let sold = 0;
    let knocks = 0;
    let repairWorth = 0;
    const landed: Counts = {};

    // The morning: each works placed before it owes one, in charge order; a knocked one owes nothing.
    const morningMs = dayMs + MORNING_MS;
    const owing = upkeepOrder(
      placed
        .filter((p) => p.placedAtMs < morningMs)
        .map((p) => ({
          id: p.rowId,
          kind: 'works' as const,
          level: p.level,
          upkeep: levelOf(p.data.levels, p.level).upkeep,
          placedAtMs: p.placedAtMs,
          rank: null,
          paused: p.pausedAtMs !== null,
          mornings: [String(day)],
          canWork: () => p.knockedAtMs === null || p.knockedAtMs > morningMs,
        })),
    );
    const charged = planUpkeep(balance, owing);
    const pausing = charged.steps.filter((s) => s.kind === 'paused');
    for (const s of pausing) {
      const p = placed.find((x) => x.rowId === s.id);
      if (p) p.pausedAtMs = morningMs;
    }
    const upkeep = balance - charged.balance;
    balance = charged.balance;

    for (const [i, hour] of (playing ? input.sessions : []).entries()) {
      const atMs = dayMs + hour * HOUR_MS;
      if (input.storms) knocks += rollStorms(atMs);
      add(landed, settle(atMs));
      if (i === 0) {
        add(bag, input.income[day - 1] ?? {});
        played = input.played;
        balance += played;
      }

      // Fix what the storms knocked about first (it works again from now).
      for (const p of placed.filter((x) => x.knockedAtMs !== null)) {
        const cost = repairCost(p.data, p.level, WEATHER_RULES.effects);
        if (!covers(bag, cost)) continue;
        add(bag, cost, -1);
        repairWorth += worth(cost);
        p.knockedAtMs = null;
        p.sinceMs = atMs;
        p.checkedMs = atMs;
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

      // Wake paused works the balance covers, in charge order.
      const asleep = upkeepOrder(
        placed
          .filter((p) => p.pausedAtMs !== null)
          .map((p) => ({
            id: p.rowId,
            kind: 'works' as const,
            level: p.level,
            upkeep: levelOf(p.data.levels, p.level).upkeep,
            placedAtMs: p.placedAtMs,
            rank: null,
          })),
      );
      for (const w of planResume(balance, asleep)) {
        const p = placed.find((x) => x.rowId === w.id);
        if (!p) continue;
        p.sinceMs = resumeSinceMs(p.sinceMs, p.pausedAtMs ?? atMs, atMs, null);
        p.pausedAtMs = null;
      }

      // Build or upgrade, in plan order, while the next step is affordable.
      while (next < plan.length) {
        const step = plan[next] as Step;
        const cost = stepCost(step);
        if (!covers(bag, cost)) break;
        add(bag, cost, -1);
        const standing = placed.find((p) => p.data.id === step.building);
        if (standing) {
          add(landed, settle(atMs)); // an upgrade raises the pace from now
          standing.level = step.level;
        } else {
          const data = worksData(step.building);
          const site = island.sites.get(data.id);
          if (!site) throw new Error(`no site for "${data.id}"`);
          placed.push({
            rowId: `${input.mapSeed}-${kid.id}-row-${String((rows += 1))}`,
            data,
            site,
            pace: paceAt(data, site, island),
            nearWater: hexNeighbors(site).some((n) => {
              const water = waterKindOf(terrain.get(hexKey(n)) ?? '');
              return water !== null && storm.nearWater.includes(water);
            }),
            level: 1,
            placedAtMs: atMs,
            sinceMs: atMs,
            pausedAtMs: null,
            knockedAtMs: null,
            checkedMs: atMs,
          });
          builtDay[data.id] ??= day;
        }
        next += 1;
      }
    }

    days.push({
      day,
      balance,
      played,
      sold,
      upkeep,
      pausedMornings: pausing.length,
      output: total(landed),
      outputWorth: worth(landed),
      knocks,
      repairWorth,
      buildings: placed.map((p) => `${p.data.id} ${String(p.level)}`),
    });
  }
  return { kid: kid.id, away: input.away, storms: input.storms, builtDay, days };
}

/** Every run: each kid daily and away, with storms and without. */
export function runWildIsle(config: WildIsleConfig, progression: ProgressionConfig): WildIsleRun[] {
  const island = wildIsland(config);
  const income = buildIncome({ ...PATCH_ECONOMY_CONFIG, days: config.days }, progression);
  const runs: WildIsleRun[] = [];
  for (const kid of config.kids) {
    const economyKid = PATCH_ECONOMY_CONFIG.kids.find((k) => k.id === kid.id);
    if (!economyKid) throw new Error(`no patch economy kid "${kid.id}"`);
    for (const away of [[], config.awayDays]) {
      for (const storms of [true, false]) {
        runs.push(
          runWildKid({
            kid,
            island,
            income: income.get(`4/${kid.id}`) ?? [],
            sessions: economyKid.sessions,
            played: playCoins(economyKid),
            away,
            storms,
            mapSeed: config.mapSeed,
            days: config.days,
          }),
        );
      }
    }
  }
  return runs;
}

/** A run's totals from `fromDay` on. */
const sum = (run: WildIsleRun, pick: (d: WildDay) => number, fromDay = 1) =>
  run.days.filter((d) => d.day >= fromDay).reduce((a, d) => a + pick(d), 0);

/** Works upkeep as a whole percent of what the output sold for, from `fromDay` on. */
export function worksUpkeepPercent(run: WildIsleRun, fromDay = 1): number {
  const sold = sum(run, (d) => d.outputWorth, fromDay);
  return sold === 0 ? 0 : Math.round((sum(run, (d) => d.upkeep, fromDay) * 100) / sold);
}

/**
 * What storms cost a kid, as a whole percent of a week's output worth (the
 * same over the run): the output the stormless run made beyond the stormy
 * one, plus every fix, at sell price.
 */
export function stormCostPercent(stormy: WildIsleRun, calm: WildIsleRun): number {
  const calmWorth = sum(calm, (d) => d.outputWorth);
  const missed = Math.max(0, calmWorth - sum(stormy, (d) => d.outputWorth));
  const fixes = sum(stormy, (d) => d.repairWorth);
  return calmWorth === 0 ? 0 : Math.round(((missed + fixes) * 100) / calmWorth);
}

/** The stormy and calm runs of a kid (daily or away). */
export function stormPair(
  runs: readonly WildIsleRun[],
  kid: string,
  away: boolean,
): { stormy: WildIsleRun; calm: WildIsleRun } {
  const of = (storms: boolean) =>
    runs.find((r) => r.kid === kid && r.storms === storms && r.away.length > 0 === away);
  const stormy = of(true);
  const calm = of(false);
  if (!stormy || !calm) throw new Error(`no storm pair for "${kid}"`);
  return { stormy, calm };
}

/** The report's Markdown. */
export function renderWildIsle(
  runs: readonly WildIsleRun[],
  config: WildIsleConfig,
  meta: { seconds: number },
): string {
  const island = wildIsland(config);
  const levels = worksLevelDays(island, config.days);
  const label = (r: WildIsleRun) =>
    `${r.kid}${r.away.length > 0 ? ` (away ${String(r.away[0])}–${String(r.away.at(-1))})` : ''}${r.storms ? '' : ', no storms'}`;
  const storms = island.fronts.filter((f) => f.kind === 'storm').length;
  const lines = [
    '# Wild Isle economy report (#621 W1-8)',
    '',
    `Water works and Heart Coins over ${String(config.days)} days on island "${config.mapSeed}" (${String(island.fronts.length)} fronts, ${String(storms)} storms). ${String(runs.length)} runs in ${meta.seconds.toFixed(1)} s. Lakes give no flood bonus: \`nearWater\` is ${WEATHER_RULES.effects.storm.nearWater.join(' and ')}.`,
    '',
    '## Each works level, a day on its homestead (the weather averaged)',
    '',
    `Guard: upkeep ${String(config.upkeepShare.min)}–${String(config.upkeepShare.max)} % of a day's output sold.`,
    '',
    '| Works | Level | Makes a day | Sells for 💛 | Upkeep 💛 | Upkeep % |',
    '|---|---|---|---|---|---|',
    ...levels.map(
      (l) =>
        `| ${l.building} | ${String(l.level)} | ${String(l.perDay)} ${l.resource} | ${String(l.soldFor)} | ${String(l.upkeep)} | ${String(l.upkeepPercent)} |`,
    ),
    '',
    '## Each kid',
    '',
    '| Kid | First pier | River Well | Upkeep % of output sold | Knocks | Storm cost % | 💛 day 30 | Works day 30 |',
    '|---|---|---|---|---|---|---|---|',
    ...runs.map((r) => {
      const pair = r.storms ? stormPair(runs, r.kid, r.away.length > 0) : null;
      return `| ${label(r)} | ${String(r.builtDay['fishing-pier'] ?? '-')} | ${String(r.builtDay['river-well'] ?? '-')} | ${String(worksUpkeepPercent(r))} | ${String(sum(r, (d) => d.knocks))} | ${pair ? String(stormCostPercent(pair.stormy, pair.calm)) : '-'} | ${String(r.days.at(-1)?.balance ?? 0)} | ${(r.days.at(-1)?.buildings ?? []).join(', ')} |`;
    }),
    '',
    `Guards: a casual kid's first Fishing Pier by day ${String(config.firstPierByDay)}; an engaged kid's River Well by day ${String(config.riverWellByDay)}; upkeep ${String(config.upkeepShare.min)}–${String(config.upkeepShare.max)} % of a day's output sold at every works level; no negative balance; storms cost an engaged kid at most ${String(config.stormMaxPercent)} % of a week's output.`,
    '',
    '## Not modelled',
    '',
    ...WILD_ISLE_LIMITS.map((l) => `- ${l}`),
    '',
  ];
  return lines.join('\n');
}
