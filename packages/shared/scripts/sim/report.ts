import { ElementIdSchema } from '../../src/schemas/data/elements.js';
import type { SimConfig } from './config.js';
import type { Bracket, Entrant } from './matchups.js';
import type { MatchResult } from './run.js';

/*
 * Turns match results into win rates, flags outliers and writes the
 * Markdown and CSV reports. Draws count as half a win everywhere.
 */

export type Section = 'species' | 'element' | 'feeling' | 'combo' | 'stance' | 'pair';

export interface ReportRow {
  readonly section: Section;
  /** The bracket the row comes from (`base`, `evolved`, `combo`, `stance`). */
  readonly group: Bracket;
  readonly subject: string;
  /** Empty for "against the whole field" rows. */
  readonly opponent: string;
  readonly rarity: string;
  readonly games: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly winRate: number;
  readonly flag: 'strong' | 'weak' | null;
  /** The table to look at if this row is flagged. */
  readonly tune: string;
}

interface Tally {
  games: number;
  wins: number;
  draws: number;
}

class Tallies {
  readonly byKey = new Map<string, Tally>();

  add(key: string, games: number, wins: number, draws: number): void {
    const tally = this.byKey.get(key) ?? { games: 0, wins: 0, draws: 0 };
    tally.games += games;
    tally.wins += wins;
    tally.draws += draws;
    this.byKey.set(key, tally);
  }
}

const rateOf = (t: Tally) => (t.games === 0 ? 0.5 : (t.wins + t.draws / 2) / t.games);

/** Records a result for both entrants under `keyOf(entrant)`. */
function addBoth(tallies: Tallies, r: MatchResult, keyOf: (e: Entrant, side: 'a' | 'b') => string) {
  const games = r.aWins + r.bWins + r.draws;
  tallies.add(keyOf(r.matchup.a, 'a'), games, r.aWins, r.draws);
  tallies.add(keyOf(r.matchup.b, 'b'), games, r.bWins, r.draws);
}

const speciesTune = (secret: boolean) =>
  secret
    ? 'species base stats or moves (packages/shared/src/data/server/secret-species.ts)'
    : 'species base stats or moves (packages/shared/src/data/species.ts)';

export function buildRows(results: readonly MatchResult[], config: SimConfig): ReportRow[] {
  const { low, high } = config.thresholds;
  const row = (
    fields: Omit<ReportRow, 'winRate' | 'flag' | 'losses' | 'wins' | 'draws' | 'games'>,
    t: Tally,
    flaggable = true,
  ): ReportRow => {
    const winRate = rateOf(t);
    return {
      ...fields,
      games: t.games,
      wins: t.wins,
      draws: t.draws,
      losses: t.games - t.wins - t.draws,
      winRate,
      flag: !flaggable ? null : winRate > high ? 'strong' : winRate < low ? 'weak' : null,
    };
  };
  const rows: ReportRow[] = [];
  const entrants = new Map<string, Entrant>();
  for (const r of results) {
    entrants.set(r.matchup.a.key, r.matchup.a);
    entrants.set(r.matchup.b.key, r.matchup.b);
  }

  // Species against the rest of their bracket.
  for (const bracket of ['base', 'evolved'] as const) {
    const tallies = new Tallies();
    for (const r of results) if (r.matchup.bracket === bracket) addBoth(tallies, r, (e) => e.key);
    for (const [key, t] of tallies.byKey) {
      const e = entrants.get(key);
      const secret = e?.secret === true;
      rows.push(
        row(
          {
            section: 'species',
            group: bracket,
            subject: key,
            opponent: '',
            rarity: e?.rarity ?? '',
            tune: speciesTune(secret),
          },
          t,
        ),
      );
    }
  }

  // Combos, elements and feelings (equal stats).
  const combos = results.filter((r) => r.matchup.bracket === 'combo');
  const comboTallies = new Tallies();
  const elementTallies = new Tallies();
  const feelingTallies = new Tallies();
  for (const r of combos) {
    const { a, b } = r.matchup;
    addBoth(comboTallies, r, (e) => e.key);
    if (a.element !== b.element) addBoth(elementTallies, r, (e) => e.element ?? '');
    if (a.feeling !== b.feeling) addBoth(feelingTallies, r, (e) => e.feeling ?? '');
  }
  for (const [key, t] of elementTallies.byKey) {
    const fields = {
      section: 'element',
      group: 'combo',
      subject: key,
      opponent: '',
      rarity: '',
      tune: `element matrix (packages/shared/src/data/matrices.ts ELEMENT_MATRIX) or the ${key} moves (packages/shared/src/data/species.ts MOVES)`,
    } as const;
    rows.push(row(fields, t));
  }
  for (const [key, t] of feelingTallies.byKey) {
    const fields = {
      section: 'feeling',
      group: 'combo',
      subject: key,
      opponent: '',
      rarity: '',
      tune: 'feeling matrix (packages/shared/src/data/matrices.ts FEELING_MATRIX)',
    } as const;
    rows.push(row(fields, t));
  }
  for (const [key, t] of comboTallies.byKey) {
    const fields = {
      section: 'combo',
      group: 'combo',
      subject: key,
      opponent: '',
      rarity: '',
      tune: 'synergy table (packages/shared/src/data/matrices.ts SYNERGY_TABLE)',
    } as const;
    rows.push(row(fields, t));
  }

  // Stances: stance A against stance B, every base form mirrored.
  const stanceTallies = new Tallies();
  for (const r of results) {
    if (r.matchup.bracket !== 'stance') continue;
    const { policyA, policyB } = r.matchup;
    const games = r.aWins + r.bWins + r.draws;
    stanceTallies.add(`${policyA}|${policyB}`, games, r.aWins, r.draws);
  }
  for (const [key, t] of stanceTallies.byKey) {
    const [subject = '', opponent = ''] = key.split('|');
    const fields = {
      section: 'stance',
      group: 'stance',
      subject,
      opponent,
      rarity: '',
      tune: 'AI stances (packages/shared/src/data/battle.ts BATTLE_RULES.ai)',
    } as const;
    rows.push(row(fields, t));
  }

  // Head-to-head pairs (all stances together). Counters are by design, so never flagged.
  const pairTallies = new Tallies();
  const pairGroup = new Map<string, Bracket>();
  for (const r of results) {
    if (r.matchup.bracket === 'stance') continue;
    const key = `${r.matchup.a.key}|${r.matchup.b.key}`;
    pairGroup.set(key, r.matchup.bracket);
    pairTallies.add(key, r.aWins + r.bWins + r.draws, r.aWins, r.draws);
  }
  for (const [key, t] of pairTallies.byKey) {
    const [subject = '', opponent = ''] = key.split('|');
    const fields = {
      section: 'pair',
      group: pairGroup.get(key) ?? 'base',
      subject,
      opponent,
      rarity: entrants.get(subject)?.rarity ?? '',
      tune: '',
    } as const;
    rows.push(row(fields, t, false));
  }
  return rows;
}

/** Flagged rows, furthest from 50% first. */
export function flaggedRows(rows: readonly ReportRow[]): ReportRow[] {
  return rows
    .filter((r) => r.flag !== null)
    .sort((x, y) => Math.abs(y.winRate - 0.5) - Math.abs(x.winRate - 0.5) || order(x, y));
}

const SECTION_ORDER: readonly Section[] = [
  'species',
  'element',
  'feeling',
  'combo',
  'stance',
  'pair',
];

function order(x: ReportRow, y: ReportRow): number {
  const bySection = SECTION_ORDER.indexOf(x.section) - SECTION_ORDER.indexOf(y.section);
  if (bySection !== 0) return bySection;
  const a = `${x.group}|${x.subject}|${x.opponent}`;
  const b = `${y.group}|${y.subject}|${y.opponent}`;
  return a < b ? -1 : a > b ? 1 : 0;
}

const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;
const flagMark = (r: ReportRow) =>
  r.flag === 'strong' ? '🔺 strong' : r.flag === 'weak' ? '🔻 weak' : '';

/** A row's name in the flags table, e.g. "base form glowboo" or "stance aggressive vs defensive". */
export function describe(r: ReportRow): string {
  switch (r.section) {
    case 'species':
      return `${r.group === 'base' ? 'base form' : 'evolved form'} ${r.subject}`;
    case 'stance':
      return `stance ${r.subject} vs ${r.opponent}`;
    case 'pair':
      return `${r.subject} vs ${r.opponent}`;
    default:
      return `${r.section} ${r.subject}`;
  }
}

function table(header: readonly string[], body: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...body.map(line)].join('\n');
}

const byRate = (rows: readonly ReportRow[]) =>
  [...rows].sort((x, y) => y.winRate - x.winRate || order(x, y));

export interface RunInfo {
  readonly contentHash: string;
  readonly battles: number;
  readonly averageTurns: number;
  readonly seconds: number;
}

export function renderMarkdown(
  rows: readonly ReportRow[],
  config: SimConfig,
  info: RunInfo,
): string {
  const { low, high } = config.thresholds;
  const flags = flaggedRows(rows);
  const section = (s: Section, group?: Bracket) =>
    byRate(rows.filter((r) => r.section === s && (group === undefined || r.group === group)));
  const rateTable = (list: readonly ReportRow[], withRarity = false) =>
    table(
      withRarity
        ? ['Who', 'Rarity', 'Win rate', 'Games', 'Flag']
        : ['Who', 'Win rate', 'Games', 'Flag'],
      list.map((r) =>
        withRarity
          ? [r.subject, r.rarity, pct(r.winRate), String(r.games), flagMark(r)]
          : [r.subject, pct(r.winRate), String(r.games), flagMark(r)],
      ),
    );

  const elements = ElementIdSchema.options;
  const headToHead = new Map<string, { games: number; score: number }>();
  for (const r of rows) {
    if (r.section !== 'pair' || r.group !== 'combo') continue;
    const [ea = '', eb = ''] = [r.subject.split('+')[0], r.opponent.split('+')[0]];
    if (ea === eb) continue;
    const score = r.wins + r.draws / 2;
    const add = (k: string, s: number) => {
      const cell = headToHead.get(k) ?? { games: 0, score: 0 };
      cell.games += r.games;
      cell.score += s;
      headToHead.set(k, cell);
    };
    add(`${ea}|${eb}`, score);
    add(`${eb}|${ea}`, r.games - score);
  }
  const matrix = table(
    ['vs →', ...elements],
    elements.map((a) => [
      a,
      ...elements.map((b) => {
        const cell = headToHead.get(`${a}|${b}`);
        return cell ? pct(cell.score / cell.games) : '—';
      }),
    ]),
  );

  const stances = [...rows.filter((r) => r.section === 'stance')].sort(order);

  return `# Heartpatch balance report

Seeded AI-vs-AI 1v1 battles with the real engine and AI stances (issue #12).
How to read it: see "Balance simulator" in the README.

- Content hash: \`${info.contentHash}\` (root seed \`${config.rootSeed}\`)
- ${info.battles} battles, ${info.averageTurns.toFixed(1)} turns on average, ${info.seconds.toFixed(1)} s
- Flagged: win rate above ${pct(high)} or below ${pct(low)} (draws count half)
- Levels: base forms ${config.levels.base}, evolved forms ${config.levels.evolved}, combos ${config.levels.combo}; stances ${config.policies.join(', ')}

## Flags (${flags.length})

${
  flags.length === 0
    ? 'Nothing outside the band. 🎉'
    : table(
        ['Flag', 'What', 'Win rate', 'Games', 'Table to tune'],
        flags.map((r) => [flagMark(r), describe(r), pct(r.winRate), String(r.games), r.tune]),
      )
}

## Base forms (level ${config.levels.base}, each against every other base form)

${rateTable(section('species', 'base'), true)}

## Evolved forms (level ${config.levels.evolved}, each against every other evolved form)

${rateTable(section('species', 'evolved'), true)}

## Elements (equal stats, against other elements)

${rateTable(section('element'))}

## Feelings (equal stats, against other feelings)

${rateTable(section('feeling'))}

## Element × feeling combos (equal stats, against every other combo)

${rateTable(section('combo'))}

## Element head-to-head (row's win rate against column, equal stats)

Not flagged: 2× matchups are meant to win most of the time.

${matrix}

## Stances (every base form against itself)

${table(
  ['Stance', 'Against', 'Win rate', 'Games', 'Flag'],
  stances.map((r) => [r.subject, r.opponent, pct(r.winRate), String(r.games), flagMark(r)]),
)}
`;
}

const CSV_HEADER = [
  'section',
  'group',
  'subject',
  'opponent',
  'rarity',
  'games',
  'wins',
  'draws',
  'losses',
  'win_rate',
  'flag',
  'tune',
] as const;

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function renderCsv(rows: readonly ReportRow[]): string {
  const lines = [...rows]
    .sort(order)
    .map((r) =>
      [
        r.section,
        r.group,
        r.subject,
        r.opponent,
        r.rarity,
        String(r.games),
        String(r.wins),
        String(r.draws),
        String(r.losses),
        r.winRate.toFixed(4),
        r.flag ?? '',
        r.tune,
      ]
        .map(csvCell)
        .join(','),
    );
  return [CSV_HEADER.join(','), ...lines].join('\n') + '\n';
}
