import { frontPath, hexToWorld, type WeatherFront, type WorldPoint } from '@heartpatch/shared';
import { DRIFT_MODE } from '../map/ambient-layout.js';
import { HEX_SIZE } from '../map/map-config.js';
import { hash01 } from '../map/map-layout.js';
import { WEATHER_LOOK } from './weather-config.js';

// Where the weather's clouds, rain and fog go (#621 W1-9). Pure: the same
// fronts and the same time always give the same spots, and the buffers are
// allocated once, so a refresh never allocates or changes the draw count.

/** Most instances of each kind, ever. Fixed at scene build. // TUNE: */
export const WEATHER_CAPS = { clouds: 72, rain: 480, fog: 48, bolts: 12 } as const;

/** Instances a radius-3 front asks for; other radii scale from it. // TUNE: */
const PER_FRONT = {
  rain: { clouds: 10, rain: 90 },
  storm: { clouds: 9, rain: 110 },
  fog: { fog: 18 },
} as const;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SQRT3 = Math.sqrt(3);
/** A front grows in over this share of its life, and fades out over the same. */
const RAMP = 0.1;
const { clouds: CLOUDS, fog: FOG, rain: RAIN, storm: STORM } = WEATHER_LOOK;

const linear = (c: number): number => Math.pow(c, 2.2);

export interface WeatherLayout {
  readonly cloudMatrices: Float32Array;
  readonly cloudColours: Float32Array;
  readonly cloudDrift: Float32Array;
  /** One soft shadow on the tiles under each cloud. */
  readonly shadowMatrices: Float32Array;
  readonly shadowColours: Float32Array;
  readonly rainMatrices: Float32Array;
  /** Per streak: phase, speed, range, slant. */
  readonly rainAttrs: Float32Array;
  readonly boltMatrices: Float32Array;
  /** Per bolt: phase, speed, 0, -1 (held) or -2 (flashing). */
  readonly boltAttrs: Float32Array;
  readonly fogMatrices: Float32Array;
  readonly fogDrift: Float32Array;
  clouds: number;
  rain: number;
  fog: number;
  bolts: number;
}

export function createWeatherLayout(): WeatherLayout {
  const { clouds, rain, fog, bolts } = WEATHER_CAPS;
  return {
    cloudMatrices: new Float32Array(clouds * 16),
    cloudColours: new Float32Array(clouds * 4),
    cloudDrift: new Float32Array(clouds * 4),
    shadowMatrices: new Float32Array(clouds * 16),
    shadowColours: new Float32Array(clouds * 4),
    rainMatrices: new Float32Array(rain * 16),
    rainAttrs: new Float32Array(rain * 4),
    boltMatrices: new Float32Array(bolts * 16),
    boltAttrs: new Float32Array(bolts * 4),
    fogMatrices: new Float32Array(fog * 16),
    fogDrift: new Float32Array(fog * 4),
    clouds: 0,
    rain: 0,
    fog: 0,
    bolts: 0,
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

function put(
  m: Float32Array,
  at: number,
  x: number,
  y: number,
  z: number,
  scale: number,
  wide = 1,
  tall = 1,
): void {
  const o = at * 16;
  m.fill(0, o, o + 16);
  m[o] = scale * wide;
  m[o + 5] = scale * tall;
  m[o + 10] = scale * wide;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

/** How thick the clouds are: a share of the count and a scale on their alpha. */
export interface CloudThickness {
  readonly share: number;
  readonly alpha: number;
}

export const FULL_CLOUDS: CloudThickness = { share: 1, alpha: 1 };

/** A storm's own rain share (the low tier still gets one) and whether the sky holds still. */
export interface StormSky {
  readonly storm: number;
  /** Motion is off: a storm's bolts hold still (a few of them) instead of flashing. */
  readonly still: boolean;
}

/**
 * Fills `out` for `nowMs`. `rainShare` thins the rain by tier, as the motes are
 * (a storm has its own share, so the low tier still gets one), and `clouds`
 * thins the clouds (the low tier's are lighter). Returns `out` for chaining;
 * counts are clamped to the caps.
 */
export function layoutWeather(
  fronts: readonly WeatherFront[],
  nowMs: number,
  rainShare: number,
  out: WeatherLayout,
  clouds: CloudThickness = FULL_CLOUDS,
  storm: StormSky = { storm: rainShare, still: false },
): WeatherLayout {
  let nCloud = 0;
  let rain = 0;
  let fog = 0;
  let bolts = 0;
  for (const front of fronts) {
    const centre = frontPosition(front, nowMs);
    const grow = frontScale(front, nowMs);
    if (!centre || grow <= 0) continue;
    const seed = seedOf(front.id);
    const bulk = front.radius / 3;
    if (front.kind === 'rain' || front.kind === 'storm') {
      const isStorm = front.kind === 'storm';
      const want = PER_FRONT[front.kind];
      const colour = CLOUDS.colour[front.kind];
      const nClouds = Math.min(
        WEATHER_CAPS.clouds - nCloud,
        Math.max(3, Math.round(want.clouds * bulk * clouds.share)),
      );
      for (let i = 0; i < nClouds; i++) {
        const s = spotIn(seed, i, nClouds, front.radius, 10);
        const at = nCloud++;
        // A storm's every other cloud is its lower deck: bigger, lower, darker.
        const lower = isStorm && i % 2 === 1;
        const size =
          (CLOUDS.size + s.jitter * CLOUDS.spread) * grow * (lower ? CLOUDS.deck.grow : 1);
        const dark = lower ? CLOUDS.deck.dark : 1;
        put(
          out.cloudMatrices,
          at,
          centre.x + s.dx,
          CLOUDS.height + s.jitter * 0.5 - (lower ? CLOUDS.deck.drop : 0),
          centre.z + s.dz,
          size,
        );
        out.cloudColours.set(
          [
            linear(colour[0]) * dark,
            linear(colour[1]) * dark,
            linear(colour[2]) * dark,
            colour[3] * clouds.alpha,
          ],
          at * 4,
        );
        out.cloudDrift.set(
          [DRIFT_MODE.float, s.jitter * 6.28, 0.25 + s.jitter * 0.2, 0.15],
          at * 4,
        );
        // Its shadow, a little ahead of the sun's side, flat on the tiles.
        put(
          out.shadowMatrices,
          at,
          centre.x + s.dx - 0.15,
          CLOUDS.shadow.height,
          centre.z + s.dz + 0.2,
          size * CLOUDS.shadow.size,
          1.25,
          1,
        );
        out.shadowColours.set(
          [1, 1, 1, CLOUDS.shadow.alpha[isStorm ? 'storm' : 'rain'] * grow],
          at * 4,
        );
      }
      const share = isStorm ? storm.storm : rainShare;
      const heavy = isStorm ? STORM : null;
      const nRain = Math.min(
        WEATHER_CAPS.rain - rain,
        Math.round(Math.max(4, want.rain * bulk) * share),
      );
      for (let i = 0; i < nRain; i++) {
        const s = spotIn(seed, i, Math.max(1, nRain), front.radius, 20);
        const at = rain++;
        put(
          out.rainMatrices,
          at,
          centre.x + s.dx,
          CLOUDS.height - 0.1,
          centre.z + s.dz,
          grow,
          heavy?.thick ?? 1,
          heavy?.long ?? 1,
        );
        out.rainAttrs.set([s.jitter, 0.9 + s.jitter * 0.6, RAIN.fall, heavy?.slant ?? 0], at * 4);
      }
      if (isStorm) {
        const wanted = storm.still ? STORM.bolts.hold : Math.round(STORM.bolts.per * bulk);
        const nBolts = Math.min(WEATHER_CAPS.bolts - bolts, Math.max(1, wanted));
        for (let i = 0; i < nBolts; i++) {
          // Under the lower deck's clouds, spread through the front.
          const s = spotIn(seed, i * 2 + 1, nClouds, front.radius, 40);
          const at = bolts++;
          put(
            out.boltMatrices,
            at,
            centre.x + s.dx,
            CLOUDS.height - CLOUDS.deck.drop + 0.05,
            centre.z + s.dz,
            STORM.bolts.height * grow,
          );
          out.boltAttrs.set([s.jitter, 0.14 + s.jitter * 0.08, 0, storm.still ? -1 : -2], at * 4);
        }
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
          FOG.height + s.jitter * 0.25,
          centre.z + s.dz,
          (FOG.size + s.jitter * FOG.spread) * grow,
        );
        out.fogDrift.set([DRIFT_MODE.float, s.jitter * 6.28, 0.2, 0.1], at * 4);
      }
    }
  }
  out.clouds = nCloud;
  out.rain = rain;
  out.fog = fog;
  out.bolts = bolts;
  return out;
}
