import { inSeason, type ItemCounts } from '../gathering/index.js';
import type { BattleRules } from '../schemas/data/battle.js';
import type { ElementId, FeelingId } from '../schemas/data/elements.js';
import type { GatherAffinity, JobRules } from '../schemas/data/jobs.js';
import type { Resource } from '../schemas/data/resources.js';
import type { Species } from '../schemas/data/species.js';
import type { TutorialOverrides } from '../schemas/data/tutorial.js';
import { statsAtLevel } from '../battle/formulas.js';

// Squishy jobs (owner decisions 2026-10-04): one job at a time, team
// picking, and squishy gatherers that repeat on their own. Pure: the server
// passes in the clock (milliseconds) and the seasons that are on; nothing
// here ticks (CLAUDE.md rule 4). The job board uses the same maths to explain.

/**
 * What a squishy is doing on its patch. A squishy has exactly one:
 * - `team`: comes along to battles (up to `BATTLE_RULES.teamSize`, in slot order);
 * - `guard`: on watch on one of its owner's tiles (#15's post);
 * - `gatherer`: working a node or a tile of owned land, again and again;
 * - `resting`: the default, at home or in a habitat.
 */
export type SquishyJobId = 'team' | 'guard' | 'gatherer' | 'resting';

/** Where a squishy's job stands, as stored: a team slot, a work tile, a watch post. */
export interface JobFacts {
  teamSlot: number | null;
  /** It works a tile its owner still holds (stale work on lost land doesn't count). */
  atWork: boolean;
  /** It stands watch (`isOnWatch` / `squishyOnWatch`). */
  onWatch: boolean;
}

/**
 * The squishy's one job. The commands keep these apart under the squishy's
 * row lock, so at most one is ever set; a watch post wins if a stale row
 * ever disagreed, because that is what nightfall and the map already count.
 */
export function jobOf(facts: JobFacts): SquishyJobId {
  if (facts.onWatch) return 'guard';
  if (facts.atWork) return 'gatherer';
  if (facts.teamSlot !== null) return 'team';
  return 'resting';
}

/**
 * A team as the player picked it: their own squishies, no repeats, at most
 * `teamSize`. Returns a kid-readable problem, or null when it's fine.
 */
export function teamProblem(
  squishyIds: readonly string[],
  rules: Pick<BattleRules, 'teamSize'>,
): string | null {
  if (squishyIds.length > rules.teamSize) {
    return `A team has room for ${String(rules.teamSize)} squishies.`;
  }
  if (new Set(squishyIds).size !== squishyIds.length) return 'Each squishy can only go once!';
  return null;
}

/** A tile as a gatherer sees it. */
export interface WorkTile {
  terrain: string;
  nodeResource: string | null;
  /** Home tiles (the Heart Seed and its ring) only work through their nodes. */
  homeSlot: number | null;
}

/** What one cycle of work on a tile gives, before the squishy's own speed. */
export interface WorkSource {
  resource: string;
  quantity: number;
  /** The Keeper-equivalent gather time (the node's, or the terrain yield's). */
  seconds: number;
  /** A node, or plain owned land ("territory farming"). */
  from: 'node' | 'land';
}

/**
 * What a gatherer would work on a tile: its node if it has a gatherable one,
 * else the terrain's yield on land outside the home base, else nothing.
 */
export function workSource(
  tile: WorkTile,
  resources: readonly Resource[],
  rules: Pick<JobRules, 'terrainYields'>,
): WorkSource | null {
  if (tile.nodeResource !== null) {
    const gather = resources.find((r) => r.id === tile.nodeResource)?.gather;
    if (gather) {
      return {
        resource: tile.nodeResource,
        quantity: gather.quantity,
        seconds: gather.seconds,
        from: 'node',
      };
    }
  }
  if (tile.homeSlot !== null) return null;
  const land = rules.terrainYields.find((y) => y.terrain === tile.terrain);
  return land
    ? { resource: land.resource, quantity: land.quantity, seconds: land.seconds, from: 'land' }
    : null;
}

/** A squishy as the job rules see it. */
export interface JobTraits {
  element: ElementId;
  feeling: FeelingId;
  /** Its species' season (Halloween squishies), if it has one. */
  season?: string | undefined;
}

/** How many sides match: 0, 1 (element or seasonal species) or 2 (and feeling). */
export function affinityMatches(squishy: JobTraits, affinity: GatherAffinity | undefined): number {
  if (!affinity) return 0;
  const element =
    affinity.elements.includes(squishy.element) ||
    (squishy.season !== undefined && affinity.seasons.includes(squishy.season));
  return (element ? 1 : 0) + (affinity.feelings.includes(squishy.feeling) ? 1 : 0);
}

/** Gathering speed as a whole percent: 100, or the match's quicker one. */
export function workSpeedPercent(
  squishy: JobTraits,
  resource: string,
  rules: Pick<JobRules, 'affinities' | 'work'>,
): number {
  const matches = affinityMatches(
    squishy,
    rules.affinities.find((a) => a.resource === resource),
  );
  if (matches === 2) return rules.work.match.bothPercent;
  if (matches === 1) return rules.work.match.onePercent;
  return 100;
}

/**
 * Seconds per cycle: the source's time, stretched by `cyclePercent` and
 * shortened by the squishy's speed (whole-number maths, floored, at least 1).
 * The tutorial's quick gather time stands in for the source's there.
 */
export function workCycleSeconds(
  sourceSeconds: number,
  speedPercent: number,
  rules: Pick<JobRules, 'work'>,
  overrides: Pick<TutorialOverrides, 'gatherSeconds'> | null = null,
): number {
  const base = overrides?.gatherSeconds ?? sourceSeconds;
  return Math.max(1, Math.floor((base * rules.work.cyclePercent) / speedPercent));
}

/** Finished cycles at `nowMs`, and where the next count starts. */
export interface WorkProgress {
  /** Finished cycles waiting to be collected (at most `maxStoredCycles`). */
  cycles: number;
  /** Full: it waits until someone collects. */
  full: boolean;
  /** When the next cycle finishes, or null while full. */
  nextReadyMs: number | null;
  /** Where counting starts after these cycles are collected. */
  nextSinceMs: number;
  /** When each finished cycle finished (its season decides its yield). */
  finishedMs: number[];
}

/**
 * Lazily worked-out progress (CLAUDE.md rule 4): cycles that fit between
 * `sinceMs` and `nowMs`, capped. A full gatherer stops working, so after a
 * collect it starts again from now; otherwise a part-done cycle carries on.
 */
export function workProgress(
  sinceMs: number,
  nowMs: number,
  cycleSeconds: number,
  rules: Pick<JobRules, 'work'>,
): WorkProgress {
  const length = cycleSeconds * 1000;
  const done = Math.floor(Math.max(0, nowMs - sinceMs) / length);
  const max = rules.work.maxStoredCycles;
  const cycles = Math.min(done, max);
  const finishedMs = Array.from({ length: cycles }, (_, i) => sinceMs + (i + 1) * length);
  if (done >= max) return { cycles, full: true, nextReadyMs: null, nextSinceMs: nowMs, finishedMs };
  return {
    cycles,
    full: false,
    nextReadyMs: sinceMs + (cycles + 1) * length,
    nextSinceMs: sinceMs + cycles * length,
    finishedMs,
  };
}

/**
 * What finished cycles yield: per cycle, the source's resource while its
 * season is on (Pumpkins only around Halloween), plus the resource's in-season
 * extras (Witch Dust). Each cycle is judged when it finished, so collecting
 * late never changes what a kid gets (DECISIONS #17).
 */
export function workYield(
  source: Pick<WorkSource, 'resource' | 'quantity'>,
  finishedMs: readonly number[],
  resources: readonly Resource[],
  seasonsAt: (ms: number) => ReadonlySet<string>,
): ItemCounts {
  const items: ItemCounts = {};
  const resource = resources.find((r) => r.id === source.resource);
  if (!resource) return items;
  const add = (id: string, n: number) => {
    items[id] = (items[id] ?? 0) + n;
  };
  for (const ms of finishedMs) {
    const seasons = seasonsAt(ms);
    if (!inSeason(resource, seasons)) continue;
    add(resource.id, source.quantity);
    for (const extra of resource.gather?.extras ?? []) {
      const found = resources.find((r) => r.id === extra.resource);
      if (found && inSeason(found, seasons)) add(extra.resource, extra.quantity);
    }
  }
  return items;
}

/** One line of "what this squishy is good at" for the job board. */
export type JobHint =
  | { kind: 'gather'; resource: string; icon: string; great: boolean }
  | { kind: 'fighter' }
  | { kind: 'speedy' }
  | { kind: 'guard' };

/**
 * A squishy's best jobs, from data: the resources it gathers quickly (both
 * sides matching first, then one), and what its stats at its level lean to:
 * attack makes a strong fighter, speed a speedy one, defense a sturdy guard.
 */
export function jobHints(
  squishy: JobTraits & { level: number },
  species: Pick<Species, 'baseStats'> | undefined,
  rules: Pick<JobRules, 'affinities' | 'maxGatherHints'>,
  battleRules: BattleRules,
): JobHint[] {
  const gather = rules.affinities
    .map((affinity, order) => ({ affinity, order, matches: affinityMatches(squishy, affinity) }))
    .filter((a) => a.matches > 0)
    .sort((a, b) => b.matches - a.matches || a.order - b.order)
    .slice(0, rules.maxGatherHints)
    .map(({ affinity, matches }): JobHint => ({
      kind: 'gather',
      resource: affinity.resource,
      icon: affinity.icon,
      great: matches === 2,
    }));
  if (!species) return gather;
  const stats = statsAtLevel(species.baseStats, squishy.level, battleRules);
  const best = Math.max(stats.attack, stats.defense, stats.speed);
  const role: JobHint =
    stats.attack === best
      ? { kind: 'fighter' }
      : stats.speed === best
        ? { kind: 'speedy' }
        : { kind: 'guard' };
  return [...gather, role];
}

/** The kid-readable line for a hint ("Great at gathering Timber 🌲"). */
export function jobHintText(hint: JobHint, resources: readonly Resource[]): string {
  switch (hint.kind) {
    case 'gather': {
      const name = resources.find((r) => r.id === hint.resource)?.name ?? hint.resource;
      return `${hint.great ? 'Great' : 'Good'} at gathering ${name} ${hint.icon}`;
    }
    case 'fighter':
      return 'Strong fighter 💪';
    case 'speedy':
      return 'Speedy fighter ⚡';
    case 'guard':
      return 'Sturdy guard 🛡️';
  }
}
