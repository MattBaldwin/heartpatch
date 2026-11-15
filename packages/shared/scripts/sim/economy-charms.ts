import { charmWeeks, type CharmWeek } from './progression-boss-report.js';
import { WITH_BOSS_RULES, type ProgressionConfig } from './progression-config.js';
import { modelData, runProgression, type ModelData } from './progression.js';

/*
 * Heart Charm supply against mini-boss asks (#190 plan §9, `pnpm
 * sim:economy`): each kid's weekly charms from the progression model under
 * `WITH_BOSS_RULES` (crafting, the starter gift and the boss bundle in;
 * wild befriending and boss asks out), and whether what's left after wild
 * befriending covers `bossAsks` charms a week.
 */

export interface CharmSupplyRow {
  readonly kid: string;
  readonly weeks: readonly CharmWeek[];
  /** The fewest charms left over in a full week after wild befriending (crafted + bundle − wild). */
  readonly leastSpare: number;
  /** Charms wild befriending wanted but couldn't have, over the run. */
  readonly short: number;
}

export interface CharmGate {
  /** The plan's boss-ask charms a week: [low, high]. */
  readonly bossAsks: readonly [number, number];
}

// TUNE: plan §9, "3–6 charms a week for boss asks" (one or two asks of 3).
export const CHARM_GATE: CharmGate = { bossAsks: [3, 6] };

/** Kid 0's weekly charms for each kid kind (first map size). Full weeks only for the spare. */
export function charmSupply(
  config: ProgressionConfig,
  data: ModelData = modelData(),
  rules = WITH_BOSS_RULES,
): CharmSupplyRow[] {
  const bundle = rules.boss?.events.bundle['heart-charm'] ?? 0;
  const seats = config.seats[0] ?? 0;
  return config.kids.map((kid) => {
    const run = runProgression(data, config, rules, kid, seats);
    const weeks = charmWeeks(run.kids[0]?.days ?? [], bundle);
    const full = weeks.filter((w) => w.week * 7 <= config.days);
    const spare = full.map((w) => w.made - w.wild);
    return {
      kid: kid.id,
      weeks,
      leastSpare: spare.length > 0 ? Math.min(...spare) : 0,
      short: weeks.reduce((n, w) => n + w.short, 0),
    };
  });
}

/** One gate line per kid: PASS when every full week's spare covers the high end, and wild befriending is never short. */
export function charmGateLines(rows: readonly CharmSupplyRow[], gate = CHARM_GATE): string[] {
  const [low, high] = gate.bossAsks;
  return rows.map((r) => {
    const pass = r.leastSpare >= high && r.short === 0;
    return `charm gate (#190, soft): ${r.kid} kid 0 spares at least ${String(r.leastSpare)} charms a week after wild befriending (boss asks want ${String(low)}–${String(high)}), short ${String(r.short)}: ${pass ? 'PASS' : 'FAIL'}`;
  });
}

/** The report section. */
export function renderCharms(rows: readonly CharmSupplyRow[], gate = CHARM_GATE): string {
  const lines = [
    '## Heart Charms and mini-boss asks (#190)',
    '',
    `From \`pnpm sim:progression\`'s \`${WITH_BOSS_RULES.label}\` runs (kid 0, first map size). "Spare" is a week's crafted charms plus the boss bundle, less wild befriending; boss asks want ${String(gate.bossAsks[0])}–${String(gate.bossAsks[1])} a week on top. Soft gate: it reports and never fails the run.`,
    '',
    ...charmGateLines(rows, gate).map((l) => `- ${l}`),
    '',
    '| Kid | Week | Crafted | Bundle | Wild | Spare | Boss asks | Left |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.flatMap((r) =>
      r.weeks.map(
        (w) =>
          `| ${r.kid} | ${String(w.week)} | ${String(w.made - w.bundle)} | ${String(w.bundle)} | ${String(w.wild)} | ${String(w.made - w.wild)} | ${String(w.boss)} | ${String(w.left)} |`,
      ),
    ),
  ];
  return `${lines.join('\n')}\n`;
}
