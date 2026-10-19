import { COMMUNITY_RULES } from '../../src/data/communities.js';
import { MAP_GEN } from '../../src/data/map-gen.js';
import { EXPLORE_RULES } from '../../src/data/explore.js';
import { EXPLORE_FINDS } from '../../src/data/server/explore-finds.js';
import { HOLLOWED_FINDS } from '../../src/data/server/hollowed-finds.js';
import type { CommunityRules } from '../../src/schemas/data/communities.js';
import type { ExploreRules } from '../../src/schemas/data/explore.js';
import type { ExploreFindTable } from '../../src/schemas/data/explore-finds.js';
import { ECONOMY_CONFIG, type EconomyConfig } from './economy-config.js';
import { runEconomy } from './economy-report.js';
import type { HollowedConfig } from './hollowed-config.js';
import type { ProgressionConfig } from './progression-config.js';

/*
 * What restoring a Hollowed Community costs a kid in days (#306, plan v3).
 * A village of `n` tiles needs `piecesBySize[n]` pieces a tile, each costing
 * its terrain's `pieceCost` plus `heartdustPerPiece` Heartdust (the joy).
 * Timber and Stone come from a day of the economy model's gathering
 * (`pnpm sim:economy`), of which `restorePercent` goes into restoring.
 * Heartdust only comes from searches: the chance a search on the village's
 * terrain finds some is the real Hollowed find tables' (`HOLLOWED_FINDS`:
 * the explore tables with Heartdust `heartdustFindMultiplier` times as
 * often). A village's spots refill every morning (#306 2a), so a day's
 * searches there are capped at its spots: its size times its terrain's
 * fewest spots a tile. A helper doubles everything but that cap.
 */

/** What the model leaves out, for the report. */
export const HOLLOWED_LIMITS = [
  'Heartdust is its expected value a search, not luck: half the kids take longer',
  'every search is on Hollowed land, and every spot holds Heartdust as often as its kind does',
  'Heartdust from anywhere else (gifts, prizes) is not counted, nor spending it on anything else',
  'Timber and Stone a day are the economy model’s on its first week’s land',
  'a village’s spots refill every morning: a day’s searches are capped at its size times its terrain’s fewest spots a tile',
  'the kid always has the tools a spot needs',
] as const;

/** What restoring a village of `size` tiles on `terrain` costs, by resource. */
export function villageCost(
  size: number,
  terrain: string,
  rules: CommunityRules = COMMUNITY_RULES,
): Record<string, number> {
  const pieces = (rules.piecesBySize[String(size)] ?? 0) * size;
  if (pieces === 0) throw new Error(`no piecesBySize for ${String(size)} tiles`);
  const each = rules.pieceCost[terrain] ?? rules.pieceCost['default'];
  if (!each) throw new Error(`no pieceCost for "${terrain}" and no default`);
  const cost: Record<string, number> = { [rules.joyResource]: pieces * rules.heartdustPerPiece };
  for (const [resource, n] of Object.entries(each))
    cost[resource] = (cost[resource] ?? 0) + pieces * n;
  return cost;
}

/** Heartdust one ordinary search on `terrain` finds, on average (its kit's kinds, by weight). */
export function heartdustPerSearch(
  terrain: string,
  explore: Pick<ExploreRules, 'terrains'> = EXPLORE_RULES,
  finds: readonly ExploreFindTable[] = EXPLORE_FINDS,
  joy: string = COMMUNITY_RULES.joyResource,
): number {
  const kit = explore.terrains.find((t) => t.terrain === terrain);
  if (!kit) throw new Error(`no explore kit for "${terrain}"`);
  const kitWeight = kit.kinds.reduce((a, k) => a + k.weight, 0);
  let perSearch = 0;
  for (const { kind, weight } of kit.kinds) {
    const table = finds.find((f) => f.kind === kind);
    if (!table) throw new Error(`no finds for "${kind}"`);
    const total = table.finds.reduce((a, f) => a + f.weight, 0);
    const dust = table.finds.reduce((a, f) => a + f.weight * (f.items?.[joy] ?? 0), 0);
    perSearch += (weight / kitWeight) * (dust / total);
  }
  return perSearch;
}

/** What one kid (or team) brings to a village each day. */
export interface DailyHelp {
  /** Timber, Stone and so on for restoring. */
  readonly resources: Readonly<Record<string, number>>;
  readonly searches: number;
}

/**
 * Days until every resource the village needs is in: the slowest one.
 * Infinity when a needed resource never comes in.
 */
export function daysToRestore(
  cost: Readonly<Record<string, number>>,
  help: DailyHelp,
  hollowedDustPerSearch: number,
  joy: string = COMMUNITY_RULES.joyResource,
): number {
  let days = 0;
  for (const [resource, need] of Object.entries(cost)) {
    const perDay =
      resource === joy ? help.searches * hollowedDustPerSearch : (help.resources[resource] ?? 0);
    days = Math.max(days, perDay > 0 ? Math.ceil(need / perDay) : Infinity);
  }
  return days;
}

/** Heartdust one Hollowed search finds on average: the real `HOLLOWED_FINDS`. */
export function hollowedDustPerSearch(
  terrain: string,
  finds: readonly ExploreFindTable[] = HOLLOWED_FINDS,
): number {
  return heartdustPerSearch(terrain, EXPLORE_RULES, finds);
}

/**
 * Searches a day a village of `size` tiles on `terrain` has room for: its
 * spots refill every morning, and each tile has at least its kit's fewest.
 */
export function villageSpotsPerDay(
  size: number,
  terrain: string,
  explore: Pick<ExploreRules, 'terrains'> = EXPLORE_RULES,
): number {
  const kit = explore.terrains.find((t) => t.terrain === terrain);
  if (!kit) throw new Error(`no explore kit for "${terrain}"`);
  return size * kit.spots.min;
}

/** One kid (or team) restoring their nearest village. */
export interface HollowedRow {
  readonly kid: string;
  readonly team: string;
  readonly help: DailyHelp;
  readonly dustPerDay: number;
  /** Village size (tiles) → days to restore it. */
  readonly days: ReadonlyMap<number, number>;
}

/** Every village size the map makes, smallest first. */
export function villageSizes(): number[] {
  const { min, max } = MAP_GEN.communities.size;
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** The economy model's kids, their day of gathering shared out, alone and with a helper. */
export function runHollowed(
  config: HollowedConfig,
  progression: ProgressionConfig,
  economy: EconomyConfig = ECONOMY_CONFIG,
): HollowedRow[] {
  const gathered = runEconomy(
    { ...economy, seats: [config.seats], days: [config.incomeDay] },
    progression,
  );
  const dust = hollowedDustPerSearch(config.terrain);
  const rows: HollowedRow[] = [];
  for (const profile of economy.profiles) {
    const day = gathered.find((r) => r.kid === profile.id)?.days[0];
    if (!day) throw new Error(`no economy day for "${profile.id}"`);
    for (const team of config.teams) {
      const resources: Record<string, number> = {};
      for (const [resource, n] of Object.entries(day.with)) {
        resources[resource] = Math.floor((n * config.restorePercent) / 100) * team.kids;
      }
      const help: DailyHelp = { resources, searches: profile.searchesPerDay * team.kids };
      // Searches past what the village's spots hold that day find nothing there.
      const days = new Map(
        villageSizes().map((size) => {
          const searches = Math.min(help.searches, villageSpotsPerDay(size, config.terrain));
          return [
            size,
            daysToRestore(villageCost(size, config.terrain), { ...help, searches }, dust),
          ];
        }),
      );
      rows.push({
        kid: profile.id,
        team: team.label,
        help,
        dustPerDay: help.searches * dust,
        days,
      });
    }
  }
  return rows;
}

/** The report's Markdown. */
export function renderHollowed(
  rows: readonly HollowedRow[],
  config: HollowedConfig,
  meta: { seconds: number },
): string {
  const sizes = villageSizes();
  const lines = [
    '# Hollowed Communities report (#306)',
    '',
    `Days for a kid to restore their nearest village, by its size. ${String(config.restorePercent)} % of a day's Timber and Stone (\`pnpm sim:economy\`, ${String(config.seats)} seats, day ${String(config.incomeDay)}) goes into restoring; Heartdust only from searches on ${config.terrain} Hollowed land (${(hollowedDustPerSearch(config.terrain) * 100).toFixed(1)} % a search: ${(heartdustPerSearch(config.terrain) * 100).toFixed(1)} % ordinary × ${String(COMMUNITY_RULES.heartdustFindMultiplier)}), at most the village's spots a day (they refill every morning: ${villageSizes()
      .map((n) => `${String(villageSpotsPerDay(n, config.terrain))} for ${String(n)} tiles`)
      .join(
        ', ',
      )}). Gate: a casual kid alone within ${String(config.gateDays)} days. ${String(rows.length)} rows in ${meta.seconds.toFixed(1)} s.`,
    '',
    `| Kid | Team | Searches a day | Timber a day | Stone a day | Heartdust a day | ${sizes.map((n) => `${String(n)} tiles`).join(' | ')} |`,
    `|---|---|---|---|---|---|${sizes.map(() => '---|').join('')}`,
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.kid} | ${r.team} | ${String(r.help.searches)} | ${String(r.help.resources['timber'] ?? 0)} | ${String(r.help.resources['stone'] ?? 0)} | ${r.dustPerDay.toFixed(1)} | ${sizes.map((n) => `${String(r.days.get(n))} d`).join(' | ')} |`,
    );
  }
  lines.push('', '## Cost', '');
  for (const n of sizes) {
    const cost = Object.entries(villageCost(n, config.terrain))
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(', ');
    lines.push(
      `- ${String(n)} tiles × ${String(COMMUNITY_RULES.piecesBySize[String(n)])} pieces: ${cost}.`,
    );
  }
  lines.push('', '## Not modelled', '', ...HOLLOWED_LIMITS.map((l) => `- ${l}`), '');
  return lines.join('\n');
}
