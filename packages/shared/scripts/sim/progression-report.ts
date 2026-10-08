import { addXp, grantedXp, xpForLevel } from '../../src/care/growth.js';
import { BATTLE_RULES } from '../../src/data/battle.js';
import { GUARDIAN_RULES } from '../../src/data/server/guardian-rules.js';
import type { ProgressionConfig, ProgressionRules } from './progression-config.js';
import {
  MODEL_LIMITS,
  type DayRecord,
  type KidRun,
  type JourneyOddsRow,
  type ProgressionRun,
  type WildOddsRow,
} from './progression.js';

/** Days the tables show. */
const SHOWN_DAYS = [1, 2, 3, 4, 5, 7, 10, 14, 21, 26, 30, 40, 50, 60];
/** The secret milestone "Big and Bouncy" (a squishy at level 20). */
const BIG_AND_BOUNCY = 20;

/** The milestones a run reaches, by day (null: not within the run). */
export interface RunSummary {
  readonly rules: string;
  readonly seats: number;
  readonly kid: string;
  /** The Partner grows up. */
  readonly evolves: number | null;
  /** Any squishy on the team reaches level 20. */
  readonly bigAndBouncy: number | null;
  /** The team wins Juniper's Gap at least `readyAt` % of the time. */
  readonly gapReady: number | null;
  readonly gapReadyLevel: number | null;
  /** No neutral land left outside the Gap / at all. */
  readonly landFullButGap: number | null;
  readonly landFull: number | null;
  readonly level: Readonly<Record<number, number>>;
}

const first = (days: readonly DayRecord[], test: (d: DayRecord) => boolean) =>
  days.find(test) ?? null;

/** Kid 0 of a run; both kids of a run play the same way. */
const lead = (run: ProgressionRun): KidRun => {
  const kid = run.kids[0];
  if (!kid) throw new Error('a run has two kids');
  return kid;
};

const GAP_STRENGTH_INDEX = GUARDIAN_RULES.strengths.length - 1;

export function summarise(run: ProgressionRun, config: ProgressionConfig): RunSummary {
  const { days } = lead(run);
  const gap = first(days, (d) => (d.odds[GAP_STRENGTH_INDEX] ?? 0) >= config.readyAt);
  return {
    rules: run.rules.label,
    seats: run.seats,
    kid: run.profile.id,
    evolves: first(days, (d) => d.partnerSpecies !== config.partner)?.day ?? null,
    bigAndBouncy: first(days, (d) => Math.max(...d.levels) >= BIG_AND_BOUNCY)?.day ?? null,
    gapReady: gap?.day ?? null,
    gapReadyLevel: gap?.partnerLevel ?? null,
    landFullButGap: first(days, (d) => d.neutralLeftOutsideGap === 0)?.day ?? null,
    landFull: first(days, (d) => d.neutralLeft === 0)?.day ?? null,
    level: Object.fromEntries(days.map((d) => [d.day, d.partnerLevel])),
  };
}

/**
 * What one Juniper's Gap win pays a Partner at `level`: an average Gap team
 * (every guardian at the middle of the Gap's levels), all tuckered out.
 */
export function gapWin(level: number, xpPercent: number, rules: ProgressionRules) {
  const gap = GUARDIAN_RULES.strengths[GAP_STRENGTH_INDEX];
  if (!gap) throw new Error('no guardian strengths');
  const middle = (gap.levels.min + gap.levels.max) / 2;
  const { perOpponentLevel, winMultiplier } = BATTLE_RULES.xp;
  const base = Math.floor(perOpponentLevel * gap.count * middle * winMultiplier);
  const xp = grantedXp(base, xpPercent);
  const after = addXp({ level, xp: xpForLevel(level, rules.growth) }, xp, rules.growth);
  const toNext = xpForLevel(level + 1, rules.growth) - xpForLevel(level, rules.growth);
  return { base, xp, levels: after.level - level, ofNextLevel: Math.floor((xp * 100) / toNext) };
}

const cell = (n: number | null) => (n === null ? '—' : String(n));

function dayTable(runs: readonly ProgressionRun[]): string {
  const kids = runs.map((run) => ({ id: run.profile.id, days: lead(run).days }));
  const days = SHOWN_DAYS.filter((d) => kids.every((k) => k.days[d - 1]));
  const head = [
    'Day',
    ...kids.map((k) => `${k.id} Partner`),
    ...kids.map((k) => `${k.id} tiles`),
    ...kids.map((k) => `${k.id} neutral left`),
    ...kids.map((k) => `${k.id} Gap win %`),
  ];
  const rows = days.map((day) => {
    const at = kids.map((k) => {
      const record = k.days[day - 1];
      if (!record) throw new Error(`no record for day ${String(day)}`);
      return record;
    });
    return [
      String(day),
      ...at.map((d) => String(d.partnerLevel)),
      ...at.map((d) => String(d.tiles)),
      ...at.map((d) => String(d.neutralLeft)),
      ...at.map((d) => String(d.odds[GAP_STRENGTH_INDEX] ?? 0)),
    ];
  });
  return markdownTable(head, rows);
}

/** Each kid's team (Partner / friends) on the shown days, for one map size. */
function teamTable(runs: readonly ProgressionRun[]): string {
  const days = [7, 14, 30, 60].filter((d) => runs.every((r) => lead(r).days[d - 1]));
  return markdownTable(
    ['Rules', 'Kid', ...days.map((d) => `Day ${String(d)}`)],
    runs.map((run) => [
      run.rules.label,
      run.profile.id,
      ...days.map((d) => lead(run).days[d - 1]?.levels.join(' / ') ?? '—'),
    ]),
  );
}

function markdownTable(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

/** A casual kid must win a journey this often (%) at these distances from this day (#270). */
export const JOURNEY_GATE = { kid: 'casual', fromDay: 3, maxDistance: 4, percent: 60 } as const;

/**
 * Does `rows` pass the #270 sim gate: a casual kid wins a journey to the
 * nearest post (distance ≤ 4) at least 60 % of the time from day 3? Returns
 * the cells that miss it (empty: it passes).
 */
export function journeyGateMisses(rows: readonly JourneyOddsRow[]): string[] {
  return rows
    .filter((row) => row.kid === JOURNEY_GATE.kid && row.day >= JOURNEY_GATE.fromDay)
    .flatMap((row) =>
      row.odds
        .filter((o) => o.distance <= JOURNEY_GATE.maxDistance && o.percent < JOURNEY_GATE.percent)
        .map(
          (o) => `day ${String(row.day)}, distance ${String(o.distance)}: ${String(o.percent)} %`,
        ),
    );
}

function journeySection(rows: readonly JourneyOddsRow[]): string {
  const distances = rows[0]?.odds ?? [];
  const misses = journeyGateMisses(rows);
  return [
    '## Journeys to trading posts (#270)',
    '',
    `Team win rate (%) by distance from your nearest land. Trail level and team size come from \`JOURNEY_RULES\` (${distances.map((o) => `${String(o.distance)}: ${String(o.size)} × Lv ${String(o.level)}`).join(', ')}). The kid's team is kid 0's at the end of that day, 4-seat map, shipped rules.`,
    '',
    markdownTable(
      ['Kid', 'Day', 'Team Lv', ...distances.map((o) => `d ${String(o.distance)}`)],
      rows.map((row) => [
        row.kid,
        String(row.day),
        row.levels.join(' / '),
        ...row.odds.map((o) => String(o.percent)),
      ]),
    ),
    '',
    misses.length === 0
      ? `Gate: a ${JOURNEY_GATE.kid} kid wins at distance ≤ ${String(JOURNEY_GATE.maxDistance)} at least ${String(JOURNEY_GATE.percent)} % of the time from day ${String(JOURNEY_GATE.fromDay)}. **Passes.**`
      : `Gate: a ${JOURNEY_GATE.kid} kid wins at distance ≤ ${String(JOURNEY_GATE.maxDistance)} at least ${String(JOURNEY_GATE.percent)} % of the time from day ${String(JOURNEY_GATE.fromDay)}. **Misses:** ${misses.join('; ')}.`,
  ].join('\n');
}

export function renderProgression(
  runs: readonly ProgressionRun[],
  config: ProgressionConfig,
  info: { seconds: number; odds?: readonly WildOddsRow[]; journeys?: readonly JourneyOddsRow[] },
): string {
  const summaries = runs.map((run) => summarise(run, config));
  const ruleSets = [...new Set(runs.map((r) => r.rules))];
  const lines: string[] = [
    '# Progression model',
    '',
    `Two kids of one kind share a map; every battle is played by the real engine. ${String(config.days)} days from ${config.startDate}, kids: ${config.kids.map((k) => `${k.id} (${String(k.battlesPerDay)} battles a day, ${String(k.xpPercent)} % XP)`).join(', ')}. A kid tries the best-odds tile next to their land while its odds are ${String(config.tryTileAt)} % or better and attempts are left, then fights wild squishies. Gap ready: the team wins Juniper's Gap ${String(config.readyAt)} % of the time. Run took ${info.seconds.toFixed(1)} s.`,
    '',
    `Kids befriend up to ${config.kids.map((k) => `${String(k.befriendsPerDay)} (${k.id})`).join(' / ')} wild squishies a day when one is stronger than their weakest friend. Not modelled: ${MODEL_LIMITS.join('; ')}. Team-strength milestones (Big and Bouncy, Gap ready, land full) depend on these and are estimates.`,
    '',
    '## Milestones by day',
    '',
    markdownTable(
      [
        'Rules',
        'Map seats',
        'Kid',
        'Evolves',
        'Big and Bouncy (Lv 20)',
        'Gap ready (Partner Lv)',
        'Land full but Gap',
        'Land full',
        'Lv day 7',
        'Lv day 14',
        'Lv day 30',
        'Lv day 60',
      ],
      summaries.map((s) => [
        s.rules,
        String(s.seats),
        s.kid,
        cell(s.evolves),
        cell(s.bigAndBouncy),
        s.gapReady === null ? '—' : `${String(s.gapReady)} (${cell(s.gapReadyLevel)})`,
        cell(s.landFullButGap),
        cell(s.landFull),
        cell(s.level[7] ?? null),
        cell(s.level[14] ?? null),
        cell(s.level[30] ?? null),
        cell(s.level[60] ?? null),
      ]),
    ),
    '',
    "## What a Juniper's Gap win pays",
    '',
    'An average Gap team (three guardians at the middle of their levels), at the day the Gap is ready.',
    '',
    markdownTable(
      [
        'Rules',
        'Kid',
        'Partner Lv',
        'Base XP',
        'XP granted',
        'Levels gained',
        '% of the next level',
      ],
      summaries
        .filter((s) => s.seats === config.seats[0] && s.gapReadyLevel !== null)
        .map((s) => {
          const rules = ruleSets.find((r) => r.label === s.rules);
          if (!rules) throw new Error(`unknown rules ${s.rules}`);
          const kid = config.kids.find((k) => k.id === s.kid);
          const win = gapWin(s.gapReadyLevel ?? 1, kid?.xpPercent ?? 100, rules);
          return [
            s.rules,
            s.kid,
            cell(s.gapReadyLevel),
            String(win.base),
            String(win.xp),
            String(win.levels),
            String(win.ofNextLevel),
          ];
        }),
    ),
  ];
  lines.push(
    '',
    `## Team levels (Partner / friends), ${String(config.seats[0])}-seat map`,
    '',
    teamTable(runs.filter((r) => r.seats === config.seats[0])),
  );
  if (info.odds) {
    const offsets = info.odds[0]?.odds.map((o) => o.offset) ?? [];
    lines.push(
      '',
      "## Wild fights at the Partner's level",
      '',
      "Team win rate (%) against base-form wild squishies at the Partner's level plus each offset.",
      '',
      markdownTable(
        ['Team', ...offsets.map((o) => `wild ${o >= 0 ? '+' : ''}${String(o)}`)],
        info.odds.map((row) => [row.team, ...row.odds.map((o) => String(o.percent))]),
      ),
    );
  }
  if (info.journeys && info.journeys.length > 0) lines.push('', journeySection(info.journeys));
  for (const rules of ruleSets) {
    for (const seats of config.seats) {
      const these = runs.filter((r) => r.rules === rules && r.seats === seats);
      const neutral = these[0]?.neutral ?? 0;
      lines.push(
        '',
        `## ${rules.label}: ${String(seats)}-seat map (${String(neutral)} neutral tiles), ${String(rules.attemptsPerDay)} attempts a day`,
        '',
        dayTable(these),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
