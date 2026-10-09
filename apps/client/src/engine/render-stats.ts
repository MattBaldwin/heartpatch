import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

/** Triangles the meshes picked for the last frame drew, instances counted (#318). */
export function activeTriangles(scene: Scene): number {
  const active = scene.getActiveMeshes();
  let triangles = 0;
  for (let i = 0; i < active.length; i++) {
    const mesh = active.data[i] as Mesh;
    const copies = mesh.hasThinInstances ? mesh.thinInstanceCount : 1;
    triangles += (mesh.getTotalIndices() / 3) * copies;
  }
  return Math.round(triangles);
}

/** "61 draws · 729k tris", for the dev overlay. */
export function formatRenderStats(drawCalls: number, triangles: number): string {
  return `${String(drawCalls)} draws · ${String(Math.round(triangles / 1000))}k tris`;
}
