import type { BattleTimeOfDay } from '@heartpatch/shared';
import {
  FALLBACK_LOOK,
  TERRAIN_LOOKS,
  type PropKind,
  type TerrainLook,
} from '../map/map-config.js';
import { hash01 } from '../map/map-layout.js';
import {
  ARENA_MOODS,
  ARENA_SPECS,
  ARENA_STAGE,
  FALLBACK_ARENA,
  type ArenaMood,
  type ArenaSpec,
} from './arena-config.js';
import { HOMES } from './battle-config.js';

// Pure arena maths (owner decision 2026-10-05, Lantern Hour's stage): which
// diorama a terrain gets, where its props, hills, clouds, stars and motes
// stand, and the sky's and ground's colours. No Babylon, so it's unit tested;
// `arena.ts` draws it. Everything is seeded from the battle id, so one battle
// always looks the same, on every device and after a refresh.

/** Everything the arena needs to know about where a battle happens. */
export interface ArenaPlan {
  /** The terrain id the battle reported (kept for the dev hook, even if unknown here). */
  readonly terrain: string;
  readonly timeOfDay: BattleTimeOfDay;
  /** The map's look for the terrain: ground colour, roughness, gloss and glow. */
  readonly look: TerrainLook;
  readonly spec: ArenaSpec;
  readonly mood: ArenaMood;
  /** False when this client doesn't know the terrain and drew the fallback. */
  readonly known: boolean;
  readonly seed: number;
}

export function arenaPlan(terrain: string, timeOfDay: BattleTimeOfDay, seed: number): ArenaPlan {
  const spec = ARENA_SPECS[terrain];
  const fallback = ARENA_SPECS[FALLBACK_ARENA];
  if (!fallback) throw new Error('the fallback arena is missing');
  return {
    terrain,
    timeOfDay,
    look: TERRAIN_LOOKS[terrain] ?? FALLBACK_LOOK,
    spec: spec ?? fallback,
    mood: ARENA_MOODS[timeOfDay],
    known: spec !== undefined && TERRAIN_LOOKS[terrain] !== undefined,
    seed,
  };
}

/** A small whole number from a battle id, so one battle always gets the same arena. */
export function arenaSeed(battleId: string): number {
  let h = 2166136261;
  for (let i = 0; i < battleId.length; i++) h = Math.imul(h ^ battleId.charCodeAt(i), 16777619);
  return (h >>> 0) % 100003;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  /** Heading, radians. */
  readonly turn: number;
}

export interface ArenaPropPlacement extends Placement {
  readonly kind: PropKind;
}

/** Where the two fighters stand: props keep clear of both. */
export const FIGHTER_HOMES: readonly { x: number; z: number }[] = [HOMES.mine, HOMES.theirs];

/**
 * Where the arena's props stand, from the battle's seed. Big props only
 * behind the fighters and to the sides (`propArc`) and never in the camera's
 * lane, so they never hide the fight; small ones (`front`) anywhere but the
 * fight itself. `share` thins them out on the low quality tier.
 */
export function arenaProps(spec: ArenaSpec, seed: number, share = 1): ArenaPropPlacement[] {
  const out: ArenaPropPlacement[] = [];
  const { clearRadius, fighterClear, propArc, cameraLane } = ARENA_STAGE;
  spec.props.forEach((group, g) => {
    const count = Math.max(group.count > 0 ? 1 : 0, Math.round(group.count * share));
    for (let i = 0; i < count; i++) {
      const salt = g * 1000 + i * 7;
      const roll = (n: number) => hash01(seed, salt, n);
      const [near, far] = group.ring;
      const r = near + (far - near) * roll(1);
      // Spread evenly over the arc with a little jitter, so groups don't clump.
      const arc = group.front ? Math.PI : propArc;
      const slot = (i + 0.5 + (roll(2) - 0.5) * 0.8) / count;
      const angle = count === 1 ? 0 : -arc + 2 * arc * slot;
      const x = Math.sin(angle) * r;
      const z = Math.cos(angle) * r;
      if (Math.hypot(x, z) < clearRadius) continue;
      if (FIGHTER_HOMES.some((h) => Math.hypot(x - h.x, z - h.z) < fighterClear)) continue;
      if (!group.front && z < cameraLane.z && Math.abs(x) < cameraLane.halfWidth) continue;
      const [small, big] = group.scale;
      out.push({
        kind: group.kind,
        x,
        y: 0,
        z,
        scale: small + (big - small) * roll(3),
        turn: roll(4) * Math.PI * 2,
      });
    }
  });
  return out;
}

/** The far hills: a ring of soft domes behind the treeline. Scale is their width; `turn` carries the height share. */
export function arenaHills(seed: number): Placement[] {
  const { count, distance, width, height } = ARENA_STAGE.hills;
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const a = -1.75 + (3.5 * (i + 0.5)) / count + (hash01(seed, i, 7) - 0.5) * 0.3;
    const d = distance[0] + (distance[1] - distance[0]) * hash01(seed, i, 8);
    const w = width[0] + (width[1] - width[0]) * hash01(seed, i, 9);
    const h = height[0] + (height[1] - height[0]) * hash01(seed, i, 10);
    out.push({ x: Math.sin(a) * d, y: -1.5, z: Math.cos(a) * d, scale: w, turn: h / w });
  }
  return out;
}

/** Vinyl clouds around the horizon, only where the camera can see them. */
export function arenaClouds(seed: number, count: number): Placement[] {
  const { distance, height, size } = ARENA_STAGE.clouds;
  const r = ARENA_STAGE.skyRadius;
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const a = -1.9 + (3.8 * (i + 0.5)) / count + (hash01(seed, i, 3) - 0.5) * 0.4;
    const d = r * (distance[0] + (distance[1] - distance[0]) * hash01(seed, i, 4));
    const y = height[0] + (height[1] - height[0]) * hash01(seed, i, 5);
    const s = size[0] + (size[1] - size[0]) * hash01(seed, i, 6);
    out.push({ x: Math.sin(a) * d, y, z: Math.cos(a) * d, scale: s, turn: 0 });
  }
  return out;
}

/** Stars on the dome (a sunflower spiral, so they never line up). */
export function arenaStars(): Placement[] {
  const out: Placement[] = [];
  const d = ARENA_STAGE.skyRadius * 0.9;
  const n = ARENA_STAGE.stars;
  for (let i = 0; i < n; i++) {
    const y = 0.15 + 0.8 * ((i + 0.5) / n);
    const a = i * 2.39996;
    const rr = Math.sqrt(1 - y * y);
    const s = 0.6 + 0.8 * (((i * 37) % 11) / 10);
    out.push({ x: Math.cos(a) * rr * d, y: y * d, z: Math.sin(a) * rr * d, scale: s, turn: 0 });
  }
  return out;
}

/** Where the motes start (they drift from here, see `moteAt`). */
export function arenaMotes(seed: number, count: number): Placement[] {
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const a = hash01(seed, i, 20) * Math.PI * 2;
    const r = 3 + 14 * Math.sqrt(hash01(seed, i, 21));
    const y = 0.4 + 3.2 * hash01(seed, i, 22);
    const s = 0.6 + hash01(seed, i, 23);
    out.push({ x: Math.sin(a) * r, y, z: Math.cos(a) * r, scale: s, turn: hash01(seed, i, 24) });
  }
  return out;
}

/** A mote's drift at `t` seconds: a slow float up and a wander, each on its own phase (`turn`). */
export function moteAt(mote: Placement, t: number): { x: number; y: number; z: number } {
  const p = mote.turn * Math.PI * 2;
  return {
    x: mote.x + Math.sin(t * 0.35 + p) * 0.45,
    y: mote.y + Math.sin(t * 0.5 + p * 2) * 0.25,
    z: mote.z + Math.cos(t * 0.3 + p) * 0.35,
  };
}

// ── Colours (sRGB hex in, 0–1 out) ───────────────────────────────────────

export type Rgb = readonly [number, number, number];

export function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rgbHex(rgb: Rgb): string {
  const to = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

export function smooth(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}

export interface SkyColors {
  readonly zenith: Rgb;
  readonly horizon: Rgb;
  readonly below: Rgb;
  readonly sun: Rgb;
  readonly sunGlow: number;
  /** The sun's azimuth (radians, atan2(x, z)): where the key light comes from. */
  readonly sunAzimuth: number;
}

/** The dome's colours (sRGB): the time of day's, with the terrain's haze in the horizon. */
export function skyColors(plan: Pick<ArenaPlan, 'mood' | 'spec'>): SkyColors {
  const { mood, spec } = plan;
  const [dx, , dz] = mood.key.dir;
  // Less of the haze at night: the horizon stays a calm blue.
  const haze = ARENA_STAGE.hazeMix * (mood.night ? 0.4 : 1);
  return {
    zenith: hexRgb(mood.sky.zenith),
    horizon: mixRgb(hexRgb(mood.sky.horizon), hexRgb(spec.haze), haze),
    below: hexRgb(mood.sky.below),
    sun: hexRgb(mood.sky.sunColor),
    sunGlow: mood.sky.sunGlow,
    sunAzimuth: Math.atan2(-dx, -dz),
  };
}

/**
 * The sky colour (sRGB) on a unit dome at height `y` (−1 straight down, 1
 * straight up) and azimuth `az`: the gradient plus the sun's warm glow near
 * the horizon on its side.
 */
export function skyAt(sky: SkyColors, y: number, az: number): Rgb {
  let c =
    y >= 0
      ? mixRgb(sky.horizon, sky.zenith, smooth(y / 0.42))
      : mixRgb(sky.horizon, sky.below, smooth(-y / 0.3));
  if (sky.sunGlow > 0 && y > -0.05) {
    let da = Math.abs(az - sky.sunAzimuth);
    if (da > Math.PI) da = Math.PI * 2 - da;
    const g = Math.max(0, 1 - da / 1.6) ** 2 * Math.max(0, 1 - y / 0.45) ** 1.5;
    c = mixRgb(c, sky.sun, sky.sunGlow * g);
  }
  return c;
}

/** The ground's colour (sRGB): the terrain's (or the spec's shore), tinted for the time of day. */
export function groundColor(plan: Pick<ArenaPlan, 'look' | 'spec' | 'mood'>): Rgb {
  const base = hexRgb(plan.spec.ground ?? plan.look.color);
  return mixRgb(base, hexRgb(plan.mood.tintColor), plan.mood.tint);
}

/** The water's colour (sRGB), tinted like the ground, or null for no lake. */
export function waterColor(plan: Pick<ArenaPlan, 'spec' | 'mood'>): Rgb | null {
  if (!plan.spec.water) return null;
  return mixRgb(hexRgb(plan.spec.water), hexRgb(plan.mood.tintColor), plan.mood.tint);
}

/** Smooth value noise in [−1, 1] from the map's hash. */
export function valueNoise(x: number, z: number, salt: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = smooth(x - xi);
  const fz = smooth(z - zi);
  const v = (a: number, b: number) => hash01(a, b, salt) * 2 - 1;
  const top = v(xi, zi) + (v(xi + 1, zi) - v(xi, zi)) * fx;
  const bottom = v(xi, zi + 1) + (v(xi + 1, zi + 1) - v(xi, zi + 1)) * fx;
  return top + (bottom - top) * fz;
}

/**
 * How light the ground is at (x, z), `d` of the way to the rim (0–1): mottled
 * by noise so it never reads as a flat lawn, darker towards the edge.
 */
export function groundShade(x: number, z: number, d: number, seed: number): number {
  const { rimDarken, mottle } = ARENA_STAGE.ground;
  const n =
    0.5 +
    0.5 * (valueNoise(x * 0.3, z * 0.3, seed) * 0.6 + valueNoise(x * 0.9, z * 0.9, seed + 9) * 0.4);
  const rim = 1 - rimDarken * smooth(Math.max(0, (d - 0.2) / 0.8));
  return rim * (1 - mottle / 2 + mottle * n);
}

/** Where the sun (or moon) disc sits on the dome, from the key light. */
export function sunPlacement(plan: Pick<ArenaPlan, 'mood'>): { x: number; y: number; z: number } {
  const [dx, dy, dz] = plan.mood.key.dir;
  const len = Math.hypot(dx, dy, dz) || 1;
  const az = Math.atan2(-dx, -dz);
  const d = ARENA_STAGE.skyRadius * 0.92;
  const elev = Math.max(0.12, -dy / len) * (plan.mood.night ? 0.45 : 0.9);
  return {
    x: Math.sin(az) * d * Math.cos(elev),
    y: Math.sin(elev) * d,
    z: Math.cos(az) * d * Math.cos(elev),
  };
}
