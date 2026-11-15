import { COMPUTER_MATES } from '../../src/data/server/computer-mates.js';
import { COMPUTER_MATES_GATE, COMPUTER_MATES_GATES, type MapFillRules } from './map-fill-config.js';
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
  /** Of those, won back by the Hollow Man in the dark (#277). */
  readonly hollowWild: number;
  /** Tiles that had gone wild and were claimed again. */
  readonly reclaimed: number;
  /** Tiles won from a rival (#203's model). */
  readonly captured: number;
  /** Fence segments broken, and fence fights the fence won. */
  readonly fenceBreaks: number;
  readonly fenceHolds: number;
  /** The last day a tile changed hands by a challenge (null: never): the map never freezes. */
  readonly lastCapture: number | null;
  /** Outer tiles fenced on the last day, all kids. */
  readonly fencedAtEnd: number;
}

export function summariseMapFill(run: MapFillRun): MapFillSummary {
  const { seats } = run.scenario;
  const keeps = seats.flatMap((seat, s) =>
    seat.stopsAfterDay === null && seat.computer === undefined ? [s] : [],
  );
  const sum = (pick: (d: MapFillRun['days'][number]) => number) =>
    run.days.reduce((total, d) => total + pick(d), 0);
  return {
    scenario: run.scenario.id,
    rules: run.rules.label,
    mapFull: run.days.find((d) => d.neutralLeftOutsideGap === 0)?.day ?? null,
    nothingToClaim: keeps.map((s) => run.days.filter((d) => d.nothingToClaim[s]).length),
    lostByPlayers: sum((d) => keeps.reduce((t, s) => t + (d.wentWild[s] ?? 0), 0)),
    wentWild: sum((d) => d.wentWild.reduce((t, n) => t + n, 0)),
    hollowWild: sum((d) => d.hollowWild.reduce((t, n) => t + n, 0)),
    reclaimed: sum((d) => d.reclaimed.reduce((t, n) => t + n, 0)),
    captured: sum((d) => d.captured.reduce((t, n) => t + n, 0)),
    fenceBreaks: sum((d) => d.fenceBreaks),
    fenceHolds: sum((d) => d.fenceHolds),
    lastCapture: [...run.days].reverse().find((d) => d.captured.some((n) => n > 0))?.day ?? null,
    fencedAtEnd: run.days.at(-1)?.fenced.reduce((t, n) => t + n, 0) ?? 0,
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
  lines.push('# Map-fill model: land that misses you, challenges and fences');
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
      return `${String(s.lostByPlayers)} lost · ${String(s.wentWild)} wild (${String(s.hollowWild)} by the Hollow Man) · ${String(s.reclaimed)} reclaimed`;
    });
    lines.push(`| ${sc.title} | ${row.join(' | ')} |`);
  }
  lines.push('');

  const fighting = rules.filter((r) => r.challenges);
  if (fighting.length > 0) {
    lines.push('## Challenges and fences (#203)');
    lines.push('');
    lines.push(
      'Once nothing neutral is left next to their land, kids challenge a rival’s. Each cell: ' +
        'tiles won from a rival · fence segments broken · fence fights the fence won · ' +
        'outer tiles fenced on the last day · the last day a tile changed hands (the map never freezes).',
    );
    lines.push('');
    lines.push(
      `| Scenario | ${fighting.map((r) => r.label).join(' | ')} |\n|---|${fighting.map(() => '---:').join('|')}|`,
    );
    for (const sc of scenarios) {
      const row = fighting.map((r) => {
        const run = runOf(sc.id, r.label);
        if (!run) return '—';
        const s = summariseMapFill(run);
        return (
          `${String(s.captured)} won · ${String(s.fenceBreaks)} broken · ${String(s.fenceHolds)} held · ` +
          `${String(s.fencedAtEnd)} fenced · last day ${cell(s.lastCapture)}`
        );
      });
      lines.push(`| ${sc.title} | ${row.join(' | ')} |`);
    }
    lines.push('');
  }

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

  const mates = computerMatesGates(runs);
  if (mates.rows.length > 0) {
    lines.push('## Computer mates (#386c)');
    lines.push('');
    lines.push(mateRowsTable(mates.rows));
    lines.push('');
    for (const g of mates.gates) lines.push(`- ${g.pass ? 'PASS' : 'FAIL'} ${g.line}`);
    lines.push('');
  }

  lines.push('## Not modelled');
  lines.push('');
  for (const limit of MAP_FILL_LIMITS) lines.push(`- ${limit}`);
  lines.push('');
  return lines.join('\n');
}

/** One computer-mates gate line (#386c, plan §9): soft, printed PASS/FAIL. */
export interface MateGate {
  readonly gate: 'a' | 'b' | 'c' | 'd';
  readonly rules: string;
  readonly pass: boolean;
  readonly line: string;
}

/** A row per solo scenario: the kid's land against the 4-kid patch, and the mates'. */
export interface MateRow {
  readonly scenario: string;
  readonly rules: string;
  readonly kidTiles: number;
  readonly fullKidTiles: number | null;
  readonly percent: number | null;
  readonly homeRingLost: number;
  readonly mateTiles: readonly number[];
  readonly mateCap: number | null;
  readonly mateClaims: number;
  readonly mateFires: number;
  readonly mateGuards: number;
}

const outer = (run: MapFillRun, day: number, s: number) => {
  const d = run.days[day - 1];
  return d ? (d.tiles[s] ?? 0) - (d.homeRing[s] ?? 0) : 0;
};

/**
 * The computer-mates gates (#386c): (a) a solo kid with 3 mates loses no
 * home-ring tile and ends `byDay` with at least 100 − `withinPercent` % of
 * the same kid's land in the 4-kid patch (the line says if it's above the
 * ± band); (c) a mate never holds more outer land than its
 * `landCapPercent` cap; (d) on a day nobody opens the patch, mates do nothing.
 */
export function computerMatesGates(runs: readonly MapFillRun[]): {
  rows: MateRow[];
  gates: MateGate[];
} {
  const { byDay, withinPercent, away } = COMPUTER_MATES_GATE;
  const rows: MateRow[] = [];
  const gates: MateGate[] = [];
  const mates = (run: MapFillRun) =>
    run.scenario.seats.flatMap((seat, s) => (seat.computer === undefined ? [] : [s]));
  const sum = (run: MapFillRun, pick: (d: MapFillRun['days'][number], s: number) => number) =>
    run.days.reduce((t, d) => t + mates(run).reduce((u, s) => u + pick(d, s), 0), 0);
  const soloIds = [...COMPUTER_MATES_GATES.map((g) => g.solo), away];
  for (const run of runs.filter((r) => soloIds.includes(r.scenario.id as never))) {
    const pair = COMPUTER_MATES_GATES.find((g) => g.solo === run.scenario.id);
    const full = pair
      ? runs.find((r) => r.scenario.id === pair.full && r.rules.label === run.rules.label)
      : undefined;
    const kidTiles = run.days[byDay - 1]?.tiles[0] ?? 0;
    const fullKidTiles = full ? (full.days[byDay - 1]?.tiles[0] ?? 0) : null;
    const percent = fullKidTiles ? Math.round((kidTiles * 100) / fullKidTiles) : null;
    const homeRingLost = Math.max(...run.days.map((d) => 7 - (d.homeRing[0] ?? 0)));
    const mateCap = run.days.at(-1)?.mateCap.find((c) => c !== null) ?? null;
    rows.push({
      scenario: run.scenario.id,
      rules: run.rules.label,
      kidTiles,
      fullKidTiles,
      percent,
      homeRingLost,
      mateTiles: mates(run).map((s) => outer(run, byDay, s)),
      mateCap,
      mateClaims: sum(run, (d, s) => d.mateClaims[s] ?? 0),
      mateFires: sum(run, (d, s) => d.mateFires[s] ?? 0),
      mateGuards: sum(run, (d, s) => d.mateGuards[s] ?? 0),
    });
    const tag = `${run.scenario.id} / ${run.rules.label}`;
    if (pair && percent !== null) {
      // Plan §9 gates the floor (at least 90 %); the brief's band (±10 %)
      // is printed too, so a kid well above the 4-kid row shows as such.
      const pass = homeRingLost === 0 && percent >= 100 - withinPercent;
      const band =
        percent > 100 + withinPercent ? `above the ±${String(withinPercent)} % band` : 'in band';
      gates.push({
        gate: 'a',
        rules: run.rules.label,
        pass,
        line: `(a) ${tag}: kid ${String(kidTiles)} tiles on day ${String(byDay)} vs ${String(fullKidTiles)} in ${pair.full} (${String(percent)} %, floor ${String(100 - withinPercent)} %, ${band}), home ring lost ${String(homeRingLost)}`,
      });
    }
    let worst = 0;
    for (const d of run.days) {
      for (const s of mates(run)) {
        const cap = d.mateCap[s] ?? 0;
        worst = Math.max(worst, outer(run, d.day, s) - cap);
      }
    }
    gates.push({
      gate: 'c',
      rules: run.rules.label,
      pass: worst <= 0,
      line: `(c) ${tag}: mates' most outer land over the cap (${String(mateCap)}) on any day: ${String(Math.max(0, worst))}`,
    });
    // (b) 386e: a kid loses at most the weekly challenge cap to mates in
    // any 7 days, though every challenge wins in the model.
    const weekCap = COMPUTER_MATES.rules.challengesPerPatchWeek[run.rules.pvpMode];
    let worstWeek = 0;
    run.days.forEach((_, i) => {
      const week = run.days.slice(Math.max(0, i - 6), i + 1);
      for (const s of run.scenario.seats.keys()) {
        if (mates(run).includes(s)) continue;
        worstWeek = Math.max(
          worstWeek,
          week.reduce((t, d) => t + (d.lostToMates[s] ?? 0), 0),
        );
      }
    });
    const challenges = sum(run, (d, s) => d.mateChallenges[s] ?? 0);
    gates.push({
      gate: 'b',
      rules: run.rules.label,
      pass: worstWeek <= weekCap,
      line: `(b) ${tag}: most tiles a kid lost to mates in any 7 days ${String(worstWeek)} (cap ${String(weekCap)}), mate challenges in all ${String(challenges)}`,
    });
    const cold = run.days.filter((d) => !d.warm);
    const acted = cold.reduce(
      (t, d) =>
        t +
        mates(run).reduce(
          (u, s) => u + (d.mateClaims[s] ?? 0) + (d.mateFires[s] ?? 0) + (d.mateGuards[s] ?? 0),
          0,
        ),
      0,
    );
    if (run.scenario.id === away) {
      gates.push({
        gate: 'd',
        rules: run.rules.label,
        pass: cold.length > 0 && acted === 0,
        line: `(d) ${tag}: ${String(cold.length)} days nobody opened the patch, mate intents on them ${String(acted)}`,
      });
    }
  }
  return { rows, gates };
}

/** The computer-mates rows as a Markdown table. */
export function mateRowsTable(rows: readonly MateRow[]): string {
  const { byDay } = COMPUTER_MATES_GATE;
  const out = [
    `| Scenario | Rules | Kid tiles day ${String(byDay)} | 4-kid patch | % | Home ring lost | Mates' outer land day ${String(byDay)} | Mate cap | Mate claims / fires / guards |`,
    '|---|---|---:|---:|---:|---:|---|---:|---|',
  ];
  for (const r of rows) {
    out.push(
      `| ${r.scenario} | ${r.rules} | ${String(r.kidTiles)} | ${cell(r.fullKidTiles)} | ${cell(r.percent)} | ${String(r.homeRingLost)} | ${r.mateTiles.join(' / ')} | ${cell(r.mateCap)} | ${String(r.mateClaims)} / ${String(r.mateFires)} / ${String(r.mateGuards)} |`,
    );
  }
  return out.join('\n');
}
