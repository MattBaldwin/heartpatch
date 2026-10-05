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
  type ArenaPropKind,
  type ArenaSpec,
} from './arena-config.js';

// Pure arena maths (owner decision 2026-10-04): which diorama a terrain gets,
// where its props stand, and the sky's colours. No Babylon, so it's unit
// tested; `arena.ts` draws it.

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
}

export function arenaPlan(terrain: string, timeOfDay: BattleTimeOfDay): ArenaPlan {
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
  };
}

export interface ArenaPropPlacement {
  readonly kind: PropKind | ArenaPropKind;
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  /** Heading, radians. */
  readonly turn: number;
  readonly color: string | null;
}

/** A small whole number from a battle id, so one battle always gets the same arena. */
export function arenaSeed(battleId: string): number {
  let h = 2166136261;
  for (let i = 0; i < battleId.length; i++) h = Math.imul(h ^ battleId.charCodeAt(i), 16777619);
  return (h >>> 0) % 100003;
}

/**
 * Where the arena's props stand, from the battle's seed. Big props only
 * behind the fighters and to the sides (`propArc`), so they never hide the
 * fight; small ones (`front`) anywhere but the fight itself. `share` thins
 * them out on the low quality tier.
 */
export function arenaProps(spec: ArenaSpec, seed: number, share = 1): ArenaPropPlacement[] {
  const out: ArenaPropPlacement[] = [];
  spec.props.forEach((group, g) => {
    const count = Math.max(group.count > 0 ? 1 : 0, Math.round(group.count * share));
    for (let i = 0; i < count; i++) {
      const salt = g * 1000 + i * 7;
      const roll = (n: number) => hash01(seed, salt, n);
      const [near, far] = group.ring;
      const r = near + (far - near) * roll(1);
      // Spread evenly over the arc with a little jitter, so groups don't clump.
      const arc = group.front ? Math.PI : ARENA_STAGE.propArc;
      const slot = (i + 0.5 + (roll(2) - 0.5) * 0.8) / count;
      const angle = count === 1 ? 0 : -arc + 2 * arc * slot;
      const x = Math.sin(angle) * r;
      const z = Math.cos(angle) * r;
      if (Math.hypot(x, z) < ARENA_STAGE.clearRadius) continue;
      const [small, big] = group.scale;
      out.push({
        kind: group.kind,
        x,
        z,
        scale: small + (big - small) * roll(3),
        turn: roll(4) * Math.PI * 2,
        color: group.color ?? null,
      });
    }
  });
  return out;
}

// ── Colours (sRGB hex in, linear 0–1 out) ───────────────────────────────

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

export interface SkyColors {
  readonly zenith: Rgb;
  readonly horizon: Rgb;
  readonly below: Rgb;
}

/** The dome's colours (sRGB): the time of day's, with the terrain's haze in the horizon. */
export function skyColors(plan: Pick<ArenaPlan, 'mood' | 'spec'>): SkyColors {
  const { mood, spec } = plan;
  // Less of the haze at night: the horizon stays a calm blue.
  const haze = ARENA_STAGE.hazeMix * (mood.night ? 0.35 : 1);
  return {
    zenith: hexRgb(mood.zenith),
    horizon: mixRgb(hexRgb(mood.horizon), hexRgb(spec.haze), haze),
    below: hexRgb(mood.below),
  };
}

/** The sky colour (sRGB) at height `y` on a unit dome (−1 straight down, 1 straight up). */
export function skyAt(sky: SkyColors, y: number): Rgb {
  if (y >= 0) return mixRgb(sky.horizon, sky.zenith, smooth(Math.min(1, y / 0.7)));
  return mixRgb(sky.horizon, sky.below, smooth(Math.min(1, -y / 0.25)));
}

/** The ground's colour (sRGB): the terrain's (or the spec's), tinted for the time of day. */
export function groundColor(plan: Pick<ArenaPlan, 'look' | 'spec' | 'mood'>): Rgb {
  const base = hexRgb(plan.spec.ground ?? plan.look.color);
  return mixRgb(base, hexRgb(plan.mood.tintColor), plan.mood.tint);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
