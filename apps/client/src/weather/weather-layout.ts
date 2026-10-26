import { frontPath, hexToWorld, type WeatherFront, type WorldPoint } from '@heartpatch/shared';
import { DRIFT_MODE } from '../map/ambient-layout.js';
import { HEX_SIZE } from '../map/map-config.js';
import { hash01 } from '../map/map-layout.js';
import { WEATHER_LOOK } from './weather-config.js';

// Where the weather's clouds, rain and fog go (#621 W1-9). Pure: the same
// fronts and the same time always give the same spots, and the buffers are
// allocated once, so a refresh never allocates or changes the draw count.

/** Most instances of each kind, ever. Fixed at scene build. // TUNE: */
export const WEATHER_CAPS = { clouds: 72, banks: 6, rain: 720, fog: 48, bolts: 12 } as const;

/** Shadows on the tiles: one under each cloud, and a shadow and a lower deck under each bank. */
const SHADOW_CAP = WEATHER_CAPS.clouds + WEATHER_CAPS.banks * 2;

/** Instances a radius-3 front asks for; other radii scale from it. // TUNE: */
const PER_FRONT = {
  rain: { clouds: 10, rain: 90 },
  storm: { rain: 300 },
  fog: { fog: 18 },
} as const;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SQRT3 = Math.sqrt(3);
/** A front grows in over this share of its life, and fades out over the same. */
const RAMP = 0.1;
const { clouds: CLOUDS, fog: FOG, rain: RAIN, storm: STORM } = WEATHER_LOOK;

const linear = (c: number): number => Math.pow(c, 2.2);
/** How far a storm's rain is pulled towards the camera, as a share of its bank's half-depth. // TUNE: */
const RAIN_NEAR = 0.45;

export interface WeatherLayout {
  readonly cloudMatrices: Float32Array;
  readonly cloudColours: Float32Array;
  readonly cloudDrift: Float32Array;
  /** A storm's bank, one per storm front (weather-clouds.ts `bankShape`). */
  readonly bankMatrices: Float32Array;
  readonly bankColours: Float32Array;
  readonly bankDrift: Float32Array;
  /**
   * Flat soft discs: a shadow on the tiles under each cloud and bank, and a
   * bank's see-through lower deck. Colour and alpha per disc.
   */
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
  banks: number;
  shadows: number;
  rain: number;
  fog: number;
  bolts: number;
}

export function createWeatherLayout(): WeatherLayout {
  const { clouds, banks, rain, fog, bolts } = WEATHER_CAPS;
  return {
    cloudMatrices: new Float32Array(clouds * 16),
    cloudColours: new Float32Array(clouds * 4),
    cloudDrift: new Float32Array(clouds * 4),
    bankMatrices: new Float32Array(banks * 16),
    bankColours: new Float32Array(banks * 4),
    bankDrift: new Float32Array(banks * 4),
    shadowMatrices: new Float32Array(SHADOW_CAP * 16),
    shadowColours: new Float32Array(SHADOW_CAP * 4),
    rainMatrices: new Float32Array(rain * 16),
    rainAttrs: new Float32Array(rain * 4),
    boltMatrices: new Float32Array(bolts * 16),
    boltAttrs: new Float32Array(bolts * 4),
    fogMatrices: new Float32Array(fog * 16),
    fogDrift: new Float32Array(fog * 4),
    clouds: 0,
    banks: 0,
    shadows: 0,
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
  deep = wide,
): void {
  const o = at * 16;
  m.fill(0, o, o + 16);
  m[o] = scale * wide;
  m[o + 5] = scale * tall;
  m[o + 10] = scale * deep;
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
  let banks = 0;
  let shadows = 0;
  let rain = 0;
  let fog = 0;
  let bolts = 0;
  const shade = (
    x: number,
    y: number,
    z: number,
    scale: number,
    wide: number,
    deep: number,
    rgb: readonly [number, number, number],
    alpha: number,
  ): void => {
    if (shadows >= SHADOW_CAP) return;
    const at = shadows++;
    put(out.shadowMatrices, at, x, y, z, scale, wide, 1, deep);
    out.shadowColours.set([linear(rgb[0]), linear(rgb[1]), linear(rgb[2]), alpha], at * 4);
  };
  for (const front of fronts) {
    const centre = frontPosition(front, nowMs);
    const grow = frontScale(front, nowMs);
    if (!centre || grow <= 0) continue;
    const seed = seedOf(front.id);
    const bulk = front.radius / 3;
    if (front.kind === 'rain') {
      const colour = CLOUDS.colour.rain;
      const nClouds = Math.min(
        WEATHER_CAPS.clouds - nCloud,
        Math.max(3, Math.round(PER_FRONT.rain.clouds * bulk * clouds.share)),
      );
      for (let i = 0; i < nClouds; i++) {
        const s = spotIn(seed, i, nClouds, front.radius, 10);
        const at = nCloud++;
        const size = (CLOUDS.size + s.jitter * CLOUDS.spread) * grow;
        put(
          out.cloudMatrices,
          at,
          centre.x + s.dx,
          CLOUDS.height + s.jitter * 0.5,
          centre.z + s.dz,
          size,
        );
        const c = at * 4;
        out.cloudColours[c] = linear(colour[0]);
        out.cloudColours[c + 1] = linear(colour[1]);
        out.cloudColours[c + 2] = linear(colour[2]);
        out.cloudColours[c + 3] = colour[3] * clouds.alpha;
        out.cloudDrift.set(
          [DRIFT_MODE.float, s.jitter * 6.28, 0.25 + s.jitter * 0.2, 0.15],
          at * 4,
        );
        shade(
          centre.x + s.dx - 0.15,
          CLOUDS.shadow.height,
          centre.z + s.dz + 0.2,
          size * CLOUDS.shadow.size,
          1.25,
          1.25,
          CLOUDS.shadow.colour,
          CLOUDS.shadow.alpha.rain * grow,
        );
      }
      const nRain = Math.min(
        WEATHER_CAPS.rain - rain,
        Math.round(Math.max(4, PER_FRONT.rain.rain * bulk) * rainShare),
      );
      for (let i = 0; i < nRain; i++) {
        const s = spotIn(seed, i, Math.max(1, nRain), front.radius, 20);
        const at = rain++;
        put(
          out.rainMatrices,
          at,
          centre.x + s.dx,
          CLOUDS.height - RAIN.below,
          centre.z + s.dz,
          grow,
        );
        out.rainAttrs.set([s.jitter, 0.9 + s.jitter * 0.6, RAIN.fall, 0], at * 4);
      }
    } else if (front.kind === 'storm') {
      // One bank over the whole front (however thin the tier's clouds), a
      // see-through darker deck under it and one broad shadow on the tiles.
      const scale = bulk * grow;
      const belly = CLOUDS.bank.belly;
      const deep = CLOUDS.bank.deep / CLOUDS.bank.wide;
      if (banks < WEATHER_CAPS.banks) {
        const at = banks++;
        put(out.bankMatrices, at, centre.x, belly, centre.z, scale);
        const colour = CLOUDS.colour.storm;
        out.bankColours.set(
          [linear(colour[0]), linear(colour[1]), linear(colour[2]), colour[3] * clouds.alpha],
          at * 4,
        );
        out.bankDrift.set([DRIFT_MODE.float, (seed & 0xff) / 40, 0.2, 0.08], at * 4);
        const deck = CLOUDS.deck;
        shade(
          centre.x,
          belly - deck.drop * scale,
          centre.z - deck.near * CLOUDS.bank.deep * scale,
          CLOUDS.bank.wide * deck.grow * scale,
          1,
          deep,
          deck.colour,
          deck.alpha * grow,
        );
        shade(
          centre.x - 0.15,
          CLOUDS.shadow.height,
          centre.z + 0.2,
          CLOUDS.bank.wide * CLOUDS.shadow.size * scale,
          1,
          deep,
          CLOUDS.shadow.colour,
          CLOUDS.shadow.alpha.storm * grow,
        );
      }
      // Heavy slanted rain from the bank's belly, most of it towards its near
      // (south) side and out past it, where the camera sees it fall rather
      // than through the bank. Still inside the front.
      const nRain = Math.min(
        WEATHER_CAPS.rain - rain,
        Math.round(Math.max(4, PER_FRONT.storm.rain * bulk) * storm.storm),
      );
      for (let i = 0; i < nRain; i++) {
        const s = spotIn(seed, i, Math.max(1, nRain), front.radius, 20);
        const at = rain++;
        put(
          out.rainMatrices,
          at,
          centre.x + s.dx,
          belly - 0.05,
          centre.z + s.dz * 0.75 - RAIN_NEAR * CLOUDS.bank.deep * scale,
          grow,
          STORM.thick,
          STORM.long,
        );
        out.rainAttrs.set([s.jitter, 0.9 + s.jitter * 0.6, RAIN.fall, STORM.slant], at * 4);
      }
      // Bolts from under the bank's near edge (the map camera looks north,
      // up +z), spread across it, so the bank doesn't hide them.
      const wanted = storm.still ? STORM.bolts.hold : Math.round(STORM.bolts.per * bulk);
      const nBolts = Math.min(WEATHER_CAPS.bolts - bolts, Math.max(1, wanted));
      for (let i = 0; i < nBolts; i++) {
        const jitter = hash01(seed, i, 60);
        const across = ((i + 0.5) / nBolts) * 2 - 1;
        const at = bolts++;
        const x = centre.x + (across * 0.7 + (jitter - 0.5) * 0.2) * CLOUDS.bank.wide * scale;
        const edge = Math.sqrt(Math.max(0, 1 - (across * 0.7) ** 2));
        put(
          out.boltMatrices,
          at,
          x,
          belly + 0.05,
          centre.z - edge * CLOUDS.bank.deep * STORM.bolts.edge * scale,
          STORM.bolts.height * grow,
        );
        // Lean: the bolt's down axis also runs towards the camera (-z).
        out.boltMatrices[at * 16 + 6] = STORM.bolts.height * grow * STORM.bolts.lean;
        out.boltAttrs.set([jitter, 0.14 + jitter * 0.08, 0, storm.still ? -1 : -2], at * 4);
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
  out.banks = banks;
  out.shadows = shadows;
  out.rain = rain;
  out.fog = fog;
  out.bolts = bolts;
  return out;
}
