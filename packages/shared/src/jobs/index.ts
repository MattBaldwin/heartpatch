import { inSeason, type ItemCounts } from '../gathering/index.js';
import type { HoldSpan } from '../care/contentment.js';
import type { MoodDrift } from '../schemas/care.js';
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
 * - `training`: practicing at its owner's Training Grounds, a little XP an
 *   hour (owner decision 2026-10-06); it sleeps at home like a resting one;
 * - `resting`: the default, at home or in a habitat.
 */
export type SquishyJobId = 'team' | 'guard' | 'gatherer' | 'training' | 'resting';

/** Where a squishy's job stands, as stored: a team slot, a work tile, a watch post. */
export interface JobFacts {
  teamSlot: number | null;
  /** It works a tile its owner still holds (stale work on lost land doesn't count). */
  atWork: boolean;
  /** It stands watch (`isOnWatch` / `squishyOnWatch`). */
  onWatch: boolean;
  /** It practices at a Training Grounds (`squishies.training_building_id`). */
  training: boolean;
}

/**
 * The squishy's one job. The commands keep these apart under the squishy's
 * row lock, so at most one is ever set; a watch post wins if a stale row
 * ever disagreed, because that is what nightfall and the map already count.
 */
export function jobOf(facts: JobFacts): SquishyJobId {
  if (facts.onWatch) return 'guard';
  if (facts.atWork) return 'gatherer';
  if (facts.training) return 'training';
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
 * What a gatherer would work on a tile (owner decision on #238, the nesting
 * economy): out on the land, the terrain's primary resource
 * (`terrainYields`), whatever spot the tile has, since spots there are the
 * Keeper's to tap; in the home ring, its spot, as before (home land yields
 * nothing). A terrain with no yield outside home (Juniper's Gap) keeps its
 * spot for a gatherer, as before #238. Nothing otherwise.
 */
export function workSource(
  tile: WorkTile,
  resources: readonly Resource[],
  rules: Pick<JobRules, 'terrainYields'>,
): WorkSource | null {
  const land =
    tile.homeSlot === null
      ? rules.terrainYields.find((y) => y.terrain === tile.terrain)
      : undefined;
  if (land) {
    return {
      resource: land.resource,
      quantity: land.quantity,
      seconds: land.seconds,
      from: 'land',
    };
  }
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
  return null;
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

/**
 * The percent modifiers on a squishy's gathering speed for a resource, each
 * a whole percent (100 = no change). Today that's its match (100, or the
 * quicker single or double match); a timed boost (a food, later) joins the
 * list as data, without touching the maths below.
 */
export function workSpeedModifiers(
  squishy: JobTraits,
  resource: string,
  rules: Pick<JobRules, 'affinities' | 'work'>,
): number[] {
  const matches = affinityMatches(
    squishy,
    rules.affinities.find((a) => a.resource === resource),
  );
  const match =
    matches === 2
      ? rules.work.match.bothPercent
      : matches === 1
        ? rules.work.match.onePercent
        : 100;
  return [match];
}

/**
 * Whole-percent modifiers combined: each applies to the result so far,
 * floored at every step (bit-identical maths; 135% then 120% is 162%).
 */
export function combinePercents(modifiers: readonly number[]): number {
  return modifiers.reduce((total, percent) => Math.floor((total * percent) / 100), 100);
}

/**
 * Gathering speed as a whole percent: the match and any `extra` modifiers
 * (`combinePercents`), never below 100.
 */
export function workSpeedPercent(
  squishy: JobTraits,
  resource: string,
  rules: Pick<JobRules, 'affinities' | 'work'>,
  extra: readonly number[] = [],
): number {
  return Math.max(
    100,
    combinePercents([...workSpeedModifiers(squishy, resource, rules), ...extra]),
  );
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

/** A stretch of time a gatherer earned nothing in: a paused homestead (#199). Null `toMs`: still paused. */
export interface WorkPause {
  readonly fromMs: number;
  readonly toMs: number | null;
}

/**
 * Real time and working time around a pause: `worked` cuts the pause's span
 * out of a real instant, and `real` puts it back (still paused, nothing
 * happens past its start).
 */
function pauseClock(pause: WorkPause) {
  const { fromMs } = pause;
  const toMs = pause.toMs ?? Number.POSITIVE_INFINITY;
  const paused = pause.toMs === null;
  return {
    fromMs,
    paused,
    worked: (t: number) => (t <= fromMs ? t : t - (Math.min(t, toMs) - fromMs)),
    real: (w: number) => (w <= fromMs ? w : paused ? fromMs : w + (toMs - fromMs)),
  };
}

/**
 * `workProgress` with a pause left out (#199: a homestead cut off from home
 * pauses its gathering, and paused time never pays). Time inside the pause
 * doesn't count: cycles finished before it are kept, and counting carries
 * on from where it stopped once the pause ends. Every time it returns is
 * real time again. With no pause it's `workProgress`.
 */
export function workProgressAround(
  sinceMs: number,
  nowMs: number,
  cycleSeconds: number,
  rules: Pick<JobRules, 'work'>,
  pause: WorkPause | null,
): WorkProgress {
  if (!pause) return workProgress(sinceMs, nowMs, cycleSeconds, rules);
  const { fromMs, paused, worked, real } = pauseClock(pause);
  const p = workProgress(worked(sinceMs), worked(nowMs), cycleSeconds, rules);
  // Still paused, the next cycle can't finish until the pause ends.
  const nextReady =
    p.nextReadyMs === null || (paused && p.nextReadyMs > fromMs) ? null : p.nextReadyMs;
  return {
    cycles: p.cycles,
    full: p.full,
    nextReadyMs: nextReady === null ? null : real(nextReady),
    // Full stops the count, as `workProgress` does: it starts again from now.
    nextSinceMs: p.full ? nowMs : real(p.nextSinceMs),
    finishedMs: p.finishedMs.map(real),
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

const HOUR_MS = 60 * 60 * 1000;

/** Training XP worked out at `nowMs`, and where the next count starts. */
export interface TrainingProgress {
  /** Whole XP earned since `sinceMs`, at most `maxHours` of it. */
  xp: number;
  /** A whole `maxHours` waited: it earns nothing more until it lands. */
  full: boolean;
  /** Where counting starts once this XP has landed (part of an XP point carries on). */
  nextSinceMs: number;
}

/**
 * Training Grounds XP (owner decision 2026-10-06), worked out lazily
 * (CLAUDE.md rule 4): `xpPerHour` for every hour since `sinceMs`, floored to
 * whole XP and capped at `training.maxHours` of it, like a gatherer's full
 * basket. Time past the cap is never paid; part of an XP point carries over.
 */
export function trainingProgress(
  sinceMs: number,
  nowMs: number,
  xpPerHour: number,
  rules: Pick<JobRules, 'training'>,
): TrainingProgress {
  const capMs = rules.training.maxHours * HOUR_MS;
  const elapsed = Math.max(0, nowMs - sinceMs);
  const xp = Math.floor((Math.min(elapsed, capMs) * xpPerHour) / HOUR_MS);
  if (elapsed >= capMs) return { xp, full: true, nextSinceMs: nowMs };
  // Rounded up, so an XP point is never paid twice.
  return { xp, full: false, nextSinceMs: sinceMs + Math.ceil((xp * HOUR_MS) / xpPerHour) };
}

/**
 * `trainingProgress` with a pause left out (owner decision 4 on #277: a
 * trainee on a homestead cut off from home naps). Time inside the pause
 * earns nothing, as for a gatherer there (`workProgressAround`); with no
 * pause it's `trainingProgress`.
 */
export function trainingProgressAround(
  sinceMs: number,
  nowMs: number,
  xpPerHour: number,
  rules: Pick<JobRules, 'training'>,
  pause: WorkPause | null,
): TrainingProgress {
  if (!pause) return trainingProgress(sinceMs, nowMs, xpPerHour, rules);
  const { worked, real } = pauseClock(pause);
  const p = trainingProgress(worked(sinceMs), worked(nowMs), xpPerHour, rules);
  // Full stops the count, as `trainingProgress` does: it starts again from now.
  return { xp: p.xp, full: p.full, nextSinceMs: p.full ? nowMs : real(p.nextSinceMs) };
}

/**
 * Gathering a resource suits a squishy when it's Good or Great at it (one or
 * both sides match, the same match `jobHints` shows): it holds its
 * contentment steady there (owner decision on #376). Elsewhere it's not
 * their thing, and contentment drifts down as if it were resting.
 */
export function gatherFits(
  squishy: JobTraits,
  resource: string,
  rules: Pick<JobRules, 'affinities'>,
): boolean {
  return (
    affinityMatches(
      squishy,
      rules.affinities.find((a) => a.resource === resource),
    ) > 0
  );
}

/** Every resource gathering suits this squishy for, in data order (the job board's fit marks). */
export function gatherFitsFor(squishy: JobTraits, rules: Pick<JobRules, 'affinities'>): string[] {
  return rules.affinities.filter((a) => affinityMatches(squishy, a) > 0).map((a) => a.resource);
}

/**
 * When a gatherer's basket fills (epoch ms, real time): `maxStoredCycles`
 * cycles of working time from `sinceMs`, with a pause left out. A full
 * gatherer stops working until someone collects. Still paused at that
 * point: the pause's start (it isn't working past it anyway).
 */
export function workFullAtMs(
  sinceMs: number,
  cycleSeconds: number,
  rules: Pick<JobRules, 'work'>,
  pause: WorkPause | null,
): number {
  const fullMs = rules.work.maxStoredCycles * cycleSeconds * 1000;
  if (!pause) return sinceMs + fullMs;
  const { worked, real } = pauseClock(pause);
  return real(worked(sinceMs) + fullMs);
}

/** When a trainee's `training.maxHours` fills (epoch ms, real time), with a pause left out. */
export function trainingFullAtMs(
  sinceMs: number,
  rules: Pick<JobRules, 'training'>,
  pause: WorkPause | null,
): number {
  const fullMs = rules.training.maxHours * HOUR_MS;
  if (!pause) return sinceMs + fullMs;
  const { worked, real } = pauseClock(pause);
  return real(worked(sinceMs) + fullMs);
}

/**
 * The first moment (to the minute) a seasonal resource is out of season
 * between `fromMs` and `toMs`, or null if it's still in season at `toMs`
 * (`fromMs` itself if it was already out then). A gatherer can't start out
 * of season and a season ends once (whole days), so the change is found by
 * halving.
 */
export function seasonEndMs(
  fromMs: number,
  toMs: number,
  inSeasonAt: (ms: number) => boolean,
): number | null {
  if (toMs <= fromMs || inSeasonAt(toMs)) return null;
  if (!inSeasonAt(fromMs)) return fromMs;
  let on = fromMs;
  let off = toMs;
  while (off - on > 60_000) {
    const mid = on + Math.floor((off - on) / 2);
    if (inSeasonAt(mid)) on = mid;
    else off = mid;
  }
  return off;
}

/**
 * What a squishy's job looks like to its contentment (owner decision on
 * #376), as epoch ms. Each part is there only while the squishy has that job
 * (the server leaves them out for one in the Hollow or a trade: no job).
 */
export interface HoldFacts {
  /** On the team (`fromMs` null: all along) or on watch (`fromMs`: when it was posted). */
  steady?: { fromMs: number | null } | undefined;
  /**
   * A gatherer: whether the resource suits it, when it started, when its land
   * changed hands (null: it's still at work), when its basket fills, when its
   * resource went out of season (null: still in), and its homestead's pause.
   */
  gatherer?:
    | {
        fits: boolean;
        fromMs: number;
        lostMs: number | null;
        fullMs: number;
        seasonEndMs: number | null;
        pause: WorkPause | null;
      }
    | undefined;
  /** A trainee: when its `maxHours` fills, and its homestead's pause (it naps there). */
  training?: { fullMs: number; pause: WorkPause | null } | undefined;
}

/** `fromMs`..`toMs` with a pause cut out. */
function aroundPause(fromMs: number, toMs: number | null, pause: WorkPause | null): HoldSpan[] {
  if (!pause) return [{ fromMs, toMs }];
  const spans: HoldSpan[] = [
    { fromMs, toMs: toMs === null ? pause.fromMs : Math.min(toMs, pause.fromMs) },
  ];
  if (pause.toMs !== null) spans.push({ fromMs: Math.max(fromMs, pause.toMs), toMs });
  return spans.filter((s) => s.toMs === null || s.toMs > s.fromMs);
}

/**
 * The stretches a squishy's job held its contentment steady (owner decision
 * on #376): Team and Guard all along; Training until its `maxHours` fills,
 * napping time left out; gathering something it's Good or Great at until its
 * basket fills, its land changes hands or its resource goes out of season,
 * napping time left out. Anything else (resting, the wrong resource, a job
 * that stopped) holds nothing: contentment drifts down.
 */
export function holdSpans(facts: HoldFacts): HoldSpan[] {
  if (facts.steady) {
    return [{ fromMs: facts.steady.fromMs ?? Number.MIN_SAFE_INTEGER, toMs: null }];
  }
  const g = facts.gatherer;
  if (g) {
    if (!g.fits) return [];
    const stops = [g.fullMs, g.lostMs, g.seasonEndMs].filter((ms): ms is number => ms !== null);
    return aroundPause(g.fromMs, Math.min(...stops), g.pause);
  }
  const t = facts.training;
  if (t) return aroundPause(Number.MIN_SAFE_INTEGER, t.fullMs, t.pause);
  return [];
}

/** Why contentment is or isn't holding at `nowMs`, for the care sheet and the roster. */
export function moodDrift(facts: HoldFacts, nowMs: number): MoodDrift {
  const g = facts.gatherer;
  // Land that changed hands: it's resting now, whatever it had before.
  const gathering = g && (g.lostMs === null || g.lostMs > nowMs);
  if (!facts.steady && !gathering && !facts.training) return 'resting';
  if (g && gathering && !g.fits) return 'wrong-job';
  const holding = holdSpans(facts).some(
    (s) => s.fromMs <= nowMs && (s.toMs === null || nowMs < s.toMs),
  );
  return holding ? 'steady' : 'stopped';
}
