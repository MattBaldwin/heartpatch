import { CURRENT_RULES, type ProgressionConfig } from './progression-config.js';
import { modelData, runProgression } from './progression.js';
import { generateMap } from '../../src/mapgen/index.js';
import { GAME_DATA } from '../../src/data/index.js';
import { hexKey } from '../../src/hex/index.js';
import type { FuelConfig } from './fuel-config.js';
import { FUEL_LIMITS, FUEL_PER_NIGHT, emberwoodLand, fuelDay, type FuelDay } from './fuel.js';

/** One kind of kid on one map size. */
export interface FuelRow {
  readonly seats: number;
  readonly kid: string;
  readonly days: readonly FuelDay[];
}

/** The progression model's land (shipped rules, kid 0 of each run), then fuel on it. */
export function runFuel(config: FuelConfig, progression: ProgressionConfig): FuelRow[] {
  const days = Math.max(...config.days);
  const short: ProgressionConfig = { ...progression, days };
  const data = modelData();
  const rows: FuelRow[] = [];
  for (const seats of config.seats) {
    const map = generateMap(GAME_DATA, { seed: progression.mapSeed, playerCount: seats });
    const tiles = new Map(map.tiles.map((t) => [hexKey(t), t]));
    for (const profile of config.profiles) {
      const kid = progression.kids.find((k) => k.id === profile.id);
      if (!kid) throw new Error(`no progression kid "${profile.id}"`);
      const run = runProgression(data, short, CURRENT_RULES, kid, seats);
      const record = run.kids[0]?.days ?? [];
      rows.push({
        seats,
        kid: profile.id,
        days: config.days.map((day) => {
          const today = record[day - 1];
          if (!today) throw new Error(`no day ${String(day)} in the progression run`);
          return fuelDay(day, profile, emberwoodLand(today.land, tiles));
        }),
      });
    }
  }
  return rows;
}

/** The report's Markdown. */
export function renderFuel(
  rows: readonly FuelRow[],
  config: FuelConfig,
  meta: { seconds: number },
): string {
  const lines = [
    '# Fuel report (#202)',
    '',
    `Each Hearthfire burns ${String(FUEL_PER_NIGHT)} Emberwood a night. Land from \`pnpm sim:progression\` (shipped rules); ${String(rows.length)} runs in ${meta.seconds.toFixed(1)} s.`,
    '',
    '| Seats | Kid | Day | Outer tiles | Emberwood nodes | Keeper / day | Gatherers / day | Fires land allows | Fires Keeper alone fuels | Fires all fuel feeds | **Lit** |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    for (const d of row.days) {
      lines.push(
        `| ${String(row.seats)} | ${row.kid} | ${String(d.day)} | ${String(d.outer)} | ${String(d.nodes)} | ${String(d.keeper)} | ${String(d.gatherers)} | ${String(d.landFires)} | ${String(d.keeperFires)} | ${String(d.fuelFires)} | **${String(d.lit)}** |`,
      );
    }
  }
  lines.push('', '## Profiles', '');
  for (const p of config.profiles) {
    lines.push(
      `- **${p.id}:** sessions at ${p.sessions.map((h) => `${String(h)}:00`).join(', ')}; the Keeper taps ${p.keeperNodes >= 99 ? 'every' : String(p.keeperNodes)} Emberwood node(s); ${String(p.gatherers)} gatherer(s) at ${String(p.gathererSpeedPercent)} % speed.`,
    );
  }
  lines.push('', '## Not modelled', '', ...FUEL_LIMITS.map((l) => `- ${l}`), '');
  return lines.join('\n');
}
