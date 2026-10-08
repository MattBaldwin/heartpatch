import { CLOTHING_BY_ID } from '../../src/data/clothing.js';
import { CLOTHING_DROPS } from '../../src/data/server/clothing-drops.js';
import type { ClothingDropSource } from '../../src/schemas/data/clothing.js';
import type { ClothingDropTable } from '../../src/schemas/data/clothing-drops.js';
import { CLOTHING_RARITIES, type ClothingRarity } from '../../src/schemas/data/clothing.js';
import type { CostumeConfig, CostumeProfile } from './costumes-config.js';

/**
 * The costume outlook (#261): for each rarity, a kid's chance per day of
 * finding one of that tier's Halloween costumes, how many days that takes on
 * average, the chance of finding one before the window closes, and the busy
 * days of coins to buy one. Every Halloween piece in a table competes with the
 * costumes, and terrain-bound pieces count as if every terrain were near
 * (the worst case for a costume).
 */

export interface CostumeTier {
  readonly rarity: ClothingRarity;
  readonly costumes: readonly string[];
  /** Expected finds of this tier per day of play. */
  readonly perDay: number;
  /** Average days to the first find (Infinity if it can't be found). */
  readonly daysToFind: number;
  /** Chance of at least one find in the window, 0–1. */
  readonly inWindow: number;
  /** Boutique price, or null when it's never sold. */
  readonly price: number | null;
  /** Days of coins to buy one, or null when it's never sold. */
  readonly daysToBuy: number | null;
}

export interface CostumeRow {
  readonly profile: string;
  readonly tiers: readonly CostumeTier[];
}

/** How many times a day each table is rolled, and at what chance. */
function rolls(
  profile: CostumeProfile,
  table: ClothingDropTable,
): { count: number; chance: number }[] {
  const by: Record<ClothingDropSource, { count: number; chance: number }[]> = {
    gather: [{ count: profile.gathers, chance: table.chance }],
    capture: [
      { count: profile.tileCaptures, chance: table.chance },
      { count: profile.rivalCaptures, chance: table.rivalChance ?? table.chance },
    ],
    battle: [{ count: profile.wildWins, chance: table.chance }],
    explore: [{ count: profile.exploreFinds, chance: table.chance }],
    rescue: [],
  };
  return by[table.source];
}

/** The outlook for one kind of kid. */
export function costumeOutlook(
  profile: CostumeProfile,
  config: Pick<CostumeConfig, 'costumes' | 'windowDays'>,
  tables: readonly ClothingDropTable[] = CLOTHING_DROPS,
): CostumeTier[] {
  return CLOTHING_RARITIES.flatMap((rarity): CostumeTier[] => {
    const costumes = config.costumes.filter((id) => CLOTHING_BY_ID.get(id)?.rarity === rarity);
    if (costumes.length === 0) return [];
    let perDay = 0;
    let missAll = 1;
    for (const table of tables) {
      // Everything that can drop in the Halloween window competes.
      const live = table.entries.filter((e) => {
        const item = CLOTHING_BY_ID.get(e.item);
        return item !== undefined && (item.season === undefined || item.season === 'halloween');
      });
      const total = live.reduce((sum, e) => sum + e.weight, 0);
      const mine = live.filter((e) => costumes.includes(e.item)).reduce((s, e) => s + e.weight, 0);
      if (total === 0 || mine === 0) continue;
      for (const { count, chance } of rolls(profile, table)) {
        const each = (chance / 100) * (mine / total);
        perDay += count * each;
        missAll *= Math.pow(1 - each, count * config.windowDays);
      }
    }
    const prices = costumes.map((id) => CLOTHING_BY_ID.get(id)?.boutiquePrice);
    const price = prices.every((p) => p !== undefined) ? Math.min(...prices) : null;
    return [
      {
        rarity,
        costumes,
        perDay,
        daysToFind: perDay === 0 ? Infinity : 1 / perDay,
        inWindow: 1 - missAll,
        price,
        daysToBuy: price === null ? null : Math.ceil(price / profile.coins),
      },
    ];
  });
}

/** Every profile's outlook. */
export function runCostumes(config: CostumeConfig): CostumeRow[] {
  return config.profiles.map((profile) => ({
    profile: profile.id,
    tiers: costumeOutlook(profile, config),
  }));
}

const days = (n: number) => (Number.isFinite(n) ? n.toFixed(n < 10 ? 1 : 0) : 'never');
const percent = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`;

/**
 * The report's rows as markdown table lines, so `pnpm sim:economy` (#199)
 * can show them too.
 */
export function costumeTableLines(row: CostumeRow, windowDays: number): string[] {
  return [
    `| Tier | Costumes | Days to find | Found by Nov 9 (${String(windowDays)} days) | Price | Days to buy |`,
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...row.tiers.map(
      (t) =>
        `| ${t.rarity} | ${t.costumes.join(', ')} | ${days(t.daysToFind)} | ${percent(t.inWindow)} | ${t.price === null ? 'never sold' : String(t.price)} | ${t.daysToBuy === null ? '—' : String(t.daysToBuy)} |`,
    ),
  ];
}

/** The whole report, as markdown. */
export function renderCostumes(rows: readonly CostumeRow[], config: CostumeConfig): string {
  return [
    '# Costume outlook (#261)',
    '',
    'How long a kid takes to find or buy each tier of Halloween costume, from',
    'the shipped drop tables, prices and the profiles in `costumes-config.ts`',
    '(guesses until #199 measures a day of play). Found = at least one of the',
    "tier's costumes from gathers, captures, rival captures, wild wins and explore finds.",
    '',
    ...rows.flatMap((row) => [
      `## ${row.profile}`,
      '',
      ...costumeTableLines(row, config.windowDays),
      '',
    ]),
  ].join('\n');
}
