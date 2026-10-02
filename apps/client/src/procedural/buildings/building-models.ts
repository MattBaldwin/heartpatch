import { Color3 } from '@babylonjs/core/Maths/math.color';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { BUILDING_COLORS as C } from './building-config.js';

// Procedural building models (design doc §13, §19): primitives merged into
// one vertex-coloured mesh per look, so every building of a kind is one draw
// call (CLAUDE.md rule 8). Glowing parts (flames, a lit grin) are a second
// mesh drawn with an unlit material. No textures, no third-party art.

/** One look of a building: its body and, if it has one, its glowing parts. */
export interface BuildingModel {
  readonly body: Mesh;
  readonly glow: Mesh | null;
}

/** Which look a building shows: lit or out for fires; one look for the rest. */
export type BuildingLook = 'lit' | 'out' | 'plain';

/** The model key for a building and its look. */
export function modelKey(buildingId: string, look: BuildingLook): string {
  return `${buildingId}:${look}`;
}

function linear(hex: string): Color3 {
  return Color3.FromHexString(hex).toLinearSpace();
}

/** Builds one look. Unknown ids get a plain marker so new data never breaks the scene. */
export function buildBuildingModel(
  scene: Scene,
  buildingId: string,
  look: BuildingLook,
): BuildingModel {
  const name = modelKey(buildingId, look);
  const body: Mesh[] = [];
  const glow: Mesh[] = [];
  const part = (
    list: Mesh[],
    mesh: Mesh,
    color: string,
    at: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
    rotation: [number, number, number] = [0, 0, 0],
  ): void => {
    mesh.position.set(...at);
    mesh.scaling.set(...scale);
    mesh.rotation.set(...rotation);
    const c = linear(color);
    const count = mesh.getTotalVertices();
    const colors = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b, 1], i * 4);
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    list.push(mesh);
  };
  const sphere = (d: number, segments = 12) =>
    CreateSphere(`${name}-part`, { diameter: d, segments }, scene);
  const cylinder = (h: number, top: number, bottom: number, tessellation = 12) =>
    CreateCylinder(
      `${name}-part`,
      { height: h, diameterTop: top, diameterBottom: bottom, tessellation },
      scene,
    );
  /** Calls `make` for `count` angles evenly around a circle. */
  const around = (count: number, make: (angle: number, i: number) => void) => {
    for (let i = 0; i < count; i++) make((i / count) * Math.PI * 2, i);
  };

  // TUNE: every size and colour below.
  switch (buildingId) {
    case 'hearthfire': {
      around(7, (a, i) => {
        part(
          body,
          sphere(0.2, 8),
          i % 2 === 0 ? C.stone : C.stoneDark,
          [Math.cos(a) * 0.36, 0.06, Math.sin(a) * 0.36],
          [1.1, 0.65, 1],
        );
      });
      for (const turn of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        part(
          body,
          cylinder(0.5, 0.09, 0.1),
          C.log,
          [0, 0.08, 0],
          [1, 1, 1],
          [Math.PI / 2, turn, 0],
        );
      }
      if (look === 'lit') {
        part(glow, sphere(0.34), C.flame, [0, 0.27, 0], [1, 1.35, 1]);
        part(glow, sphere(0.2), C.flameCore, [0, 0.33, 0], [1, 1.4, 1]);
        part(glow, sphere(0.12), C.flame, [0.1, 0.5, 0.02], [1, 1.5, 1]);
      } else {
        part(body, sphere(0.3), C.ash, [0, 0.12, 0], [1, 0.45, 1]);
      }
      break;
    }
    case 'jack-o-lantern-hearthfire': {
      around(6, (a) => {
        part(
          body,
          sphere(0.38, 12),
          C.pumpkin,
          [Math.cos(a) * 0.12, 0.3, Math.sin(a) * 0.12],
          [0.85, 1, 0.85],
        );
      });
      part(body, sphere(0.6, 16), C.pumpkinDark, [0, 0.3, 0], [1.05, 0.95, 1.05]);
      part(body, cylinder(0.16, 0.05, 0.08), C.stem, [0, 0.64, 0], [1, 1, 1], [0.15, 0, 0.1]);
      // The grin faces the camera (−z).
      const faceList = look === 'lit' ? glow : body;
      const face = look === 'lit' ? C.face : C.faceOut;
      part(faceList, sphere(0.12, 8), face, [-0.12, 0.38, -0.29], [1, 1.2, 0.35]);
      part(faceList, sphere(0.12, 8), face, [0.12, 0.38, -0.29], [1, 1.2, 0.35]);
      part(faceList, sphere(0.26, 10), face, [0, 0.22, -0.28], [1.3, 0.45, 0.35]);
      break;
    }
    case 'ember-den': {
      part(body, cylinder(0.08, 0.98, 1, 24), C.denTrim, [0, 0.04, 0]);
      part(body, sphere(0.86, 20), C.den, [0, 0.08, 0], [1, 0.82, 1]);
      part(body, sphere(0.34, 12), C.door, [0, 0.16, -0.38], [0.85, 1, 0.3]);
      part(body, cylinder(0.24, 0.1, 0.12), C.denTrim, [0.22, 0.56, 0.1]);
      part(glow, sphere(0.1, 8), C.flame, [0.22, 0.72, 0.1], [1, 1.3, 1]);
      break;
    }
    case 'cozy-meadow': {
      part(body, cylinder(0.06, 1, 1, 24), C.grass, [0, 0.03, 0]);
      around(9, (a) => {
        part(body, cylinder(0.18, 0.06, 0.07, 8), C.fence, [
          Math.cos(a) * 0.46,
          0.12,
          Math.sin(a) * 0.46,
        ]);
      });
      part(
        body,
        CreateTorus(`${name}-rail`, { diameter: 0.92, thickness: 0.04, tessellation: 24 }, scene),
        C.fence,
        [0, 0.16, 0],
      );
      for (const [x, z, color] of [
        [-0.2, 0.15, C.petal],
        [0.18, -0.1, C.petalAlt],
        [0.05, 0.28, C.petal],
        [-0.12, -0.24, C.petalAlt],
      ] as const) {
        part(body, sphere(0.09, 8), color, [x, 0.08, z], [1, 0.7, 1]);
      }
      break;
    }
    default:
      part(body, CreateBox(`${name}-box`, { size: 0.5 }, scene), C.plain, [0, 0.25, 0]);
  }

  const merge = (parts: Mesh[], suffix: string): Mesh | null => {
    if (parts.length === 0) return null;
    const mesh = Mesh.MergeMeshes(parts, true, true);
    if (!mesh) throw new Error(`could not build ${name}`);
    mesh.name = `${name}${suffix}`;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  };
  const merged = merge(body, '');
  if (!merged) throw new Error(`${name} has no body`);
  return { body: merged, glow: merge(glow, '-glow') };
}
