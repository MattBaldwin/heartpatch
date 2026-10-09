import { describe, expect, it } from 'vitest';
import { EXPLORE_HOP, EXPLORE_VIEW } from './explore-config.js';
import {
  createHop,
  hopActive,
  hopPose,
  shadowScale,
  stepHop,
  strideAt,
  TELEPORT,
  type Hop,
  type HopPose,
} from './keeper-hop.js';

const FPS = 60;

/** Walks `seconds` at `push` (share of full speed), then stands still for `rest` seconds; returns every pose. */
function walk(
  hop: Hop,
  {
    seconds,
    push = 1,
    rest = 0,
    fps = FPS,
    reduce = false,
  }: {
    seconds: number;
    push?: number;
    rest?: number;
    fps?: number;
    reduce?: boolean;
  },
): HopPose[] {
  const dt = 1 / fps;
  const poses: HopPose[] = [];
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames + Math.round(rest * fps); i++) {
    const ds = i < frames ? EXPLORE_VIEW.walkSpeed * push * dt : 0;
    stepHop(hop, ds, dt, push, reduce);
    poses.push({ ...hopPose(hop, reduce, 1, { lift: 0, squash: 1 }) });
  }
  return poses;
}

const highest = (poses: readonly HopPose[]) => Math.max(...poses.map((p) => p.lift));

describe('the hop follows the ground covered (#317)', () => {
  it('takes one hop per stride, whatever the frame rate', () => {
    const smooth = createHop();
    const choppy = createHop();
    walk(smooth, { seconds: 2, fps: 60 });
    walk(choppy, { seconds: 2, fps: 20 });
    const covered = EXPLORE_VIEW.walkSpeed * 2;
    // Between the shortest and the longest stride's count, and the same either way.
    expect(smooth.phase).toBeGreaterThan(covered / EXPLORE_HOP.stride.max);
    expect(smooth.phase).toBeLessThan(covered / EXPLORE_HOP.stride.min);
    expect(choppy.phase).toBeCloseTo(smooth.phase, 0);
  });

  it("doesn't hop on the spot (a finger on the stick, pushing against a rock)", () => {
    const hop = createHop();
    for (let i = 0; i < 60; i++) stepHop(hop, 0, 1 / FPS, 1, false);
    expect(hop.phase).toBe(0);
    expect(hopActive(hop)).toBe(false);
    expect(hopPose(hop, false, 1, { lift: 1, squash: 2 })).toEqual({ lift: 0, squash: 1 });
  });

  it('gives a gentle push small, quick hops and full stick longer, higher ones', () => {
    const gentle = createHop();
    const full = createHop();
    const gentlePoses = walk(gentle, { seconds: 2, push: 0.5 });
    const fullPoses = walk(full, { seconds: 2, push: 1 });
    expect(strideAt(full.effort)).toBeGreaterThan(strideAt(gentle.effort));
    expect(highest(fullPoses)).toBeGreaterThan(highest(gentlePoses));
    expect(highest(fullPoses)).toBeLessThanOrEqual(EXPLORE_HOP.height.max + 1e-9);
    expect(highest(gentlePoses)).toBeGreaterThanOrEqual(EXPLORE_HOP.height.min * 0.5);
  });

  it('starts every walk small, even a tap-walk at full speed', () => {
    const hop = createHop();
    const poses = walk(hop, { seconds: 2 });
    const firstHop = poses.slice(0, Math.round(FPS / 4));
    expect(highest(firstHop)).toBeLessThan(highest(poses));
  });

  it('stays on or above the ground, squashing on landing and stretching on take-off', () => {
    const poses = walk(createHop(), { seconds: 2, rest: 1 });
    expect(Math.min(...poses.map((p) => p.lift))).toBeGreaterThanOrEqual(0);
    const squashes = poses.map((p) => p.squash);
    expect(Math.min(...squashes)).toBeLessThan(1 - EXPLORE_HOP.squash / 2);
    expect(Math.max(...squashes)).toBeGreaterThan(1 + EXPLORE_HOP.stretch / 2);
    // On the ground it never floats.
    for (const p of poses) if (p.squash < 1) expect(p.lift).toBe(0);
  });

  it('lands soon after a stop in mid-air, settles with a squish, then rests', () => {
    const hop = createHop();
    const dt = 1 / FPS;
    // Walk until it's up in the air.
    let pose = hopPose(hop, false, 1, { lift: 0, squash: 1 });
    while (pose.lift < 0.05) {
      stepHop(hop, EXPLORE_VIEW.walkSpeed * dt, dt, 1, false);
      pose = hopPose(hop, false, 1, pose);
    }
    let landedAfter = 0;
    while (hop.landing || hop.moving) {
      stepHop(hop, 0, dt, 0, false);
      landedAfter += dt;
    }
    expect(landedAfter).toBeLessThanOrEqual(EXPLORE_HOP.landMs / 1000 + dt);
    expect(hopPose(hop, false, 1, pose).lift).toBe(0);
    let settled = 0;
    let deepest = 1;
    while (hopActive(hop)) {
      deepest = Math.min(deepest, hopPose(hop, false, 1, pose).squash);
      stepHop(hop, 0, dt, 0, false);
      settled += dt;
    }
    expect(deepest).toBeLessThan(1 - EXPLORE_HOP.settleSquash / 2);
    expect(settled).toBeLessThanOrEqual(EXPLORE_HOP.settleMs / 1000 + dt);
    expect(hopPose(hop, false, 1, pose)).toEqual({ lift: 0, squash: 1 });
  });

  it('carries on from the air if the walk picks up again while coming down', () => {
    const hop = createHop();
    const dt = 1 / FPS;
    let pose = hopPose(hop, false, 1, { lift: 0, squash: 1 });
    while (pose.lift < 0.05) {
      stepHop(hop, EXPLORE_VIEW.walkSpeed * dt, dt, 1, false);
      pose = hopPose(hop, false, 1, pose);
    }
    stepHop(hop, 0, dt, 0, false);
    const before = hopPose(hop, false, 1, { lift: 0, squash: 1 }).lift;
    stepHop(hop, EXPLORE_VIEW.walkSpeed * dt, dt, 1, false);
    const after = hopPose(hop, false, 1, { lift: 0, squash: 1 }).lift;
    expect(before).toBeGreaterThan(0);
    expect(Math.abs(after - before)).toBeLessThan(0.03);
  });

  it('keeps followers out of step with each other', () => {
    const [a, b] = EXPLORE_HOP.followerOffset;
    const one = createHop(a);
    const two = createHop(b);
    walk(one, { seconds: 1 });
    walk(two, { seconds: 1 });
    const frac = (h: Hop) => h.phase - Math.floor(h.phase);
    expect(Math.abs(frac(one) - frac(two))).toBeGreaterThan(0.1);
  });

  it('only bobs with Reduce Motion: no squash, stretch or settle', () => {
    const hop = createHop();
    const poses = walk(hop, { seconds: 2, rest: 0.3, reduce: true });
    for (const p of poses) expect(p.squash).toBe(1);
    expect(highest(poses)).toBeLessThanOrEqual(EXPLORE_HOP.bob + 1e-9);
    expect(highest(poses)).toBeGreaterThan(0);
    expect(hopActive(hop)).toBe(false);
  });

  it('shrinks the shadow as the hopper rises', () => {
    expect(shadowScale(0)).toBe(1);
    expect(shadowScale(EXPLORE_HOP.height.max)).toBeCloseTo(EXPLORE_HOP.shadowMin);
    expect(shadowScale(EXPLORE_HOP.height.max / 2)).toBeGreaterThan(EXPLORE_HOP.shadowMin);
    expect(shadowScale(EXPLORE_HOP.height.max / 2)).toBeLessThan(1);
  });

  it('treats a jump to a new place as no step at all', () => {
    // A walking frame never covers more than this; a new tile's start does.
    expect(TELEPORT).toBeGreaterThan(EXPLORE_VIEW.walkSpeed * EXPLORE_VIEW.maxFrameStep);
    expect(TELEPORT).toBeLessThan(EXPLORE_VIEW.keeperRadius * 3);
  });

  it('starts every hopper on the ground, followers gliding a little before their first hop', () => {
    const dt = 1 / FPS;
    const step = EXPLORE_VIEW.walkSpeed * dt;
    for (const offset of [0, ...EXPLORE_HOP.followerOffset]) {
      const hop = createHop(offset);
      stepHop(hop, step, dt, 1, false);
      const first = hopPose(hop, false, 1, { lift: 0, squash: 1 });
      // Never in the air on the first step: the Keeper crouches to take off,
      // a follower glides at rest.
      expect(first.lift).toBe(0);
      expect(first.squash).toBeLessThanOrEqual(1);
      if (offset > 0) expect(first.squash).toBe(1);
      // Off the ground only once it has glided its offset.
      let glided = step;
      while (hopPose(hop, false, 1, first).lift === 0 && glided < 1) {
        stepHop(hop, step, dt, 1, false);
        glided += step;
      }
      expect(glided).toBeGreaterThanOrEqual(offset * EXPLORE_HOP.stride.min);
    }
  });

  it("doesn't settle a follower that stopped before its first hop", () => {
    const [offset] = EXPLORE_HOP.followerOffset;
    const hop = createHop(offset);
    stepHop(hop, 0.001, 1 / FPS, 1, false);
    stepHop(hop, 0, 1 / FPS, 0, false);
    expect(hopActive(hop)).toBe(false);
    expect(hopPose(hop, false, 1, { lift: 1, squash: 2 })).toEqual({ lift: 0, squash: 1 });
  });
});
