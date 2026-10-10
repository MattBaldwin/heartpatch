import { EXPLORE_RULES, skyAt, type SkyAt, type SkyPhase } from '@heartpatch/shared';

// What the explore sky looks like at a moment (#335, owner-approved mockup):
// day is sunny with clouds, dawn and dusk are warm, night is a friendly deep
// blue with stars (art bible §2: never black). Pure, so it's unit-tested;
// `ExploreSky` draws it.

/** One time of day's sky and light. Colours are sRGB hex. */
export interface SkyLook {
  readonly zenith: string;
  readonly horizon: string;
  /** The sun's (or the moon's) disc, and whether it shows (not underwater). */
  readonly sun: string;
  readonly sunDisc: boolean;
  readonly moon: boolean;
  readonly cloud: string;
  /** How many clouds show (0–`EXPLORE_SKY.clouds.length`). */
  readonly clouds: number;
  readonly stars: boolean;
  /** The stars' colour (underwater they're bubbles and glowing plankton). */
  readonly starColor: string;
  /** Underwater: the water's haze over the far seabed (#335), else null. */
  readonly fog: string | null;
  /** The sun light's colour and strength (times today's), and the sky light's strength. */
  readonly light: { readonly color: string; readonly sun: number; readonly environment: number };
}

export const SKY_LOOKS: Readonly<Record<SkyPhase, SkyLook>> = {
  dawn: {
    zenith: '#8fa2e3', // TUNE
    horizon: '#ffd6b0', // TUNE
    sun: '#ffd28a',
    sunDisc: true,
    moon: false,
    cloud: '#ffd6e4',
    clouds: 3,
    stars: false,
    starColor: '#fff3c4',
    fog: null,
    light: { color: '#ffd9c2', sun: 0.85, environment: 0.85 }, // TUNE
  },
  day: {
    zenith: '#6fbff0', // TUNE
    horizon: '#e6f7ff', // TUNE
    sun: '#ffe27a', // TUNE
    sunDisc: true,
    moon: false,
    cloud: '#ffffff', // TUNE
    clouds: 4, // TUNE
    stars: false,
    starColor: '#fff3c4',
    fog: null,
    light: { color: '#fff5e6', sun: 1, environment: 1 },
  },
  dusk: {
    zenith: '#6b5bb0', // TUNE
    horizon: '#ffb36b', // TUNE
    sun: '#ff9a52',
    sunDisc: true,
    moon: false,
    cloud: '#d9b8ee',
    clouds: 3,
    stars: false,
    starColor: '#fff3c4',
    fog: null,
    light: { color: '#ffc49a', sun: 0.8, environment: 0.8 }, // TUNE
  },
  night: {
    zenith: '#1e2a5e', // TUNE: a friendly deep blue, never black
    horizon: '#4d5596', // TUNE
    sun: '#fff3d0',
    sunDisc: true,
    moon: true,
    cloud: '#5a6299',
    clouds: 1,
    stars: true,
    starColor: '#fff3c4',
    fog: null,
    light: { color: '#b9c4ff', sun: 0.55, environment: 0.6 }, // TUNE: kids still see the spots
  },
};

/**
 * Under a lake (#335): the bright surface at the top fading to deep water,
 * bubbles drifting up, and the light the colour of the sky above. At night
 * the plankton glows. Never black (art bible §2).
 */
export const WATER_LOOKS: Readonly<Record<SkyPhase, SkyLook>> = {
  dawn: {
    ...SKY_LOOKS.dawn,
    zenith: '#a9c6ea', // TUNE: the surface, lit pink-gold from above
    horizon: '#4f8fc0', // TUNE
    sunDisc: false,
    clouds: 0,
    stars: true,
    starColor: '#eefbff',
    fog: '#5d9cc8',
    light: { color: '#cfe6ff', sun: 0.8, environment: 0.85 },
  },
  day: {
    ...SKY_LOOKS.day,
    zenith: '#8fd8f5', // TUNE: sunlight through the water
    horizon: '#3f8fc4', // TUNE: deep water
    sunDisc: false,
    clouds: 0,
    stars: true,
    starColor: '#eefbff',
    fog: '#5aa6d6',
    light: { color: '#c9ecff', sun: 0.9, environment: 0.95 },
  },
  dusk: {
    ...SKY_LOOKS.dusk,
    zenith: '#b7a9d8', // TUNE
    horizon: '#3f6fa8', // TUNE
    sunDisc: false,
    clouds: 0,
    stars: true,
    starColor: '#eefbff',
    fog: '#4f7fb4',
    light: { color: '#d6d2ff', sun: 0.75, environment: 0.8 },
  },
  night: {
    ...SKY_LOOKS.night,
    zenith: '#4d6bb0', // TUNE: moonlight on the surface
    horizon: '#24407e', // TUNE: still blue, never black
    sunDisc: false,
    clouds: 0,
    stars: true,
    starColor: '#9ff6ff', // glowing plankton
    fog: '#2c4a8a',
    light: { color: '#a9c8ff', sun: 0.55, environment: 0.6 },
  },
};

/**
 * Inside the hills cave (#335): warm purple stone all round, little glowing
 * motes where the stars would be, and a dim warm light (the Lantern's own
 * glow is the lit circle it plays in). A cave is the same at any hour.
 */
const CAVE: SkyLook = {
  zenith: '#4f3c6e', // TUNE: the cave roof
  horizon: '#33264a', // TUNE: the far, dark walls (never black)
  sun: '#ffd36e',
  sunDisc: false,
  moon: false,
  cloud: '#5c4878',
  clouds: 0,
  stars: true,
  starColor: '#8ef0ff', // glow motes
  fog: '#3a2b52',
  light: { color: '#ffd9b0', sun: 0.6, environment: 0.55 }, // TUNE: warm and dim
};
export const CAVE_LOOKS: Readonly<Record<SkyPhase, SkyLook>> = {
  dawn: CAVE,
  day: CAVE,
  dusk: CAVE,
  night: CAVE,
};

/**
 * Each biome's own world (#335, owner decision 2026-10-09): lakes are
 * explored underwater, hills inside a cave, mountains up a trail; the rest
 * on cozy open ground.
 */
export type ExploreWorld = 'ground' | 'underwater' | 'cave' | 'trail';
const WORLDS: Readonly<Record<string, ExploreWorld>> = {
  lake: 'underwater',
  hills: 'cave',
  mountains: 'trail',
};

/** The world a terrain is explored in. */
export function exploreWorld(terrain: string): ExploreWorld {
  return WORLDS[terrain] ?? 'ground';
}

/** Is this terrain explored underwater? */
export function isUnderwater(terrain: string): boolean {
  return exploreWorld(terrain) === 'underwater';
}

/**
 * Where the sky's pieces sit, in degrees from the middle of the view (the
 * camera never turns, #291). The view is 43° tall; its top fifth shows the
 * sky past the tile's far edge (about 13° up and higher), under the HUD's
 * header. An upright phone is
 * about 20° wide, so everything stays within ±9° of the middle.
 */
export const EXPLORE_SKY = {
  /** The sky dome's radius, world units (inside the camera's far plane). */
  radius: 60, // TUNE
  /** The horizon colour up to `low`, the zenith from `high`, a blend between. */
  gradient: { low: 4, high: 22 }, // TUNE: degrees above the middle of the view
  sun: { at: [2.5, 17.5], size: 1.2 }, // TUNE: [right, up] and its radius, degrees: above the tile's far edge, in the HUD's gap
  /** Cloud puffs: [right, up, size], degrees. The first `clouds` of a look show. */
  clouds: [
    [-6, 12, 2.2],
    [8.5, 9, 1.8],
    [-11, 16, 2.6],
    [12, 17, 2],
  ],
  stars: { count: 44, right: 16, from: 6, to: 22, size: 0.22 }, // TUNE: degrees
  /** Underwater haze, world units from the camera (the camera is about 7 from the Keeper). */
  fog: { start: 9, end: 30 }, // TUNE
} as const;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) =>
  `#${hex(a)
    .map((v, i) => Math.round(v + ((hex(b)[i] ?? 0) - v) * t))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The look at a moment: colours and light fade into the next sky; stars,
 * clouds and the moon switch halfway. Underwater and in a cave, their own looks.
 */
export function skyLook(at: SkyAt, world: ExploreWorld = 'ground'): SkyLook {
  const looks = world === 'underwater' ? WATER_LOOKS : world === 'cave' ? CAVE_LOOKS : SKY_LOOKS;
  const a = looks[at.phase];
  const b = looks[at.next];
  const t = Math.min(1, Math.max(0, at.blend));
  const pick = t < 0.5 ? a : b;
  return {
    zenith: mix(a.zenith, b.zenith, t),
    horizon: mix(a.horizon, b.horizon, t),
    sun: pick.sun,
    sunDisc: pick.sunDisc,
    moon: pick.moon,
    cloud: mix(a.cloud, b.cloud, t),
    clouds: pick.clouds,
    stars: pick.stars,
    starColor: pick.starColor,
    fog: a.fog && b.fog ? mix(a.fog, b.fog, t) : pick.fog,
    light: {
      color: mix(a.light.color, b.light.color, t),
      sun: lerp(a.light.sun, b.light.sun, t),
      environment: lerp(a.light.environment, b.light.environment, t),
    },
  };
}

/**
 * Minutes after local midnight in `timeZone` (the device's own zone if that
 * one is unknown). The device clock is the game's clock in production
 * (`HP_DEV_NOW` only moves the server's).
 */
export function localMinuteIn(timeZone: string | null, now: Date): number {
  const format = (zone?: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      ...(zone ? { timeZone: zone } : {}),
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return part('hour') * 60 + part('minute');
  };
  try {
    return format(timeZone ?? undefined);
  } catch {
    return format();
  }
}

/** The sky over the explore view at `now` on a patch in `timeZone`. */
export function exploreSkyAt(timeZone: string | null, now: Date): SkyAt {
  return skyAt(localMinuteIn(timeZone, now), EXPLORE_RULES.sky);
}

/** Do two looks draw the same? (The screen skips a minute that changes nothing.) */
export function sameLook(a: SkyLook, b: SkyLook): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
