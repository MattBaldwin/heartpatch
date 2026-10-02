import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { SceneContent } from '../engine/stage.js';

/**
 * Placeholder scene for judging sharpness, lighting and camera feel: a few
 * rounded pastel vinyl-toy shapes on a soft island. Real map content is #7.
 */

const ISLAND_RADIUS = 22;

const PASTELS = {
  pink: '#ffb3c7',
  peach: '#ffc9a3',
  butter: '#ffe79a',
  mint: '#a8e6c9',
  sky: '#a9cdf7',
  lilac: '#cdb6f4',
} as const;

type Pastel = keyof typeof PASTELS;

interface Placement {
  readonly shape: 'blob' | 'capsule' | 'donut' | 'mushroom';
  readonly color: Pastel;
  readonly x: number;
  readonly z: number;
  readonly size: number;
}

/** Hand-placed so the scene is the same on every load. */
const PLACEMENTS: readonly Placement[] = [
  { shape: 'blob', color: 'pink', x: 0, z: 0, size: 2.2 },
  { shape: 'capsule', color: 'sky', x: -4, z: 2.5, size: 1.6 },
  { shape: 'donut', color: 'butter', x: 4.5, z: 1.5, size: 1.8 },
  { shape: 'mushroom', color: 'lilac', x: -2.5, z: -4, size: 1.7 },
  { shape: 'blob', color: 'mint', x: 3, z: -4.5, size: 1.5 },
  { shape: 'blob', color: 'peach', x: -7.5, z: -2, size: 1.3 },
  { shape: 'capsule', color: 'pink', x: 8, z: -2, size: 1.2 },
  { shape: 'donut', color: 'lilac', x: -8, z: 7, size: 1.4 },
  { shape: 'mushroom', color: 'peach', x: 7.5, z: 7.5, size: 1.5 },
  { shape: 'blob', color: 'sky', x: 0.5, z: 9, size: 1.8 },
  { shape: 'capsule', color: 'mint', x: -12, z: 3, size: 1.4 },
  { shape: 'blob', color: 'butter', x: 12.5, z: 3.5, size: 1.6 },
  { shape: 'mushroom', color: 'mint', x: 0, z: -11, size: 1.9 },
  { shape: 'donut', color: 'sky', x: -6, z: -11, size: 1.2 },
  { shape: 'blob', color: 'lilac', x: 6.5, z: -11.5, size: 1.4 },
  { shape: 'capsule', color: 'butter', x: -14, z: -8, size: 1.3 },
  { shape: 'blob', color: 'pink', x: 14, z: -9, size: 1.2 },
  { shape: 'donut', color: 'peach', x: 3, z: 15, size: 1.3 },
];

function vinyl(scene: Scene, name: string, hex: string): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.FromHexString(hex).toLinearSpace();
  m.metallic = 0;
  m.roughness = 0.42; // TUNE
  // Glossy coat over a softer base: the soft-vinyl toy look (design doc §19).
  m.clearCoat.isEnabled = true;
  m.clearCoat.intensity = 0.9;
  m.clearCoat.roughness = 0.2; // TUNE: broader, softer highlight
  return m;
}

function buildShape(scene: Scene, p: Placement, mat: PBRMaterial, i: number): Mesh[] {
  const name = `${p.shape}-${i}`;
  const s = p.size;
  switch (p.shape) {
    case 'blob': {
      const m = CreateSphere(name, { diameter: s, segments: 48 }, scene);
      m.scaling.set(1.1, 0.85, 1);
      m.position.set(p.x, s * 0.42, p.z);
      m.material = mat;
      return [m];
    }
    case 'capsule': {
      const m = CreateCapsule(
        name,
        { height: s * 1.5, radius: s * 0.42, tessellation: 48, capSubdivisions: 12 },
        scene,
      );
      m.position.set(p.x, s * 0.75, p.z);
      m.material = mat;
      return [m];
    }
    case 'donut': {
      const m = CreateTorus(name, { diameter: s, thickness: s * 0.45, tessellation: 64 }, scene);
      m.position.set(p.x, s * 0.23, p.z);
      m.material = mat;
      return [m];
    }
    case 'mushroom': {
      const stem = CreateCapsule(
        `${name}-stem`,
        { height: s * 0.9, radius: s * 0.2, tessellation: 32, capSubdivisions: 8 },
        scene,
      );
      stem.position.set(p.x, s * 0.45, p.z);
      stem.material = vinyl(scene, `${name}-stem-mat`, '#fff4ea');
      const cap = CreateSphere(`${name}-cap`, { diameter: s, segments: 48, slice: 0.55 }, scene);
      cap.scaling.y = 0.75;
      cap.position.set(p.x, s * 0.72, p.z);
      cap.material = mat;
      return [stem, cap];
    }
  }
}

/** A soft round shadow texture: cheap contact shadows without a shadow map. */
function blobShadowTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture('blob-shadow', { width: size, height: size }, scene, true);
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

export function buildTestScene(scene: Scene): SceneContent {
  scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);

  const island = CreateCylinder(
    'island',
    { diameter: ISLAND_RADIUS * 2, height: 1.2, tessellation: 128 },
    scene,
  );
  island.position.y = -0.6;
  const grass = new PBRMaterial('island-mat', scene);
  grass.albedoColor = Color3.FromHexString('#c8eebc').toLinearSpace();
  grass.metallic = 0;
  grass.roughness = 0.85;
  island.material = grass;

  const rim = CreateTorus(
    'island-rim',
    { diameter: ISLAND_RADIUS * 2, thickness: 1.2, tessellation: 128 },
    scene,
  );
  rim.position.y = -0.6;
  rim.material = grass;

  const materials = new Map<Pastel, PBRMaterial>();
  const shadowMat = new PBRMaterial('blob-shadow-mat', scene);
  shadowMat.unlit = true;
  shadowMat.albedoColor = Color3.FromHexString('#6b4b6e').toLinearSpace();
  shadowMat.albedoTexture = blobShadowTexture(scene);
  shadowMat.useAlphaFromAlbedoTexture = true;
  shadowMat.disableDepthWrite = true;

  const shadow = CreateGround('blob-shadows', { width: 1, height: 1 }, scene);
  shadow.material = shadowMat;
  shadow.isPickable = false;
  const rot = Quaternion.Identity();
  PLACEMENTS.forEach((p, i) => {
    let mat = materials.get(p.color);
    if (!mat) {
      mat = vinyl(scene, `vinyl-${p.color}`, PASTELS[p.color]);
      materials.set(p.color, mat);
    }
    buildShape(scene, p, mat, i);
    const d = p.size * 1.6;
    shadow.thinInstanceAdd(
      Matrix.Compose(new Vector3(d, 1, d), rot, new Vector3(p.x, 0.01, p.z)),
      i === PLACEMENTS.length - 1,
    );
  });

  // Nothing here moves, so Babylon can skip recomputing world matrices.
  for (const mesh of scene.meshes) mesh.freezeWorldMatrix();

  const r = ISLAND_RADIUS - 4;
  return { bounds: { minX: -r, maxX: r, minZ: -r, maxZ: r } };
}
