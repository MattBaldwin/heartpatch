import type { MapFillRules } from './map-fill-config.js';
import { MAP_FILL_LIMITS, type MapFillRun } from './map-fill.js';

/** What one run comes to. */
export interface MapFillSummary {
  readonly scenario: string;
  readonly rules: string;
  /** First day no neutral land was left outside Juniper's Gap (null: never within the run). */
  readonly mapFull: number | null;
  /** Days a kid who played had no neutral tile next to their land, per kid who keeps playing. */
  readonly nothingToClaim: readonly number[];
  /** Tiles that went wild from kids who keep playing (should be 0). */
  readonly lostByPlayers: number;
  /** Tiles that went wild in all. */
  readonly wentWild: number;
  /** Tiles that had gone wild and were claimed again. */
  readonly reclaimed: number;
}

export function summariseMapFill(run: MapFillRun): MapFillSummary {
  const { seats } = run.scenario;
  const keeps = seats.flatMap((seat, s) => (seat.stopsAfterDay === null ? [s] : []));
  const sum = (pick: (d: MapFillRun['days'][number]) => number) =>
    run.days.reduce((total, d) => total + pick(d), 0);
  return {
    scenario: run.scenario.id,
    rules: run.rules.label,
    mapFull: run.days.find((d) => d.neutralLeftOutsideGap === 0)?.day ?? null,
    nothingToClaim: keeps.map((s) => run.days.filter((d) => d.nothingToClaim[s]).length),
    lostByPlayers: sum((d) => keeps.reduce((t, s) => t + (d.wentWild[s] ?? 0), 0)),
    wentWild: sum((d) => d.wentWild.reduce((t, n) => t + n, 0)),
    reclaimed: sum((d) => d.reclaimed.reduce((t, n) => t + n, 0)),
  };
}

/** Tiles the kid who stops holds on their last day and after each number of days away. */
export function awayTiles(run: MapFillRun, awayDays: readonly number[]) {
  const s = run.scenario.seats.findIndex((seat) => seat.stopsAfterDay !== null);
  const stop = run.scenario.seats[s]?.stopsAfterDay;
  if (s < 0 || stop === undefined || stop === null) return null;
  const at = (day: number) => run.days.find((d) => d.day === day)?.tiles[s] ?? null;
  return { atStop: at(stop), away: awayDays.map((n) => ({ days: n, tiles: at(stop + n) })) };
}

const cell = (v: number | null) => (v === null ? '—' : String(v));

export function renderMapFill(
  runs: readonly MapFillRun[],
  rules: readonly MapFillRules[],
  options: {
    readonly days: number;
    readonly awayDays: readonly number[];
    readonly seconds: number;
  },
): string {
  const scenarios = [...new Map(runs.map((r) => [r.scenario.id, r.scenario])).values()];
  const runOf = (scenario: string, label: string) =>
    runs.find((r) => r.scenario.id === scenario && r.rules.label === label);
  const header = (first: string) =>
    `| ${first} | ${rules.map((r) => r.label).join(' | ')} |\n|---|${rules.map(() => '---:').join('|')}|`;
  const lines: string[] = [];
  lines.push('# Map-fill model: land that misses you');
  lines.push('');
  lines.push(
    `${String(runs.length)} runs of ${String(options.days)} days in ${options.seconds.toFixed(1)} s. ` +
      'Owner decision 2026-10-06 (design review Q2). Same data and config, same report.',
  );
  lines.push('');
  const tending = rules.find((r) => r.tending)?.tending;
  if (tending) {
    lines.push(
      `Tending rules: fades after ${String(tending.missesYouAfterDays)} days untended, can go wild ` +
        `after ${String(tending.wildAfterDays)}, at most ${String(tending.wildPerNight.gentle)} (Gentle) / ` +
        `${String(tending.wildPerNight.on)} (On, Off) tiles a player a night, farthest first; ` +
        `tiles within ${String(tending.keepRadius)} of a Heart Seed never fade; Visit tends all of a kid's land.`,
    );
    lines.push('');
  }

  lines.push("## Map-full day (no neutral land left outside Juniper's Gap)");
  lines.push('');
  lines.push(header('Scenario'));
  for (const sc of scenarios) {
    const row = rules.map((r) => {
      const run = runOf(sc.id, r.label);
      return run ? cell(summariseMapFill(run).mapFull) : '—';
    });
    lines.push(`| ${sc.title} | ${row.join(' | ')} |`);
  }
  lines.push('');

  lines.push(
    `## Days with nothing to claim (days 1–${String(options.days)}, each kid who keeps playing)`,
  );
  lines.push('');
  lines.push(header('Scenario'));
  for (const sc of scenarios) {
    const row = rules.map((r) => {
      const run = runOf(sc.id, r.label);
      return run ? summariseMapFill(run).nothingToClaim.join(' / ') : '—';
    });
    lines.push(`| ${sc.title} | ${row.join(' | ')} |`);
  }
  lines.push('');

  lines.push('## Land lost by kids who keep playing (should be 0), and land that came back');
  lines.push('');
  lines.push(header('Scenario'));
  for (const sc of scenarios) {
    const row = rules.map((r) => {
      const run = runOf(sc.id, r.label);
      if (!run) return '—';
      const s = summariseMapFill(run);
      return `${String(s.lostByPlayers)} lost · ${String(s.wentWild)} wild · ${String(s.reclaimed)} reclaimed`;
    });
    lines.push(`| ${sc.title} | ${row.join(' | ')} |`);
  }
  lines.push('');

  lines.push('## Tiles a kid keeps after stopping (home ring included)');
  lines.push('');
  for (const sc of scenarios) {
    const sample = runOf(sc.id, rules[0]?.label ?? '');
    if (!sample || !awayTiles(sample, options.awayDays)) continue;
    lines.push(`### ${sc.title}`);
    lines.push('');
    lines.push(header('Days away'));
    const rows = [
      {
        label: 'last day played',
        pick: (a: NonNullable<ReturnType<typeof awayTiles>>) => a.atStop,
      },
    ];
    for (const [i, n] of options.awayDays.entries()) {
      rows.push({ label: `${String(n)} days`, pick: (a) => a.away[i]?.tiles ?? null });
    }
    for (const row of rows) {
      const values = rules.map((r) => {
        const run = runOf(sc.id, r.label);
        const away = run ? awayTiles(run, options.awayDays) : null;
        return away ? cell(row.pick(away)) : '—';
      });
      lines.push(`| ${row.label} | ${values.join(' | ')} |`);
    }
    lines.push('');
  }

  lines.push('## Not modelled');
  lines.push('');
  for (const limit of MAP_FILL_LIMITS) lines.push(`- ${limit}`);
  lines.push('');
  return lines.join('\n');
}
