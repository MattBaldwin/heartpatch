import { REKINDLED } from '../../src/data/found-sets.js';
import { REKINDLED_DROPS } from '../../src/data/server/hollowed-finds.js';
import { deriveSeed, Rng } from '../../src/rng/index.js';
import type { FoundSet } from '../../src/schemas/data/found-sets.js';
import type { FoundSetDropTable } from '../../src/schemas/data/found-set-drops.js';
import { rollFoundSets } from '../../src/wardrobe/found-set-drops.js';
import { ECONOMY_CONFIG, type EconomyConfig } from './economy-config.js';
import type { HollowedConfig } from './hollowed-config.js';
import { villageSizes, villageSpotsPerDay } from './hollowed.js';

/*
 * How long a kid takes to find the Rekindled set (#306 PR 5): the real
 * secret tables (`REKINDLED_DROPS`) and roll (`rollFoundSets`), a day at a
 * time. Each day the kid makes the economy model's searches (`pnpm
 * sim:economy`), all of them on grey village land, capped at what the
 * smallest village's spots hold (they refill every morning). A piece the
 * kid has never drops again. Seeded, so a run is the same every time.
 */

/** What the model leaves out, for the report. */
export const REKINDLED_LIMITS = [
  'only village searches: solved puzzles, cellars and the far Hollow (their own, better tables) would make it quicker',
  'every search is on grey village land: searches on the kid’s own land find no Rekindled pieces',
  'a Hollow stops being grey once restored (about a week for a casual kid): the days assume grey Hollows are left to search (a patch has 3 or more; none is checked here)',
  'pieces drop only on patches where milestones count (2 or more members), as the title needs',
] as const;

/** Days (1 = the first day of searching) by which something was found, in one kid's run. */
interface RunDays {
  readonly firstPiece: number;
  readonly fullSet: number;
  readonly finds: ReadonlyMap<string, number>;
}

function runOnce(
  set: FoundSet,
  tables: readonly FoundSetDropTable[],
  searchesPerDay: number,
  rng: Rng,
  maxDays: number,
): RunDays {
  const owned = new Set<string>();
  const finds = new Map<string, number>();
  let firstPiece = Infinity;
  let fullSet = Infinity;
  for (let day = 1; day <= maxDays; day++) {
    for (let s = 0; s < searchesPerDay; s++) {
      const roll = rollFoundSets(tables, 'village', owned, rng);
      if (roll.clothing !== null) {
        owned.add(roll.clothing);
        firstPiece = Math.min(firstPiece, day);
      }
      for (const id of Object.keys(roll.items)) if (!finds.has(id)) finds.set(id, day);
    }
    if (fullSet === Infinity && set.pieces.every((p) => owned.has(p))) fullSet = day;
    if (fullSet !== Infinity && set.finds.every((f) => finds.has(f))) break;
  }
  return { firstPiece, fullSet, finds };
}

/** The `p`th percentile (0–100) of `values`, nearest rank. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? Infinity;
}

/** One kid's days to find things, as a median and a 90th percentile over every run. */
export interface RekindledRow {
  readonly kid: string;
  readonly searchesPerDay: number;
  /** Label → [median, p90] days. */
  readonly days: ReadonlyMap<string, readonly [number, number]>;
}

export function runRekindled(
  config: HollowedConfig,
  economy: EconomyConfig = ECONOMY_CONFIG,
  set: FoundSet = REKINDLED,
  tables: readonly FoundSetDropTable[] = REKINDLED_DROPS,
): RekindledRow[] {
  const cap = villageSpotsPerDay(Math.min(...villageSizes()), config.terrain);
  return economy.profiles.map((profile) => {
    const searchesPerDay = Math.min(profile.searchesPerDay, cap);
    const runs = Array.from({ length: config.rekindled.runs }, (_, i) =>
      runOnce(
        set,
        tables,
        searchesPerDay,
        Rng.fromSeed(deriveSeed(config.rekindled.seed, profile.id, i)),
        config.rekindled.maxDays,
      ),
    );
    const stat = (pick: (r: RunDays) => number): readonly [number, number] => {
      const values = runs.map(pick);
      return [percentile(values, 50), percentile(values, 90)];
    };
    const days = new Map<string, readonly [number, number]>([
      ['first piece', stat((r) => r.firstPiece)],
      [`all ${String(set.pieces.length)} pieces (${set.title.name})`, stat((r) => r.fullSet)],
      ...set.finds.map((f): [string, readonly [number, number]] => [
        `first ${f}`,
        stat((r) => r.finds.get(f) ?? Infinity),
      ]),
    ]);
    return { kid: profile.id, searchesPerDay, days };
  });
}

/** The full set's median days for `kid`. */
export function fullSetDays(rows: readonly RekindledRow[], kid: string): number {
  const row = rows.find((r) => r.kid === kid);
  const full = [...(row?.days.entries() ?? [])].find(([label]) => label.startsWith('all '));
  return full?.[1][0] ?? Infinity;
}

/** The report's Rekindled section, in Markdown lines. */
export function renderRekindled(rows: readonly RekindledRow[], config: HollowedConfig): string[] {
  const village = REKINDLED_DROPS.find((t) => t.place === 'village');
  const labels = [...(rows[0]?.days.keys() ?? [])];
  const show = (n: number) =>
    Number.isFinite(n) ? `${String(n)} d` : `> ${String(config.rekindled.maxDays)} d`;
  return [
    '## The Rekindled set (#306 PR 5)',
    '',
    `Days of village searching until a kid finds each thing: median / 90th percentile over ${String(config.rekindled.runs)} seeded runs of the real \`REKINDLED_DROPS\` (${String(village?.chance ?? 0)} % a village search) and roll. A piece the kid has never drops again. Gate: a casual kid finds the whole set within ${String(config.rekindled.gateDays)} days (median).`,
    '',
    `| Kid | Searches a day | ${labels.join(' | ')} |`,
    `|---|---|${labels.map(() => '---|').join('')}`,
    ...rows.map(
      (r) =>
        `| ${r.kid} | ${String(r.searchesPerDay)} | ${labels
          .map((l) => {
            const [median, p90] = r.days.get(l) ?? [Infinity, Infinity];
            return `${show(median)} / ${show(p90)}`;
          })
          .join(' | ')} |`,
    ),
    '',
    '### Not modelled',
    '',
    ...REKINDLED_LIMITS.map((l) => `- ${l}`),
    '',
  ];
}
