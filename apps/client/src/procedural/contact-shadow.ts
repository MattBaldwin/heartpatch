import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { CONTACT_SHADOW } from './config.js';

/**
 * A soft round shadow under each squishy: one unit quad, drawn once per
 * squishy as a thin instance. Cheap contact shadows without a shadow map.
 */
export function createContactShadowMesh(scene: Scene): Mesh {
  const size = 64;
  const texture = new DynamicTexture('squishy-shadow', { width: size, height: size }, scene, true);
  const ctx = texture.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.4)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.update();

  const material = new PBRMaterial('squishy-shadow-mat', scene);
  material.unlit = true;
  material.albedoColor = Color3.FromHexString(CONTACT_SHADOW.color).toLinearSpace();
  material.albedoTexture = texture;
  material.useAlphaFromAlbedoTexture = true;
  material.disableDepthWrite = true;

  const mesh = CreateGround('squishy-shadows', { width: 1, height: 1 }, scene);
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}
