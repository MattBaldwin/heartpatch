import { describe, expect, it } from 'vitest';
import { BATTLE_CAMERA, HOMES } from './battle-config.js';
import { CameraDirector, frameDistance, shakeOffset, type FitPoint } from './camera-director.js';

const homes = { a: HOMES.mine, b: HOMES.theirs } as const;
const safe = { top: 0.12, bottom: 0.65 };
const fit: FitPoint[] = [
  { x: HOMES.mine.x, z: HOMES.mine.z, r: 1.6, h: 3.6 },
  { x: HOMES.theirs.x, z: HOMES.theirs.z, r: 1.6, h: 3.6 },
];
const cue = {
  focus: 'b' as const,
  push: 0.1,
  pushDelay: 0,
  shake: 0.12,
  shakeDelay: 0,
  roll: 0.02,
};

describe('frameDistance', () => {
  it('backs off further on a phone than on a landscape iPad, and keeps the aim at feetY', () => {
    const phone = frameDistance(390 / 844, safe, fit);
    const tablet = frameDistance(1180 / 820, safe, fit);
    expect(phone.distance).toBeGreaterThan(tablet.distance);
    expect(phone.shift).toBeCloseTo(1 - 2 * BATTLE_CAMERA.feetY, 6);
  });

  it('backs off more when the safe region shrinks or a fit point grows', () => {
    const roomy = frameDistance(1, safe, fit).distance;
    const tight = frameDistance(1, { top: 0.25, bottom: 0.65 }, fit).distance;
    expect(tight).toBeGreaterThan(roomy);
    const far = frameDistance(1, safe, [
      ...fit,
      { x: HOMES.theirs.x - 3, z: HOMES.theirs.z, r: 1.6, h: 3.6 },
    ]).distance;
    expect(far).toBeGreaterThanOrEqual(roomy);
  });
});

describe('shakeOffset', () => {
  it('dies away and is nothing before it starts', () => {
    expect(shakeOffset(0.2, -5)).toEqual({ x: 0, y: 0 });
    const early = Math.hypot(shakeOffset(0.2, 20).x, shakeOffset(0.2, 20).y);
    expect(early).toBeGreaterThan(0);
    expect(shakeOffset(0.2, 2000)).toEqual({ x: 0, y: 0 });
  });
});

describe('CameraDirector', () => {
  it('looks at the fight from a low angle, above the ground', () => {
    const cam = new CameraDirector(homes, false);
    const shot = cam.shot(0, 390 / 844, safe, fit);
    expect(shot.position.y).toBeGreaterThan(shot.target.y);
    expect(shot.position.z).toBeLessThan(shot.target.z);
    expect(shot.fov).toBe(BATTLE_CAMERA.fov);
    expect(shot.up).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('leans towards the fighter a step is about and pushes in on a hit, then relaxes', () => {
    const cam = new CameraDirector(homes, false);
    const rest = { ...cam.shot(0, 1, safe, fit).target };
    const restDistance = cam.shot(0, 1, safe, fit).distance;
    cam.cue(cue, 0);
    let shot = cam.shot(16, 1, safe, fit);
    for (let t = 32; t <= 600; t += 16) shot = cam.shot(t, 1, safe, fit);
    expect(shot.target.x).toBeGreaterThan(rest.x);
    expect(shot.distance).toBeLessThan(restDistance);
    expect(cam.moving(600)).toBe(true);
    const pushed = shot.distance;
    for (let t = 616; t <= 4000; t += 16) shot = cam.shot(t, 1, safe, fit);
    expect(shot.distance).toBeGreaterThan(pushed);
    cam.rest();
    for (let t = 4016; t <= 6000; t += 16) shot = cam.shot(t, 1, safe, fit);
    expect(shot.target.x).toBeCloseTo(rest.x, 2);
    expect(cam.moving(6000)).toBe(false);
  });

  it('shakes and rolls on impact, then settles', () => {
    const cam = new CameraDirector(homes, false);
    cam.cue(cue, 1000);
    const shot = cam.shot(1020, 1, safe, fit);
    expect(shot.up.x).not.toBe(0);
    expect(
      Math.abs(shot.target.x - (BATTLE_CAMERA.aim.x + 0)) +
        Math.abs(shot.target.y - BATTLE_CAMERA.aim.y),
    ).toBeGreaterThan(0);
    for (let t = 1040; t <= 3000; t += 16) cam.shot(t, 1, safe, fit);
    expect(cam.shot(3000, 1, safe, fit).up.x).toBeCloseTo(0, 6);
  });

  it('never shakes, rolls or pushes with reduced motion, and leans only a little', () => {
    const cam = new CameraDirector(homes, true);
    const restDistance = cam.shot(0, 1, safe, fit).distance;
    cam.cue(cue, 0);
    const shot = cam.shot(16, 1, safe, fit);
    expect(shot.up).toEqual({ x: 0, y: 1, z: 0 });
    expect(shot.distance).toBe(restDistance);
    expect(shot.target.y).toBe(BATTLE_CAMERA.aim.y);
    expect(shot.target.x - BATTLE_CAMERA.aim.x).toBeLessThan(BATTLE_CAMERA.focusShift);
  });

  it('reuses its shot object (no per-frame garbage)', () => {
    const cam = new CameraDirector(homes, false);
    expect(cam.shot(0, 1, safe, fit)).toBe(cam.shot(16, 1, safe, fit));
  });
});
