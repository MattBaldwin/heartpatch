import { bossLevelFor, bossVisitFor, bossWeekOf } from '../../src/boss/schedule.js';
import { addDays } from '../../src/home/local-date.js';
import { deriveSeed, Rng } from '../../src/rng/index.js';
import type { BossBagEntry, BossEventRules } from '../../src/schemas/data/boss-events.js';
import type { LocalDate } from '../../src/schemas/time.js';
import type { Species } from '../../src/schemas/data/species.js';
import type { BattleContent } from '../../src/battle/content.js';
import { bossContent, standInBosses } from './boss.js';
import type { BossModel } from './progression-config.js';

/*
 * Mini-boss visits in `pnpm sim:progression` (#190 plan §9). The pieces the
 * day loop uses: which patch-local days a visit is out (the server's own
 * `bossVisitFor`, over a sim-only stand-in bag), the befriend odds (plan §3)
 * and the friend that joins. Fights are played by the real engine in the
 * day loop (`progression.ts`), like every other battle there.
 */

/** One kid's mini-boss day (`DayRecord.boss`), present only under rules with `boss`. */
export interface BossDay {
  /** The boss is out on the patch today (the patch is ready and a visit covers today). */
  readonly out: boolean;
  /** The kid's Partner is grown enough to fight it (else "Too big for now!"). */
  readonly canFight: boolean;
  /** Fights started today. */
  readonly tries: number;
  /** Won today (at most once a visit). */
  readonly won: boolean;
  /** Befriend asks made today, and the boss kind that said yes (its base form joins), if any. */
  readonly asks: number;
  readonly friend: string | null;
  /** Heart Charms: in the bag at the end of the day, and today's moves. */
  readonly charms: number;
  readonly charmsIn: number;
  readonly charmsWild: number;
  readonly charmsBoss: number;
  /** Charms wild befriending wanted today but the bag didn't have (the model still befriends). */
  readonly charmsShort: number;
}

/** The sim-only bag: `count` stand-in grown-ups (the shipped bag is empty until 234b). */
export function standInBag(count: number, content: BattleContent = bossContent()): BossBagEntry[] {
  return standInBosses(content, count).map((s) => ({ speciesId: s.id, terrains: ['meadow'] }));
}

/** Patch-local days a visit touches: from `opensAtHour` for `windowHours` (16:00 + 48 h: three days). */
export function visitDays(rules: Pick<BossEventRules, 'opensAtHour' | 'windowHours'>): number {
  return Math.ceil((rules.opensAtHour + rules.windowHours) / 24);
}

/** A visit that covers `date`: its window id (the week's Monday), boss and opening day. Null if none. */
export function visitOn(
  mapSeed: string,
  date: LocalDate,
  rules: BossEventRules,
): { readonly week: LocalDate; readonly speciesId: string; readonly opensOn: LocalDate } | null {
  // A visit opens and ends inside its week (`bossVisitFor`), so only this week's can cover today.
  const week = bossWeekOf(date);
  // The sim has no Long Night weekday (the map has none in the model).
  const plan = bossVisitFor(mapSeed, week, null, rules);
  if (!plan) return null;
  const span = visitDays(rules);
  for (let i = 0; i < span; i++) {
    if (addDays(plan.opensOn, i) === date) {
      return { week, speciesId: plan.boss.speciesId, opensOn: plan.opensOn };
    }
  }
  return null;
}

/** The ask's chance (%), plan §3: base + per standing + per earlier miss; sure after enough misses. */
export function askPercent(
  standing: number,
  misses: number,
  befriend: BossModel['befriend'],
): number {
  if (misses >= befriend.sureAfterMisses) return 100;
  const odds =
    befriend.basePercent +
    befriend.perStandingPercent * standing +
    befriend.perMissPercent * misses;
  return Math.min(100, odds);
}

/** One seeded ask: true for a yes. */
export function askRoll(seed: string, percent: number): boolean {
  return Rng.fromSeed(deriveSeed(seed, 'boss-befriend')).int(1, 100) <= percent;
}

/** The base form of `speciesId`'s line (what joins after a yes, #234). */
export function baseFormOf(speciesId: string, species: ReadonlyMap<string, Species>): string {
  const parent = new Map<string, string>();
  for (const s of species.values()) for (const e of s.evolutions) parent.set(e.into, s.id);
  let id = speciesId;
  for (let guard = 0; parent.has(id) && guard < 10; guard++) id = parent.get(id) ?? id;
  return id;
}

/** The friend's join level (owner decision 4): a share of the Partner's, a floor, below its first evolution. */
export function joinLevel(
  baseId: string,
  partnerLevel: number,
  species: ReadonlyMap<string, Species>,
  befriend: BossModel['befriend'],
): number {
  const level = Math.max(
    befriend.minJoinLevel,
    Math.floor((partnerLevel * befriend.joinLevelPercent) / 100),
  );
  const first = species.get(baseId)?.evolutions.reduce((m, e) => Math.min(m, e.level), Infinity);
  return first === undefined || first === Infinity ? level : Math.min(level, first - 1);
}

/** The boss's level for a kid (the server's `bossLevelFor`). */
export function bossLevel(partnerLevel: number, rules: BossEventRules, maxLevel: number): number {
  return bossLevelFor(partnerLevel, rules, maxLevel);
}
