import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import { painted as paintedMesh } from '../map/map-props.js';
import { cylinderPart, disc, icoSphere, kitMesh, merged, painted, type Part } from './kit-mesh.js';

const newEngine = () =>
  new NullEngine({
    renderWidth: 64,
    renderHeight: 64,
    textureSize: 64,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });

/** One shape three ways round: moved, turned, squashed, mirrored, baked once on its own. */
function placements<T extends Mesh | Part>(make: {
  sphere: () => T;
  cylinder: () => T;
  disc: () => T;
  paint: (m: T, hex: string) => T;
}): T[] {
  const ball = make.sphere();
  ball.position.set(0.2, 0.5, -0.1);
  ball.scaling.set(1, 0.7, 1.3);
  const stem = make.cylinder();
  stem.position.set(0, 0.25, 0);
  stem.rotation.set(0.3, 1.1, -0.4);
  stem.bakeCurrentTransformIntoVertices();
  stem.scaling.set(1.5, 1.5, 1.5); // a scale on top of a bake, as the flower bed does
  const leaf = make.disc();
  leaf.rotation.x = Math.PI / 2;
  leaf.scaling.set(-1, 1.25, 1); // mirrored: the faces flip
  return [make.paint(ball, '#ff9fc0'), make.paint(stem, '#5f9f4f'), make.paint(leaf, '#fffaf0')];
}

const close = (
  a: ArrayLike<number> | null | undefined,
  b: ArrayLike<number> | null | undefined,
) => {
  expect(a?.length).toBe(b?.length);
  for (let i = 0; i < (a?.length ?? 0); i++) expect(a?.[i]).toBeCloseTo(b?.[i] ?? NaN, 5);
};

describe('merged parts (#501 D1)', () => {
  it('builds what Mesh.MergeMeshes built from meshes', () => {
    const scene = new Scene(newEngine());
    const options = {
      sphere: { radius: 0.3, subdivisions: 2, flat: false },
      cylinder: { height: 0.5, diameterTop: 0.02, diameterBottom: 0.03, tessellation: 6 },
      disc: { radius: 0.09, tessellation: 7 },
    };
    const meshes = placements<Mesh>({
      sphere: () => CreateIcoSphere('s', options.sphere, scene),
      cylinder: () => CreateCylinder('c', options.cylinder, scene),
      disc: () => CreateDisc('d', options.disc, scene),
      paint: paintedMesh,
    });
    const reference = Mesh.MergeMeshes(meshes, true, true)!;
    const part = merged(
      placements<Part>({
        sphere: () => icoSphere(options.sphere),
        cylinder: () => cylinderPart(options.cylinder),
        disc: () => disc(options.disc),
        paint: painted,
      }),
    );
    close(part.data.positions, reference.getVerticesData(VertexBuffer.PositionKind));
    close(part.data.normals, reference.getVerticesData(VertexBuffer.NormalKind));
    close(part.data.colors, reference.getVerticesData(VertexBuffer.ColorKind));
    close(part.data.uvs, reference.getVerticesData(VertexBuffer.UVKind));
    expect(Array.from(part.data.indices ?? [])).toEqual(Array.from(reference.getIndices() ?? []));

    // And as a kit mesh: the same vertices, side and bounds as the merged mesh.
    const mesh = kitMesh(scene, 'test-merged', () => part);
    close(
      mesh.getVerticesData(VertexBuffer.PositionKind),
      reference.getVerticesData(VertexBuffer.PositionKind),
    );
    expect(mesh.getTotalVertices()).toBe(reference.getTotalVertices());
    expect(mesh.getTotalIndices()).toBe(reference.getTotalIndices());
    expect(mesh.sideOrientation).toBe(reference.sideOrientation);
    const box = mesh.getBoundingInfo().boundingBox;
    close(box.minimum.asArray(), reference.getBoundingInfo().boundingBox.minimum.asArray());
    close(box.maximum.asArray(), reference.getBoundingInfo().boundingBox.maximum.asArray());
    expect(mesh.isPickable).toBe(false);
    expect(mesh.alwaysSelectAsActiveMesh).toBe(true);
    // It merged on the CPU: the only meshes in the scene are the two results.
    expect(scene.meshes.map((m) => m.name).sort()).toEqual(['s_merged', 'test-merged']);
  });
});

describe('kit meshes (#501 D1)', () => {
  const ball = () => merged([painted(icoSphere({ radius: 0.5, subdivisions: 2 }), '#ffffff')]);

  it('builds and uploads a kind once a page, and every later scene draws from it', () => {
    const engine = newEngine();
    const vertexBuffers = vi.spyOn(engine, 'createVertexBuffer');
    const indexBuffers = vi.spyOn(engine, 'createIndexBuffer');
    const build = vi.fn(ball);

    const first = new Scene(engine);
    const a = kitMesh(first, 'test-ball', build);
    const b = kitMesh(first, 'test-ball', build); // a second mesh of the kind (a faded copy)
    expect(build).toHaveBeenCalledTimes(1);
    const uploads = vertexBuffers.mock.calls.length;
    expect(uploads).toBe(4); // positions, normals, uvs, colours
    expect(indexBuffers).toHaveBeenCalledTimes(1);
    const indexCount = a.getTotalIndices();
    const vertexCount = a.getTotalVertices();
    expect(indexCount).toBeGreaterThan(0);
    expect(b.getTotalIndices()).toBe(indexCount);

    // The next scene (the next explore build) makes no buffers for it.
    first.dispose();
    const second = new Scene(engine);
    const c = kitMesh(second, 'test-ball', build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(vertexBuffers).toHaveBeenCalledTimes(uploads);
    expect(indexBuffers).toHaveBeenCalledTimes(1);
    // Disposing the first scene left the kit's buffers alone.
    expect(c.getTotalIndices()).toBe(indexCount);
    expect(c.getVerticesData(VertexBuffer.PositionKind)?.length).toBe(vertexCount * 3);
    const indices = c.geometry?.getIndexBuffer();
    expect(indices?.references).toBe(2); // the kit's own and this geometry's
    c.dispose();
    expect(indices?.references).toBe(1);
  });

  it('keeps each engine its own (a lost context rebuilds on a new one)', () => {
    const build = vi.fn(ball);
    kitMesh(new Scene(newEngine()), 'test-ball-engines', build);
    kitMesh(new Scene(newEngine()), 'test-ball-engines', build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('can still be recoloured, without touching the kit (the sky recolours its clouds)', () => {
    const engine = newEngine();
    const first = new Scene(engine);
    const mesh = kitMesh(first, 'test-ball-recolour', ball);
    const kitColours = mesh.getVertexBuffer(VertexBuffer.ColorKind)?.getData();
    mesh.setVerticesData(
      VertexBuffer.ColorKind,
      new Float32Array(mesh.getTotalVertices() * 4).fill(0.5),
    );
    const again = kitMesh(new Scene(engine), 'test-ball-recolour', ball);
    expect(again.getVertexBuffer(VertexBuffer.ColorKind)?.getData()).toBe(kitColours);
  });
});
