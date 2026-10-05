import {
  BATTLE_RULES,
  GAME_DATA,
  JOB_RULES,
  jobHints,
  jobHintText,
  type ItemCounts,
  type JobSquishy,
  type JobsView,
  type WorkSpot,
  type WorkStatus,
} from '@heartpatch/shared';
import { describeItems, itemName } from '../../inventory/bag-view.js';
import { formatTimeLeft } from '../../inventory/game-clock.js';
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
  collect: (what: string) => `Collect ${what}`,
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
  firelit: '🔥 Safe by the fire tonight',
  dark: '🌙 Outside the firelight. The Hollow Man may visit at night!',
  takenBy: (name: string) => `${name} is here`,
  leavesWatch: 'Leaves watch',
  stopsGathering: 'Stops gathering',
  inHollow: 'In the Hollow',
  outOfSeason: 'Out of season, so nothing to find here. Give them a new job!',
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

/** A squishy's colour for its little blob (its species' main colour). */
export function colorOf(s: JobSquishy): string {
  return SPECIES.get(s.squishy.speciesId)?.visual.palette[0] ?? '#c9b8ff';
}

/** "+5 🪵 Timber ready" / "Full! Collect me" / "Next in 12:30". */
export function workLine(work: WorkStatus, nowMs: number): string {
  const name = `${itemIcon(work.resource)} ${itemName(work.resource)}`;
  if (work.full) return `Gathering ${name}. Full! Time to collect.`;
  const next =
    work.nextReadyAt === null
      ? ''
      : ` Next in ${formatTimeLeft(Date.parse(work.nextReadyAt) - nowMs)}.`;
  const ready = work.readyCycles > 0 ? ` ${describeItems(work.ready)} ready!` : '';
  return `Gathering ${name}.${ready}${next}`;
}

/** The squishy's job, in a few words. */
export function jobLine(s: JobSquishy, nowMs: number): string {
  if (s.squishy.state !== 'active') return `${JOBS_TEXT.inHollow}. Rescue them soon!`;
  switch (s.job) {
    case 'team':
      return `On the team (${ordinal((s.teamSlot ?? 0) + 1)}) ⚔️`;
    case 'guard':
      return 'On watch 🛡️';
    case 'gatherer':
      return s.work ? workLine(s.work, nowMs) : 'Gathering';
    case 'resting':
      return s.habitatId ? 'Resting in a habitat 🏡' : 'Resting at home 💤';
  }
}

/** "Great at gathering Timber 🌲", "Strong fighter 💪" (shared `jobHints`, from data). */
export function hintLines(s: JobSquishy): string[] {
  const species = SPECIES.get(s.squishy.speciesId);
  return jobHints({ ...s.squishy, season: species?.season }, species, JOB_RULES, BATTLE_RULES).map(
    (hint) => jobHintText(hint, RESOURCES),
  );
}

/** A spot to gather, in words: "🌲 Timber (Forest)". */
export function spotLabel(spot: WorkSpot): string {
  const what = `${itemIcon(spot.resource)} ${itemName(spot.resource)}`;
  // A node is "the Timber spot"; open land says where it is.
  if (spot.from === 'node') return `${what} spot`;
  return `${what} on ${TERRAIN_NAMES.get(spot.terrain) ?? 'the land'}`;
}

/** Everything my gatherers have ready, added up. */
export function readyTotal(view: Pick<JobsView, 'squishies'>): ItemCounts {
  const total: ItemCounts = {};
  for (const s of view.squishies) {
    for (const [id, n] of Object.entries(s.work?.ready ?? {})) total[id] = (total[id] ?? 0) + n;
  }
  return total;
}

/** Can anything be collected now (a finished cycle, even an out-of-season one)? */
export function anythingReady(view: Pick<JobsView, 'squishies'>): boolean {
  return view.squishies.some((s) => (s.work?.readyCycles ?? 0) > 0);
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
  return null;
}

/** A team pick: tap a squishy to put it in the first free slot, or take it off. */
export function toggleTeam(team: readonly string[], id: string, size: number): string[] {
  if (team.includes(id)) return team.filter((t) => t !== id);
  return team.length >= size ? [...team] : [...team, id];
}
