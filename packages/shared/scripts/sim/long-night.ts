import { HOLLOW_RULES } from '../../src/data/hollow.js';
import { HOME_BASE_RULES } from '../../src/data/home-base.js';
import { LONG_NIGHT_RULES } from '../../src/data/long-night.js';
import { LONG_NIGHT_SECRETS } from '../../src/data/server/long-night.js';
import { addDays } from '../../src/home/local-date.js';
import {
  firstHollowNight,
  keeperNightOf,
  rollStrikes,
  strengthOf,
} from '../../src/hollow/index.js';
import {
  isKeeperCounted,
  isLongNight,
  longNightPercent,
  patchHeld,
} from '../../src/long-night/index.js';
import { deriveSeed, Rng } from '../../src/rng/index.js';
import type { LocalDate } from '../../src/schemas/time.js';
import type { LongNightConfig, LongNightKid } from './long-night-config.js';

/*
 * Does a patch hold its Long Night? (#727b.) Every patch is run from each
 * weekday it could start on; its Keepers join on the config's days, at noon.
 * On each Long Night of month one, each Keeper's strikes are the real
 * `rollStrikes` on their night's strength row at the Long Night percent
 * (`longNightPercent`, the real secret multiplier), with the real grace.
 * He takes something only from a Keeper who left something in the dark: an
 * unstocked kid always has (dark land past their home), a stocked kid only
 * on a stray night. A Keeper holds if he struck nothing or found nothing;
 * the patch holds by `patchHeld`.
 */

/** What the model leaves out, for the report. */
export const LONG_NIGHT_LIMITS = [
  'every Keeper plays all month (nobody is away, so everyone past grace is counted)',
  'stocking and strays are coin flips each Long Night, not a model of fuel or land',
  'an unstocked kid always has dark land; a stocked one has nothing in the dark unless they stray',
  'Keepers join at noon on their join day',
] as const;

export type Readiness = 'stocked' | 'unstocked' | 'as they play';

export interface LongNightRow {
  readonly kid: string;
  readonly seats: number;
  readonly readiness: Readiness;
  /** Counted Keeper Long Nights (past grace) in month one. */
  readonly keeperNights: number;
  /** Their share that held. */
  readonly keeperHolds: number;
  /** Month-one patch Long Nights. */
  readonly patchNights: number;
  /** Their share the patch held. */
  readonly patchHolds: number;
}

const noon = 12 * 60;
const rules = { ...HOME_BASE_RULES, ...HOLLOW_RULES };

/** One patch's month: each Long Night's Keepers, and whether the patch held. */
export function simulatePatch(
  config: LongNightConfig,
  kid: LongNightKid,
  seats: number,
  readiness: Readiness,
  startDay: number,
  run: number,
): { keepers: { counted: boolean; held: boolean }[]; held: boolean }[] {
  const start = addDays(config.startDate, startDay);
  const joins = config.joinDays[String(seats)] ?? [];
  const percent = longNightPercent(config.strengthPercent, LONG_NIGHT_SECRETS.strengthMultiplier);
  const seed = deriveSeed(config.seed, kid.id, seats, readiness, startDay, run);
  const nights: { keepers: { counted: boolean; held: boolean }[]; held: boolean }[] = [];
  let latest: LocalDate | null = null;
  for (let d = 0; d < config.monthDays; d++) {
    const night = addDays(start, d);
    if (!isLongNight(LONG_NIGHT_RULES.defaultWeekday, night, latest)) continue;
    latest = night;
    const keepers = joins.flatMap((joinDay, seat) => {
      const joined = { date: addDays(start, joinDay), minute: noon };
      const nightNo = keeperNightOf(joined, night, rules);
      if (nightNo < 1) return []; // not on the patch yet
      const userId = `keeper-${String(seat)}`;
      const grace = night < firstHollowNight(joined, rules);
      const strikes = grace
        ? 0
        : rollStrikes(
            strengthOf(nightNo, rules).chances,
            percent,
            rules.strength.cap,
            deriveSeed(seed, 'hollow-strength', night, userId),
          );
      const rng = Rng.fromSeed(deriveSeed(seed, 'ready', night, userId));
      const stocked =
        readiness === 'stocked' || (readiness === 'as they play' && rng.chance(kid.stocksPercent));
      const exposed = !stocked || rng.chance(kid.strayPercent);
      return [
        { counted: isKeeperCounted(grace, 0, LONG_NIGHT_RULES), held: !exposed || strikes === 0 },
      ];
    });
    nights.push({ keepers, held: patchHeld(keepers) });
  }
  return nights;
}

export function runLongNight(config: LongNightConfig): LongNightRow[] {
  const rows: LongNightRow[] = [];
  const readinesses: Readiness[] = ['stocked', 'unstocked', 'as they play'];
  for (const kid of config.kids) {
    for (const seats of Object.keys(config.joinDays).map(Number)) {
      for (const readiness of readinesses) {
        let keeperNights = 0;
        let keeperHeld = 0;
        let patchNights = 0;
        let patchHeldCount = 0;
        for (let startDay = 0; startDay < 7; startDay++) {
          for (let run = 0; run < config.runs; run++) {
            for (const n of simulatePatch(config, kid, seats, readiness, startDay, run)) {
              patchNights++;
              if (n.held) patchHeldCount++;
              for (const k of n.keepers) {
                if (!k.counted) continue;
                keeperNights++;
                if (k.held) keeperHeld++;
              }
            }
          }
        }
        rows.push({
          kid: kid.id,
          seats,
          readiness,
          keeperNights,
          keeperHolds: keeperNights === 0 ? 0 : keeperHeld / keeperNights,
          patchNights,
          patchHolds: patchNights === 0 ? 0 : patchHeldCount / patchNights,
        });
      }
    }
  }
  return rows;
}

/** The three gates from the plan, each with the row it reads. */
export function longNightGates(rows: readonly LongNightRow[], config: LongNightConfig) {
  const find = (seats: number, readiness: Readiness) =>
    rows.find((r) => r.kid === 'casual' && r.seats === seats && r.readiness === readiness);
  const stocked = find(1, 'stocked')?.keeperHolds ?? 0;
  const unstocked = find(1, 'unstocked')?.keeperHolds ?? 1;
  const patch = find(4, 'as they play')?.patchHolds ?? 0;
  const [low, high] = config.gates.patchHolds;
  return [
    {
      label: `fuel-stocked casual kid holds ≥ ${pct(config.gates.stockedHoldsAtLeast)}`,
      value: stocked,
      pass: stocked >= config.gates.stockedHoldsAtLeast,
    },
    {
      label: `unstocked casual kid holds ≤ ${pct(config.gates.unstockedHoldsAtMost)}`,
      value: unstocked,
      pass: unstocked <= config.gates.unstockedHoldsAtMost,
    },
    {
      label: `4-seat casual patch holds ${pct(low)}–${pct(high)} in month one`,
      value: patch,
      pass: patch >= low && patch <= high,
    },
  ];
}

const pct = (share: number) => `${(share * 100).toFixed(0)} %`;

/** Each night's chances, ordinary and on a Long Night (clamped at 100, as `rollStrikes` does). */
export function strengthTable(strengthPercent: number) {
  const percent = longNightPercent(strengthPercent, LONG_NIGHT_SECRETS.strengthMultiplier);
  const scale = (chances: readonly number[], p: number) =>
    chances.map((c) => Math.min(100, Math.floor((c * p) / 100)));
  return rules.strength.nights.map((row) => ({
    from: row.from,
    stage: row.stage,
    ordinary: scale(row.chances, strengthPercent),
    longNight: scale(row.chances, percent),
  }));
}

export function renderLongNight(
  rows: readonly LongNightRow[],
  config: LongNightConfig,
  meta: { seconds: number },
): string {
  const gates = longNightGates(rows, config);
  const lines = [
    '# Long Night report (#727)',
    '',
    `Month one (${String(config.monthDays)} days) of Long Nights on ${String(config.runs)} patches from each starting weekday, at ${String(config.strengthPercent)} % strength × the secret multiplier (${String(LONG_NIGHT_SECRETS.strengthMultiplier)}). Keepers join on days ${Object.entries(
      config.joinDays,
    )
      .map(([seats, days]) => `${days.join(', ')} (${seats} seats)`)
      .join('; ')}. ${String(rows.length)} rows in ${meta.seconds.toFixed(1)} s.`,
    '',
    '## Gates',
    '',
    ...gates.map((g) => `- ${g.pass ? 'PASS' : 'FAIL'}: ${g.label} (${pct(g.value)})`),
    '',
    '## Holds',
    '',
    '| Kid | Seats | Readiness | Keeper Long Nights | Keeper held | Patch Long Nights | Patch held |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.kid} | ${String(r.seats)} | ${r.readiness} | ${String(r.keeperNights)} | ${pct(r.keeperHolds)} | ${String(r.patchNights)} | ${pct(r.patchHolds)} |`,
    ),
    '',
    '## Strike chances by Keeper night',
    '',
    'His first strike is certain on a Long Night from night 4 on: holding is all about preparation.',
    '',
    '| From night | Stage | Ordinary | Long Night |',
    '|---|---|---|---|',
    ...strengthTable(config.strengthPercent).map(
      (r) =>
        `| ${String(r.from)} | ${r.stage} | ${r.ordinary.join(', ') || '–'} | ${r.longNight.join(', ') || '–'} |`,
    ),
    '',
    '## Kids',
    '',
    ...config.kids.map(
      (k) =>
        `- ${k.id}: stocked ${String(k.stocksPercent)} % of Long Nights; strays ${String(k.strayPercent)} % of stocked ones.`,
    ),
    '',
    '## Limits',
    '',
    ...LONG_NIGHT_LIMITS.map((l) => `- ${l}`),
    '',
  ];
  return lines.join('\n');
}
