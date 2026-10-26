import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { merged } from '../map/map-props.js';
import { CLOUD_ATTRIBUTE } from './cloud-plugin.js';
import { WEATHER_LOOK } from './weather-config.js';

const { squash, floor, sun } = WEATHER_LOOK.clouds;

/** [diameter, x, y, z] of each puff of the one cloud shape. */
const PUFFS = [
  [1.5, 0, -0.06, 0],
  [1, 0, 0, 0],
  [0.72, 0.5, -0.04, 0.12],
  [0.66, -0.46, -0.05, -0.08],
  [0.6, 0.12, 0.2, -0.16],
  [0.5, -0.2, 0.17, 0.2],
] as const;

/**
 * One cloud: a few cushions fused into a single mesh with rounded tops and a
 * flat bottom (anything below `floor` is pressed up to it). Each vertex carries
 * its height up the whole cloud and how much it faces the sun, for the shade in
 * cloud-plugin.ts.
 */
export function buildCloud(scene: Scene): Mesh {
  const parts = PUFFS.map(([d, x, y, z], i) => {
    const p = CreateSphere(`wc${i}`, { diameter: d, segments: 12 }, scene);
    p.position.set(x, y, z);
    p.scaling.y = squash;
    return p;
  });
  const cloud = merged('weather-clouds', parts);
  const at = cloud.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const normals = cloud.getVerticesData(VertexBuffer.NormalKind) ?? [];
  const n = at.length / 3;
  const norm = Math.hypot(...sun) || 1;
  let high: number = floor;
  for (let i = 0; i < n; i++) high = Math.max(high, at[i * 3 + 1] ?? 0);
  const shade = new Float32Array(n * 4);
  const flat = normals.slice();
  for (let i = 0; i < n; i++) {
    const y = at[i * 3 + 1] ?? 0;
    const pressed = y < floor;
    if (pressed) {
      at[i * 3 + 1] = floor;
      flat[i * 3] = 0;
      flat[i * 3 + 1] = -1;
      flat[i * 3 + 2] = 0;
    }
    const facing =
      ((flat[i * 3] ?? 0) * sun[0] +
        (flat[i * 3 + 1] ?? 0) * sun[1] +
        (flat[i * 3 + 2] ?? 0) * sun[2]) /
      norm;
    shade[i * 4] = Math.min(1, Math.max(0, ((at[i * 3 + 1] ?? 0) - floor) / (high - floor)));
    shade[i * 4 + 1] = Math.max(0, facing);
  }
  cloud.setVerticesData(VertexBuffer.PositionKind, at);
  cloud.setVerticesData(VertexBuffer.NormalKind, flat);
  cloud.setVerticesData(CLOUD_ATTRIBUTE, shade, false, 4);
  return cloud;
}

/** A small zig-zag bolt in the x-y plane, 1 tall, hanging from y = 0 to -1. */
export function buildBolt(scene: Scene, width: number): Mesh {
  const w = width;
  // Left and right edges of each of five kinks, top to bottom.
  const kinks = [
    [0, 0],
    [-0.18, -0.25],
    [0.14, -0.45],
    [-0.14, -0.7],
    [0.02, -1],
  ] as const;
  const positions: number[] = [];
  for (const [cx, y] of kinks) positions.push(cx - 0.5 * w, y, 0, cx + 0.5 * w, y, 0);
  const indices: number[] = [];
  for (let i = 0; i < kinks.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const mesh = new Mesh('weather-bolt', scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.applyToMesh(mesh, true);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}
