import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { describe, expect, it } from 'vitest';
import { faceYaw } from './face-yaw.js';

/** Where a model's front (−z at yaw 0) points after Babylon turns it by `yaw`. */
function front(yaw: number): Vector3 {
  return new Vector3(0, 0, -1).rotateByQuaternionToRef(
    Quaternion.RotationAxis(Vector3.Up(), yaw),
    new Vector3(),
  );
}

describe('faceYaw', () => {
  it.each([
    ['+x', 1, 0],
    ['−x', -1, 0],
    ['+z', 0, 1],
    ['−z', 0, -1],
    ['a diagonal', 3, -4],
  ])('turns the front to face along %s', (_name, dx, dz) => {
    const len = Math.hypot(dx, dz);
    const f = front(faceYaw(dx, dz));
    expect(f.x).toBeCloseTo(dx / len, 6);
    expect(f.z).toBeCloseTo(dz / len, 6);
  });

  it('is 0 walking towards −z (the default camera)', () => {
    expect(faceYaw(0, -1)).toBeCloseTo(0, 6);
  });
});
