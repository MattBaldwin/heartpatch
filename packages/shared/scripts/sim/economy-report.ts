import { CURRENT_RULES, type ProgressionConfig } from './progression-config.js';
import { modelData, runProgression } from './progression.js';
import { generateMap } from '../../src/mapgen/index.js';
import { EXPLORE_RULES } from '../../src/data/explore.js';
import { GAME_DATA } from '../../src/data/index.js';
import { hexKey } from '../../src/hex/index.js';
import type { ExploreRules } from '../../src/schemas/data/explore.js';
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
export function runEconomy(
  config: EconomyConfig,
  progression: ProgressionConfig,
  bonus: Pick<ExploreRules, 'homestead'> = EXPLORE_RULES,
): EconomyRow[] {
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
          shown.push(economyDay(day, profile, today.land, tiles, progress, bonus));
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

/** Describes a homestead bonus: "+1 a cycle", "125 %, rounded up", or both. */
export function bonusLabel(bonus: Pick<ExploreRules, 'homestead'>): string {
  const { yieldPercent, yieldPlus } = bonus.homestead;
  const parts = [
    ...(yieldPercent === 100 ? [] : [`${String(yieldPercent)} %, rounded up`]),
    ...(yieldPlus === 0 ? [] : [`+${String(yieldPlus)} a cycle`]),
  ];
  return parts.join(', then ') || 'nothing';
}

/** Each candidate bonus's gain, by kid and day, on the 4-seat map: the table the bonus is picked from. */
export interface CandidateRow {
  readonly label: string;
  /** `${kid} day ${day}` → gain, a whole percent. */
  readonly gains: ReadonlyMap<string, number>;
}

export function runCandidates(
  config: EconomyConfig,
  progression: ProgressionConfig,
): CandidateRow[] {
  const fourSeats = { ...config, seats: [config.seats[0] ?? 4] };
  return config.candidates.map((c) => {
    const gains = new Map<string, number>();
    for (const row of runEconomy(fourSeats, progression, c)) {
      for (const d of row.days) gains.set(`${row.kid} day ${String(d.day)}`, gainPercent(d));
    }
    return { label: c.label, gains };
  });
}

/** The report's Markdown. */
export function renderEconomy(
  rows: readonly EconomyRow[],
  config: EconomyConfig,
  meta: { seconds: number },
  candidates: readonly CandidateRow[] = [],
): string {
  const lines = [
    '# Economy report (#199)',
    '',
    `Resources a kid gathers in a day, without and with the shipped homestead bonus (${bonusLabel(EXPLORE_RULES)} on every cycle a homestead gives). Land from \`pnpm sim:progression\` (shipped rules); ${String(rows.length)} runs in ${meta.seconds.toFixed(1)} s.`,
    '',
    '| Seats | Kid | Day | Outer tiles | Explored | Homesteads | Gatherers on homesteads | Without | With | **Gain** |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    for (const d of row.days) {
      lines.push(
        `| ${String(row.seats)} | ${row.kid} | ${String(d.day)} | ${String(d.outer)} | ${String(d.explored)} | ${String(d.homesteads)} | ${String(d.onHomesteads)} | ${String(total(d.without))} | ${String(total(d.with))} | **${String(gainPercent(d))} %** |`,
      );
    }
  }
  if (candidates.length > 0) {
    const keys = [...(candidates[0]?.gains.keys() ?? [])];
    lines.push(
      '',
      '## Candidate bonuses (4 seats, gain)',
      '',
      `| Bonus | ${keys.join(' | ')} |`,
      `|---|${keys.map(() => '---|').join('')}`,
      ...candidates.map(
        (c) =>
          `| ${c.label} | ${keys.map((k) => `${String(c.gains.get(k) ?? 0)} %`).join(' | ')} |`,
      ),
    );
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
