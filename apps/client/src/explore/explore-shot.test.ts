import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { writeShot } from './explore-scene.js';

const engine = new NullEngine({
  renderWidth: 400,
  renderHeight: 800,
  textureSize: 64,
  deterministicLockstep: false,
  lockstepMaxSteps: 4,
});
afterEach(() => {
  engine.scenes.forEach((s) => {
    s.dispose();
  });
});

/** Where a point lands on a 400×800 screen through the camera's matrices as they stand. */
function onScreen(camera: TargetCamera, p: Vector3): Vector3 {
  return Vector3.Project(
    p,
    Matrix.IdentityReadOnly,
    camera.getTransformationMatrix(),
    new Viewport(0, 0, 400, 800),
  );
}

describe('writeShot', () => {
  it('projects with the new shot at once, not the last frame’s (#335)', () => {
    const scene = new Scene(engine);
    // Like the stage: the camera starts far off (the map's view) and draws a frame there.
    const camera = new TargetCamera('cam', new Vector3(0, 20, -12), scene);
    camera.setTarget(Vector3.Zero());
    scene.render();

    const head = new Vector3(0, 0.8, 0);
    writeShot(camera, new Vector3(0, 0.5, 0), (28 * Math.PI) / 180, 7.5);
    const now = onScreen(camera, head);
    scene.render();
    const drawn = onScreen(camera, head);
    expect(now.x).toBeCloseTo(drawn.x, 3);
    expect(now.y).toBeCloseTo(drawn.y, 3);
  });

  it('looks along +z, down by the pitch, from the distance', () => {
    const scene = new Scene(engine);
    const camera = new TargetCamera('cam', Vector3.Zero(), scene);
    const pitch = (30 * Math.PI) / 180;
    writeShot(camera, new Vector3(1, 0, 2), pitch, 10);
    expect(camera.position.x).toBeCloseTo(1);
    expect(camera.position.y).toBeCloseTo(Math.sin(pitch) * 10);
    expect(camera.position.z).toBeCloseTo(2 - Math.cos(pitch) * 10);
  });
});
