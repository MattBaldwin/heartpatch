import {
  BOSS_GATE,
  CURRENT_RULES,
  WITH_BOSS_RULES,
  type BossGate,
  type ProgressionConfig,
  type ProgressionRules,
} from './progression-config.js';
import { firstsOf, formatFirst, type FirstsFacts } from './progression-firsts.js';
import type { DayRecord, ProgressionRun } from './progression.js';

/*
 * The mini-boss part of the progression report (#190 plan §9): the firsts
 * targets, the XP gate against the run without bosses, and each kid's Heart
 * Charm ledger by week (also read by `pnpm sim:economy`).
 */

export interface BossFirstsCheck {
  readonly kid: string;
  readonly what: 'beaten' | 'friend';
  readonly day: number | null;
  readonly byDay: number;
  readonly pass: boolean;
}

export interface BossXpCheck {
  readonly kid: string;
  readonly day: number;
  /** Partner level without and with bosses (the kid of the two that rose most). */
  readonly partner: readonly [number, number];
  /** Mean team level (rounded down) without and with bosses, the same kid. */
  readonly team: readonly [number, number];
  readonly delta: number;
  readonly maxLevels: number;
  readonly pass: boolean;
}

export interface BossGateResult {
  readonly firsts: readonly BossFirstsCheck[];
  readonly xp: readonly BossXpCheck[];
  readonly pass: boolean;
}

const find = (
  runs: readonly ProgressionRun[],
  rules: ProgressionRules,
  seats: number,
  kid: string,
): ProgressionRun | undefined =>
  runs.find((r) => r.rules === rules && r.seats === seats && r.profile.id === kid);

const meanLevel = (d: DayRecord | undefined) =>
  d && d.levels.length > 0 ? Math.floor(d.levels.reduce((n, l) => n + l, 0) / d.levels.length) : 0;

/**
 * `BOSS_GATE` over `runs` (first map size): kid 0's first boss beaten and
 * first boss friend by the targets, and both kids' day-14 and day-30 levels
 * (Partner and team mean) within `maxLevels` of `CURRENT_RULES`. Null when
 * a run is missing.
 */
export function bossGate(
  runs: readonly ProgressionRun[],
  config: ProgressionConfig,
  facts: FirstsFacts,
  gate: BossGate = BOSS_GATE,
  rules: ProgressionRules = WITH_BOSS_RULES,
): BossGateResult | null {
  const seats = config.seats[0] ?? 0;
  const firsts: BossFirstsCheck[] = [];
  const xp: BossXpCheck[] = [];
  for (const [kid, targets] of Object.entries(gate.byDay)) {
    const run = find(runs, rules, seats, kid);
    const base = find(runs, CURRENT_RULES, seats, kid);
    if (!run || !base) return null;
    const found = firstsOf(run.kids[0]?.days ?? [], facts);
    for (const what of ['beaten', 'friend'] as const) {
      const day = found.find((f) => f.id === `first-boss-${what}`)?.day;
      const at = typeof day === 'number' ? day : null;
      const byDay = targets[what];
      firsts.push({ kid, what, day: at, byDay, pass: at !== null && at <= byDay });
    }
    for (const day of gate.xpDays) {
      const rows = run.kids.map((k, i) => {
        const now = k.days[day - 1];
        const was = base.kids[i]?.days[day - 1];
        const partner = [was?.partnerLevel ?? 0, now?.partnerLevel ?? 0] as const;
        const team = [meanLevel(was), meanLevel(now)] as const;
        return { partner, team, delta: Math.max(partner[1] - partner[0], team[1] - team[0]) };
      });
      const worst = rows.reduce((a, b) => (b.delta > a.delta ? b : a));
      xp.push({
        kid,
        day,
        ...worst,
        maxLevels: gate.maxLevels,
        pass: worst.delta <= gate.maxLevels,
      });
    }
  }
  return {
    firsts,
    xp,
    pass: firsts.every((f) => f.pass) && xp.every((x) => x.pass),
  };
}

/** The gate's lines, each PASS or FAIL (soft: the report never fails the run). */
export function formatBossGate(result: BossGateResult, runDays: number): string[] {
  const verdict = (pass: boolean) => (pass ? 'PASS' : 'FAIL');
  const sign = (n: number) => `${n >= 0 ? '+' : ''}${String(n)}`;
  return [
    ...result.firsts.map(
      (f) =>
        `boss gate (#190, soft): ${f.kid} kid 0 first boss ${f.what} ${formatFirst(f.day, runDays)} (by day ${String(f.byDay)}): ${verdict(f.pass)}`,
    ),
    ...result.xp.map(
      (x) =>
        `boss XP gate (#190, soft): ${x.kid} day ${String(x.day)} Partner Lv ${String(x.partner[0])} → ${String(x.partner[1])}, team mean Lv ${String(x.team[0])} → ${String(x.team[1])} (${sign(x.delta)}, at most +${String(x.maxLevels)}): ${verdict(x.pass)}`,
    ),
  ];
}

/** One week of a kid's Heart Charms. */
export interface CharmWeek {
  readonly week: number;
  /** Crafted plus the boss bundle. */
  readonly made: number;
  readonly bundle: number;
  readonly wild: number;
  readonly boss: number;
  /** Charms wild befriending wanted but the bag didn't have. */
  readonly short: number;
  /** In the bag at the week's end. */
  readonly left: number;
  readonly asks: number;
}

/** A kid's Heart Charm ledger by week (days 1–7 are week 1); empty without `boss` rules. */
export function charmWeeks(days: readonly DayRecord[], bundlePerWin: number): CharmWeek[] {
  const weeks: CharmWeek[] = [];
  for (let start = 0; start < days.length; start += 7) {
    const these = days.slice(start, start + 7).flatMap((d) => (d.boss ? [d.boss] : []));
    if (these.length === 0) continue;
    const sum = (pick: (b: (typeof these)[number]) => number) =>
      these.reduce((n, b) => n + pick(b), 0);
    const bundle = sum((b) => (b.won ? bundlePerWin : 0));
    weeks.push({
      week: start / 7 + 1,
      made: sum((b) => b.charmsIn),
      bundle,
      wild: sum((b) => b.charmsWild),
      boss: sum((b) => b.charmsBoss),
      short: sum((b) => b.charmsShort),
      left: these.at(-1)?.charms ?? 0,
      asks: sum((b) => b.asks),
    });
  }
  return weeks;
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

/** The report's mini-boss section; empty when the runs have no `WITH_BOSS_RULES`. */
export function renderBoss(
  runs: readonly ProgressionRun[],
  config: ProgressionConfig,
  facts: FirstsFacts,
  gate: BossGate = BOSS_GATE,
): string[] {
  const model = WITH_BOSS_RULES.boss;
  const result = bossGate(runs, config, facts, gate);
  if (!model || !result) return [];
  const seats = config.seats[0] ?? 0;
  const bundle = model.events.bundle['heart-charm'] ?? 0;
  const visits = runs
    .filter((r) => r.rules === WITH_BOSS_RULES && r.seats === seats)
    .map((run) => {
      const days = run.kids[0]?.days ?? [];
      const out = days.filter((d) => d.boss?.out).length;
      const tries = days.reduce((n, d) => n + (d.boss?.tries ?? 0), 0);
      const wins = days.filter((d) => d.boss?.won).length;
      const asks = days.reduce((n, d) => n + (d.boss?.asks ?? 0), 0);
      const friends = days.filter((d) => d.boss?.friend).length;
      return [
        run.profile.id,
        String(out),
        String(tries),
        String(wins),
        String(asks),
        String(friends),
      ];
    });
  const levels = runs
    .filter((r) => (r.rules === WITH_BOSS_RULES || r.rules === CURRENT_RULES) && r.seats === seats)
    .map((run) => {
      const days = run.kids[0]?.days ?? [];
      return [
        run.rules.label,
        run.profile.id,
        ...gate.xpDays.flatMap((d) => [
          String(days[d - 1]?.partnerLevel ?? '—'),
          String(meanLevel(days[d - 1])),
        ]),
      ];
    });
  const ledger = runs
    .filter((r) => r.rules === WITH_BOSS_RULES && r.seats === seats)
    .flatMap((run) =>
      charmWeeks(run.kids[0]?.days ?? [], bundle).map((w) => [
        run.profile.id,
        String(w.week),
        String(w.made - w.bundle),
        String(w.bundle),
        String(w.wild),
        String(w.boss),
        String(w.short),
        String(w.left),
      ]),
    );
  return [
    '## Mini-bosses (#190)',
    '',
    `\`${WITH_BOSS_RULES.label}\`: the shipped boss rules (\`BOSS_EVENTS\`) with ${String(model.standIns)} stand-in bosses (the shipped bag is empty until 234b), the server's own visit schedule (\`bossVisitFor\`, no Long Night in the model) and boss level, fought through the real team format. Tries per day the boss is out: ${Object.entries(
      model.triesPerDay,
    )
      .map(([k, n]) => `${k} ${String(n)}`)
      .join(
        ', ',
      )}; on top of the day's battles. A win pays every fighter the engine's XP as one win in the falloff, and the bundle (${String(bundle)} Heart Charms); then up to ${String(model.befriend.asksPerWin)} asks of ${String(model.befriend.charmsPerAsk)} charms at ${String(model.befriend.basePercent)} % + ${String(model.befriend.perStandingPercent)} % a standing squishy + ${String(model.befriend.perMissPercent)} % an earlier miss, sure after ${String(model.befriend.sureAfterMisses)} misses (plan §3). Charms: ${String(model.charms.start)} to start, ${Object.entries(
      model.charms.perDay,
    )
      .map(([k, n]) => `${k} ${String(n)}`)
      .join(
        ' / ',
      )} crafted a day, ${String(model.charms.perWildFriend)} a wild befriend (up to the kid's befriends a day). ${String(seats)}-seat map, kid 0.`,
    '',
    ...formatBossGate(result, config.days).map((l) => `- ${l}`),
    '',
    table(['Kid', 'Days out', 'Tries', 'Wins', 'Asks', 'Friends'], visits),
    '',
    'Levels without and with bosses (Partner, team mean):',
    '',
    table(
      [
        'Rules',
        'Kid',
        ...gate.xpDays.flatMap((d) => [`Partner d${String(d)}`, `Team d${String(d)}`]),
      ],
      levels,
    ),
    '',
    'Heart Charms by week:',
    '',
    table(['Kid', 'Week', 'Crafted', 'Bundle', 'Wild', 'Boss asks', 'Short', 'Left'], ledger),
    '',
  ];
}
