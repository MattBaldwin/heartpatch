import { Animation } from '@babylonjs/core/Animations/animation';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { VINYL } from '../config.js';
import type { Rgb } from '../params.js';
import { SPROUT } from './sprout-config.js';
import { sproutParams, type SproutParams } from './sprout-params.js';

/** Where Sprout floats, on the ground plane. */
export interface SproutSpot {
  readonly x: number;
  readonly z: number;
}

const DEG = Math.PI / 180;

const linear = (c: Rgb) => new Color3(c[0], c[1], c[2]).toLinearSpace();

function vinyl(scene: Scene, name: string, color: Rgb): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = linear(color);
  m.metallic = 0;
  m.roughness = VINYL.roughness;
  m.clearCoat.isEnabled = true;
  m.clearCoat.intensity = VINYL.clearCoatIntensity;
  m.clearCoat.roughness = VINYL.clearCoatRoughness;
  return m;
}

/** A soft warm glow behind Sprout: one billboard quad with a radial texture. */
function haloMaterial(scene: Scene, color: Rgb): PBRMaterial {
  const size = 64;
  const texture = new DynamicTexture('sprout-halo', { width: size, height: size }, scene, true);
  const ctx = texture.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.update();

  const m = new PBRMaterial('sprout-halo-mat', scene);
  m.unlit = true;
  m.albedoColor = linear(color);
  m.albedoTexture = texture;
  m.useAlphaFromAlbedoTexture = true;
  m.disableDepthWrite = true;
  return m;
}

/** Thin instances of `mesh` at each of `matrices` (one draw call for all of them). */
function instance(mesh: Mesh, matrices: readonly Matrix[]): void {
  matrices.forEach((m, i) => {
    mesh.thinInstanceAdd(m, i === matrices.length - 1);
  });
}

/**
 * Sprout in the scene: a glowing seed body with a face and a little leaf
 * sprout, a few meshes and five shared materials (eyes, cheeks and leaves
 * are thin instances). It floats still, so an idle scene stays idle; it only
 * hops (a short Babylon animation, which keeps the render loop drawing just
 * for its length) when it has something to say.
 */
export class SproutActor {
  readonly params: SproutParams;
  private readonly root: TransformNode;
  private readonly scene: Scene;
  private readonly hopAnimation: Animation;

  constructor(scene: Scene, ownerId: string, spot: SproutSpot) {
    this.scene = scene;
    this.params = sproutParams(ownerId);
    const p = this.params;
    const r = SPROUT.size / 2;

    this.root = new TransformNode('sprout', scene);
    this.root.position.set(spot.x, SPROUT.floatHeight, spot.z);

    const bodyMat = vinyl(scene, 'sprout-body', p.body);
    bodyMat.emissiveColor = linear(p.body).scale(p.glow);
    const inkMat = vinyl(scene, 'sprout-ink', p.ink);
    const blushMat = vinyl(scene, 'sprout-blush', p.blush);
    blushMat.alpha = 0.85;
    const leafMat = vinyl(scene, 'sprout-leaf', p.leaf);

    const body = CreateSphere('sprout-body', { diameter: SPROUT.size, segments: 32 }, scene);
    body.scaling.y = p.squash;
    body.material = bodyMat;
    body.parent = this.root;

    // Face on the side towards the map camera (−z), tipped up a little since
    // the camera looks down on it.
    const faceZ = -r * 0.9;
    const eyes = CreateSphere('sprout-eyes', { diameter: r * 0.28, segments: 12 }, scene);
    eyes.material = inkMat;
    eyes.parent = this.root;
    const eyeScale = new Vector3(0.8, 1.15, 0.6);
    instance(eyes, [
      Matrix.Compose(eyeScale, Quaternion.Identity(), new Vector3(-r * 0.3, r * 0.3, faceZ)),
      Matrix.Compose(eyeScale, Quaternion.Identity(), new Vector3(r * 0.3, r * 0.3, faceZ)),
    ]);

    const cheeks = CreateSphere('sprout-cheeks', { diameter: r * 0.3, segments: 12 }, scene);
    cheeks.material = blushMat;
    cheeks.parent = this.root;
    const cheekScale = new Vector3(1.2, 0.7, 0.35);
    instance(cheeks, [
      Matrix.Compose(cheekScale, Quaternion.Identity(), new Vector3(-r * 0.55, 0, -r * 0.82)),
      Matrix.Compose(cheekScale, Quaternion.Identity(), new Vector3(r * 0.55, 0, -r * 0.82)),
    ]);

    const top = r * p.squash;
    const stem = CreateCylinder(
      'sprout-stem',
      { height: r * 0.4, diameterTop: r * 0.08, diameterBottom: r * 0.14, tessellation: 10 },
      scene,
    );
    stem.material = leafMat;
    stem.position.y = top + r * 0.12;
    stem.parent = this.root;

    const leaves = CreateSphere('sprout-leaves', { diameter: r * 0.6, segments: 12 }, scene);
    leaves.material = leafMat;
    leaves.parent = this.root;
    const leafScale = new Vector3(1, 0.28, 0.55);
    const splay = p.leafSplayDeg * DEG;
    const leafY = top + r * 0.3;
    instance(leaves, [
      Matrix.Compose(
        leafScale,
        Quaternion.RotationYawPitchRoll(0, 0, splay),
        new Vector3(-r * 0.24, leafY, 0),
      ),
      Matrix.Compose(
        leafScale,
        Quaternion.RotationYawPitchRoll(0, 0, -splay),
        new Vector3(r * 0.24, leafY, 0),
      ),
    ]);

    const halo = CreatePlane('sprout-halo', { size: SPROUT.size * SPROUT.haloScale }, scene);
    halo.material = haloMaterial(scene, p.body);
    halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
    halo.isPickable = false;
    halo.parent = this.root;

    for (const mesh of [body, eyes, cheeks, stem, leaves]) mesh.isPickable = false;

    const fps = 60;
    const frames = Math.round(SPROUT.hop.seconds * fps);
    const lift = SPROUT.hop.height * SPROUT.size;
    this.hopAnimation = new Animation(
      'sprout-hop',
      'position.y',
      fps,
      Animation.ANIMATIONTYPE_FLOAT,
    );
    const y = SPROUT.floatHeight;
    this.hopAnimation.setKeys([
      { frame: 0, value: y },
      { frame: Math.round(frames * 0.4), value: y + lift },
      { frame: Math.round(frames * 0.75), value: y - lift * 0.15 },
      { frame: frames, value: y },
    ]);
  }

  /** Floats over another spot (e.g. the Heart Seed once the Glade is drawn). */
  moveTo(spot: SproutSpot): void {
    this.root.position.x = spot.x;
    this.root.position.z = spot.z;
  }

  /** A happy little hop: Sprout has something to say. */
  hop(): void {
    const frames = this.hopAnimation.getHighestFrame();
    this.scene.stopAnimation(this.root);
    this.scene.beginDirectAnimation(this.root, [this.hopAnimation], 0, frames, false);
  }

  dispose(): void {
    this.scene.stopAnimation(this.root);
    this.root.dispose(false, true);
  }
}
