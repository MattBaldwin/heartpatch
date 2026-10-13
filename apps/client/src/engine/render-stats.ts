import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

/** Triangles the meshes picked for the last frame drew, instances counted (#318). */
export function activeTriangles(scene: Scene): number {
  const active = scene.getActiveMeshes();
  let triangles = 0;
  for (let i = 0; i < active.length; i++) {
    const mesh = active.data[i];
    if (!mesh) continue;
    // Instanced meshes (not thin instances) are each picked on their own.
    const copies = mesh instanceof Mesh && mesh.hasThinInstances ? mesh.thinInstanceCount : 1;
    triangles += (mesh.getTotalIndices() / 3) * copies;
  }
  return Math.round(triangles);
}

/** "61 draws · 729k tris", for the dev overlay. */
export function formatRenderStats(drawCalls: number, triangles: number): string {
  return `${String(drawCalls)} draws · ${String(Math.round(triangles / 1000))}k tris`;
}

/** What the badge's second line counts (#501): see `formatResourceStats`. */
export interface ResourceStats {
  readonly meshes: number;
  readonly materials: number;
  readonly textures: number;
  readonly animatables: number;
  /** WebGL objects since this engine's context was first counted, or null on WebGPU. */
  readonly gl: {
    readonly buffersMade: number;
    readonly buffersFreed: number;
    readonly texturesMade: number;
    readonly texturesFreed: number;
    readonly vertexArraysMade: number;
    readonly vertexArraysFreed: number;
    readonly programs: number;
  } | null;
  /** Squishy and Keeper batch uploads since the page opened. */
  readonly batchUploads: number;
  /** The governor's render scale (fraction of the DPR-capped resolution). */
  readonly renderScale: number;
}

/**
 * "48 mesh · 20 mat · 5 tex · 0 anim · buf +40/-12 · gltex +9/-2 · vao +30/-4 · 27 prog · 6 up · 1.00 scale":
 * the badge's second line (#501), so a count that climbs while a scene only
 * plays shows on a real device.
 */
export function formatResourceStats(s: ResourceStats): string {
  const parts = [
    `${String(s.meshes)} mesh`,
    `${String(s.materials)} mat`,
    `${String(s.textures)} tex`,
    `${String(s.animatables)} anim`,
  ];
  if (s.gl) {
    parts.push(
      `buf +${String(s.gl.buffersMade)}/-${String(s.gl.buffersFreed)}`,
      `gltex +${String(s.gl.texturesMade)}/-${String(s.gl.texturesFreed)}`,
      `vao +${String(s.gl.vertexArraysMade)}/-${String(s.gl.vertexArraysFreed)}`,
      `${String(s.gl.programs)} prog`,
    );
  }
  parts.push(`${String(s.batchUploads)} up`, `${s.renderScale.toFixed(2)} scale`);
  return parts.join(' · ');
}
