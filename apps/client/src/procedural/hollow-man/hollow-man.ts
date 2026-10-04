import { Animation } from '@babylonjs/core/Animations/animation';
import '@babylonjs/core/Animations/animatable';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateLathe } from '@babylonjs/core/Meshes/Builders/latheBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import {
  HOLLOW_MAN,
  HOLLOW_MAN_PROFILE,
  VISIT_FPS,
  VISIT_KEYS,
  visitFrames,
} from './hollow-man-config.js';

// The Hollow Man (#21, design doc §14): one lathed silhouette and two glowing
// eyes, all unlit, so he reads as a shadow at any light level. Two draw
// calls, built once per map scene and hidden until a visit. He never speaks,
// never chases, never comes close: he stands a little way off, flickers,
// hesitates, and fades away.

function unlit(scene: Scene, name: string, color: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.emissiveColor = Color3.FromHexString(color).toLinearSpace();
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  m.alphaMode = Constants.ALPHA_COMBINE;
  m.alpha = 0;
  return m;
}

function floatAnimation(
  name: string,
  property: string,
  keys: readonly (readonly [number, number])[],
): Animation {
  const animation = new Animation(
    name,
    property,
    VISIT_FPS,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CONSTANT,
  );
  animation.setKeys(keys.map(([frame, value]) => ({ frame, value })));
  return animation;
}

export class HollowMan {
  readonly root: TransformNode;
  private readonly scene: Scene;
  private readonly body: Mesh;
  private readonly eyes: Mesh;
  private readonly bodyMaterial: StandardMaterial;
  private readonly eyeMaterial: StandardMaterial;
  private visiting = false;
  private ground = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    const h = HOLLOW_MAN.height;
    this.root = new TransformNode('hollow-man', scene);
    // Always turned to the camera, so his eyes are what you see.
    this.root.billboardMode = TransformNode.BILLBOARDMODE_Y;

    this.body = CreateLathe(
      'hollow-man-body',
      {
        shape: HOLLOW_MAN_PROFILE.map(([r, y]) => new Vector3(r * h, y * h, 0)),
        tessellation: 24,
        cap: Mesh.NO_CAP,
      },
      scene,
    );
    this.bodyMaterial = unlit(scene, 'hollow-man-body-mat', HOLLOW_MAN.bodyColor);
    this.body.material = this.bodyMaterial;

    const eye = (side: number): Mesh => {
      const m = CreateSphere(
        'hollow-man-eye',
        { diameter: HOLLOW_MAN.eyeSize * h, segments: 8 },
        scene,
      );
      // In front of his face (the camera looks along +z), a little flattened.
      m.position.set(side * HOLLOW_MAN.eyeGap * h, HOLLOW_MAN.eyeHeight * h, -0.075 * h);
      m.scaling.set(1, 1.35, 0.6);
      return m;
    };
    const merged = Mesh.MergeMeshes([eye(-1), eye(1)], true);
    if (!merged) throw new Error('could not build the Hollow Man');
    this.eyes = merged;
    this.eyes.name = 'hollow-man-eyes';
    this.eyeMaterial = unlit(scene, 'hollow-man-eye-mat', HOLLOW_MAN.eyeColor);
    this.eyes.material = this.eyeMaterial;

    for (const mesh of [this.body, this.eyes]) {
      mesh.parent = this.root;
      mesh.isPickable = false;
    }
    this.root.setEnabled(false);
  }

  /** True while a visit plays (the map draws every frame then). */
  get isVisiting(): boolean {
    return this.visiting;
  }

  /**
   * Plays one visit standing at `at` (a ground point), then hides him again
   * and calls `done`. A visit already playing is left
   * to finish.
   */
  visit(at: { x: number; y: number; z: number }, done?: () => void): void {
    if (this.visiting) return;
    this.visiting = true;
    this.ground = at.y;
    this.root.position.set(at.x, at.y, at.z);
    this.root.setEnabled(true);
    const last = visitFrames();
    const finish = () => {
      if (!this.visiting) return;
      this.visiting = false;
      this.root.setEnabled(false);
      done?.();
    };
    const bodyAlpha = VISIT_KEYS.bodyAlpha.map(([f, v]) => [f, v * HOLLOW_MAN.bodyAlpha] as const);
    this.scene.beginDirectAnimation(
      this.bodyMaterial,
      [floatAnimation('hollow-man-fade', 'alpha', bodyAlpha)],
      0,
      last,
      false,
      1,
      finish,
    );
    this.scene.beginDirectAnimation(
      this.eyeMaterial,
      [floatAnimation('hollow-man-eyes', 'alpha', VISIT_KEYS.eyeAlpha)],
      0,
      last,
      false,
    );
    this.scene.beginDirectAnimation(
      this.root,
      [
        floatAnimation(
          'hollow-man-rise',
          'position.y',
          VISIT_KEYS.rise.map(([f, v]) => [f, this.ground + v] as const),
        ),
      ],
      0,
      last,
      false,
    );
  }

  /**
   * Stands him at `at` (a ground point), `scale` times his size, faded to
   * `alpha` (0–1; 0 hides him), for a caller that drives him frame by frame
   * (the opening cinematic, #46). Not for use while a visit plays.
   */
  pose(at: { x: number; y: number; z: number }, alpha: number, scale = 1): void {
    if (this.visiting) return;
    const visible = alpha > 0.001;
    this.root.setEnabled(visible);
    if (!visible) return;
    this.root.position.set(at.x, at.y, at.z);
    this.root.scaling.setAll(scale);
    this.bodyMaterial.alpha = alpha * HOLLOW_MAN.bodyAlpha;
    // The eyes come in after the body, so he's a shadow first.
    this.eyeMaterial.alpha = Math.min(1, Math.max(0, alpha * 1.6 - 0.6));
  }

  dispose(): void {
    this.visiting = false;
    this.root.dispose(false, true);
  }
}
