import { Buffer, VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { DataBuffer } from '@babylonjs/core/Buffers/dataBuffer';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDiscVertexData } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateIcoSphereVertexData } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorusVertexData } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Geometry } from '@babylonjs/core/Meshes/geometry';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

// Explore's kit geometry without GPU churn (#501 D1). The kit's shapes are
// built from a few primitives each, merged into one vertex-coloured mesh.
// Built as meshes and merged with `Mesh.MergeMeshes`, every primitive was a
// throwaway mesh whose buffers went to the GPU before the merge read them
// back (about 340 meshes and 2.4k buffers a tile). Here a primitive is a
// `Part`, vertex data on the CPU with a transform, merged on the CPU; the
// merged shape goes to the GPU once per page and every later scene's mesh of
// that kind draws from the same buffers, as the scenes come and go.

/**
 * A primitive on the CPU: its vertex data and a transform, which reads like
 * a mesh's (position, rotation, scaling; Babylon's order) so the kit's
 * shapes are written as before.
 */
export class Part {
  readonly position = Vector3.Zero();
  readonly rotation = Vector3.Zero();
  readonly scaling = Vector3.One();
  readonly data: VertexData;

  constructor(data: VertexData) {
    this.data = data;
  }

  getTotalVertices(): number {
    return (this.data.positions?.length ?? 0) / 3;
  }

  /**
   * Moves the vertices by the transform and resets it, as a mesh's own bake
   * does: normals come out unit length, faces flip under a mirroring scale.
   */
  bakeCurrentTransformIntoVertices(): this {
    bake(this, true);
    return this;
  }
}

/**
 * Applies a part's transform to its vertices and resets it. `unit`: a
 * mesh's bake, normals made unit length; else as `Mesh.MergeMeshes` moved
 * each mesh into place (`VertexData.transform`), normals left scaled.
 */
function bake(part: Part, unit: boolean): Part {
  const { position, rotation, scaling, data } = part;
  data.transform(
    Matrix.Compose(
      scaling,
      Quaternion.RotationYawPitchRoll(rotation.y, rotation.x, rotation.z),
      position,
    ),
  );
  const normals = data.normals;
  for (let i = 0; unit && normals && i < normals.length; i += 3) {
    const x = normals[i] ?? 0;
    const y = normals[i + 1] ?? 0;
    const z = normals[i + 2] ?? 0;
    const length = Math.hypot(x, y, z) || 1;
    normals[i] = x / length;
    normals[i + 1] = y / length;
    normals[i + 2] = z / length;
  }
  position.setAll(0);
  rotation.setAll(0);
  scaling.setAll(1);
  return part;
}

/** Babylon's builders' shapes, as parts (same options, same vertices). */
export const icoSphere = (options: Parameters<typeof CreateIcoSphereVertexData>[0]) =>
  new Part(CreateIcoSphereVertexData(options));
export const uvSphere = (options: Parameters<typeof CreateSphereVertexData>[0]) =>
  new Part(CreateSphereVertexData(options));
export const cylinderPart = (options: Parameters<typeof CreateCylinderVertexData>[0]) =>
  new Part(CreateCylinderVertexData(options));
export const disc = (options: Parameters<typeof CreateDiscVertexData>[0]) =>
  new Part(CreateDiscVertexData(options));
export const box = (options: Parameters<typeof CreateBoxVertexData>[0]) =>
  new Part(CreateBoxVertexData(options));
export const torus = (options: Parameters<typeof CreateTorusVertexData>[0]) =>
  new Part(CreateTorusVertexData(options));

/** Paints a part one colour, linear (the map props' `painted`, on a part). */
export function painted(part: Part, hex: string): Part {
  const c = Color3.FromHexString(hex).toLinearSpace();
  const colors = new Float32Array(part.getTotalVertices() * 4);
  for (let i = 0; i < colors.length; i += 4) colors.set([c.r, c.g, c.b, 1], i);
  part.data.colors = colors;
  return part;
}

/** Parts baked and merged into one, on the CPU (what `Mesh.MergeMeshes` did with meshes). */
export function merged(parts: readonly Part[]): Part {
  const [first, ...rest] = parts.map((p) => bake(p, false).data);
  if (!first) throw new Error('nothing to merge');
  if (rest.length > 0) first.merge(rest, true);
  return new Part(first);
}

/** A kind's shape on the GPU: one buffer per attribute and the indices, shared by every scene. */
interface Kit {
  readonly attributes: readonly (readonly [kind: string, buffer: Buffer])[];
  readonly indices: DataBuffer;
  readonly vertices: number;
  readonly indexCount: number;
}

/**
 * The kits on the GPU, by engine (a lost context's rebuild makes a new
 * engine, so it starts empty) and then by kind. Kept for the page: a few
 * dozen small shapes, while each explore build used to make thousands of
 * buffers.
 */
const kits = new WeakMap<AbstractEngine, Map<string, Kit>>();

const ATTRIBUTES: readonly (readonly [
  string,
  'positions' | 'normals' | 'uvs' | 'colors',
  number,
])[] = [
  [VertexBuffer.PositionKind, 'positions', 3],
  [VertexBuffer.NormalKind, 'normals', 3],
  [VertexBuffer.UVKind, 'uvs', 2],
  [VertexBuffer.ColorKind, 'colors', 4],
];

function upload(engine: AbstractEngine, name: string, part: Part): Kit {
  const data = bake(part, false).data;
  const attributes: [string, Buffer][] = [];
  for (const [kind, key, size] of ATTRIBUTES) {
    const values = data[key];
    if (!values) continue;
    const floats = Float32Array.from(values);
    const label = `${name}-${kind}`;
    attributes.push([kind, new Buffer(engine, floats, false, size, false, false, false, 1, label)]);
  }
  const indices = data.indices ?? [];
  return {
    attributes,
    indices: engine.createIndexBuffer(indices, false, `${name}-indices`),
    vertices: part.getTotalVertices(),
    indexCount: indices.length,
  };
}

/**
 * A mesh of one kit kind in `scene`. The first call on an engine builds the
 * shape (`build`) and uploads it; every later one, in this scene or the
 * next, draws from those buffers and builds nothing. `name` is the kind:
 * one name, one shape. The mesh's geometry is the GPU's only (no CPU copy of
 * the indices), so it is drawn, placed and thin-instanced, never edited.
 */
export function kitMesh(scene: Scene, name: string, build: () => Part): Mesh {
  const engine = scene.getEngine();
  let byKind = kits.get(engine);
  if (!byKind) {
    byKind = new Map();
    kits.set(engine, byKind);
  }
  let kit = byKind.get(name);
  if (!kit) {
    kit = upload(engine, name, build());
    byKind.set(name, kit);
  }
  const geometry = new Geometry(Geometry.RandomId(), scene);
  for (const [kind, buffer] of kit.attributes) {
    // Not owned: disposing the scene frees the geometry, never the kit's buffers.
    const size = buffer.byteStride / Float32Array.BYTES_PER_ELEMENT;
    geometry.setVerticesBuffer(buffer.createVertexBuffer(kind, 0, size), kit.vertices);
  }
  // The geometry releases its index buffer when disposed: one reference each, the kit keeps its own.
  kit.indices.references++;
  geometry.setIndexBuffer(kit.indices, kit.vertices, kit.indexCount, kit.indices.is32Bits);
  const mesh = new Mesh(name, scene);
  geometry.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}
