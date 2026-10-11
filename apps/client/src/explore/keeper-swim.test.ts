import { describe, expect, it } from 'vitest';
import { EXPLORE_SWIM, EXPLORE_VIEW } from './explore-config.js';
import {
  bubblesAt,
  createSwim,
  stepSwim,
  strokeAt,
  swimActive,
  swimPlacement,
  swimPose,
  type Swim,
  type SwimPlacement,
  type SwimPose,
} from './keeper-swim.js';

const FPS = 60;
const pose = (): SwimPose => ({ pitch: 0, lift: 0, squash: 1, surge: 0 });

/** Swims `seconds` at `push`, then rests `rest` seconds; returns each frame's pose and the kicks. */
function swim(
  s: Swim,
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
    poses.push({ ...swimPose(s, reduce, i * dt, pose()) });
  }
  return { poses, kicks };
}

describe('the swim (#399, glide and kick)', () => {
  it('leans forward into the heading, toward flat, while swimming, never back', () => {
    const { poses } = swim(createSwim(), { seconds: 2 });
    for (const p of poses) expect(p.pitch).toBeGreaterThanOrEqual(0);
    for (const p of poses.slice(FPS)) expect(p.pitch).toBeGreaterThan(0.9);
  });

  it('treads water upright once stopped, and stops drawing', () => {
    const s = createSwim();
    const { poses } = swim(s, { seconds: 1, rest: 3 });
    const last = poses.at(-1);
    expect(last?.pitch ?? 1).toBeLessThan(0.01);
    expect(last?.surge).toBe(0);
    expect(s.moving).toBe(false);
    expect(swimActive(s)).toBe(false);
  });

  it('kicks by the water covered, not the clock: half the push, fewer kicks', () => {
    const full = swim(createSwim(), { seconds: 4, push: 1 }).kicks;
    const half = swim(createSwim(), { seconds: 4, push: 0.5 }).kicks;
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

  it('kicks only while moving: letting go never starts a kick', () => {
    const s = createSwim();
    swim(s, { seconds: 1 });
    const { kicks } = swim(s, { seconds: 0, rest: 2 });
    expect(kicks).toBe(0);
  });

  it('surges ahead on the kick and glides back to the pace', () => {
    const { poses } = swim(createSwim(), { seconds: 3 });
    const surges = poses.slice(FPS).map((p) => p.surge);
    expect(Math.max(...surges)).toBeGreaterThan(0.25);
    expect(Math.min(...surges)).toBeLessThan(0.02);
    // Bunches up on the kick, stretches out on the glide.
    const squash = poses.slice(FPS).map((p) => p.squash);
    expect(Math.min(...squash)).toBeLessThan(0.95);
    expect(Math.max(...squash)).toBeGreaterThan(1.05);
  });

  it('barely moves up and down while swimming (no bounce)', () => {
    const { poses } = swim(createSwim(), { seconds: 3 });
    const lifts = poses.slice(FPS).map((p) => p.lift);
    expect(Math.max(...lifts) - Math.min(...lifts)).toBeLessThanOrEqual(
      2 * EXPLORE_SWIM.kick.bob + 1e-9,
    );
  });

  it('with Reduce Motion: a still float, no kick, surge or bob', () => {
    const { poses } = swim(createSwim(), { seconds: 2, rest: 2, reduce: true });
    for (const p of poses) {
      expect(p.surge).toBe(0);
      expect(p.squash).toBe(1);
      expect(p.lift).toBe(EXPLORE_SWIM.float);
    }
  });

  it('strokes grow with effort', () => {
    expect(strokeAt(0)).toBe(EXPLORE_SWIM.stroke.min);
    expect(strokeAt(1)).toBe(EXPLORE_SWIM.stroke.max);
  });

  it('writes the pose in place', () => {
    const out = pose();
    expect(swimPose(createSwim(), false, 0, out)).toBe(out);
  });

  it('moves smoothly frame to frame, the kick-to-glide hand-over included (60 and 120 fps)', () => {
    for (const fps of [60, 120]) {
      const s = createSwim();
      const dt = 1 / fps;
      let last: SwimPose | null = null;
      // Warm up, then many strokes at full push.
      for (let i = 0; i < fps * 6; i++) {
        stepSwim(s, EXPLORE_VIEW.walkSpeed * dt, dt, 1);
        const p = { ...swimPose(s, false, i * dt, pose()) };
        if (last && i > fps) {
          // A 60 fps frame may change each by this much at most; 120 fps half that.
          const k = 60 / fps;
          expect(Math.abs(p.squash - last.squash)).toBeLessThan(0.06 * k);
          expect(Math.abs(p.surge - last.surge)).toBeLessThan(0.08 * k);
          expect(Math.abs(p.pitch - last.pitch)).toBeLessThan(0.05 * k);
          expect(Math.abs(p.lift - last.lift)).toBeLessThan(0.02 * k);
        }
        last = p;
      }
    }
  });
});

describe('placing the swimmer (#399)', () => {
  const tall = 0.9;
  const out = (): SwimPlacement => ({ dx: 0, dz: 0, lean: 0, lift: 0, midX: 0, midZ: 0 });
  const swimming = (pitch: number): SwimPose => ({ pitch, lift: 0.4, squash: 1, surge: 0 });

  it('leans the head forward into the heading (a negative lean), and stands upright treading water', () => {
    expect(swimPlacement(swimming(1.1), tall, 0, out()).lean).toBeLessThan(0);
    expect(swimPlacement(swimming(0), tall, 0, out()).lean).toBe(-0);
  });

  it('pitches about the head: the head stays on its point at any tilt and heading', () => {
    const pivot = tall * EXPLORE_SWIM.pivot;
    for (const yaw of [0, Math.PI / 2, Math.PI, -0.7]) {
      for (const pitch of [0, 0.4, 0.8, 1.15]) {
        const p = swimPlacement(swimming(pitch), tall, yaw, out());
        // The field rotates the body about its feet: yaw, then the lean
        // (positive tips the top toward the Keeper's back, +z at yaw 0).
        const lean = p.lean;
        const backX = Math.sin(yaw);
        const backZ = Math.cos(yaw);
        const headX = p.dx + backX * pivot * Math.sin(lean);
        const headZ = p.dz + backZ * pivot * Math.sin(lean);
        const headY = p.lift + pivot * Math.cos(lean);
        expect(headX).toBeCloseTo(0, 9);
        expect(headZ).toBeCloseTo(0, 9);
        expect(headY).toBeCloseTo(0.4 * tall + pivot, 9);
      }
    }
  });

  it('trails the feet behind the heading, with the shadow under the middle', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI]) {
      const p = swimPlacement(swimming(1.15), tall, yaw, out());
      // The heading is (−sin yaw, −cos yaw): the feet sit the other way.
      const along = -Math.sin(yaw) * p.dx - Math.cos(yaw) * p.dz;
      expect(along).toBeLessThan(0);
      const mid = -Math.sin(yaw) * p.midX - Math.cos(yaw) * p.midZ;
      expect(mid).toBeGreaterThan(along);
      expect(mid).toBeLessThan(0);
    }
  });

  it('surges ahead along the heading on a kick', () => {
    const rest = swimPlacement(swimming(1.15), tall, Math.PI / 2, out());
    const kick = swimPlacement({ ...swimming(1.15), surge: 0.3 }, tall, Math.PI / 2, out());
    // Yaw π/2 faces −x: the kick moves it further toward −x.
    expect(kick.dx).toBeLessThan(rest.dx);
  });
});

describe('kick bubbles by quality tier (#399)', () => {
  it('only the high tier puffs them, so lower tiers draw nothing extra', () => {
    expect(bubblesAt('high')).toBe(true);
    expect(bubblesAt('medium')).toBe(false);
    expect(bubblesAt('low')).toBe(false);
  });
});
