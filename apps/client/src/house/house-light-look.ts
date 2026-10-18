import { EXPLORE_RULES, skyAt, type SkyAt, type SkyPhase } from '@heartpatch/shared';
import { localMinuteIn } from '../explore/explore-sky-look.js';
import type { QualityTier } from '../engine/config.js';
import {
  HOUSE_INTERIOR,
  HOUSE_LIGHT,
  HOUSE_TIERS,
  HOUSE_TIMES,
  type HouseTimeLook,
} from './house-config.js';

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
  const at6 = (i: 0 | 1 | 2 | 3 | 4 | 5) => mix(a.sky[i], b.sky[i], t);
  const sky: HouseTimeLook['sky'] = [at6(0), at6(1), at6(2), at6(3), at6(4), at6(5)];
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
    lamp: lerp(a.lamp, b.lamp, t),
    environment: lerp(a.environment, b.environment, t),
    sunSpecular: lerp(a.sunSpecular, b.sunSpecular, t),
    glow: lerp(a.glow, b.glow, t),
    lift: mix(a.lift, b.lift, t),
    ceiling: mix(a.ceiling, b.ceiling, t),
    yard: lerp(a.yard, b.yard, t),
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

/** A colour's lightness, 0 to 1 (Rec. 709 weights on sRGB). */
const lightness = (h: string): number => {
  const [r = 0, g = 0, b = 0] = hex(h);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/**
 * How bright the room's walls read under a look on a tier (a proxy, not a
 * render): on high and medium the image-based light, the fire and lamp
 * the scene lights and the warm ambient lift (the sun mostly falls on the
 * shell's back, not the room);
 * on low the ambient bounce and the one house light. The time-of-day test
 * holds day at or above dusk with it, so daylight never reads gloomier.
 */
export function interiorLight(look: HouseTimeLook, tier: QualityTier): number {
  if (HOUSE_TIERS[tier].shadowMap === 0) {
    return (
      HOUSE_INTERIOR.ambient * lightness(look.ambient) +
      HOUSE_INTERIOR.house * lightness(look.house.color) * look.house.intensity
    );
  }
  return (
    HOUSE_INTERIOR.environment * HOUSE_LIGHT.environment.lit * look.environment +
    HOUSE_INTERIOR.fire * look.lamps +
    HOUSE_INTERIOR.lamp * look.lamp +
    HOUSE_INTERIOR.lift * lightness(look.lift)
  );
}
