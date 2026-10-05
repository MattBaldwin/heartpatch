import { Animation } from '@babylonjs/core/Animations/animation';
import '@babylonjs/core/Animations/animatable';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateLathe } from '@babylonjs/core/Meshes/Builders/latheBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Scene } from '@babylonjs/core/scene';
import {
  armAngles,
  EYE_FLARE,
  HOLLOW_ARM,
  HOLLOW_HEM,
  HOLLOW_MAN,
  HOLLOW_MAN_PROFILE,
  VISIT_FPS,
  VISIT_KEYS,
  visitFrames,
} from './hollow-man-config.js';

// The Hollow Man (#21, design doc §14): one lathed silhouette with a ragged
// cloak, two long arms and two glowing eyes, all unlit, so he reads as a
// shadow at any light level. Three draw calls (body, both arms as thin
// instances of one mesh, eyes), built once per scene and hidden until he
// appears. On the map he never chases or comes close: he stands a little way
// off with his arms hanging, flickers, hesitates, and fades away. The opening
// cinematic (#46) poses him frame by frame and can raise his arms to reach,
// his eyes flaring as he does (owner decision 2026-10-04, "spooky-tense").

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

/**
 * The cloak's ragged hem: lifts the bottom edge between `tatters` soft
 * points, fading out up the cloak. Pure, on a flat xyz array (tested).
 */
export function raggedHem(positions: Float32Array | number[], height: number): void {
  const fade = HOLLOW_HEM.fade * height;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    if (y >= fade || (x === 0 && z === 0)) continue;
    const wave = 0.5 - 0.5 * Math.cos(Math.atan2(z, x) * HOLLOW_HEM.tatters);
    positions[i + 1] = y + HOLLOW_HEM.depth * height * wave * (1 - y / fade);
  }
}

/**
 * One arm's matrix at `reach`, in his own space (h: his height): from the
 * shoulder, rolled out from his side and pitched forward. Also where its
 * wrist ends up, for tests and effects.
 */
export function armMatrix(
  side: -1 | 1,
  reach: number,
  h: number,
  out = Matrix.Identity(),
): { matrix: Matrix; wrist: Vector3 } {
  const { roll, pitch } = armAngles(side, reach);
  const [sx, sy, sz] = HOLLOW_ARM.shoulder;
  Matrix.ComposeToRef(
    Vector3.OneReadOnly,
    Quaternion.RotationYawPitchRoll(0, pitch, roll),
    new Vector3(side * sx * h, sy * h, sz * h),
    out,
  );
  const wrist = Vector3.TransformCoordinates(new Vector3(0, -HOLLOW_ARM.length * h, 0), out);
  return { matrix: out, wrist };
}

/** A long, thin arm hanging down from the origin, with three long soft fingers. */
function buildArm(scene: Scene, h: number): Mesh {
  const length = HOLLOW_ARM.length * h;
  const [top, wrist] = HOLLOW_ARM.radius;
  const arm = CreateLathe(
    'hollow-man-arm-part',
    {
      shape: [
        new Vector3(0, top * h, 0),
        new Vector3(top * h, 0, 0),
        new Vector3(top * h * 0.85, -length * 0.45, 0),
        new Vector3(wrist * h, -length, 0),
        new Vector3(0, -length - wrist * h, 0),
      ],
      tessellation: 10,
      cap: Mesh.NO_CAP,
    },
    scene,
  );
  const fingers = [-1, 0, 1].map((k) => {
    const finger = CreateCylinder(
      'hollow-man-finger',
      {
        height: HOLLOW_ARM.fingerLength * h,
        diameterTop: wrist * h * 1.3,
        diameterBottom: wrist * h * 0.45,
        tessellation: 6,
      },
      scene,
    );
    const angle = k * HOLLOW_ARM.fingerSplay;
    const half = (HOLLOW_ARM.fingerLength * h) / 2;
    finger.rotation.z = angle;
    // Rolled by `angle`, a finger's tip points along (sin, −cos): its centre goes there too.
    finger.position.set(Math.sin(angle) * half, -length - Math.cos(angle) * half, 0);
    return finger;
  });
  const mesh = Mesh.MergeMeshes([arm, ...fingers], true);
  if (!mesh) throw new Error('could not build the Hollow Man');
  mesh.name = 'hollow-man-arms';
  return mesh;
}

export interface HollowManOptions {
  /** Image processing for his eyes, so they keep their glow through a colour drain (#46). */
  eyeImageProcessing?: ImageProcessingConfiguration;
}

export class HollowMan {
  readonly root: TransformNode;
  private readonly scene: Scene;
  private readonly body: Mesh;
  private readonly arms: Mesh;
  private readonly eyes: Mesh;
  private readonly bodyMaterial: StandardMaterial;
  private readonly eyeMaterial: StandardMaterial;
  private readonly eyeColor: Color3;
  private readonly flareColor: Color3;
  /** Both arms' instance matrices (read-only outside; tests read it). */
  readonly armData = new Float32Array(32);
  private readonly scratch = Matrix.Identity();
  private visiting = false;
  private ground = 0;
  private reach = -1;
  private flare = -1;

  constructor(scene: Scene, options: HollowManOptions = {}) {
    this.scene = scene;
    const h = HOLLOW_MAN.height;
    this.root = new TransformNode('hollow-man', scene);
    // Always turned to the camera, so his eyes are what you see.
    this.root.billboardMode = TransformNode.BILLBOARDMODE_Y;

    this.body = CreateLathe(
      'hollow-man-body',
      {
        shape: HOLLOW_MAN_PROFILE.map(([r, y]) => new Vector3(r * h, y * h, 0)),
        tessellation: 28,
        cap: Mesh.NO_CAP,
      },
      scene,
    );
    const positions = this.body.getVerticesData(VertexBuffer.PositionKind);
    if (positions) {
      raggedHem(positions, h);
      this.body.setVerticesData(VertexBuffer.PositionKind, positions);
    }
    this.bodyMaterial = unlit(scene, 'hollow-man-body-mat', HOLLOW_MAN.bodyColor);
    this.body.material = this.bodyMaterial;

    // Both arms are thin instances of one mesh: one draw call.
    this.arms = buildArm(scene, h);
    this.arms.material = this.bodyMaterial;
    this.arms.alwaysSelectAsActiveMesh = true;

    const eye = (side: number): Mesh => {
      const m = CreateSphere(
        'hollow-man-eye',
        { diameter: HOLLOW_MAN.eyeSize * h, segments: 8 },
        scene,
      );
      // In front of his face (the camera looks along +z), narrow and a little flattened.
      m.position.set(side * HOLLOW_MAN.eyeGap * h, HOLLOW_MAN.eyeHeight * h, -0.07 * h);
      m.scaling.set(1.25, 1.0, 0.6);
      return m;
    };
    const merged = Mesh.MergeMeshes([eye(-1), eye(1)], true);
    if (!merged) throw new Error('could not build the Hollow Man');
    this.eyes = merged;
    this.eyes.name = 'hollow-man-eyes';
    // Flaring grows the eyes where they are, not away from his face.
    this.eyes.setPivotPoint(new Vector3(0, HOLLOW_MAN.eyeHeight * h, -0.07 * h));
    this.eyeMaterial = unlit(scene, 'hollow-man-eye-mat', HOLLOW_MAN.eyeColor);
    if (options.eyeImageProcessing) {
      this.eyeMaterial.imageProcessingConfiguration = options.eyeImageProcessing;
    }
    this.eyes.material = this.eyeMaterial;
    this.eyeColor = this.eyeMaterial.emissiveColor.clone();
    this.flareColor = Color3.FromHexString(EYE_FLARE.color).toLinearSpace();

    for (const mesh of [this.body, this.arms, this.eyes]) {
      mesh.parent = this.root;
      mesh.isPickable = false;
    }
    this.setReach(0, 0);
    this.root.setEnabled(false);
  }

  /** True while a visit plays (the map draws every frame then). */
  get isVisiting(): boolean {
    return this.visiting;
  }

  /**
   * Plays one visit standing at `at` (a ground point), arms hanging, then
   * hides him again and calls `done`. A visit already playing is left to finish.
   */
  visit(at: { x: number; y: number; z: number }, done?: () => void): void {
    if (this.visiting) return;
    this.visiting = true;
    this.ground = at.y;
    this.root.position.set(at.x, at.y, at.z);
    this.root.scaling.setAll(1);
    this.setReach(0, 0);
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
   * `alpha` (0–1; 0 hides him), with his arms at `reach` (0 hanging, 1
   * reaching out and down) and his eyes flared by `flare` (0–1; pass 0 for
   * reduced motion), for a caller that drives him frame by frame (the
   * opening cinematic, #46). Not for use while a visit plays.
   */
  pose(
    at: { x: number; y: number; z: number },
    alpha: number,
    scale = 1,
    reach = 0,
    flare = 0,
  ): void {
    if (this.visiting) return;
    const visible = alpha > 0.001;
    this.root.setEnabled(visible);
    if (!visible) return;
    this.root.position.set(at.x, at.y, at.z);
    this.root.scaling.setAll(scale);
    this.bodyMaterial.alpha = alpha * HOLLOW_MAN.bodyAlpha;
    // The eyes come in after the body, so he's a shadow first.
    this.eyeMaterial.alpha = Math.min(1, Math.max(0, alpha * 1.6 - 0.6));
    this.setReach(reach, flare);
  }

  /** Raises both arms to `reach` and flares the eyes by `flare`; skips work when unchanged. */
  private setReach(reach: number, flare: number): void {
    const r = Math.round(Math.min(1, Math.max(0, reach)) * 1000) / 1000;
    const f = Math.round(Math.min(1, Math.max(0, flare)) * 1000) / 1000;
    if (r !== this.reach) {
      this.reach = r;
      const h = HOLLOW_MAN.height;
      armMatrix(-1, r, h, this.scratch).matrix.copyToArray(this.armData, 0);
      armMatrix(1, r, h, this.scratch).matrix.copyToArray(this.armData, 16);
      if (this.arms.thinInstanceCount === 0) {
        this.arms.thinInstanceSetBuffer('matrix', this.armData, 16, false);
      } else {
        this.arms.thinInstanceBufferUpdated('matrix');
      }
    }
    if (f !== this.flare) {
      this.flare = f;
      this.eyes.scaling.setAll(1 + (EYE_FLARE.scale - 1) * f);
      Color3.LerpToRef(this.eyeColor, this.flareColor, f, this.eyeMaterial.emissiveColor);
      this.eyeMaterial.emissiveColor.scaleInPlace(1 + (EYE_FLARE.brightness - 1) * f);
    }
  }

  dispose(): void {
    this.visiting = false;
    this.root.dispose(false, true);
  }
}
