import { hexToWorld, type PublicTile } from '@heartpatch/shared';
import type { QualityTier } from '../engine/config.js';
import { AMBIENT, MOTES, TERRAIN_LOOKS, type MoteKind } from './map-config.js';

export type { MoteKind } from './map-config.js';
import { hash01 } from './map-layout.js';

// Pure ambient-life layout (no Babylon), so it's unit-tested: where the
// drifting motes start and how each one moves, and whether ambient life runs
// at all. The motion itself is a pure function of one time uniform in the
// shader (terrain-plugin.ts), so the CPU does nothing per frame.

/** How a mote moves in the shader (`terrainDrift.x`): see terrain-plugin.ts. */
export const DRIFT_MODE = {
  wander: 0,
  fall: 1,
  firefly: 2,
  orbit: 3,
  float: 4,
} as const;

/** One mote: where it hangs and how it drifts. */
export interface Mote {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly size: number;
  /** `terrainDrift`: mode, phase (radians), range (world units), speed. */
  readonly drift: readonly [number, number, number, number];
}

const TERRAINS_FOR: Readonly<Record<MoteKind, readonly string[]>> = {
  pollen: ['meadow', 'hills', 'pumpkin-fields'],
  leaves: ['forest', 'old-forest'],
  fireflies: ['meadow', 'forest', 'old-forest', 'lake'],
  sparkles: ['junipers-gap'],
  bats: ['forest', 'old-forest', 'mountains'],
  fog: ['lake', 'meadow'],
};

/** How each kind floats: height above its tile, size, and its drift. TUNE: all of it. */
const STYLE: Readonly<
  Record<
    MoteKind,
    {
      lift: [number, number];
      size: [number, number];
      mode: number;
      range: [number, number];
      speed: [number, number];
    }
  >
> = {
  pollen: {
    lift: [0.18, 0.5],
    size: [0.03, 0.045],
    mode: DRIFT_MODE.wander,
    range: [0.12, 0.25],
    speed: [0.35, 0.6],
  },
  leaves: {
    lift: [0.7, 1.0],
    size: [0.05, 0.07],
    mode: DRIFT_MODE.fall,
    range: [0.6, 0.85],
    speed: [0.6, 0.9],
  },
  fireflies: {
    lift: [0.12, 0.45],
    size: [0.05, 0.07],
    mode: DRIFT_MODE.firefly,
    range: [0.15, 0.3],
    speed: [0.4, 0.75],
  },
  sparkles: {
    lift: [0.1, 0.9],
    size: [0.03, 0.05],
    mode: DRIFT_MODE.wander,
    range: [0.1, 0.2],
    speed: [0.5, 0.9],
  },
  bats: {
    lift: [0.9, 1.3],
    size: [1.2, 1.5],
    mode: DRIFT_MODE.orbit,
    range: [0.6, 1.4],
    speed: [0.35, 0.6],
  },
  fog: {
    lift: [0.06, 0.1],
    size: [0.9, 1.4],
    mode: DRIFT_MODE.float,
    range: [0.2, 0.4],
    speed: [0.15, 0.25],
  },
};

const SALT: Readonly<Record<MoteKind, number>> = {
  pollen: 100,
  leaves: 110,
  fireflies: 120,
  sparkles: 130,
  bats: 140,
  fog: 150,
};

/**
 * The motes of `kind` over these tiles: each tile of a matching terrain
 * gets `perTile` on average (hash-seeded, so the same everywhere), up to
 * `max`. Home tiles get none.
 */
export function motesFor(kind: MoteKind, tiles: readonly PublicTile[], size: number): Mote[] {
  const { perTile, max } = MOTES[kind];
  const style = STYLE[kind];
  const salt = SALT[kind];
  const terrains = TERRAINS_FOR[kind];
  const lerp = ([lo, hi]: readonly [number, number], t: number) => lo + (hi - lo) * t;
  const motes: Mote[] = [];
  for (const tile of tiles) {
    if (tile.homeSlot !== null || !terrains.includes(tile.terrain)) continue;
    const whole = Math.floor(perTile);
    const count = whole + (hash01(tile.q, tile.r, salt) < perTile - whole ? 1 : 0);
    const centre = hexToWorld(tile, size);
    const ground = TERRAIN_LOOKS[tile.terrain]?.height ?? 0;
    for (let i = 0; i < count; i++) {
      const h = (n: number) => hash01(tile.q, tile.r, salt + 1 + i * 8 + n);
      const angle = h(0) * Math.PI * 2;
      const spread = h(1) * 0.45 * size;
      motes.push({
        x: centre.x + Math.cos(angle) * spread,
        y: ground + lerp(style.lift, h(2)),
        z: centre.z + Math.sin(angle) * spread,
        size: lerp(style.size, h(3)),
        drift: [style.mode, h(4) * Math.PI * 2, lerp(style.range, h(5)), lerp(style.speed, h(6))],
      });
    }
  }
  // A stable shuffle, so any first n (the cap, or a lower tier's share) spread
  // over the whole map rather than its first rows.
  const keyed = motes.map((m) => ({
    m,
    key: hash01(Math.round(m.x * 100), Math.round(m.z * 100), salt + 7),
  }));
  keyed.sort((a, b) => a.key - b.key);
  return keyed.slice(0, max).map((k) => k.m);
}

/**
 * - `live`: everything moves (sway, water, motes) and the map draws about 30
 *   frames a second.
 * - `still`: reduced motion. Nothing moves and nothing drifts; the map draws
 *   only when something changes, as before.
 * - `off`: the low quality tier, or a device too slow for it: no motes, no
 *   motion.
 */
export type AmbientMode = 'live' | 'still' | 'off';

export function ambientMode(state: {
  tier: QualityTier;
  reducedMotion: boolean;
  slow: boolean;
}): AmbientMode {
  if (state.tier === 'low' || state.slow) return 'off';
  return state.reducedMotion ? 'still' : 'live';
}

/** Share of the motes drawn on a tier (low draws none). */
export function moteShare(tier: QualityTier): number {
  return AMBIENT.motes[tier];
}

/**
 * Watches how often ambient frames actually arrive. Ambient life asks for
 * one about every 33 ms; when the device can't keep up (most frames in a
 * window of `judgeFrames` further apart than `maxFrameGapMs`, GPU or main
 * thread alike), it says "slow" and stays slow for this visit, so the map
 * keeps its frame budget for the player's own taps and drags. A majority, not
 * an average: one hitch (a shader compiling) never switches it off, and a
 * renderer that takes a second a frame is caught within a few frames. The
 * first `graceMs` (shader compiles, uploads) don't count, and `skip` drops
 * the gap over a hidden page (no frames at all).
 */
export class AmbientJudge {
  private slowFrames = 0;
  private frames = 0;
  private start: number | null = null;
  private last: number | null = null;
  private slowNow = false;

  /** Records one ambient frame at `now` (ms); true once the device is judged slow. */
  record(now: number): boolean {
    if (this.slowNow) return true;
    this.start ??= now;
    const last = this.last;
    this.last = now;
    if (last === null || now - this.start < AMBIENT.graceMs) return false;
    this.frames += 1;
    if (now - last > AMBIENT.maxFrameGapMs) this.slowFrames += 1;
    if (this.slowFrames * 2 > AMBIENT.judgeFrames) this.slowNow = true;
    else if (this.frames >= AMBIENT.judgeFrames) {
      this.slowFrames = 0;
      this.frames = 0;
    }
    return this.slowNow;
  }

  /** The page was hidden: the next frame starts a new gap, not one spanning the time away. */
  skip(): void {
    this.last = null;
  }

  get slow(): boolean {
    return this.slowNow;
  }
}
