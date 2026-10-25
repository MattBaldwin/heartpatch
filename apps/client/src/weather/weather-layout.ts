import { frontPath, hexToWorld, type WeatherFront, type WorldPoint } from '@heartpatch/shared';
import { DRIFT_MODE } from '../map/ambient-layout.js';
import { HEX_SIZE } from '../map/map-config.js';
import { hash01 } from '../map/map-layout.js';

// Where the weather's clouds, rain and fog go (#621 W1-9). Pure: the same
// fronts and the same time always give the same spots, and the buffers are
// allocated once, so a refresh never allocates or changes the draw count.

/** Most instances of each kind, ever. Fixed at scene build. // TUNE: */
export const WEATHER_CAPS = { clouds: 72, rain: 480, fog: 48 } as const;

/** Instances a radius-3 front asks for; other radii scale from it. // TUNE: */
const PER_FRONT = {
  rain: { clouds: 14, rain: 90 },
  storm: { clouds: 22, rain: 160 },
  fog: { fog: 18 },
} as const;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SQRT3 = Math.sqrt(3);
/** A front grows in over this share of its life, and fades out over the same. */
const RAMP = 0.1;
const CLOUD_HEIGHT = 2.1;
const FOG_HEIGHT = 0.2;
const RAIN_FALL = 1.9;

type ColourKey = 'rain' | 'storm';
/** sRGB, turned linear below. Translucent so the tiles stay visible. */
const CLOUD_COLOUR: Record<ColourKey, readonly [number, number, number, number]> = {
  rain: [0.7, 0.69, 0.8, 0.55],
  storm: [0.541, 0.525, 0.678, 0.72], // #8a86ad
};

const linear = (c: number): number => Math.pow(c, 2.2);

export interface WeatherLayout {
  readonly cloudMatrices: Float32Array;
  readonly cloudColours: Float32Array;
  readonly cloudDrift: Float32Array;
  readonly rainMatrices: Float32Array;
  /** Per streak: phase, speed, range, unused. */
  readonly rainAttrs: Float32Array;
  readonly fogMatrices: Float32Array;
  readonly fogDrift: Float32Array;
  clouds: number;
  rain: number;
  fog: number;
}

export function createWeatherLayout(): WeatherLayout {
  const { clouds, rain, fog } = WEATHER_CAPS;
  return {
    cloudMatrices: new Float32Array(clouds * 16),
    cloudColours: new Float32Array(clouds * 4),
    cloudDrift: new Float32Array(clouds * 4),
    rainMatrices: new Float32Array(rain * 16),
    rainAttrs: new Float32Array(rain * 4),
    fogMatrices: new Float32Array(fog * 16),
    fogDrift: new Float32Array(fog * 4),
    clouds: 0,
    rain: 0,
    fog: 0,
  };
}

/** The front's centre in world space: eased along its path by time, or null off-duty. */
export function frontPosition(front: WeatherFront, nowMs: number): WorldPoint | null {
  const start = Date.parse(front.startAt);
  const end = Date.parse(front.endAt);
  if (!(end > start) || nowMs < start || nowMs >= end) return null;
  const path = frontPath(front);
  const last = path.length - 1;
  const at = ((nowMs - start) / (end - start)) * last;
  const i = Math.max(0, Math.min(last - 1, Math.floor(at)));
  const from = path[i];
  if (!from) return null;
  const a = hexToWorld(from, HEX_SIZE);
  const to = path[i + 1];
  // A front that stays on one hex has nowhere to step.
  if (!to) return a;
  const b = hexToWorld(to, HEX_SIZE);
  const t = at - i;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/** 0 to 1: grows in over the first tenth of the front's life and out over the last. */
export function frontScale(front: WeatherFront, nowMs: number): number {
  const start = Date.parse(front.startAt);
  const end = Date.parse(front.endAt);
  if (!(end > start)) return 0;
  const life = (nowMs - start) / (end - start);
  if (life < 0 || life >= 1) return 0;
  return Math.min(1, life / RAMP, (1 - life) / RAMP);
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h | 0;
}

/** The i-th of n spots in a front's disc: a golden-angle spiral with a little jitter. */
export function spotIn(
  seed: number,
  i: number,
  n: number,
  radiusTiles: number,
  salt: number,
): { dx: number; dz: number; jitter: number } {
  const reach = (radiusTiles + 0.5) * SQRT3 * HEX_SIZE;
  const angle = i * GOLDEN_ANGLE + hash01(seed, i, salt) * 0.6;
  const dist = Math.sqrt((i + 0.5) / n) * reach * (0.85 + hash01(seed, i, salt + 1) * 0.15);
  return {
    dx: Math.cos(angle) * dist,
    dz: Math.sin(angle) * dist,
    jitter: hash01(seed, i, salt + 2),
  };
}

function put(m: Float32Array, at: number, x: number, y: number, z: number, scale: number): void {
  const o = at * 16;
  m.fill(0, o, o + 16);
  m[o] = scale;
  m[o + 5] = scale;
  m[o + 10] = scale;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

/**
 * Fills `out` for `nowMs`. `rainShare` (1, 0.5 or 0) thins the rain by tier,
 * as the motes are. Returns `out` for chaining; counts are clamped to the caps.
 */
export function layoutWeather(
  fronts: readonly WeatherFront[],
  nowMs: number,
  rainShare: number,
  out: WeatherLayout,
): WeatherLayout {
  let clouds = 0;
  let rain = 0;
  let fog = 0;
  for (const front of fronts) {
    const centre = frontPosition(front, nowMs);
    const grow = frontScale(front, nowMs);
    if (!centre || grow <= 0) continue;
    const seed = seedOf(front.id);
    const bulk = front.radius / 3;
    if (front.kind === 'rain' || front.kind === 'storm') {
      const want = PER_FRONT[front.kind];
      const colour = CLOUD_COLOUR[front.kind];
      const nClouds = Math.min(
        WEATHER_CAPS.clouds - clouds,
        Math.max(4, Math.round(want.clouds * bulk)),
      );
      for (let i = 0; i < nClouds; i++) {
        const s = spotIn(seed, i, nClouds, front.radius, 10);
        const at = clouds++;
        put(
          out.cloudMatrices,
          at,
          centre.x + s.dx,
          CLOUD_HEIGHT + s.jitter * 0.5,
          centre.z + s.dz,
          (0.9 + s.jitter * 0.6) * grow,
        );
        out.cloudColours.set(
          [linear(colour[0]), linear(colour[1]), linear(colour[2]), colour[3]],
          at * 4,
        );
        out.cloudDrift.set(
          [DRIFT_MODE.float, s.jitter * 6.28, 0.25 + s.jitter * 0.2, 0.15],
          at * 4,
        );
      }
      const nRain = Math.min(
        WEATHER_CAPS.rain - rain,
        Math.round(Math.max(4, want.rain * bulk) * rainShare),
      );
      for (let i = 0; i < nRain; i++) {
        const s = spotIn(seed, i, Math.max(1, nRain), front.radius, 20);
        const at = rain++;
        put(out.rainMatrices, at, centre.x + s.dx, CLOUD_HEIGHT - 0.1, centre.z + s.dz, grow);
        out.rainAttrs.set([s.jitter, 0.9 + s.jitter * 0.6, RAIN_FALL, 0], at * 4);
      }
    } else if (front.kind === 'fog') {
      const n = Math.min(WEATHER_CAPS.fog - fog, Math.max(4, Math.round(PER_FRONT.fog.fog * bulk)));
      for (let i = 0; i < n; i++) {
        const s = spotIn(seed, i, n, front.radius, 30);
        const at = fog++;
        put(
          out.fogMatrices,
          at,
          centre.x + s.dx,
          FOG_HEIGHT + s.jitter * 0.25,
          centre.z + s.dz,
          (1.2 + s.jitter * 0.8) * grow,
        );
        out.fogDrift.set([DRIFT_MODE.float, s.jitter * 6.28, 0.2, 0.1], at * 4);
      }
    }
  }
  out.clouds = clouds;
  out.rain = rain;
  out.fog = fog;
  return out;
}
