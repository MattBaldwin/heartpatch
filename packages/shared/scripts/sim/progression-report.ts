import { addXp, grantedXp, xpForLevel } from '../../src/care/growth.js';
import { BATTLE_RULES } from '../../src/data/battle.js';
import { GUARDIAN_RULES } from '../../src/data/server/guardian-rules.js';
import {
  CURRENT_RULES,
  FRIENDLY_GATE,
  SOLO_GATE,
  SOLO_MATES_RULES,
  SOLO_RULES,
  TIER_GATE,
  WITH_FRIENDLIES_RULES,
  type FriendlyGate,
  type SoloGate,
  type ProgressionConfig,
  type ProgressionRules,
} from './progression-config.js';
import {
  BIG_AND_BOUNCY,
  FIRSTS,
  firstsGate,
  firstsOf,
  formatFirst,
  formatFirstsGate,
  formatTierGate,
  TIERS,
  tierFirstsOf,
  tierGate,
  type FirstsFacts,
} from './progression-firsts.js';
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

/** Kid 0 of a run; both kids of a run play the same way (a solo run has one). */
const lead = (run: ProgressionRun): KidRun => {
  const kid = run.kids[0];
  if (!kid) throw new Error('a run has a kid');
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
 * #728's gate: the gated kind's Partner level on the gate day, without and
 * with friendlies, for the kid of the pair it moves most (friendlies can
 * snowball: the winner earns more and wins more, so one kid races ahead
 * while the other falls behind; kid 0 alone can read either way).
 */
export interface FriendlyGateResult {
  readonly kid: string;
  /** The kid of the pair whose level moved most (0 or 1). */
  readonly slot: number;
  readonly day: number;
  readonly seats: number;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly maxLevels: number;
  readonly passes: boolean;
}

/**
 * `FRIENDLY_GATE` over `runs`: both kids of the gated kind on the first map
 * size, `CURRENT_RULES` against `WITH_FRIENDLIES_RULES`, the larger rise
 * counting. Null when a run is missing.
 */
export function friendlyGate(
  runs: readonly ProgressionRun[],
  config: ProgressionConfig,
  gate: FriendlyGate = FRIENDLY_GATE,
): FriendlyGateResult | null {
  const seats = config.seats[0] ?? 0;
  const levelsOf = (rules: ProgressionRules) => {
    const run = runs.find(
      (r) => r.rules === rules && r.seats === seats && r.profile.id === gate.kid,
    );
    const levels = (run?.kids ?? []).flatMap((k) => k.days[gate.day - 1]?.partnerLevel ?? []);
    return levels.length === 2 ? levels : null;
  };
  const was = levelsOf(CURRENT_RULES);
  const now = levelsOf(WITH_FRIENDLIES_RULES);
  if (!was || !now) return null;
  const deltas = now.map((level, k) => level - (was[k] ?? 0));
  const delta = Math.max(...deltas);
  const slot = deltas.indexOf(delta);
  const before = was[slot] ?? 0;
  const after = now[slot] ?? 0;
  return {
    kid: gate.kid,
    slot,
    day: gate.day,
    seats,
    before,
    after,
    delta,
    maxLevels: gate.maxLevels,
    passes: delta <= gate.maxLevels,
  };
}

export function formatFriendlyGate(result: FriendlyGateResult): string {
  const sign = result.delta >= 0 ? '+' : '';
  return (
    `friendly gate (#728): ${result.kid} kid ${String(result.slot)} Partner Lv ${String(result.before)} → ${String(result.after)} ` +
    `on day ${String(result.day)} (${sign}${String(result.delta)}, at most +${String(result.maxLevels)}): ` +
    (result.passes ? 'PASS' : 'FAIL')
  );
}

/** One kind's row of #386e's gate: Partner levels on each gate day. */
export interface SoloGateRow {
  readonly kid: string;
  readonly days: readonly {
    readonly day: number;
    /** `SOLO_RULES`, alone (no gate: the "before"). */
    readonly solo: number;
    /** `SOLO_MATES_RULES`, alone with computer mates (gated). */
    readonly mates: number;
    /** `WITH_FRIENDLIES_RULES` on the first map size, kid 0 / kid 1. */
    readonly paired: readonly number[];
    /** The pair's mean, what the percentages compare against. */
    readonly pairedMean: number;
    /** Solo and solo-with-mates vs `pairedMean` (%, one decimal). */
    readonly soloPercent: number;
    readonly matesPercent: number;
    readonly passes: boolean;
  }[];
  readonly passes: boolean;
}

const percentOf = (level: number, base: number) => Math.round(((level - base) * 1000) / base) / 10;

/**
 * `SOLO_GATE` over `runs` (#386e, plan §9): for each kind, the solo kid with
 * computer mates within `maxPercent` % of the 4-seat friendlies pair's mean
 * Partner level on each gate day. Null when a run is missing.
 */
export function soloGate(
  runs: readonly ProgressionRun[],
  config: ProgressionConfig,
  gate: SoloGate = SOLO_GATE,
): SoloGateRow[] | null {
  const seats = config.seats[0] ?? 0;
  const rows: SoloGateRow[] = [];
  for (const { id } of config.kids) {
    const find = (rules: ProgressionRules) =>
      runs.find((r) => r.rules === rules && r.seats === seats && r.profile.id === id);
    const [solo, mates, paired] = [SOLO_RULES, SOLO_MATES_RULES, WITH_FRIENDLIES_RULES].map(find);
    if (!solo || !mates || !paired) return null;
    const levelOf = (kid: KidRun | undefined, day: number) => kid?.days[day - 1]?.partnerLevel ?? 0;
    const days = gate.days.map((day) => {
      const pair = paired.kids.map((k) => levelOf(k, day));
      const pairedMean = pair.reduce((n, l) => n + l, 0) / Math.max(1, pair.length);
      const matesLevel = levelOf(mates.kids[0], day);
      const matesPercent = percentOf(matesLevel, pairedMean);
      return {
        day,
        solo: levelOf(solo.kids[0], day),
        mates: matesLevel,
        paired: pair,
        pairedMean,
        soloPercent: percentOf(levelOf(solo.kids[0], day), pairedMean),
        matesPercent,
        passes: Math.abs(matesPercent) <= gate.maxPercent,
      };
    });
    rows.push({ kid: id, days, passes: days.every((d) => d.passes) });
  }
  return rows;
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${String(n)}`;

export function formatSoloGate(rows: readonly SoloGateRow[], gate: SoloGate = SOLO_GATE): string {
  const cells = rows.flatMap((row) =>
    row.days.map(
      (d) =>
        `${row.kid} day ${String(d.day)} Lv ${String(d.mates)} vs ${String(d.pairedMean)} (${signed(d.matesPercent)} %)`,
    ),
  );
  return (
    `solo gate (#386e): solo + computer mates within ±${String(gate.maxPercent)} % of the friendlies pair: ` +
    `${cells.join(', ')}: ${rows.every((r) => r.passes) ? 'PASS' : 'FAIL'}`
  );
}

/** The solo and computer-mates table (#386e) and its gate. */
function renderSolo(runs: readonly ProgressionRun[], config: ProgressionConfig): string[] {
  const rows = soloGate(runs, config);
  const mates = SOLO_MATES_RULES.computerMates;
  if (!rows || !mates) return [];
  return [
    '## Solo and computer mates (#386e)',
    '',
    `\`${SOLO_RULES.label}\`: one kid alone on a ${String(config.seats[0])}-seat map, no friendlies, defences or rival. \`${SOLO_MATES_RULES.label}\`: the same kid plus computer patch-mates: \`${WITH_FRIENDLIES_RULES.label}\`' friendlies a day against a mate (paid the same, a friendly counting toward the falloff only when the kid won; the coins cap on wins against computers doesn't touch XP), and ${String(mates.challengesPerWeek)} mate challenges a week on the kid's land outside the shield, held by the kid's guards at the watch floor. A mate fields the kid's team at the Partner level ${signed(mates.levelOffset)}. Each kind's levels are compared with the 4-seat \`${WITH_FRIENDLIES_RULES.label}\` pair's mean (kid 0 / kid 1 in brackets). Gate: ${formatSoloGate(rows)}.`,
    '',
    markdownTable(
      [
        'Kid',
        'Day',
        'solo',
        'solo + mates',
        'pair (kid 0 / 1)',
        'solo vs pair',
        'solo + mates vs pair',
      ],
      rows.flatMap((row) =>
        row.days.map((d) => [
          row.kid,
          String(d.day),
          String(d.solo),
          String(d.mates),
          `${String(d.pairedMean)} (${d.paired.join(' / ')})`,
          `${signed(d.soloPercent)} %`,
          `${signed(d.matesPercent)} %${d.passes ? '' : ' (FAIL)'}`,
        ]),
      ),
    ),
    '',
  ];
}

/** Sums a kid's day records up to and including `day`. */
const upTo = (days: readonly DayRecord[], day: number, field: 'defences' | 'defencesHeld') =>
  days.filter((d) => d.day <= day).reduce((n, d) => n + d[field], 0);

/** The friendlies and defences table (#728) and its gate. */
function renderFriendlies(runs: readonly ProgressionRun[], config: ProgressionConfig): string[] {
  const these = runs.filter((r) => r.rules === CURRENT_RULES || r.rules === WITH_FRIENDLIES_RULES);
  const gate = friendlyGate(runs, config);
  if (!gate || !WITH_FRIENDLIES_RULES.friendlies) return [];
  const { friendlies, defences } = WITH_FRIENDLIES_RULES;
  return [
    '## Friendlies and defences (#728)',
    '',
    `\`${WITH_FRIENDLIES_RULES.label}\`: the map's two kids play ${config.kids.map((k) => `${String(friendlies.perDay[k.id] ?? 0)} (${k.id})`).join(' / ')} friendlies a day against each other on top of their battles, both sides paid ${friendlies.oneOpponent ? "one opponent's worth of the engine's XP" : "the engine's XP"} at ${String(friendlies.xpPercent)} % (the shipped \`GROWTH_RULES\` knobs, as the battles service pays it), a friendly counting toward the falloff only for the side that won (owner decision 2026-11-15); their tile tries also weigh each other's land outside the home ring${defences ? ` from day ${String(defences.shieldDays + 1)}, at most ${String(defences.lossCapPerDay)} taken from a kid a day, against the owner's first ${String(defences.maxDefenders)} squishies on watch at the Partner level + ${String(defences.guardLevel.partnerBonus)}` : ''}. Levels are kid 0 / kid 1, and the gate takes the kid that moves most. Paid as the engine sums it (every opponent tuckered out, in full) friendlies snowballed: the winner earned more and won more, so one kid raced ahead (+10 by day 14); the owner's rule (2026-11-14) pays one opponent's worth at 50 %. Defences: the other kid's tries on kid 0's land (held in brackets; a hold pays the guards XP), an upper bound: here the whole team guards every tile, where on the server a squishy watches one tile and unguarded land falls back to guardians, who earn nothing. Read only the level columns of the firsts table for this variant: its befriend firsts move later because a befriend counts only when it joins the team, and wild squishies rarely beat a team levelled by friendlies. Gate: ${formatFriendlyGate(gate)} (${String(gate.seats)}-seat map).`,
    '',
    markdownTable(
      [
        'Rules',
        'Map seats',
        'Kid',
        'Friendlies a day',
        'Defences by day 14',
        'Defences by day 30',
        'Lv day 7 (kid 0 / 1)',
        'Lv day 14',
        'Lv day 30',
      ],
      these.map((run) => {
        const level = (day: number) =>
          run.kids.map((k) => cell(k.days[day - 1]?.partnerLevel ?? null)).join(' / ');
        const { days } = lead(run);
        const defence = (day: number) =>
          `${String(upTo(days, day, 'defences'))} (${String(upTo(days, day, 'defencesHeld'))})`;
        return [
          run.rules.label,
          String(run.seats),
          run.profile.id,
          String(run.rules.friendlies?.perDay[run.profile.id] ?? 0),
          defence(14),
          defence(30),
          level(7),
          level(14),
          level(30),
        ];
      }),
    ),
    '',
  ];
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
  info: {
    seconds: number;
    odds?: readonly WildOddsRow[];
    journeys?: readonly JourneyOddsRow[];
    /** Species facts for the "firsts" table (#736); none leaves it out. */
    firsts?: FirstsFacts;
  },
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
    ...(info.firsts ? renderFirsts(runs, config, info.firsts) : []),
    ...(info.firsts ? renderTierFirsts(runs, config, info.firsts) : []),
    ...renderFriendlies(runs, config),
    ...renderSolo(runs, config),
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
      // The solo rows (#386e) run on the first map size only.
      if (these.length === 0) continue;
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

/** The "firsts" table (#736): each run's first of each new thing, and the boredom gate. */
function renderFirsts(
  runs: readonly ProgressionRun[],
  config: ProgressionConfig,
  facts: FirstsFacts,
): string[] {
  const gate = config.firstsGate;
  const rows = runs.map((run) => {
    const firsts = firstsOf(lead(run).days, facts);
    const result = firstsGate(firsts, gate);
    const longest = Math.max(...result.gaps.map((g) => g.days));
    return [
      run.rules.label,
      String(run.seats),
      run.profile.id,
      ...firsts.map((f) => formatFirst(f.day, config.days)),
      String(longest),
    ];
  });
  const gated = runs.filter(
    (r) => r.profile.id === gate.kid && r.rules === CURRENT_RULES && r.seats === config.seats[0],
  );
  return [
    '## Firsts (#736)',
    '',
    `The day each new thing first happens to kid 0. "Rare befriended" counts only a befriend that joins the team (a late bound); "map full" is the shared map's last neutral tile. Gate: ${formatFirstsGate(
      firstsGate(firstsOf(gated[0] ? lead(gated[0]).days : [], facts), gate),
      gate,
    )} (shipped rules, ${String(config.seats[0])}-seat map).`,
    '',
    markdownTable(
      [
        'Rules',
        'Map seats',
        'Kid',
        ...FIRSTS.map((f) => f.label),
        `Longest gap (days 1–${String(gate.windowDays)})`,
      ],
      rows,
    ),
    '',
  ];
}

/** #732's per-tier gate line for these runs (the gated run's kid 0), or null when it wasn't run. */
export function tierGateLine(
  runs: readonly ProgressionRun[],
  config: ProgressionConfig,
  facts: FirstsFacts,
): string | null {
  const gated = runs.find(
    (r) =>
      r.rules === TIER_GATE.rules && r.profile.id === TIER_GATE.kid && r.seats === config.seats[0],
  );
  if (!gated) return null;
  const policy = TIER_GATE.rules.befriendPolicy ?? 'stronger';
  return formatTierGate(
    tierGate(tierFirstsOf(lead(gated).days, facts), TIER_GATE.byDay),
    TIER_GATE.kid,
    policy,
  );
}

/** #732's per-tier line: the first day a befriended squishy of each rarity line evolves. */
function renderTierFirsts(
  runs: readonly ProgressionRun[],
  config: ProgressionConfig,
  facts: FirstsFacts,
): string[] {
  const gate = tierGateLine(runs, config, facts);
  return [
    '## First evolve by rarity line (#732)',
    '',
    `The day a befriended squishy (any team member but the Partner, the two day-1 teammates included) of each rarity line first evolves, for kid 0; a line's rarity is its base form's. Rules marked "(collector)" put a rarer friend on the team even when it's weaker; the rest only take a stronger one. ${gate ?? `#732 per-tier gate: not run (needs \`${TIER_GATE.rules.label}\`).`}`,
    '',
    markdownTable(
      ['Rules', 'Map seats', 'Kid', ...TIERS],
      runs.map((run) => [
        run.rules.label,
        String(run.seats),
        run.profile.id,
        ...tierFirstsOf(lead(run).days, facts).map((f) => formatFirst(f.day, config.days)),
      ]),
    ),
    '',
  ];
}
