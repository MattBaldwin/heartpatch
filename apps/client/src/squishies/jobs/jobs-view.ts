import {
  BATTLE_RULES,
  GAME_DATA,
  JOB_RULES,
  jobHints,
  jobHintText,
  type ItemCounts,
  type JobSquishy,
  type JobsView,
  type PublicTile,
  type Rarity,
  type WorkSpot,
  type WorkStatus,
} from '@heartpatch/shared';
import { describeItems, itemName } from '../../inventory/bag-view.js';
import { formatTimeLeft, formatWait } from '../../inventory/game-clock.js';
import { itemIcon } from '../../inventory/item-icons.js';

// The job board's and team picker's words and models (owner decisions
// 2026-10-04). Pure, so tests read them without a DOM. Kid-readable copy
// (style guide §2, §6): short lines, no stats-speak, numbers only as times
// and counts.

export const JOBS_TEXT = {
  boardTitle: 'Squishy jobs',
  teamTitle: 'Your team',
  close: 'Close',
  empty: 'No squishies yet. Go make a friend!',
  team: 'Team',
  gather: 'Gather',
  rest: 'Rest',
  train: 'Train',
  offToTrain: (name: string) => `${name} is off to practice!`,
  noGrounds: 'Build Training Grounds on a homestead to train 🏡',
  groundsFull: 'The Training Grounds are full right now.',
  pickGrounds: 'Where should they practice? They sleep there at night.',
  groundsLit: '🔥 Safe by the fire tonight',
  groundsDark: "🌙 It's dark here at night. Build a fire nearby to keep trainees safe! 🔥",
  groundsNapping: 'zZ Napping. Join this homestead back up to home!',
  allNapping: 'zZ Your Training Grounds are napping. Join their homesteads back up to home!',
  trainingNapping: 'zZ Its homestead is napping, so no practice for now.',
  pickSpot: 'Where should they gather?',
  noSpots: 'No spots to gather yet. Win some land!',
  cancel: 'Never mind',
  save: 'Save team',
  saved: 'Team saved! Off to adventure!',
  emptySlot: 'Tap a squishy',
  teamHint: (size: number) => `Pick up to ${String(size)} for battles. Tap a slot to take one off.`,
  emptyTeamNote: 'No team? Your strongest resting squishies go.',
  teamButton: 'Team',
  jobsButton: 'Jobs',
  gatheringHere: (n: number) =>
    n === 1 ? '🧺 A squishy is gathering here' : `🧺 ${String(n)} squishies are gathering here`,
  sendGatherer: '🧺 Send a gatherer',
  // The tile panel's line about my own gatherer there (#602).
  workerHere: (name: string) => `🧺 ${name} is gathering here`,
  workerLoves: (name: string) => `🧺 ${name} is gathering here. Loves it!\u00a0💕`,
  workerMeh: (name: string) => `🧺 ${name} is gathering here. Not their thing\u00a0🌧️`,
  workerFull: (name: string) => `💤 ${name} is napping. Basket full!`,
  workerPaused: (name: string) => `💤 ${name} is napping till this homestead joins home.`,
  firelit: '🔥 Safe by the fire tonight',
  dark: '🌙 Outside the firelight. The Hollow Man may visit at night!',
  takenBy: (name: string) => `${name} is here`,
  leavesWatch: 'Leaves watch',
  stopsGathering: 'Stops gathering',
  stopsTraining: 'Stops training',
  inHollow: 'In the Hollow',
  outOfSeason: 'Out of season, so nothing to find here. Give them a new job!',
  training: 'Practicing at the Training Grounds 🎯',
  // Whether gathering here suits it (#376): a job it's good at keeps it happy.
  fits: (resource: string, icon: string) => `Loves gathering ${resource} here! ${icon}`,
  noFit: "Not their thing, they'll get grumpy",
  // The pop-up when a squishy goes to a job (#376): a job it loves is a little party.
  lovesIt: (name: string) => `${name} loves it here!\u00a0💕`,
  notKeen: (name: string) => `${name} isn't keen\u00a0🌧️`,
  // The mood chip on a working squishy's row (#376).
  moodLoves: 'Loves this job',
  moodMeh: 'Not their thing',
} as const;

/** "1st", "2nd", "3rd". */
const ordinal = (n: number) =>
  n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${String(n)}th`;

const RESOURCES = GAME_DATA.resources;
const TERRAIN_NAMES = new Map(GAME_DATA.terrains.map((t) => [t.id, t.name]));
const SPECIES = new Map(GAME_DATA.species.map((s) => [s.id, s]));

/** What to call a squishy (the server's name for it, else its species'). */
export function nameOf(view: Pick<JobsView, 'names'>, s: JobSquishy): string {
  return view.names[s.squishy.id] ?? SPECIES.get(s.squishy.speciesId)?.name ?? 'Your squishy';
}

/**
 * A squishy's rarity for its dot (#240), or null when this client has no
 * row for its species (a secret one: the jobs view sends names, not rows).
 */
export function rarityOf(s: JobSquishy): Rarity | null {
  return SPECIES.get(s.squishy.speciesId)?.rarity ?? null;
}

/** A squishy's colour for its little blob (its species' main colour). */
export function colorOf(s: JobSquishy): string {
  return SPECIES.get(s.squishy.speciesId)?.visual.palette[0] ?? '#c9b8ff';
}

/**
 * "Next in 12:30" / "+5 🪵 Timber on its way to your bag!" / "Basket full!".
 * Finished cycles go straight into the bag (owner decision 2026-10-06), so
 * "ready" only shows for the moment before they land.
 */
export function workLine(work: WorkStatus, nowMs: number): string {
  const name = `${itemIcon(work.resource)} ${itemName(work.resource)}`;
  if (work.full) return `Gathering ${name}. Basket full! It empties into your bag soon.`;
  const next =
    work.nextReadyAt === null
      ? ''
      : ` Next in ${formatTimeLeft(Date.parse(work.nextReadyAt) - nowMs)}.`;
  const ready = work.readyCycles > 0 ? ` ${describeItems(work.ready)} on its way to your bag!` : '';
  return `Gathering ${name}.${ready}${next}`;
}

/**
 * Its line on the job board changes by itself: a gatherer counting down to
 * its next cycle, or a squishy waiting for full battle XP (#201). The board
 * ticks these lines and asks for a fresh view when one runs out.
 */
export function countsDown(s: JobSquishy): boolean {
  return (s.work !== null && !s.work.full) || s.fullXpResetAt !== null;
}

/** The squishy's job, in a few words, and when full battle XP comes back (#201). */
export function jobLine(s: JobSquishy, nowMs: number): string {
  const job = jobWords(s, nowMs);
  if (s.fullXpResetAt === null || Date.parse(s.fullXpResetAt) <= nowMs) return job;
  return `${job} · Full XP again in ${formatWait(Date.parse(s.fullXpResetAt) - nowMs)}`;
}

function jobWords(s: JobSquishy, nowMs: number): string {
  if (s.squishy.state !== 'active') return `${JOBS_TEXT.inHollow}. You can rescue them!`;
  switch (s.job) {
    case 'team':
      return `On the team (${ordinal((s.teamSlot ?? 0) + 1)}) ⚔️`;
    case 'guard':
      return 'On watch 🛡️';
    case 'gatherer':
      return s.work ? workLine(s.work, nowMs) : 'Gathering';
    case 'training':
      return JOBS_TEXT.training;
    case 'resting':
      return s.habitatId ? 'Resting in a habitat 🏡' : 'Resting at home 💤';
  }
}

/** "Great at gathering Timber 🪵", "Strong fighter 💪" (shared `jobHints`, from data). */
export function hintLines(s: JobSquishy): string[] {
  const species = SPECIES.get(s.squishy.speciesId);
  return jobHints({ ...s.squishy, season: species?.season }, species, JOB_RULES, BATTLE_RULES).map(
    (hint) => jobHintText(hint, RESOURCES),
  );
}

/** Training Grounds on the picker: "🎯 Training Grounds · room for 1", numbered when there are more. */
export function groundsLabel(view: Pick<JobsView, 'trainingGrounds'>, id: string): string {
  const all = view.trainingGrounds;
  const at = all.findIndex((g) => g.id === id);
  const g = all[at];
  if (!g) return '🎯 Training Grounds';
  const name = all.length > 1 ? `Training Grounds ${String(at + 1)}` : 'Training Grounds';
  const room = Math.max(0, g.capacity - g.used);
  return `🎯 ${name} · ${room === 0 ? 'full' : `room for ${String(room)}`}`;
}

/**
 * Why Train is switched off, said by cause: no Training Grounds yet, all of
 * them napping, or all full. '' while a squishy can start training somewhere.
 */
export function trainHintText(view: Pick<JobsView, 'trainingGrounds'>): string {
  if (canTrain(view)) return '';
  const all = view.trainingGrounds;
  if (all.length === 0) return JOBS_TEXT.noGrounds;
  return all.every((g) => g.napping) ? JOBS_TEXT.allNapping : JOBS_TEXT.groundsFull;
}

/** Can a squishy start training somewhere (Training Grounds with room, not napping)? */
export function canTrain(view: Pick<JobsView, 'trainingGrounds'>): boolean {
  return view.trainingGrounds.some((g) => !g.napping && g.used < g.capacity);
}

/** A spot to gather, in words: "🪵 Timber (Forest)". */
export function spotLabel(spot: WorkSpot): string {
  const what = `${itemIcon(spot.resource)} ${itemName(spot.resource)}`;
  // A node is "the Timber spot"; open land says where it is.
  if (spot.from === 'node') return `${what} spot`;
  return `${what} on ${TERRAIN_NAMES.get(spot.terrain) ?? 'the land'}`;
}

/**
 * Whether gathering at this spot suits this squishy (#376, the server's
 * `gatherFits`), and the line that says so under the spot.
 */
export function spotFit(
  squishy: Pick<JobSquishy, 'gatherFits'>,
  spot: Pick<WorkSpot, 'resource'>,
): { fits: boolean; line: string } {
  const fits = squishy.gatherFits.includes(spot.resource);
  return {
    fits,
    line: fits ? JOBS_TEXT.fits(itemName(spot.resource), itemIcon(spot.resource)) : JOBS_TEXT.noFit,
  };
}

/**
 * How a squishy feels about its job right now, for the row's chip (#376):
 * `loves` on the team, on watch, training or gathering what it's good at;
 * `meh` gathering anything else; null while resting, away, or when its job
 * has stopped for now (a full basket, full Training XP, a napping homestead),
 * as then its happiness drifts whatever the job.
 */
export function workMood(
  s: Pick<JobSquishy, 'job' | 'gatherFits' | 'work' | 'training'>,
): WorkMood | null {
  if (s.job === 'team' || s.job === 'guard') return 'loves';
  if (s.job === 'training' && s.training) {
    return s.training.full || s.training.napping ? null : 'loves';
  }
  if (s.job === 'gatherer' && s.work) {
    if (!s.gatherFits.includes(s.work.resource)) return 'meh';
    return s.work.full ? null : 'loves';
  }
  return null;
}

/** How a squishy feels about its job (#376): it loves it, or it isn't keen. */
export type WorkMood = 'loves' | 'meh';

/**
 * Each of my squishies with a work mood (#393), by squishy id, for the home's
 * bounce and droop. Squishies without one (resting, away, a stopped job)
 * aren't in it and look as they always do.
 */
export function workMoods(view: Pick<JobsView, 'squishies'>): Map<string, WorkMood> {
  const moods = new Map<string, WorkMood>();
  for (const s of view.squishies) {
    const mood = workMood(s);
    if (mood) moods.set(s.squishy.id, mood);
  }
  return moods;
}

/**
 * The one quiet mark a gatherer of mine gets on the map (#602), or null:
 * `meh` when it isn't keen on the job, `napping` when its basket is full or
 * its homestead is cut off from home. Happy, busy gatherers get none: tap the
 * tile to see how they feel.
 */
export function gathererMark(
  s: Pick<JobSquishy, 'job' | 'gatherFits' | 'work' | 'training'>,
  tile: Pick<PublicTile, 'homestead'>,
): GathererMark | null {
  if (s.job !== 'gatherer' || !s.work) return null;
  if (workMood(s) === 'meh') return 'meh';
  if (s.work.full || tile.homestead === 'paused') return 'napping';
  return null;
}

/** A gatherer mark on the map (#602). */
export type GathererMark = 'meh' | 'napping';

/**
 * The tile panel's line about who gathers here (#602): my own gatherer by
 * name and how it feels; a patch-mate's never says which squishy.
 */
export function workerLine(
  count: number,
  mine: { name: string; squishy: JobSquishy } | null,
  tile: Pick<PublicTile, 'homestead'>,
): string {
  if (!mine) return JOBS_TEXT.gatheringHere(count);
  const { name, squishy } = mine;
  if (tile.homestead === 'paused') return JOBS_TEXT.workerPaused(name);
  if (squishy.work?.full) return JOBS_TEXT.workerFull(name);
  const mood = workMood(squishy);
  if (mood === 'loves') return JOBS_TEXT.workerLoves(name);
  if (mood === 'meh') return JOBS_TEXT.workerMeh(name);
  return JOBS_TEXT.workerHere(name);
}

/** Everything my gatherers have ready, added up. */
export function readyTotal(view: Pick<JobsView, 'squishies'>): ItemCounts {
  const total: ItemCounts = {};
  for (const s of view.squishies) {
    for (const [id, n] of Object.entries(s.work?.ready ?? {})) total[id] = (total[id] ?? 0) + n;
  }
  return total;
}

/** The team picker's slots: a squishy id per slot, or null. */
export function teamSlots(team: readonly string[], size: number): (string | null)[] {
  return Array.from({ length: size }, (_, i) => team[i] ?? null);
}

/** What joining the team would cost this squishy, if anything ("Leaves watch"). */
export function teamCost(s: JobSquishy): string | null {
  if (s.squishy.state !== 'active') return JOBS_TEXT.inHollow;
  if (s.job === 'guard') return JOBS_TEXT.leavesWatch;
  if (s.job === 'gatherer') return JOBS_TEXT.stopsGathering;
  if (s.job === 'training') return JOBS_TEXT.stopsTraining;
  return null;
}

/** A team pick: tap a squishy to put it in the first free slot, or take it off. */
export function toggleTeam(team: readonly string[], id: string, size: number): string[] {
  if (team.includes(id)) return team.filter((t) => t !== id);
  return team.length >= size ? [...team] : [...team, id];
}
