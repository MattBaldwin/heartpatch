import { describe, expect, it } from 'vitest';
import { EXPLORE_SWIM, EXPLORE_VIEW } from './explore-config.js';
import {
  createSwim,
  stepSwim,
  strokeAt,
  swimActive,
  swimPose,
  type Swim,
  type SwimPose,
  type SwimStyle,
} from './keeper-swim.js';

const FPS = 60;
const STYLES: readonly SwimStyle[] = ['glide', 'paddle', 'dolphin'];
const pose = (): SwimPose => ({ pitch: 0, lift: 0, squash: 1, surge: 0, sway: 0 });

/** Swims `seconds` at `push`, then rests `rest` seconds; returns each frame's pose and the kicks. */
function swim(
  s: Swim,
  style: SwimStyle,
  {
    seconds,
    push = 1,
    rest = 0,
    reduce = false,
  }: {
    seconds: number;
    push?: number;
    rest?: number;
    reduce?: boolean;
  },
): { poses: SwimPose[]; kicks: number } {
  const dt = 1 / FPS;
  const poses: SwimPose[] = [];
  let kicks = 0;
  const frames = Math.round(seconds * FPS);
  for (let i = 0; i < frames + Math.round(rest * FPS); i++) {
    const ds = i < frames ? EXPLORE_VIEW.walkSpeed * push * dt : 0;
    if (stepSwim(s, ds, dt, push)) kicks++;
    poses.push({ ...swimPose(s, style, reduce, i * dt, pose()) });
  }
  return { poses, kicks };
}

describe('the swim (#399)', () => {
  it('leans forward into the heading while swimming, never back', () => {
    for (const style of STYLES) {
      const { poses } = swim(createSwim(), style, { seconds: 2 });
      const swimming = poses.slice(FPS);
      for (const p of swimming) expect(p.pitch).toBeGreaterThan(0.3);
      // The glide stretches out toward horizontal.
      if (style === 'glide') {
        expect(Math.min(...swimming.map((p) => p.pitch))).toBeGreaterThan(0.9);
      }
    }
  });

  it('treads water upright once stopped, and stops drawing', () => {
    const s = createSwim();
    const { poses } = swim(s, 'glide', { seconds: 1, rest: 3 });
    const last = poses.at(-1);
    expect(last?.pitch ?? 1).toBeLessThan(0.01);
    expect(last?.surge).toBe(0);
    expect(s.moving).toBe(false);
    expect(swimActive(s)).toBe(false);
  });

  it('kicks by the water covered, not the clock: half the push, about half the kicks', () => {
    const full = swim(createSwim(), 'glide', { seconds: 4, push: 1 }).kicks;
    const half = swim(createSwim(), 'glide', { seconds: 4, push: 0.5 }).kicks;
    expect(full).toBeGreaterThan(4);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full * 0.7);
    // A slow frame covers the same water and kicks the same.
    const slow = createSwim();
    let slowKicks = 0;
    for (let i = 0; i < 40; i++) {
      if (stepSwim(slow, EXPLORE_VIEW.walkSpeed * 0.1, 0.1, 1)) slowKicks++;
    }
    expect(Math.abs(slowKicks - full)).toBeLessThanOrEqual(1);
  });

  it('surges ahead on the kick and glides back (the glide)', () => {
    const { poses } = swim(createSwim(), 'glide', { seconds: 3 });
    const surges = poses.slice(FPS).map((p) => p.surge);
    expect(Math.max(...surges)).toBeGreaterThan(0.1);
    expect(Math.min(...surges)).toBeLessThan(0.02);
  });

  it('with Reduce Motion: a still float, no surge, bob, sway or squash', () => {
    for (const style of STYLES) {
      const { poses } = swim(createSwim(), style, { seconds: 2, rest: 2, reduce: true });
      for (const p of poses) {
        expect(p.surge).toBe(0);
        expect(p.sway).toBe(0);
        expect(p.squash).toBe(1);
        expect(p.lift).toBe(EXPLORE_SWIM.float);
      }
    }
  });

  it('strokes grow with effort', () => {
    expect(strokeAt(0)).toBe(EXPLORE_SWIM.stroke.min);
    expect(strokeAt(1)).toBe(EXPLORE_SWIM.stroke.max);
  });

  it('writes the pose in place', () => {
    const out = pose();
    expect(swimPose(createSwim(), 'glide', false, 0, out)).toBe(out);
  });
});
