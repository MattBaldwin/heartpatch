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
  /**
   * Multiplies the ground's and its decor's colour (#335, owner: a moonlit
   * blue-green at night). Spots, glints and the team keep their own colour.
   */
  readonly groundTint: string;
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
    groundTint: '#fff0e8', // TUNE: a touch warm
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
    groundTint: '#ffffff', // TUNE
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
    groundTint: '#ffeedd', // TUNE: a touch warm
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
    groundTint: '#6f9ea6', // TUNE: moonlit blue-green (owner)
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
    zenith: '#9ccfd8', // TUNE: the surface, lit pink-gold through blue-green water
    horizon: '#2f7f98', // TUNE
    sunDisc: false,
    clouds: 0,
    stars: true,
    starColor: '#eefbff',
    fog: '#4f97a8',
    groundTint: '#c6e6dc', // TUNE: the water's blue-green over everything
    light: { color: '#c8ece4', sun: 0.8, environment: 0.85 },
  },
  day: {
    ...SKY_LOOKS.day,
    zenith: '#7fd6d8', // TUNE: sunlight through blue-green water
    horizon: '#2a8aa0', // TUNE: deep water
    sunDisc: false,
    clouds: 0,
    stars: true,
    starColor: '#eefbff',
    fog: '#4fa6b4',
    groundTint: '#c4ece0', // TUNE: the water's blue-green over everything
    light: { color: '#bdf0e6', sun: 0.9, environment: 0.95 },
  },
  dusk: {
    ...SKY_LOOKS.dusk,
    zenith: '#a5b8d6', // TUNE
    horizon: '#2f6a94', // TUNE
    sunDisc: false,
    clouds: 0,
    stars: true,
    starColor: '#eefbff',
    fog: '#457e9e',
    groundTint: '#bcd6dc', // TUNE
    light: { color: '#cdd8f0', sun: 0.75, environment: 0.8 },
  },
  night: {
    ...SKY_LOOKS.night,
    zenith: '#3f7aa8', // TUNE: moonlight through the water
    horizon: '#1f4f7e', // TUNE: still blue, never black
    sunDisc: false,
    clouds: 0,
    stars: true,
    starColor: '#9ff6ff', // glowing plankton
    fog: '#2a5a86',
    groundTint: '#7fa6b0', // TUNE: moonlit water
    light: { color: '#a9c8ff', sun: 0.55, environment: 0.6 },
  },
};

/** Terrains explored underwater (#335, owner decision 2026-10-09: lakes, with a Snorkel). */
export const UNDERWATER_TERRAINS: ReadonlySet<string> = new Set(['lake']);

/** Is this terrain explored underwater? */
export function isUnderwater(terrain: string): boolean {
  return UNDERWATER_TERRAINS.has(terrain);
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
  /** Underwater and cave haze, world units from the camera (the camera is about 7 from the Keeper). */
  fog: { start: 5, end: 22 }, // TUNE: a soft depth haze
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
 * clouds and the moon switch halfway. Underwater uses the water's looks.
 */
export function skyLook(at: SkyAt, underwater = false): SkyLook {
  const looks = underwater ? WATER_LOOKS : SKY_LOOKS;
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
    groundTint: mix(a.groundTint, b.groundTint, t),
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
