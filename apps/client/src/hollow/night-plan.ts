import { DUSK_MINUTES } from './hollow-config.js';

// The night's decisions on the client (#277), pure so each is unit-tested:
// which chips show, when the dark-land nudge is due, how a live nightfall
// plays, and when opening the app joins tonight's show part way. The server
// decides what happens at night (rule 1); these only decide what to show.

/** One chip over the map. */
export type NightChip = 'night' | 'night-in' | 'dark' | 'stage' | 'moon';

/** Where the night stands for me, as the chips and the nudge read it. */
export interface NightNow {
  readonly isNight: boolean;
  /** Minutes until tonight's nightfall (null: it has fallen). */
  readonly minutes: number | null;
  /** My dark spots on the map. */
  readonly darkCount: number;
}

/** It's dusk: night falls within `DUSK_MINUTES`. */
export const isDusk = (now: NightNow): boolean =>
  !now.isNight && now.minutes !== null && now.minutes <= DUSK_MINUTES;

/**
 * The chips over the map (mockup screens 1–4, 7), left to right. By day: my
 * dark spots, if any, and his stage. At dusk: the countdown and my dark
 * spots, with his stage shrunk to its moon (always a tap away), or the
 * countdown and his stage. At night: "Night" and his stage.
 */
export function nightChips(now: NightNow): NightChip[] {
  if (now.isNight) return ['night', 'stage'];
  if (isDusk(now)) return now.darkCount > 0 ? ['night-in', 'dark', 'moon'] : ['night-in', 'stage'];
  return now.darkCount > 0 ? ['dark', 'stage'] : ['stage'];
}

/**
 * The nudge before nightfall (mockup screen 1) is due: it's dusk, I have
 * dark land, this device hasn't answered it for tonight, and it isn't the
 * tutorial's Glade.
 */
export function nudgeDue(
  now: NightNow,
  tonight: string,
  answered: string | null,
  glade: boolean,
): boolean {
  return !glade && isDusk(now) && now.darkCount > 0 && answered !== tonight;
}

/**
 * How a live nightfall plays: `live` from nightfall (while it's night, or
 * any time in a dev build, where the dev route makes night fall), `replay`
 * at the morning replay's pace (the tutorial's scripted nightfall, by day),
 * `visit` (his old visit: a night with no walk to show), or `none` (a
 * server catching up on a missed night by day: the morning report tells it).
 */
export function fallPlan(input: {
  readonly glade: boolean;
  readonly isNight: boolean;
  readonly devTools: boolean;
  readonly walks: number;
}): 'live' | 'replay' | 'visit' | 'none' {
  if (input.glade) return input.walks > 0 ? 'replay' : 'visit';
  if (!input.isNight && !input.devTools) return 'none';
  return input.walks > 0 ? 'live' : 'visit';
}

/**
 * When a live nightfall's show starts (wall-clock ms): tonight's nightfall
 * when the event is tonight's (a server catching up at 7:40 shows it over),
 * else the event's own time (the dev route).
 */
export function liveStart(input: {
  readonly fallNight: string;
  readonly fallAt: number;
  readonly tonight: string;
  readonly nightfallAt: number;
}): number {
  return input.fallNight === input.tonight ? Math.min(input.fallAt, input.nightfallAt) : input.fallAt;
}

/**
 * Opening the app during tonight's prowl joins the show part way: it's
 * night, my report for tonight has a walk, the strike hasn't come, and this
 * device hasn't watched or skipped it.
 */
export function joinsTonight(input: {
  readonly isNight: boolean;
  readonly tonight: string;
  readonly reportNight: string | null;
  readonly walk: number;
  readonly now: number;
  readonly strikeAt: number;
  readonly watched: string | null;
}): boolean {
  return (
    input.isNight &&
    input.reportNight === input.tonight &&
    input.walk > 0 &&
    input.now < input.strikeAt &&
    input.watched !== input.tonight
  );
}
