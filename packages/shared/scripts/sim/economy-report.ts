import { CURRENT_RULES, type ProgressionConfig } from './progression-config.js';
import { modelData, runProgression } from './progression.js';
import { generateMap } from '../../src/mapgen/index.js';
import { EXPLORE_RULES } from '../../src/data/explore.js';
import { GAME_DATA } from '../../src/data/index.js';
import { hexKey } from '../../src/hex/index.js';
import type { EconomyConfig } from './economy-config.js';
import {
  ECONOMY_LIMITS,
  economyDay,
  exploreDay,
  total,
  type EconomyDay,
  type ExploreProgress,
} from './economy.js';

/** One kind of kid on one map size. */
export interface EconomyRow {
  readonly seats: number;
  readonly kid: string;
  readonly days: readonly EconomyDay[];
}

/** The progression model's land (shipped rules, kid 0 of each run), explored day by day. */
export function runEconomy(config: EconomyConfig, progression: ProgressionConfig): EconomyRow[] {
  const days = Math.max(...config.days);
  const short: ProgressionConfig = { ...progression, days };
  const data = modelData();
  const rows: EconomyRow[] = [];
  for (const seats of config.seats) {
    const map = generateMap(GAME_DATA, { seed: progression.mapSeed, playerCount: seats });
    const tiles = new Map(map.tiles.map((t) => [hexKey(t), t]));
    for (const profile of config.profiles) {
      const kid = progression.kids.find((k) => k.id === profile.kid);
      if (!kid) throw new Error(`no progression kid "${profile.kid}"`);
      const record = runProgression(data, short, CURRENT_RULES, kid, seats).kids[0]?.days ?? [];
      const progress: ExploreProgress = new Map();
      const shown: EconomyDay[] = [];
      for (let day = 1; day <= days; day++) {
        const today = record[day - 1];
        if (!today) throw new Error(`no day ${String(day)} in the progression run`);
        exploreDay(progress, today.land, tiles, progression.mapSeed, profile);
        if (config.days.includes(day)) {
          shown.push(economyDay(day, profile, today.land, tiles, progress));
        }
      }
      rows.push({ seats, kid: profile.id, days: shown });
    }
  }
  return rows;
}

/** How much more a day brings in with the homestead bonus, a whole percent. */
export function gainPercent(day: EconomyDay): number {
  const before = total(day.without);
  return before === 0 ? 0 : Math.round(((total(day.with) - before) * 100) / before);
}

const list = (income: Readonly<Record<string, number>>) =>
  Object.entries(income)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(', ') || 'nothing';

/** The report's Markdown. */
export function renderEconomy(
  rows: readonly EconomyRow[],
  config: EconomyConfig,
  meta: { seconds: number },
): string {
  const lines = [
    '# Economy report (#199)',
    '',
    `Resources a kid gathers in a day, without and with the homestead bonus (${String(EXPLORE_RULES.homestead.gatherPercent)} % speed on a homestead's gathers). Land from \`pnpm sim:progression\` (shipped rules); ${String(rows.length)} runs in ${meta.seconds.toFixed(1)} s.`,
    '',
    '| Seats | Kid | Day | Outer tiles | Explored | Homesteads | Without | With | **Gain** |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    for (const d of row.days) {
      lines.push(
        `| ${String(row.seats)} | ${row.kid} | ${String(d.day)} | ${String(d.outer)} | ${String(d.explored)} | ${String(d.homesteads)} | ${String(total(d.without))} | ${String(total(d.with))} | **${String(gainPercent(d))} %** |`,
      );
    }
  }
  lines.push('', '## By resource', '');
  for (const row of rows) {
    for (const d of row.days) {
      lines.push(
        `- ${String(row.seats)} seats, ${row.kid}, day ${String(d.day)}: without ${list(d.without)}; with ${list(d.with)}.`,
      );
    }
  }
  lines.push('', '## Profiles', '');
  for (const p of config.profiles) {
    lines.push(
      `- **${p.id}** (${p.kid}'s land): sessions at ${p.sessions.map((h) => `${String(h)}:00`).join(', ')}; the Keeper taps ${String(p.keeperNodes)} node(s); ${String(p.gatherers)} gatherer(s); ${String(p.searchesPerDay)} searches a day.`,
    );
  }
  lines.push('', '## Not modelled', '', ...ECONOMY_LIMITS.map((l) => `- ${l}`), '');
  return lines.join('\n');
}
