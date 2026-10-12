import { EXPLORE_RULES, skyAt, type SkyAt, type SkyPhase } from '@heartpatch/shared';
import { localMinuteIn } from '../explore/explore-sky-look.js';
import { HOUSE_TIMES, type HouseTimeLook } from './house-config.js';

/*
 * The house's light at a moment (#381 H2): the windows and the light
 * outside follow the patch's real clock, on the same sky as explore (#335,
 * `skyAt` over `EXPLORE_RULES.sky`). At dusk and night the lamps and the
 * fire are lit and the windows are dark blue; by day it's warm daylight.
 * Pure, so it's unit-tested; the screen picks it when the scene is built and
 * once a minute after (never per frame), and the scene applies it.
 */

/** The house's light now: the time of day's look, fading into the next. */
export interface HouseLightLook extends HouseTimeLook {
  /** The time of day it is, for the dev hook and the captures. */
  readonly phase: SkyPhase;
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number): string =>
  `#${hex(a)
    .map((v, i) => Math.round(v + ((hex(b)[i] ?? 0) - v) * t))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The look for a sky moment: colours and strengths fade into the next time
 * of day; the windows' picture and whether the lamps are lit switch halfway.
 */
export function houseLookAt(at: SkyAt): HouseLightLook {
  const a = HOUSE_TIMES[at.phase];
  const b = HOUSE_TIMES[at.next];
  const t = Math.min(1, Math.max(0, at.blend));
  const pick = t < 0.5 ? a : b;
  const sky = a.sky.map((c, i) => mix(c, b.sky[i] ?? c, t)) as unknown as HouseTimeLook['sky'];
  return {
    phase: t < 0.5 ? at.phase : at.next,
    sky,
    haze: mix(a.haze, b.haze, t),
    clear: mix(a.clear, b.clear, t),
    lawn: mix(a.lawn, b.lawn, t),
    lawnLift: mix(a.lawnLift, b.lawnLift, t),
    pane: pick.pane,
    lit: pick.lit,
    sun: {
      color: mix(a.sun.color, b.sun.color, t),
      intensity: lerp(a.sun.intensity, b.sun.intensity, t),
    },
    house: {
      color: mix(a.house.color, b.house.color, t),
      intensity: lerp(a.house.intensity, b.house.intensity, t),
    },
    ambient: mix(a.ambient, b.ambient, t),
    lamps: lerp(a.lamps, b.lamps, t),
    glow: lerp(a.glow, b.glow, t),
  };
}

/** The look at `minute` minutes after the patch's local midnight. */
export const houseLookAtMinute = (minute: number): HouseLightLook =>
  houseLookAt(skyAt(minute, EXPLORE_RULES.sky));

/** The look at `now` on a patch in `timeZone` (the device's zone when unknown). */
export const houseLookNow = (timeZone: string | null, now: Date): HouseLightLook =>
  houseLookAtMinute(localMinuteIn(timeZone, now));

/** The look B1–B4 were judged on (dusk), for a scene built without a clock (the unit tests). */
export const DUSK_LOOK: HouseLightLook = houseLookAt({ phase: 'dusk', next: 'dusk', blend: 0 });

/** Do two looks light the house the same? (A quiet minute changes and redraws nothing.) */
export function sameHouseLook(a: HouseLightLook, b: HouseLightLook): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
