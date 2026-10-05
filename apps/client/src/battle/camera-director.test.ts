import { describe, expect, it } from 'vitest';
import { BATTLE_CAMERA } from './battle-config.js';
import { CameraDirector, frameDistance, shakeOffset } from './camera-director.js';
import type { CameraCue } from './choreography.js';

const homes = { a: { x: -2, z: -3 }, b: { x: 2, z: 3 } };
const cue = (extra: Partial<CameraCue> = {}): CameraCue => ({
  focus: null,
  push: 0,
  pushDelay: 0,
  shake: 0,
  shakeDelay: 0,
  ...extra,
});
const distance = (shot: ReturnType<CameraDirector['shot']>) =>
  Math.hypot(
    shot.position.x - shot.target.x,
    shot.position.y - shot.target.y,
    shot.position.z - shot.target.z,
  );

describe('frameDistance', () => {
  it('backs off on a narrow portrait screen so the fight fits across', () => {
    expect(frameDistance(393 / 659)).toBeGreaterThan(frameDistance(1194 / 834));
  });
});

describe('shakeOffset', () => {
  it('wobbles, then dies away', () => {
    const early = shakeOffset(0.2, 30);
    expect(Math.abs(early.x) + Math.abs(early.y)).toBeGreaterThan(0);
    expect(shakeOffset(0.2, 2000)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(0, 30)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(0.2, -10)).toEqual({ x: 0, y: 0 });
  });
});

describe('CameraDirector', () => {
  it('frames both fighters at rest, looking at the fight from the front', () => {
    const director = new CameraDirector(homes, false);
    const shot = director.shot(0, 0.6);
    expect(shot.target).toEqual(BATTLE_CAMERA.aim);
    expect(shot.position.z).toBeLessThan(shot.target.z);
    expect(shot.position.y).toBeGreaterThan(shot.target.y);
    expect(shot.shift).toBe(BATTLE_CAMERA.lensShift);
  });

  it('leans towards the fighter a step is about, pushes in on a hit, and shakes', () => {
    const director = new CameraDirector(homes, false);
    const rest = distance(director.shot(0, 0.6));
    director.cue(cue({ focus: 'b', push: 0.15, shake: 0.2 }), 1000);
    const hit = director.shot(1030, 0.6);
    expect(hit.target.x).not.toBe(BATTLE_CAMERA.aim.x); // shaking
    for (let t = 1030; t < 3000; t += 16) director.shot(t, 0.6);
    const settled = director.shot(3000, 0.6);
    expect(distance(settled)).toBeLessThan(rest);
    expect(settled.target.x).toBeGreaterThan(BATTLE_CAMERA.aim.x); // towards b
    expect(director.moving(3000)).toBe(false);
    director.rest();
    for (let t = 3000; t < 5000; t += 16) director.shot(t, 0.6);
    expect(distance(director.shot(5000, 0.6))).toBeCloseTo(rest, 2);
  });

  it('with reduced motion: never shakes or pushes in, and leans only a little', () => {
    const director = new CameraDirector(homes, true);
    const rest = distance(director.shot(0, 0.6));
    director.cue(cue({ focus: 'b', push: 0.15, shake: 0.3 }), 1000);
    for (let t = 1000; t < 1200; t += 16) {
      const shot = director.shot(t, 0.6);
      expect(shot.target.y).toBe(BATTLE_CAMERA.aim.y);
      expect(distance(shot)).toBeCloseTo(rest, 5);
    }
    const full = new CameraDirector(homes, false);
    full.cue(cue({ focus: 'b' }), 1000);
    for (let t = 1000; t < 4000; t += 16) full.shot(t, 0.6);
    expect(director.shot(4000, 0.6).target.x).toBeLessThan(full.shot(4000, 0.6).target.x);
  });

  it('reuses its result (no allocation per frame)', () => {
    const director = new CameraDirector(homes, false);
    expect(director.shot(0, 0.6)).toBe(director.shot(16, 0.6));
  });
});
