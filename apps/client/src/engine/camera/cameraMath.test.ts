import { describe, expect, it } from 'vitest';
import {
  cameraBasis,
  cameraPosition,
  clampDistance,
  clampTarget,
  groundAt,
  releaseVelocity,
  stepInertia,
  toNdc,
  wheelZoomFactor,
  zoomAbout,
  type Bounds,
  type CameraPose,
  type InertiaState,
} from './cameraMath.js';

const pose: CameraPose = {
  target: { x: 3, z: -2 },
  distance: 20,
  pitch: (58 * Math.PI) / 180,
  yaw: 0,
  fov: 0.75,
  aspect: 390 / 844,
};
const bounds: Bounds = { minX: -10, maxX: 10, minZ: -8, maxZ: 8 };

describe('camera basis and position', () => {
  it('looks north and down, with an orthonormal basis', () => {
    const { forward, right, up } = cameraBasis(pose.pitch, 0);
    expect(forward.z).toBeGreaterThan(0);
    expect(forward.y).toBeLessThan(0);
    expect(right).toEqual({ x: 1, y: 0, z: -0 });
    expect(up.y).toBeGreaterThan(0);
    const dot = forward.x * up.x + forward.y * up.y + forward.z * up.z;
    expect(dot).toBeCloseTo(0, 10);
  });

  it('sits `distance` away from the target, above the ground', () => {
    const p = cameraPosition(pose);
    expect(Math.hypot(p.x - 3, p.y, p.z + 2)).toBeCloseTo(20, 10);
    expect(p.y).toBeCloseTo(20 * Math.sin(pose.pitch), 10);
    expect(p.z).toBeLessThan(-2);
  });
});

describe('groundAt', () => {
  it('hits the target at the centre of the screen', () => {
    const g = groundAt(pose, 0, 0)!;
    expect(g.x).toBeCloseTo(3, 10);
    expect(g.z).toBeCloseTo(-2, 10);
  });

  it('maps up the screen to further north and right to east', () => {
    const top = groundAt(pose, 0, 0.8)!;
    const right = groundAt(pose, 0.8, 0)!;
    expect(top.z).toBeGreaterThan(-2);
    expect(right.x).toBeGreaterThan(3);
  });

  it('returns null for a ray above the horizon', () => {
    expect(groundAt({ ...pose, pitch: 0.1 }, 0, 1)).toBeNull();
  });

  it('converts CSS pixels to NDC', () => {
    expect(toNdc(0, 0, 400, 800)).toEqual({ x: -1, y: 1 });
    expect(toNdc(200, 400, 400, 800)).toEqual({ x: 0, y: 0 });
  });
});

describe('panning keeps the ground under the finger', () => {
  it('moves the target by the ground delta between two finger positions', () => {
    const a = groundAt(pose, -0.2, -0.3)!;
    const b = groundAt(pose, 0.1, 0.2)!;
    const moved = {
      ...pose,
      target: { x: pose.target.x + a.x - b.x, z: pose.target.z + a.z - b.z },
    };
    const under = groundAt(moved, 0.1, 0.2)!;
    expect(under.x).toBeCloseTo(a.x, 10);
    expect(under.z).toBeCloseTo(a.z, 10);
  });
});

describe('zoomAbout (pinch)', () => {
  it('keeps the anchor at the same screen point after zooming', () => {
    const ndc = { x: 0.4, y: -0.5 };
    const anchor = groundAt(pose, ndc.x, ndc.y)!;
    for (const newDistance of [8, 15, 35]) {
      const target = zoomAbout(pose.target, anchor, pose.distance, newDistance);
      const after = groundAt({ ...pose, target, distance: newDistance }, ndc.x, ndc.y)!;
      expect(after.x).toBeCloseTo(anchor.x, 9);
      expect(after.z).toBeCloseTo(anchor.z, 9);
    }
  });

  it('is a no-op zooming about the target itself', () => {
    expect(zoomAbout({ x: 1, z: 2 }, { x: 1, z: 2 }, 10, 5)).toEqual({ x: 1, z: 2 });
  });
});

describe('bounds', () => {
  it('clamps the target into the map', () => {
    expect(clampTarget({ x: 50, z: -50 }, bounds)).toEqual({ x: 10, z: -8 });
    expect(clampTarget({ x: 1, z: 2 }, bounds)).toEqual({ x: 1, z: 2 });
  });

  it('clamps zoom distance, treating NaN as fully zoomed out', () => {
    expect(clampDistance(2, 7, 38)).toBe(7);
    expect(clampDistance(100, 7, 38)).toBe(38);
    expect(clampDistance(Number.NaN, 7, 38)).toBe(38);
  });
});

describe('stepInertia', () => {
  const start: InertiaState = { target: { x: 0, z: 0 }, velocity: { x: 4, z: 2 } };
  const glide = (fps: number, seconds: number) => {
    let s = start;
    for (let i = 0; i < fps * seconds; i++) s = stepInertia(s, 1 / fps, 0.3, 0, bounds);
    return s;
  };

  it('glides the same distance at 30, 60 and 120 fps', () => {
    const a = glide(30, 1);
    const b = glide(60, 1);
    const c = glide(120, 1);
    expect(b.target.x).toBeCloseTo(a.target.x, 9);
    expect(c.target.x).toBeCloseTo(a.target.x, 9);
    expect(c.target.z).toBeCloseTo(a.target.z, 9);
  });

  it('converges to v·tau and slows down', () => {
    const s = glide(60, 5);
    expect(s.target.x).toBeCloseTo(4 * 0.3, 3);
    expect(Math.abs(s.velocity.x)).toBeLessThan(0.01);
  });

  it('stops below the stop speed', () => {
    let s = start;
    for (let i = 0; i < 600 && (s.velocity.x !== 0 || s.velocity.z !== 0); i++) {
      s = stepInertia(s, 1 / 60, 0.3, 0.05, bounds);
    }
    expect(s.velocity).toEqual({ x: 0, z: 0 });
  });

  it('stops the axis that hits a bound but keeps sliding along the other', () => {
    const s = stepInertia(
      { target: { x: 9.9, z: 0 }, velocity: { x: 10, z: 3 } },
      1 / 60,
      0.3,
      0,
      bounds,
    );
    expect(s.target.x).toBe(10);
    expect(s.velocity.x).toBe(0);
    expect(s.velocity.z).toBeGreaterThan(0);
  });

  it('returns the same state when at rest', () => {
    const rest: InertiaState = { target: { x: 1, z: 1 }, velocity: { x: 0, z: 0 } };
    expect(stepInertia(rest, 1 / 60, 0.3, 0, bounds)).toBe(rest);
  });
});

describe('releaseVelocity', () => {
  const samples = [
    { t: 0, p: { x: 0, z: 0 } },
    { t: 100, p: { x: 1, z: 0 } },
    { t: 150, p: { x: 2, z: 1 } },
    { t: 200, p: { x: 3, z: 2 } },
  ];

  it('uses only the most recent samples', () => {
    const v = releaseVelocity(samples, 200, 100, 0, 1000);
    expect(v.x).toBeCloseTo(20, 9);
    expect(v.z).toBeCloseTo(20, 9);
  });

  it('gives no fling when the finger rested before lifting', () => {
    expect(releaseVelocity(samples, 500, 100, 0, 1000)).toEqual({ x: 0, z: 0 });
  });

  it('ignores slow drags and caps wild flicks', () => {
    expect(releaseVelocity(samples, 200, 100, 50, 1000)).toEqual({ x: 0, z: 0 });
    const v = releaseVelocity(samples, 200, 100, 0, 10);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(10, 9);
  });

  it('handles empty and single-sample input', () => {
    expect(releaseVelocity([], 0, 100, 0, 10)).toEqual({ x: 0, z: 0 });
    expect(releaseVelocity([samples[0]!], 0, 100, 0, 10)).toEqual({ x: 0, z: 0 });
  });
});

describe('wheelZoomFactor', () => {
  it('zooms out for positive deltas and back in symmetrically', () => {
    expect(wheelZoomFactor(100, 1.15)).toBeCloseTo(1.15);
    expect(wheelZoomFactor(100, 1.15) * wheelZoomFactor(-100, 1.15)).toBeCloseTo(1);
  });
});
