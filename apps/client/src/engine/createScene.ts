import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { hardwareScalingFor } from './dpr.js';

/**
 * Placeholder engine and empty scene. Render quality (WebGPU, AA, dynamic
 * resolution) and the touch camera arrive in #6.
 */
export function createEngineAndScene(canvas: HTMLCanvasElement): { engine: Engine; scene: Scene } {
  const engine = new Engine(canvas, true, { stencil: true }, false);
  engine.setHardwareScalingLevel(hardwareScalingFor(window.devicePixelRatio));

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 2,
    Math.PI / 3,
    10,
    Vector3.Zero(),
    scene,
  );
  camera.attachControl(canvas, true);
  new HemisphericLight('light', new Vector3(0, 1, 0), scene);

  return { engine, scene };
}
