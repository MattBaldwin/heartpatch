import { BUILDINGS } from '../../src/data/buildings.js';
import { GAME_DATA } from '../../src/data/index.js';
import { RECIPES } from '../../src/data/recipes.js';
import { hexKey, type HexKey } from '../../src/hex/index.js';
import { generateMap, type MapTile } from '../../src/mapgen/index.js';
import type { FactoryConfig } from './factory-config.js';
import { buildBudget } from './fuel-cover.js';
import { CURRENT_RULES, type ProgressionConfig } from './progression-config.js';
import { modelData, runProgression } from './progression.js';

/*
 * When can a kid pay for each Crafting Factory level? (#294.) Each day, the
 * kid's build income so far (the fuel model's, minus the share kept for
 * fires), less their first home builds and the Timber their Heart Charms
 * take, against the Factory's levels added up.
 */

/** What the model leaves out, for the report. */
export const FACTORY_LIMITS = [
  "build income is the fuel model's (#277): the Keeper's build-node taps and build gatherers, every day so far, on that day's land",
  'the kid saves for the Factory before any fence or second-level building',
  'fires get their own share of build materials, as in `pnpm sim:fuel`',
] as const;

const factory = BUILDINGS.find((b) => b.kind === 'factory');
if (factory?.kind !== 'factory') throw new Error('no Crafting Factory in the building data');
const FACTORY = factory;
const CHARM = RECIPES.find((r) => r.id === 'heart-charm');
if (!CHARM) throw new Error('no Heart Charm recipe');
const CHARM_TIMBER = CHARM.inputs['timber'] ?? 0;

type Counts = Record<string, number>;

function add(into: Counts, items: Readonly<Counts>, times = 1): Counts {
  for (const [id, n] of Object.entries(items)) into[id] = (into[id] ?? 0) + n * times;
  return into;
}

/** Everything paid to have the Factory at each level (index 0 = level 1). */
export function factoryLevelCosts(): Counts[] {
  const total: Counts = {};
  return FACTORY.levels.map((l) => ({ ...add(total, l.cost) }));
}

/** What the first home builds cost, at level 1. */
export function firstBuildsCost(ids: readonly string[]): Counts {
  const total: Counts = {};
  for (const id of ids) {
    const b = BUILDINGS.find((x) => x.id === id);
    if (!b) throw new Error(`no building "${id}"`);
    add(total, b.levels[0]?.cost ?? {});
  }
  return total;
}

/** Does `budget` cover `cost`? */
export const covers = (budget: Readonly<Counts>, cost: Readonly<Counts>): boolean =>
  Object.entries(cost).every(([id, n]) => (budget[id] ?? 0) >= n);

/** One kid on one map size: the first day each Factory level is paid for (null: not by `days`). */
export interface FactoryRow {
  readonly seats: number;
  readonly kid: string;
  readonly levelDays: readonly (number | null)[];
}

export function runFactory(config: FactoryConfig, progression: ProgressionConfig): FactoryRow[] {
  const short: ProgressionConfig = { ...progression, days: config.days };
  const data = modelData();
  const levels = factoryLevelCosts();
  const first = firstBuildsCost(config.firstBuilds);
  const rows: FactoryRow[] = [];
  for (const seats of config.seats) {
    const map = generateMap(GAME_DATA, { seed: progression.mapSeed, playerCount: seats });
    const tiles = new Map<HexKey, MapTile>(map.tiles.map((t) => [hexKey(t), t]));
    for (const profile of config.profiles) {
      const kid = progression.kids.find((k) => k.id === profile.id);
      if (!kid) throw new Error(`no progression kid "${profile.id}"`);
      const record = runProgression(data, short, CURRENT_RULES, kid, seats).kids[0]?.days ?? [];
      const spare = { ...profile, buildShare: 100 - profile.buildShare };
      const charms = config.charmsPerDay[profile.id] ?? 0;
      const levelDays: (number | null)[] = levels.map(() => null);
      for (let day = 1; day <= config.days; day++) {
        const land = record[day - 1]?.land ?? [];
        const owned = land.flatMap((k) => {
          const t = tiles.get(k);
          return t ? [t] : [];
        });
        const budget = buildBudget(spare, day, owned);
        const spent = add({ ...first }, { timber: CHARM_TIMBER * charms * day });
        const left: Counts = {};
        for (const [id, n] of Object.entries(budget)) left[id] = n - (spent[id] ?? 0);
        levels.forEach((cost, i) => {
          if (levelDays[i] === null && covers(left, cost)) levelDays[i] = day;
        });
      }
      rows.push({ seats, kid: profile.id, levelDays });
    }
  }
  return rows;
}

/** The report's Markdown. */
export function renderFactory(
  rows: readonly FactoryRow[],
  config: FactoryConfig,
  meta: { seconds: number },
): string {
  const costs = FACTORY.levels.map((l, i) => {
    const cost = Object.entries(l.cost)
      .map(([id, n]) => `${String(n)} ${id}`)
      .join(', ');
    return `level ${String(i + 1)} (${String(l.queues)} batches): ${cost}`;
  });
  const day = (d: number | null) => (d === null ? `not by day ${String(config.days)}` : String(d));
  const lines = [
    '# Crafting Factory report (#294)',
    '',
    `The first day a kid can pay for each Factory level, after their first home builds (${config.firstBuilds.join(', ')}) and their Heart Charms' Timber. ${String(rows.length)} runs in ${meta.seconds.toFixed(1)} s.`,
    '',
    ...costs.map((c) => `- ${c}`),
    '',
    `| Seats | Kid | ${FACTORY.levels.map((_, i) => `Level ${String(i + 1)}`).join(' | ')} |`,
    `|---|---|${FACTORY.levels.map(() => '---').join('|')}|`,
    ...rows.map(
      (r) => `| ${String(r.seats)} | ${r.kid} | ${r.levelDays.map((d) => day(d)).join(' | ')} |`,
    ),
    '',
    `Guardrails: a casual kid builds level 1 by day ${String(config.levelOneByDay)} and level 2 by day ${String(config.levelTwoByDay)}.`,
    '',
    '## Not modelled',
    '',
    ...FACTORY_LIMITS.map((l) => `- ${l}`),
    '',
  ];
  return lines.join('\n');
}
